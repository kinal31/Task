# Day 1 Plan: Pure JS SDK (`src/sdk/`, no React)

**Goal for the day:** a fully working, fully tested SDK that you can drive from a Node script. It covers CRUD, validation, search, undo/redo, subscriptions, the activity log, a React-ready snapshot, and atomic transactions.

**Total: about 8 to 9 hours.** Write each phase's tests *before moving on*. Don't batch them to the end.

---

## Core design decisions (lock these in first, 20 min)

1. **Internal state is a `Map<id, Node>` of immutable, frozen node objects.** To change a node, you *replace* it with a new frozen object and never mutate it in place. This gives you three things for free:
   - cheap transaction rollback (restore the old Map)
   - structural sharing for React later
   - safe returns to consumers
2. **Node shape:** `{ id, name, type, parentId, childIds }`. Files always have `childIds: []`, and any attempt to make a file a parent is rejected.
3. **Child order:** `childIds` keeps insertion order (so undo can restore exact positions). The *output tree* is sorted folders-first, then by name.
4. **One mutation pipeline.** Every public mutation goes `validate → build command → _commit(command, event)`. Nothing else touches state.
5. **Command pattern:** each command is `{ type, label, apply(), revert() }`, built on private raw primitives that do no validation.
6. **No-op rule:** renaming to the same name, or moving to the same parent, returns the item unchanged and creates **no history entry and no notification**. Document it.
7. **Name rules:** trim, then reject empty names, names containing `/`, and names over 255 chars. Uniqueness key is `name.toLowerCase()` among siblings, excluding the item itself, so renaming `a.txt` to `A.txt` is allowed.
8. **Ids:** `crypto.randomUUID()`, with an injectable `idGenerator` option so tests are deterministic.
9. **Root "My Files":** `parentId: null`, protected from rename, move, and delete.

---

## Phase 1: Foundations (45 min)

**Files:** `constants.js`, `errors.js`, `utils.js`, `emitter.js`

- `errors.js`: `FileExplorerError(code, message, details)` plus an `ErrorCodes` object (`DUPLICATE_NAME`, `NOT_FOUND`, `INVALID_PARENT`, `INVALID_MOVE`, `INVALID_NAME`, `ROOT_PROTECTED`, `INVALID_OPTIONS`, `INVALID_QUERY`, `NOTHING_TO_UNDO`, `NOTHING_TO_REDO`, `TRANSACTION_ERROR`).
- `utils.js`: `deepFreeze`, `normalizeName`, `nameKey`, `generateId`.
- `emitter.js`: a `Set` of listeners.
  - `subscribe(fn)` returns an unsubscribe function that is safe to call twice.
  - `emit(event)` wraps each listener in try/catch so one bad listener doesn't block the others.
  - Iterate over a copy of the Set, so a listener that unsubscribes during emit doesn't break iteration.
  - Add a `listenerCount()` helper. You'll need it for the React cleanup tests.

**Tests:** subscribe/unsubscribe, double-unsubscribe, a throwing listener doesn't stop the others, unsubscribe during emit.

---

## Phase 2: Store skeleton and reads (1 hr)

**Files:** `FileExplorerSDK.js`, `sample-data.js`, `index.js`

Constructor: `new FileExplorerSDK({ initialData, idGenerator, historyLimit = 100, activityLimit = 50, rootName = 'My Files' })`.

State: `_nodes`, `_rootId`, `_version`, `_tx = null`, `_history`, `_activity`, `_emitter`.

Private raw primitives (no validation, no history, no notify):
- `_put(node)`: freeze, then `_nodes.set`
- `_insert(node, parentId, index)`
- `_removeSubtree(id)`: returns `{ nodes, parentId, index }`
- `_rewrite(id, patch)`

Seed data goes through the raw primitives so the sample structure isn't in history or the activity log. Version starts at 0.

Public reads:
- `getItem(id)`: returns a copy `{...node, childIds: [...]}`, frozen. Throws `NOT_FOUND`.
- `getPath(id)`: returns `{ ids: [...], names: [...], text: 'My Files / Documents' }`.
- `getTree()`: stub for now, finished in Phase 7.
- `getVersion()`

**Tests:** seeded structure matches the example tree, `getItem` for a missing id, `getPath` on a deep item.

**Write this test helper now:** `assertInvariants(sdk)`. It checks that every child's `parentId` matches its parent, no orphans exist, there are no cycles, sibling names are unique case-insensitively, and files have no children. **Call it at the end of nearly every test.** It's your safety net for "never corrupt the structure".

---

## Phase 3: Validators and create/rename (1.5 hr)

**File:** `validators.js` (pure functions that take the nodes Map and return normalized values or throw)

- `requireNode(nodes, id)`
- `requireFolder(nodes, id)` throws `INVALID_PARENT` if the target is a file
- `validateName(raw)` returns the trimmed name
- `assertNameAvailable(nodes, parentId, name, ignoreId)`

Methods:
- `createFile(parentId, name)` and `createFolder(parentId, name)`: both go through one private `_create(type, ...)`.
- `rename(id, newName)`: checks `ROOT_PROTECTED`, validates the name, checks uniqueness (ignoring self), then handles the no-op case.

Each builds a command and calls `_commit`:

```js
// create
apply:  () => this._insert(node, parentId, index)   // same node object (same id) on redo
revert: () => this._removeSubtree(node.id)
// rename
apply:  () => this._rewrite(id, { name: newName })
revert: () => this._rewrite(id, { name: oldName })
```

**Tests:** create file/folder, create in a file (`INVALID_PARENT`), duplicate (including different casing), invalid names, rename preserves id, case-only rename allowed, rename root rejected, same-name rename is a no-op, and a failed op leaves `getVersion()` unchanged.

---

## Phase 4: Move and delete (1.5 hr)

**Move validation order** (fixed order gives predictable errors):
1. item exists
2. not root
3. target exists and is a folder
4. same parent means no-op
5. target is not the item itself or a descendant (walk up from the *target* through `parentId` and check for the item's id)
6. name is free in the target folder

Command: `apply` removes the id from the old parent's `childIds`, appends it to the new parent's, and rewrites its `parentId`. `revert` reverses that and restores the **original index**.

**Delete:**
- Block root.
- `apply`: iterative DFS to collect the subtree, remove all nodes, and splice the id out of the parent's `childIds`. Store `{ removedNodes, parentId, index }` in the closure.
- `revert`: re-insert every removed node (same objects, same ids) and splice the id back into the parent at the stored index.

**Tests:** move file and folder, identity preserved after move, move into self, into a child, into a deep descendant, into a file, move name collision, delete a leaf, delete a deep folder (all descendants gone from `getItem`), delete root rejected, and `assertInvariants` after every case.

---

## Phase 5: History and notifications (1.5 hr)

**File:** `history.js`: `push(cmd)`, `popUndo()`, `popRedo()`, `canUndo()`, `canRedo()`, `clear()`, `labels()`.

Rules:
- `push` clears the redo stack. **Document this: a new action after undo discards the redo branch.**
- Cap the undo stack at `historyLimit`, dropping the oldest.
- Failed operations never reach `push`, because validation throws first.

SDK methods:
- `undo()` and `redo()` throw `NOTHING_TO_UNDO` or `NOTHING_TO_REDO`. Otherwise they run `revert()` or `apply()`, move the command between stacks, then `_bump`.
- `canUndo()`, `canRedo()`
- `getHistory()`: labels only, e.g. `{ undo: [...], redo: [...] }`

**`_bump(event)`** does four things: `version++`, append to the activity log (capped), emit `{ ...event, version }`, return. Undo and redo emit `{ type: 'undo' | 'redo', command: label }`.

`getActivityLog(limit)` returns a frozen copy of entries shaped `{ id, type, message, itemId, timestamp, version }`.

**Tests:**
- undo/redo for create, rename, move, and delete
- undo of a nested folder delete restores the whole subtree with the same ids
- new op after undo clears redo
- a failed op adds no history
- the history cap works
- every undo/redo notifies exactly once
- a long mixed sequence of ops, then undo everything, equals the initial tree
- redo everything equals the final tree

---

## Phase 6: Search (1 hr)

**File:** `search.js`, a pure function `runSearch(nodes, rootId, query, options)`.

```js
sdk.search(query, {
  type: 'all' | 'file' | 'folder',
  sortBy: 'name' | 'type' | 'path',
  order: 'asc' | 'desc',
  page: 1,
  pageSize: 10
})
// -> { items: [{ id, name, type, path, location }], total, page, pageSize, totalPages, query }
```

- `query` must be a string, otherwise `INVALID_QUERY`. Trim it. **An empty query returns an empty result with `total: 0`** (document this choice).
- Validate options: unknown `type`, `sortBy`, or `order`, or a non-integer `page` or `pageSize`, or `page < 1`, or `pageSize` outside 1 to 100, all throw `INVALID_OPTIONS`. Unspecified options use defaults.
- Do one DFS from the root that carries the path along, so path computation isn't O(n × depth). Exclude the root from results.
- Matching is case-insensitive substring on `name`.
- Sort with a stable comparator (use `localeCompare`) and tie-break by id.
- `path` is the full path including the item. `location` is the parent's path text, which is what you display.
- A page beyond `totalPages` returns empty `items` with the correct totals.
- Never mutate anything. Results are fresh frozen objects computed on each call, so they always reflect mutations.

**Tests:** nested matches, case-insensitivity, type filter, each sort and order, pagination (first page, last page, out of range), empty query, bad options, results update after create/rename/move/delete/undo, and a deep-equal check on the tree before and after searching.

---

## Phase 7: Snapshot with structural sharing (45 min)

This is the part React depends on, so do it now.

- `getSnapshot()`: returns a cached nested tree, rebuilt only when `_version` changes. It must return the **same reference** between changes.
- `getTree()` can return the same frozen snapshot.
- **Structural sharing:** keep a `Map<id, { node, childTrees, tree }>` cache. When building a node's tree object, if the node reference and all its children's tree references are unchanged from the cache, reuse the previous tree object. After a rename, only that node and its ancestors get new references. Siblings stay identical.
- Bind public methods that React passes around (`subscribe`, `getSnapshot`) in the constructor, so they can be passed unbound.
- The snapshot's tree objects look like `{ id, name, type, parentId, children: [...] }`, frozen, with children sorted folders-first.

**Tests:** same reference when nothing changed, a rename changes only the ancestor chain (`expect(newTree.children[1]).toBe(oldTree.children[1])` for an untouched sibling), the snapshot is deeply frozen, and mutating a returned object throws in strict mode or has no effect and leaves the SDK unchanged.

---

## Phase 8: Transactions (1.5 hr)

API: `sdk.transaction(tx => { tx.delete(a); tx.move(b, c); return value; })`

Implementation:

```js
transaction(fn) {
  if (this._tx) throw nested-transaction error;       // simplest: disallow nesting, document it
  const backup = { nodes: new Map(this._nodes), version: this._version };
  this._tx = { commands: [], events: [] };
  let result;
  try {
    result = fn(this._txApi());                       // tx exposes the same mutation methods, no undo/redo/subscribe
    if (result && typeof result.then === 'function') throw async-not-supported error;
  } catch (e) {
    this._nodes = backup.nodes; this._version = backup.version;
    throw e;                                          // rethrow original error
  } finally {
    var draft = this._tx; this._tx = null;
  }
  if (draft.commands.length === 0) return result;
  this._history.push(composite(draft.commands));      // ONE undo entry
  this._bump({ type: 'transaction', events: draft.events });  // ONE notification
  return result;
}
```

- `_commit` checks `this._tx`: inside a transaction it applies and buffers, with no history push and no notify.
- Reads inside a transaction see draft state, which is needed for patterns like "create a folder, then move items into it".
- `composite.apply` runs commands forward. `composite.revert` runs them in **reverse**.
- Rollback restores the Map copy, which is cheap because nodes are immutable.

**Tests:** all-succeed commits with a single notification and a single undo; a failure in the third op leaves the tree identical to the original, with no history entry, no notification, and the same version; a later undo undoes the whole batch; an empty transaction creates nothing; an async callback is rejected and rolled back; the original error propagates; `assertInvariants` passes after rollback; and the SDK works normally after a failed transaction.

---

## Phase 9: Wrap-up and docs (30 to 45 min)

- Add JSDoc to every public method (params, returns, throws).
- Export from `index.js`: `FileExplorerSDK`, `FileExplorerError`, `ErrorCodes`, `createSampleData`.
- Write a **non-React usage script** (`examples/node-demo.js`). It proves the SDK is framework independent, and its content becomes your README usage examples.
- Start `docs/API.md` by pasting the method list and fleshing it out as you go.
- Run a grep to confirm there is **no `react` or `window`/`document` import** anywhere in `src/sdk`.

---

## Final SDK public API (target by end of Day 1)

| Method | Returns | Throws |
|---|---|---|
| `getTree()` / `getSnapshot()` | frozen nested tree | none |
| `getItem(id)` | frozen item copy | `NOT_FOUND` |
| `getPath(id)` | `{ ids, names, text }` | `NOT_FOUND` |
| `createFile(parentId, name)` | new item | `NOT_FOUND`, `INVALID_PARENT`, `INVALID_NAME`, `DUPLICATE_NAME` |
| `createFolder(parentId, name)` | new item | same as above |
| `rename(id, name)` | updated item | `NOT_FOUND`, `ROOT_PROTECTED`, `INVALID_NAME`, `DUPLICATE_NAME` |
| `move(id, newParentId)` | updated item | `NOT_FOUND`, `ROOT_PROTECTED`, `INVALID_PARENT`, `INVALID_MOVE`, `DUPLICATE_NAME` |
| `delete(id)` | `{ deletedIds }` | `NOT_FOUND`, `ROOT_PROTECTED` |
| `search(query, options)` | paginated result | `INVALID_QUERY`, `INVALID_OPTIONS` |
| `undo()` / `redo()` | event info | `NOTHING_TO_UNDO` / `NOTHING_TO_REDO` |
| `canUndo()` / `canRedo()` / `getHistory()` | booleans / labels | none |
| `subscribe(listener)` | unsubscribe fn | none |
| `getActivityLog(limit)` | frozen entries | none |
| `transaction(fn)` | `fn`'s return value | whatever `fn` throws, `TRANSACTION_ERROR` |
| `getVersion()` | number | none |

---

## Day 1 "done" checklist

- [ ] `npx vitest run tests/sdk` is green, with `assertInvariants` used throughout
- [ ] Every failure path checked for: no state change, no history entry, no notification
- [ ] Undo-all returns to the initial tree and redo-all to the final tree
- [ ] Snapshot reference is stable when nothing changed, and unchanged siblings keep their references
- [ ] Mutating anything returned by the SDK cannot change internal state
- [ ] Node demo script runs with plain `node`
- [ ] Public methods have JSDoc and `docs/API.md` has a draft

---

## If you fall behind

Cut in this order: (1) simplify the activity log to message-only entries, (2) drop the `location` extra in search, (3) postpone transactions to the morning of Day 2. **Never cut** `assertInvariants`, the immutability tests, or the failure-path tests. They are exactly what the assessment evaluates.
