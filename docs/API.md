# File Explorer SDK — API Reference

A framework-independent, in-memory file-tree SDK written in plain JavaScript.
No React, no DOM, no backend. Safe to import from Node or any UI library.

```js
import { FileExplorerSDK, createSampleData } from './src/sdk/index.js';

const sdk = new FileExplorerSDK({ initialData: createSampleData() });
```

---

## Contents

- [Constructor](#constructor)
- [Reads](#reads)
- [Mutations](#mutations)
- [Undo / redo](#undo--redo)
- [Search](#search)
- [Transactions](#transactions)
- [Subscriptions and events](#subscriptions-and-events)
- [Activity log](#activity-log)
- [Snapshot](#snapshot)
- [Error codes](#error-codes)
- [Design decisions](#design-decisions)

---

## Constructor

### `new FileExplorerSDK(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `initialData` | `{ children?: SeedNode[] }` | — | Nested seed structure. Seeded nodes never appear in history or the activity log. |
| `idGenerator` | `() => string` | `crypto.randomUUID` | Injectable so tests are deterministic. |
| `historyLimit` | `number` | `100` | Maximum undo entries (oldest dropped). |
| `activityLimit` | `number` | `50` | Maximum activity-log entries kept. |
| `rootName` | `string` | `'My Files'` | Trimmed; whitespace-only falls back to the default. |

A `SeedNode` is `{ name: string, type: 'file'|'folder', children?: SeedNode[] }`.
Seed names must be non-empty, `/`-free, and unique among siblings (case-insensitive).

```js
const sdk = new FileExplorerSDK({
  initialData: { children: [{ name: 'Docs', type: 'folder' }] },
  idGenerator: (() => { let n = 0; return () => `id-${++n}`; })(),
  rootName: 'My Drive',
});
```

---

## Reads

### `getRootId(): string`
The root node's id. The root has `parentId: null`.

### `getItem(id): Readonly<Node>`
A frozen copy `{ id, name, type, parentId, childIds }`.
**Throws** `NOT_FOUND`.

```js
sdk.getItem(id); // → { id, name: 'Resume.pdf', type: 'file', parentId, childIds: [] }
```

### `hasItem(id): boolean`
Whether the id exists. Never throws.

### `getPath(id): Readonly<{ ids, names, text }>`
Path from the root to `id`. `text` is the names joined with `' / '`.
**Throws** `NOT_FOUND`.

```js
sdk.getPath(id).text; // 'My Files / Documents / Work / Report.docx'
```

### `getVersion(): number`
Counter incremented on every successful change (used as a cache key by React).

### `getSize(): number`
Number of stored nodes, root included.

---

## Mutations

All mutations: validate first, mutate only after validation succeeds, then
push one history entry, bump the version, append to the activity log, and
notify subscribers once. A **failed operation does none of these**.

### `createFile(parentId, name): Readonly<Node>`
### `createFolder(parentId, name): Readonly<Node>`
Creates an item as the last child of `parentId`. The name is trimmed.
**Throws** `NOT_FOUND` (missing parent), `INVALID_PARENT` (parent is a file),
`INVALID_NAME` (empty, contains `/`, > 255 chars, non-string),
`DUPLICATE_NAME` (case-insensitive collision among siblings).

```js
const file = sdk.createFile(parentId, 'Resume.pdf');
```

### `rename(id, newName): Readonly<Node>`
**Throws** `NOT_FOUND`, `ROOT_PROTECTED` (root), `INVALID_NAME`,
`DUPLICATE_NAME` (excluding the item itself, so `a.txt` → `A.txt` is allowed).

No-op rule: renaming to the same (trimmed) name returns the item unchanged
with **no history entry and no notification**.

### `move(id, newParentId): Readonly<Node>`
Appends the item as the last child of the target folder.
Validation order: item exists → not root → target exists and is a folder →
same parent is a no-op → target is not the item itself or a descendant
(walks up from the target) → name is free in the target.
**Throws** `NOT_FOUND`, `ROOT_PROTECTED`, `INVALID_PARENT`, `INVALID_MOVE`,
`DUPLICATE_NAME`. Identity (the id) is preserved.

### `delete(id): Readonly<{ deletedIds: string[] }>`
Deletes the item and its entire subtree. `deletedIds` lists every removed id.
**Throws** `NOT_FOUND`, `ROOT_PROTECTED` (root).

---

## Undo / redo

Command pattern: each successful operation pushes `{ type, label, apply, revert }`
onto one of two stacks.

| Method | Returns | Throws |
|---|---|---|
| `undo()` | `{ type: 'undo', command }` | `NOTHING_TO_UNDO` |
| `redo()` | `{ type: 'redo', command }` | `NOTHING_TO_REDO` |
| `canUndo()` / `canRedo()` | `boolean` | — |
| `getHistory()` | `{ undo: string[], redo: string[] }` labels, most recent first | — |

Rules (by design):
- **A new action after an undo clears the redo stack.** The redo branch is discarded.
- Failed operations never reach history (validation happens before the push).
- The undo stack is capped at `historyLimit`; the oldest entry is dropped.
- Delete stores the **entire removed subtree** with original ids, so undo
  restores full nested structure and preserves identity.
- Create's redo re-inserts the node **with the same id**.
- Move's revert restores the **original child index**.
- Undo/redo each notify subscribers exactly once.

```js
sdk.createFile(rootId, 'a.txt');
sdk.undo();   // a.txt is gone; canRedo() === true
sdk.redo();   // a.txt is back, same id
```

---

## Search

### `search(query, options?): Readonly<SearchResult>`

| Option | Values | Default |
|---|---|---|
| `type` | `'all' \| 'file' \| 'folder'` | `'all'` |
| `sortBy` | `'name' \| 'type' \| 'path'` | `'name'` |
| `order` | `'asc' \| 'desc'` | `'asc'` |
| `page` | integer ≥ 1 | `1` |
| `pageSize` | integer 1–100 | `10` |

Returns `{ items, total, page, pageSize, totalPages, query }` where each item
is `{ id, name, type, path, location }`. `path` includes the item itself;
`location` is the parent's path text.

- Matching: case-insensitive **substring** on `name`, all nodes except the root.
- **An empty (or whitespace-only) query returns an empty result with `total: 0`** (documented choice).
- A page beyond `totalPages` returns empty `items` with the correct totals.
- `totalPages` is `0` when there are no matches.
- Invalid options throw `INVALID_OPTIONS`; a non-string query throws `INVALID_QUERY`.
- Read-only and computed fresh from current state, so results always reflect mutations.
- Sorting uses a stable `localeCompare` comparator with an id tie-break.

```js
sdk.search('res', { type: 'file', sortBy: 'path', order: 'desc', page: 1, pageSize: 10 });
```

---

## Transactions

### `transaction(fn): any`

Runs `fn` as an atomic batch: **snapshot → suppress → commit or restore**.

- `fn(tx)` receives mutation methods only: `createFile`, `createFolder`,
  `rename`, `move`, `delete`. No undo/redo/subscribe/transaction on `tx`.
- Reads on the SDK see the draft state inside `fn` (so you can create a
  folder and immediately move items into it).
- On any throw: the pre-transaction state is restored, **no history entry**,
  **no notification**, version unchanged, and the original error is rethrown.
- On success: **one** composite history entry (one undo reverses the whole
  batch, reverting child commands in reverse order) and **one** notification
  (`{ type: 'transaction', count, events, version }`).
- Nested transactions throw `TRANSACTION_ERROR`.
- The callback must be synchronous; a returned promise throws
  `TRANSACTION_ERROR` and rolls back.
- An empty batch (no mutations) is a no-op and returns `fn`'s value.

```js
sdk.transaction((tx) => {
  const folder = tx.createFolder(rootId, 'Archive');
  tx.move(fileA, folder.id);
  tx.move(fileB, folder.id);
});
// One undo brings everything back.
```

---

## Subscriptions and events

### `subscribe(listener): () => void`
Registers a listener; returns an unsubscribe function that is safe to call twice.

### `listenerCount(): number`
Active subscriber count (used by React cleanup tests).

Event payloads (all include `version`):

| Event | Extra fields |
|---|---|
| `{ type: 'create' }` | `itemId`, `name`, `itemType`, `parentId` |
| `{ type: 'rename' }` | `itemId`, `oldName`, `newName` |
| `{ type: 'move' }` | `itemId`, `name`, `oldParentId`, `newParentId` |
| `{ type: 'delete' }` | `itemId`, `name`, `parentId` |
| `{ type: 'undo' }` / `{ type: 'redo' }` | `command` (label) |
| `{ type: 'transaction' }` | `count`, `events` (the inner events) |

A listener that throws does not break the emitter or the other listeners.

---

## Activity log

### `getActivityLog(limit?): ReadonlyArray<Readonly<Entry>>`
Chronological (oldest first), taking the most recent `limit` entries
(default: everything kept, capped at `activityLimit`).

Entry: `{ id, type, message, itemId, timestamp, version }`.

---

## Snapshot

### `getSnapshot()` / `getTree()`
The frozen nested tree: `{ id, name, type, parentId, children }`, with
children sorted **folders-first, then by name** (files always have `children: []`).

- The reference is **stable between changes** — required by React's
  `useSyncExternalStore` (a new object per call would loop forever).
- **Structural sharing:** unchanged subtrees keep the exact same object
  references across rebuilds, so `React.memo` can skip them. After a rename,
  only that node and its ancestors receive new references.
- Deeply frozen: mutating anything returned throws `TypeError` in strict mode
  and can never affect internal state.

---

## Error codes

Every failure throws `FileExplorerError extends Error` with a stable `code`:

| Code | Meaning |
|---|---|
| `NOT_FOUND` | Unknown id |
| `INVALID_PARENT` | Target of a create is a file |
| `INVALID_NAME` | Empty name, contains `/`, > 255 chars, or non-string |
| `DUPLICATE_NAME` | Case-insensitive name collision among siblings |
| `ROOT_PROTECTED` | Rename/move/delete of the root |
| `INVALID_MOVE` | Moving an item into itself or a descendant |
| `INVALID_QUERY` | `search` query is not a string |
| `INVALID_OPTIONS` | Unknown/invalid search option values |
| `NOTHING_TO_UNDO` / `NOTHING_TO_REDO` | Empty history stack |
| `TRANSACTION_ERROR` | Nesting, async callback, or non-function callback |

```js
import { FileExplorerError, ErrorCodes } from './src/sdk/index.js';

try {
  sdk.rename(id, 'x');
} catch (e) {
  if (e instanceof FileExplorerError && e.code === ErrorCodes.DUPLICATE_NAME) {
    // ...
  }
}
```

---

## Design decisions

1. **Normalized flat `Map<id, Node>`** — O(1) lookups, simple move/rename,
   natural identity preservation, easy validation. The nested tree is built
   only for `getSnapshot()`.
2. **Immutable frozen nodes** — every change *replaces* a node. This gives
   cheap transaction rollback (restore a Map copy), structural sharing, and
   safe returns for free.
3. **Single mutation pipeline** — `validate → build command → _commit`.
   Nothing else touches state.
4. **No-op rule** — same-name rename / same-parent move returns the item
   with no history and no notification.
5. **Root protection** — `parentId: null`; cannot be renamed, moved, or deleted.
6. **Synchronous SDK** — the UI layer may simulate async delays; the SDK never does.
