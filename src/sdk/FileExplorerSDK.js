/**
 * FileExplorerSDK — a framework-independent, in-memory file tree.
 *
 * Core design decisions:
 * - Internal state is a `Map<id, Node>` of immutable, frozen node objects.
 *   Changing a node always *replaces* it; nothing is mutated in place.
 *   This gives cheap transaction rollback, structural sharing for React,
 *   and safe returns to consumers for free.
 * - Node shape: `{ id, name, type: 'file'|'folder', parentId, childIds }`.
 *   Files always have `childIds: []`.
 * - Child order: `childIds` keeps insertion order (so undo restores exact
 *   positions). The *output tree* is sorted folders-first, then by name.
 * - One mutation pipeline: validate → build command → _commit(command, event).
 *   Nothing else touches state.
 * - This module must never import React or touch the DOM.
 */

import { createEmitter } from './emitter.js';
import { FileExplorerError, ErrorCodes } from './errors.js';
import {
  NODE_TYPES,
  DEFAULT_ROOT_NAME,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_ACTIVITY_LIMIT,
  HISTORY_COMMAND_TYPES,
} from './constants.js';
import { normalizeName, nameKey, generateId, deepFreeze } from './utils.js';
import { createHistory } from './history.js';
import { runSearch } from './search.js';
import {
  requireNode,
  requireFolder,
  validateName,
  assertNameAvailable,
} from './validators.js';

/**
 * @typedef {object} Node
 * @property {string} id
 * @property {string} name
 * @property {'file'|'folder'} type
 * @property {string|null} parentId - null only for the root
 * @property {string[]} childIds - insertion order; always [] for files
 */

/**
 * @typedef {object} FileExplorerSDKOptions
 * @property {{ children?: Array<object> }} [initialData] - nested seed structure
 * @property {() => string} [idGenerator] - injectable for deterministic tests
 * @property {number} [historyLimit=100]
 * @property {number} [activityLimit=50]
 * @property {string} [rootName='My Files']
 */

export class FileExplorerSDK {
  /**
   * @param {FileExplorerSDKOptions} [options]
   */
  constructor(options = {}) {
    const {
      initialData,
      idGenerator,
      historyLimit = DEFAULT_HISTORY_LIMIT,
      activityLimit = DEFAULT_ACTIVITY_LIMIT,
      rootName = DEFAULT_ROOT_NAME,
    } = options;

    /** @private */
    this._idGenerator = typeof idGenerator === 'function' ? idGenerator : generateId;
    /** @private */
    this._historyLimit = historyLimit;
    /** @private */
    this._activityLimit = activityLimit;

    /** @private @type {Map<string, Node>} */
    this._nodes = new Map();
    /** @private */
    this._rootId = this._idGenerator();
    /** @private */
    this._version = 0;
    /** @private {null | { commands: object[], events: object[] }} */
    this._tx = null;
    /** @private {object[]} */
    this._activity = [];
    /** @private */
    this._emitter = createEmitter();
    /** @private */
    this._history = createHistory(this._historyLimit);
    /** @private {Map<string, { node: Node, sortedChildren: object[], tree: object }>|null} */
    this._snapshotCache = null;
    /** @private {object|null} */
    this._snapshot = null;
    /** @private {number} version the current snapshot was built at */
    this._snapshotVersion = -1;

    const rootNameFinal = normalizeName(rootName) || DEFAULT_ROOT_NAME;
    this._put({
      id: this._rootId,
      name: rootNameFinal,
      type: NODE_TYPES.FOLDER,
      parentId: null,
      childIds: [],
    });

    if (initialData) {
      this._seedChildren(initialData, this._rootId);
    }

    // Bind the methods React passes around so they can be used unbound
    // (useSyncExternalStore requires stable, callable references).
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.getTree = this.getTree.bind(this);
    this.getVersion = this.getVersion.bind(this);
    this.canUndo = this.canUndo.bind(this);
    this.canRedo = this.canRedo.bind(this);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private raw primitives — no validation, no history, no notification.
  // Every state change in the SDK flows through these.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Freezes a node and stores it, replacing any previous version.
   * @private
   * @param {Node} node
   * @returns {Node} the frozen stored node
   */
  _put(node) {
    const frozen = Object.freeze({
      ...node,
      childIds: Object.freeze([...node.childIds]),
    });
    this._nodes.set(frozen.id, frozen);
    return frozen;
  }

  /**
   * Replaces a node with a patched copy (shallow merge).
   * @private
   * @param {string} id
   * @param {Partial<Node>} patch
   * @returns {Node} the new frozen node
   */
  _rewrite(id, patch) {
    const node = this._nodes.get(id);
    return this._put({ ...node, ...patch });
  }

  /**
   * Stores a node and splices its id into the parent's childIds at `index`.
   * @private
   * @param {Node} node
   * @param {string} parentId
   * @param {number} [index] - defaults to append
   */
  _insert(node, parentId, index = this._nodes.get(parentId).childIds.length) {
    this._put(node);
    const parent = this._nodes.get(parentId);
    const childIds = [...parent.childIds];
    childIds.splice(index, 0, node.id);
    this._rewrite(parentId, { childIds });
  }

  /**
   * Removes a node and its entire subtree from the store, and splices the
   * node out of its parent's childIds.
   * @private
   * @param {string} id
   * @returns {{ nodes: Record<string, Node>, parentId: string, index: number }}
   *   the removed nodes keyed by id, plus where they came from
   */
  _removeSubtree(id) {
    const node = this._nodes.get(id);
    const parentId = node.parentId;
    const parent = this._nodes.get(parentId);
    const index = parent.childIds.indexOf(id);

    /** @type {Record<string, Node>} */
    const removedNodes = {};
    /** @type {string[]} */
    const stack = [id];
    while (stack.length > 0) {
      const currentId = stack.pop();
      const current = this._nodes.get(currentId);
      if (!current) continue;
      removedNodes[currentId] = current;
      for (const childId of current.childIds) stack.push(childId);
      this._nodes.delete(currentId);
    }

    const childIds = [...parent.childIds];
    childIds.splice(index, 1);
    this._rewrite(parentId, { childIds });

    return { nodes: removedNodes, parentId, index };
  }

  /**
   * Re-inserts a previously removed subtree (same objects, same ids) and
   * splices the subtree root back into the parent at `index`.
   * @private
   * @param {Record<string, Node>} removedNodes
   * @param {string} subtreeRootId
   * @param {string} parentId
   * @param {number} index
   */
  _reinsertSubtree(removedNodes, subtreeRootId, parentId, index) {
    for (const node of Object.values(removedNodes)) {
      this._nodes.set(node.id, node);
    }
    const parent = this._nodes.get(parentId);
    const childIds = [...parent.childIds];
    childIds.splice(index, 0, subtreeRootId);
    this._rewrite(parentId, { childIds });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Seeding
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Builds children of `parentId` from a nested seed structure using the raw
   * primitives, so seeded data never appears in history or the activity log.
   * @private
   */
  _seedChildren(data, parentId) {
    const children = Array.isArray(data) ? data : data?.children;
    if (!children) return;

    const seen = new Set();
    for (const child of children) {
      const name = normalizeName(child.name);
      if (!name || name.includes('/')) {
        throw new FileExplorerError(
          ErrorCodes.INVALID_NAME,
          `Invalid seed name: ${JSON.stringify(child.name)}`,
          child.name
        );
      }
      const key = nameKey(name);
      if (seen.has(key)) {
        throw new FileExplorerError(
          ErrorCodes.DUPLICATE_NAME,
          `Duplicate seed name among siblings: ${name}`,
          name
        );
      }
      seen.add(key);

      const type = child.type === NODE_TYPES.FOLDER ? NODE_TYPES.FOLDER : NODE_TYPES.FILE;
      const id = this._idGenerator();
      const node = {
        id,
        name,
        type,
        parentId,
        childIds: [],
      };
      this._put(node);
      const parent = this._nodes.get(parentId);
      this._rewrite(parentId, { childIds: [...parent.childIds, id] });

      if (type === NODE_TYPES.FOLDER && child.children) {
        this._seedChildren(child, id);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Reads
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Returns the root node id.
   * @returns {string}
   */
  getRootId() {
    return this._rootId;
  }

  /**
   * Returns a frozen copy of a single node.
   * @param {string} id
   * @returns {Readonly<Node>}
   * @throws {FileExplorerError} NOT_FOUND when the id is unknown
   */
  getItem(id) {
    const node = this._nodes.get(id);
    if (!node) {
      throw new FileExplorerError(
        ErrorCodes.NOT_FOUND,
        `No item with id "${id}"`,
        id
      );
    }
    return Object.freeze({ ...node, childIds: Object.freeze([...node.childIds]) });
  }

  /**
   * Whether an id exists in the tree.
   * @param {string} id
   * @returns {boolean}
   */
  hasItem(id) {
    return this._nodes.has(id);
  }

  /**
   * Returns the path from the root to `id`.
   * @param {string} id
   * @returns {Readonly<{ ids: string[], names: string[], text: string }>}
   *   e.g. `{ ids: [...], names: [...], text: 'My Files / Documents / Resume.pdf' }`
   * @throws {FileExplorerError} NOT_FOUND
   */
  getPath(id) {
    if (!this._nodes.has(id)) {
      throw new FileExplorerError(
        ErrorCodes.NOT_FOUND,
        `No item with id "${id}"`,
        id
      );
    }
    /** @type {string[]} */
    const ids = [];
    /** @type {string[]} */
    const names = [];
    let current = this._nodes.get(id);
    while (current) {
      ids.unshift(current.id);
      names.unshift(current.name);
      current = current.parentId ? this._nodes.get(current.parentId) : null;
    }
    return Object.freeze({
      ids: Object.freeze(ids),
      names: Object.freeze(names),
      text: names.join(' / '),
    });
  }

  /**
   * Current version counter. Bumps on every successful change.
   * @returns {number}
   */
  getVersion() {
    return this._version;
  }

  /**
   * Number of nodes currently stored (root included).
   * Mostly useful for tests and demos.
   * @returns {number}
   */
  getSize() {
    return this._nodes.size;
  }

  /**
   * Subscribes to SDK change events.
   * @param {(event: { type: string, version: number }) => void} listener
   * @returns {() => void} unsubscribe function (safe to call twice)
   */
  subscribe(listener) {
    return this._emitter.subscribe(listener);
  }

  /**
   * @returns {number} the number of active subscribers
   */
  listenerCount() {
    return this._emitter.listenerCount();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Mutation pipeline: validate → build command → _commit
  // ────────────────────────────────────────────────────────────────────────

  /**
   * The single funnel for every successful mutation.
   *
   * Outside a transaction: applies the command, records it in history, and
   * bumps version + notifies via `_bump`.
   * Inside a transaction: applies and buffers; history push and
   * notification happen once, when the transaction commits.
   *
   * Validation must already have happened — this method never throws for
   * user errors.
   *
   * @private
   * @param {{ type: string, label: string, apply: () => void, revert: () => void }} command
   * @param {{ type: string, [key: string]: any }} event
   */
  _commit(command, event) {
    command.apply();
    // Invalidate the cached snapshot: this also covers reads made inside a
    // transaction (where the version does not change until commit).
    this._snapshot = null;

    if (this._tx) {
      this._tx.commands.push(command);
      this._tx.events.push(event);
      return;
    }

    if (this._history) {
      this._history.push(command);
    }
    this._bump(event);
  }

  /**
   * Bumps the version, appends to the capped activity log, and notifies
   * subscribers with `{ ...event, version }`.
   * @private
   * @param {{ type: string, [key: string]: any }} event
   */
  _bump(event) {
    this._version += 1;

    const entry = {
      id: this._idGenerator(),
      type: event.type,
      message: this._describeEvent(event),
      itemId: event.itemId ?? null,
      timestamp: Date.now(),
      version: this._version,
    };
    this._activity.push(entry);
    if (this._activity.length > this._activityLimit) {
      this._activity.shift(); // keep only the most recent entries
    }

    this._emitter.emit({ ...event, version: this._version });
  }

  /**
   * Builds a human-readable activity-log message for an event.
   * @private
   * @param {{ type: string, [key: string]: any }} event
   * @returns {string}
   */
  _describeEvent(event) {
    switch (event.type) {
      case 'create':
        return `Created ${event.itemType} "${event.name}"`;
      case 'rename':
        return `Renamed "${event.oldName}" to "${event.newName}"`;
      case 'move':
        return `Moved "${event.name}"`;
      case 'delete':
        return `Deleted "${event.name}"`;
      case 'undo':
        return `Undid: ${event.command}`;
      case 'redo':
        return `Redid: ${event.command}`;
      case 'transaction':
        return `Transaction with ${event.count} operation${event.count === 1 ? '' : 's'}`;
      default:
        return event.type;
    }
  }

  /**
   * Creates a new file inside `parentId`.
   * @param {string} parentId
   * @param {string} name
   * @returns {Readonly<Node>} the new item (frozen copy)
   * @throws {FileExplorerError} NOT_FOUND | INVALID_PARENT | INVALID_NAME | DUPLICATE_NAME
   */
  createFile(parentId, name) {
    return this._create(NODE_TYPES.FILE, parentId, name);
  }

  /**
   * Creates a new folder inside `parentId`.
   * @param {string} parentId
   * @param {string} name
   * @returns {Readonly<Node>} the new item (frozen copy)
   * @throws {FileExplorerError} NOT_FOUND | INVALID_PARENT | INVALID_NAME | DUPLICATE_NAME
   */
  createFolder(parentId, name) {
    return this._create(NODE_TYPES.FOLDER, parentId, name);
  }

  /**
   * Shared implementation behind createFile/createFolder.
   * @private
   */
  _create(type, parentId, name) {
    // 1. validate everything first
    requireFolder(this._nodes, parentId);
    const finalName = validateName(name);
    assertNameAvailable(this._nodes, parentId, finalName);

    // 2. build the node and the command that can re-apply/revert it
    const node = {
      id: this._idGenerator(),
      name: finalName,
      type,
      parentId,
      childIds: [],
    };
    const command = {
      type: HISTORY_COMMAND_TYPES.CREATE,
      label: `Create ${type} "${finalName}"`,
      // Same node object (same id) on redo, so identity is preserved.
      apply: () => this._insert(node, parentId),
      revert: () => {
        this._removeSubtree(node.id);
      },
    };

    // 3. mutate only now
    this._commit(command, {
      type: 'create',
      itemId: node.id,
      name: finalName,
      itemType: type,
      parentId,
    });
    return this.getItem(node.id);
  }

  /**
   * Renames an item. The root cannot be renamed. Renaming to the same name
   * is a no-op: the item is returned unchanged, with no history entry and no
   * notification. A case-only rename (a.txt → A.txt) is allowed.
   *
   * @param {string} id
   * @param {string} newName
   * @returns {Readonly<Node>} the updated item (frozen copy)
   * @throws {FileExplorerError} NOT_FOUND | ROOT_PROTECTED | INVALID_NAME | DUPLICATE_NAME
   */
  rename(id, newName) {
    requireNode(this._nodes, id);
    if (id === this._rootId) {
      throw new FileExplorerError(
        ErrorCodes.ROOT_PROTECTED,
        'The root folder cannot be renamed',
        id
      );
    }
    const node = this._nodes.get(id);
    const finalName = validateName(newName);

    if (finalName === node.name) {
      return this.getItem(id); // no-op
    }
    assertNameAvailable(this._nodes, node.parentId, finalName, id);

    const oldName = node.name;
    const command = {
      type: HISTORY_COMMAND_TYPES.RENAME,
      label: `Rename "${oldName}" to "${finalName}"`,
      apply: () => this._rewrite(id, { name: finalName }),
      revert: () => this._rewrite(id, { name: oldName }),
    };
    this._commit(command, {
      type: 'rename',
      itemId: id,
      oldName,
      newName: finalName,
    });
    return this.getItem(id);
  }

  /**
   * Moves an item into another folder, appended as the last child.
   * Moving to the same parent is a no-op: the item is returned unchanged,
   * with no history entry and no notification.
   *
   * Validation order (fixed, so errors are predictable):
   * 1. item exists  2. not root  3. target exists and is a folder
   * 4. same parent → no-op  5. target is not the item itself or a descendant
   * 6. name is free in the target folder
   *
   * @param {string} id
   * @param {string} newParentId
   * @returns {Readonly<Node>} the updated item (frozen copy)
   * @throws {FileExplorerError} NOT_FOUND | ROOT_PROTECTED | INVALID_PARENT
   *   | INVALID_MOVE | DUPLICATE_NAME
   */
  move(id, newParentId) {
    requireNode(this._nodes, id);
    if (id === this._rootId) {
      throw new FileExplorerError(
        ErrorCodes.ROOT_PROTECTED,
        'The root folder cannot be moved',
        id
      );
    }
    const target = requireFolder(this._nodes, newParentId);
    const node = this._nodes.get(id);

    if (node.parentId === newParentId) {
      return this.getItem(id); // no-op
    }

    // Walk up from the *target*: if we meet the item's id, the target is the
    // item itself or one of its descendants.
    let cursor = target;
    while (cursor) {
      if (cursor.id === id) {
        throw new FileExplorerError(
          ErrorCodes.INVALID_MOVE,
          `Cannot move "${node.name}" into itself or one of its descendants`,
          { id, newParentId }
        );
      }
      cursor = cursor.parentId ? this._nodes.get(cursor.parentId) : null;
    }

    assertNameAvailable(this._nodes, newParentId, node.name);

    const oldParentId = node.parentId;
    const oldIndex = this._nodes.get(oldParentId).childIds.indexOf(id);
    const name = node.name;

    const command = {
      type: HISTORY_COMMAND_TYPES.MOVE,
      label: `Move "${name}"`,
      apply: () => {
        const oldParent = this._nodes.get(oldParentId);
        this._rewrite(oldParentId, {
          childIds: oldParent.childIds.filter((childId) => childId !== id),
        });
        const newParent = this._nodes.get(newParentId);
        this._rewrite(newParentId, {
          childIds: [...newParent.childIds, id],
        });
        this._rewrite(id, { parentId: newParentId });
      },
      revert: () => {
        const newParent = this._nodes.get(newParentId);
        this._rewrite(newParentId, {
          childIds: newParent.childIds.filter((childId) => childId !== id),
        });
        const oldParent = this._nodes.get(oldParentId);
        const childIds = [...oldParent.childIds];
        childIds.splice(oldIndex, 0, id); // restore the original index
        this._rewrite(oldParentId, { childIds });
        this._rewrite(id, { parentId: oldParentId });
      },
    };

    this._commit(command, {
      type: 'move',
      itemId: id,
      name,
      oldParentId,
      newParentId,
    });
    return this.getItem(id);
  }

  /**
   * Deletes an item and its entire subtree. The root cannot be deleted.
   *
   * @param {string} id
   * @returns {Readonly<{ deletedIds: string[] }>} every id that was removed
   * @throws {FileExplorerError} NOT_FOUND | ROOT_PROTECTED
   */
  delete(id) {
    requireNode(this._nodes, id);
    if (id === this._rootId) {
      throw new FileExplorerError(
        ErrorCodes.ROOT_PROTECTED,
        'The root folder cannot be deleted',
        id
      );
    }
    const node = this._nodes.get(id);
    const parentId = node.parentId;

    /** @type {{ nodes: Record<string, Node>, parentId: string, index: number } | null} */
    let removed = null;

    const command = {
      type: HISTORY_COMMAND_TYPES.DELETE,
      label: `Delete "${node.name}"`,
      apply: () => {
        removed = this._removeSubtree(id);
      },
      revert: () => {
        // Re-insert every removed node with the same objects and ids, and
        // splice the subtree root back at its original index. This restores
        // the full nested structure.
        this._reinsertSubtree(removed.nodes, id, removed.parentId, removed.index);
      },
    };

    this._commit(command, {
      type: 'delete',
      itemId: id,
      name: node.name,
      parentId,
    });

    return Object.freeze({
      deletedIds: Object.freeze(Object.keys(removed.nodes)),
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Undo / redo
  // ────────────────────────────────────────────────────────────────────────

  /**
   * @returns {boolean} whether there is something to undo
   */
  canUndo() {
    return this._history.canUndo();
  }

  /**
   * @returns {boolean} whether there is something to redo
   */
  canRedo() {
    return this._history.canRedo();
  }

  /**
   * Undoes the most recent operation by reverting its command, moves it to
   * the redo stack, and notifies subscribers once.
   *
   * With strict LIFO order, name conflicts cannot occur on undo: every
   * command was validated when it was first applied, and nothing else has
   * touched the state since.
   *
   * @returns {Readonly<{ type: 'undo', command: string }>}
   * @throws {FileExplorerError} NOTHING_TO_UNDO
   */
  undo() {
    if (!this._history.canUndo()) {
      throw new FileExplorerError(
        ErrorCodes.NOTHING_TO_UNDO,
        'Nothing to undo'
      );
    }
    const command = this._history.takeForUndo();
    command.revert();
    this._history.returnToRedo(command);
    const event = { type: 'undo', command: command.label };
    this._bump(event);
    return Object.freeze({ ...event });
  }

  /**
   * Redoes the most recently undone operation by re-applying its command,
   * moves it back to the undo stack, and notifies subscribers once.
   *
   * @returns {Readonly<{ type: 'redo', command: string }>}
   * @throws {FileExplorerError} NOTHING_TO_REDO
   */
  redo() {
    if (!this._history.canRedo()) {
      throw new FileExplorerError(
        ErrorCodes.NOTHING_TO_REDO,
        'Nothing to redo'
      );
    }
    const command = this._history.takeForRedo();
    command.apply();
    this._history.returnToUndo(command);
    const event = { type: 'redo', command: command.label };
    this._bump(event);
    return Object.freeze({ ...event });
  }

  /**
   * Labels of history entries, most recent first.
   * @returns {Readonly<{ undo: string[], redo: string[] }>}
   */
  getHistory() {
    const labels = this._history.labels();
    return Object.freeze({
      undo: Object.freeze(labels.undo),
      redo: Object.freeze(labels.redo),
    });
  }

  /**
   * Recent activity-log entries in chronological order (oldest first),
   * capped at `limit` of the most recent entries.
   *
   * @param {number} [limit]
   * @returns {ReadonlyArray<Readonly<{
   *   id: string, type: string, message: string,
   *   itemId: string|null, timestamp: number, version: number
   * }>>}
   */
  getActivityLog(limit) {
    const take =
      typeof limit === 'number' && Number.isInteger(limit) && limit >= 0
        ? limit
        : this._activity.length;
    const entries = this._activity.slice(-take);
    return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
  }

  /**
   * Searches all nodes (excluding the root) with a case-insensitive
   * substring match on the name. Results are computed fresh from the current
   * state on every call, so they always reflect the latest mutations.
   *
   * An empty (or whitespace-only) query returns an empty result with
   * `total: 0`.
   *
   * @param {string} query
   * @param {{ type?: 'all'|'file'|'folder', sortBy?: 'name'|'type'|'path',
   *           order?: 'asc'|'desc', page?: number, pageSize?: number }} [options]
   * @returns {Readonly<{ items: ReadonlyArray<{ id: string, name: string,
   *   type: string, path: string, location: string }>,
   *   total: number, page: number, pageSize: number, totalPages: number,
   *   query: string }>}
   * @throws {FileExplorerError} INVALID_QUERY | INVALID_OPTIONS
   */
  search(query, options) {
    return runSearch(this._nodes, this._rootId, query, options);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Transactions (atomic batches)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Runs `fn` as an atomic batch. Approach: snapshot, work on a draft, then
   * commit or restore.
   *
   * - `fn` receives a tx object exposing the mutation methods
   *   (createFile, createFolder, rename, move, delete) but NOT undo/redo,
   *   subscribe, or transaction. Reads (getItem, getTree, getPath, search…)
   *   are available on the SDK itself and see the draft state, which makes
   *   patterns like "create a folder, then move items into it" work.
   * - If anything throws, the pre-transaction state is restored, no history
   *   entry is created, no notification is sent, and the original error is
   *   rethrown.
   * - If it succeeds, ONE composite history entry is pushed and listeners
   *   are notified ONCE. One undo reverses the entire batch (commands are
   *   reverted in reverse order).
   * - Nested transactions are not supported and throw TRANSACTION_ERROR.
   * - The callback must be synchronous; a returned promise is rejected with
   *   TRANSACTION_ERROR and the batch is rolled back.
   *
   * @template T
   * @param {(tx: { createFile: Function, createFolder: Function,
   *   rename: Function, move: Function, delete: Function }) => T} fn
   * @returns {T} whatever `fn` returns
   * @throws {*} whatever `fn` throws, or TRANSACTION_ERROR for nesting /
   *   async callbacks
   */
  transaction(fn) {
    if (typeof fn !== 'function') {
      throw new FileExplorerError(
        ErrorCodes.TRANSACTION_ERROR,
        'transaction requires a callback function'
      );
    }
    if (this._tx) {
      throw new FileExplorerError(
        ErrorCodes.TRANSACTION_ERROR,
        'Nested transactions are not supported'
      );
    }

    // 1. Snapshot the state before. Nodes are immutable, so copying the Map
    //    (which holds references) is cheap and makes rollback trivial.
    const backup = { nodes: new Map(this._nodes), version: this._version };

    // 2. Run with notifications and history suppressed (_commit buffers).
    this._tx = { commands: [], events: [] };
    let result;
    try {
      result = fn(this._txApi());
      if (result && typeof result.then === 'function') {
        throw new FileExplorerError(
          ErrorCodes.TRANSACTION_ERROR,
          'transaction callbacks must be synchronous (async is not supported)'
        );
      }
    } catch (e) {
      // 3. Restore the snapshot; no history entry, no notification.
      this._nodes = backup.nodes;
      this._version = backup.version;
      this._snapshot = null;
      throw e; // rethrow the original error
    } finally {
      var draft = this._tx;
      this._tx = null;
    }

    // 4. Commit: one composite history entry, one notification.
    if (draft.commands.length === 0) {
      return result;
    }
    const commands = draft.commands;
    const composite = {
      type: HISTORY_COMMAND_TYPES.TRANSACTION,
      label: `Transaction (${commands.length} operation${commands.length === 1 ? '' : 's'})`,
      apply: () => {
        for (const command of commands) command.apply();
      },
      // Composite revert runs child commands in REVERSE order.
      revert: () => {
        for (let i = commands.length - 1; i >= 0; i -= 1) {
          commands[i].revert();
        }
      },
    };
    this._history.push(composite);
    this._bump({
      type: 'transaction',
      count: commands.length,
      events: draft.events,
    });
    return result;
  }

  /**
   * The mutation-only surface handed to a transaction callback.
   * @private
   */
  _txApi() {
    const sdk = this;
    return {
      createFile: (parentId, name) => sdk.createFile(parentId, name),
      createFolder: (parentId, name) => sdk.createFolder(parentId, name),
      rename: (id, newName) => sdk.rename(id, newName),
      move: (id, newParentId) => sdk.move(id, newParentId),
      delete: (id) => sdk.delete(id),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Snapshot with structural sharing (what React's useSyncExternalStore reads)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Rebuilds the nested tree snapshot, reusing previous tree objects wherever
   * the node and all of its (sorted) children's tree references are
   * unchanged. After a rename, only that node and its ancestors get new
   * references — unchanged siblings keep the exact same object identity,
   * which is what lets `React.memo` skip re-rendering them.
   * @private
   */
  _rebuildSnapshot() {
    const previousCache = this._snapshotCache ?? new Map();
    /** @type {Map<string, { node: Node, sortedChildren: object[], tree: object }>} */
    const nextCache = new Map();

    // Output order: folders first, then by name, id as a deterministic
    // tie-break. Internal childIds keep insertion order for undo fidelity.
    const compareTrees = (a, b) => {
      if (a.type !== b.type) {
        return a.type === NODE_TYPES.FOLDER ? -1 : 1;
      }
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      if (a.id === b.id) return 0;
      return a.id < b.id ? -1 : 1;
    };

    const build = (id) => {
      const node = this._nodes.get(id);
      const childTrees = node.childIds.map(build);
      const sortedChildren =
        node.type === NODE_TYPES.FOLDER
          ? [...childTrees].sort(compareTrees)
          : [];

      const cached = previousCache.get(id);
      if (
        cached &&
        cached.node === node &&
        cached.sortedChildren.length === sortedChildren.length &&
        cached.sortedChildren.every((child, i) => child === sortedChildren[i])
      ) {
        nextCache.set(id, cached);
        return cached.tree;
      }

      const tree = deepFreeze({
        id: node.id,
        name: node.name,
        type: node.type,
        parentId: node.parentId,
        children: sortedChildren,
      });
      const entry = { node, sortedChildren, tree };
      nextCache.set(id, entry);
      return tree;
    };

    this._snapshotCache = nextCache;
    this._snapshot = build(this._rootId);
    this._snapshotVersion = this._version;
  }

  /**
   * Returns the cached nested tree snapshot. The reference is **stable**
   * between changes (required by `useSyncExternalStore` — a new object on
   * every call would cause an infinite render loop). The snapshot is deeply
   * frozen, with children sorted folders-first then by name.
   *
   * @returns {Readonly<{ id: string, name: string, type: string,
   *   parentId: string|null, children: ReadonlyArray<object> }>}
   */
  getSnapshot() {
    if (this._snapshot === null || this._snapshotVersion !== this._version) {
      this._rebuildSnapshot();
    }
    return this._snapshot;
  }

  /**
   * Alias of {@link getSnapshot} — the frozen nested tree.
   * @returns {Readonly<object>}
   */
  getTree() {
    return this.getSnapshot();
  }
}
