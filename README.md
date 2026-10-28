# VideoSDK File Explorer

A file-explorer built as a **framework-independent JavaScript SDK** (`src/sdk/`, no React, no DOM) with a React UI planned on top of it. This repository currently contains **Day 1: the fully tested pure-JS SDK** — CRUD, validation, search, undo/redo, subscriptions, an activity log, a React-ready snapshot with structural sharing, and atomic transactions. Everything runs in plain Node.

## Install, run, test

```bash
npm install          # install dependencies
npm test             # run the full Vitest suite (SDK tests)
npm run test:watch   # watch mode
npm run demo         # node examples/node-demo.js — proves framework independence
npm run dev          # Vite dev server (placeholder UI; full app in Day 2)
npm run build        # production build
```

Requires Node 18+ (uses `crypto.randomUUID`).

## Folder structure

```
├── src/
│   ├── sdk/                  # pure JS — zero React/DOM imports
│   │   ├── FileExplorerSDK.js  # the SDK class (state, pipeline, public API)
│   │   ├── constants.js        # node types, defaults, search enums
│   │   ├── errors.js           # FileExplorerError + ErrorCodes
│   │   ├── utils.js            # deepFreeze, normalizeName, nameKey, generateId
│   │   ├── validators.js       # pure validation functions
│   │   ├── emitter.js          # own Set-based subscribe/notify
│   │   ├── history.js          # two-stack undo/redo (command pattern)
│   │   ├── search.js           # pure runSearch()
│   │   ├── sample-data.js      # nested seed structure
│   │   └── index.js            # public exports
│   ├── App.jsx / main.jsx     # placeholder UI (Day 2 replaces this)
├── tests/
│   ├── setup.js
│   └── sdk/                   # Vitest suites + assertInvariants helper
├── examples/node-demo.js      # non-React usage script
├── docs/API.md                # full API reference
└── doc/                       # original implementation plans
```

## Architecture

### Data model

Internal state is a **normalized flat map**, not nested objects:

```
nodes: Map<id, { id, name, type: 'file'|'folder', parentId, childIds: string[] }>
rootId: string          // root: parentId === null, protected
version: number         // bumped on every successful change
```

Why a flat map: O(1) lookups by id, trivial move/rename (rewrite `parentId` + two `childIds` arrays), identity preserved naturally, and easy structural validation. The nested tree is materialized only in `getSnapshot()`.

Every node is a **frozen immutable object**. Changing a node always *replaces* it (`_rewrite` → `_put`). This single decision pays off three times:

1. **Transaction rollback** = restore a copy of the Map (nodes are shared references, so it's cheap).
2. **Structural sharing** for React: unchanged subtrees keep their exact object references.
3. **Safe returns**: nothing handed to a consumer can ever mutate internal state.

### Mutation pipeline

Every public mutation follows one path:

```
validate (throws FileExplorerError before any mutation)
  → build command { type, label, apply(), revert() }
  → _commit(command, event)
       apply()
       inside a transaction? buffer it (no history, no notify)
       else: history.push(command); _bump(event)
             _bump: version++, capped activity log, emit { ...event, version }
```

Failed operations never reach `_commit` — so they never corrupt state, never create history, and never notify.

### SDK vs React responsibilities (Day 2 preview)

- **SDK**: owns all file data; the single source of truth. Emits events; exposes a cached, structurally shared snapshot for `useSyncExternalStore`.
- **React**: owns only UI state (selection, expansion, search inputs, pending/error). Never copies the tree into `useState`.

```
UI action → sdk.rename(...) → validate → mutate → emit
                                                    │
UI ←── useSyncExternalStore(sdk.subscribe, sdk.getSnapshot)
```

## Undo / redo

Command pattern with two stacks (`undoStack`, `redoStack`):

- **Create** — undo removes the node; redo re-inserts it **with the same id**.
- **Rename** — stores `oldName`/`newName`; undo rewrites the name back.
- **Move** — stores `oldParentId`/`newParentId`/original index; revert restores the exact position.
- **Delete** — stores the **entire removed subtree** (all node objects + parent + index); undo re-inserts everything with original ids, restoring full nested structure.

Documented rules:

- **A new successful operation after an undo clears the redo stack.**
- Failed operations push nothing (validation happens before the push).
- History is capped (default 100); the oldest entry is dropped.
- Undo/redo each notify exactly once. With strict LIFO order, name conflicts cannot occur on undo: every command was validated when first applied, and nothing else has touched the state since.

## Transactions

`sdk.transaction(fn)` — atomic batches:

1. Snapshot the state (copy the Map).
2. Run `fn(tx)` with history and notifications suppressed; reads see draft state.
3. On any error: restore the snapshot, create no history entry, send no notification, rethrow the original error.
4. On success: push **one composite history entry** and notify **once**. One undo reverts the whole batch (child commands reverted in reverse order).

Nested transactions and async callbacks are rejected with `TRANSACTION_ERROR` (documented limitation).

## Search

`sdk.search(query, options)` — case-insensitive substring match on names across the whole tree (root excluded), computed fresh on every call. Supports `type` filter, `sortBy` (`name`/`type`/`path`), `order`, and pagination. Empty query returns an empty result (`total: 0`). Invalid options throw `INVALID_OPTIONS`. Full details in [docs/API.md](docs/API.md).

## Re-render optimization (SDK side, for Day 2)

The snapshot returned by `getSnapshot()` implements **structural sharing**: when one node changes, only it and its ancestors get new object references; unchanged siblings keep the same reference. Combined with `React.memo` in Day 2, unchanged subtrees will skip re-rendering. The snapshot reference is stable between changes (cached per `version`), which `useSyncExternalStore` requires.

Re-render observations from the React app will be recorded in this README after Day 2.

## Bonus features completed (Day 1 scope)

- **Transactions** — atomic batches with rollback, one history entry, one notification.
- **Activity log** — capped, frozen, human-readable messages for every successful change including undo/redo and transactions.
- **Injectable `idGenerator`** — deterministic tests and demos.
- **Deterministic snapshot sorting** — folders-first, then name, with id tie-break.

Multi-select / bulk delete in the UI is a Day 2 bonus.

## Testing

136 Vitest tests across 8 suites:

| Suite | Covers |
|---|---|
| `emitter` | subscribe/unsubscribe, double-unsubscribe, throwing listeners, unsubscribe during emit |
| `reads` | seeding, `getItem`/`getPath`/`hasItem`, immutability, NOT_FOUND |
| `create-rename` | CRUD, duplicates (case-insensitive), file-as-parent, invalid names, root protection, no-ops, failed ops leave version unchanged |
| `move-delete` | move validation order, descendant moves, name collisions, subtree delete, root protection |
| `history` | undo/redo per operation, nested restore with same ids, redo cleared on new action, history cap, notification counts, undo-all ≡ initial tree |
| `search` | matching, filters, sorts, pagination, validation, freshness after mutations, no mutation |
| `snapshot` | reference stability, structural sharing, folders-first sort, deep-frozen |
| `transaction` | single undo/notification, rollback (exact tree restore), nested/async rejection, draft reads |

A structural `assertInvariants(sdk)` helper runs at the end of nearly every test: parent/child consistency, no cycles, no orphans, unique sibling names, files childless.

```bash
npm test
node examples/node-demo.js
```

## Known limitations

- **In-memory only** — no persistence; a refresh resets everything.
- **Synchronous SDK** — any "pending" UX belongs to the UI layer.
- **History capped** (default 100); oldest entries are dropped.
- **Nested transactions** not supported; async transaction callbacks are rejected.
- **Search is a linear scan** (fine for small/medium trees; an index would be needed at 100k nodes).
- **No drag-and-drop, no file contents, no virtualization, no cross-tab sync.**
- The React UI (Day 2) is not implemented yet; `src/App.jsx` is a placeholder.

## Documentation

- [docs/API.md](docs/API.md) — full API reference with parameters, return values, errors, and examples.
- `doc/` — the original implementation plans this project follows.
