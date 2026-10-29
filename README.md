# VideoSDK File Explorer

A file-explorer built as a **framework-independent JavaScript SDK** (`src/sdk/`, pure JS, zero React/DOM imports) with a **React UI** on top. The SDK owns all file data and is the single source of truth; React owns only UI state (selection, expansion, search inputs, pending/error) and reads the tree through `useSyncExternalStore`.

## Install, run, test

```bash
npm install          # install dependencies
npm test             # run the full Vitest suite (SDK + UI)
npm run test:watch   # watch mode
npm run demo         # node examples/node-demo.js — proves framework independence
npm run dev          # Vite dev server (full React app)
npm run build        # production build
```

Requires Node 18+ (uses `crypto.randomUUID`).

## Folder structure

```
├── src/
│   ├── sdk/                     # pure JS — zero React/DOM imports
│   │   ├── FileExplorerSDK.js   # the SDK class (state, pipeline, public API)
│   │   ├── constants.js         # node types, defaults, search enums
│   │   ├── errors.js            # FileExplorerError + ErrorCodes
│   │   ├── utils.js             # deepFreeze, normalizeName, nameKey, generateId
│   │   ├── validators.js        # pure validation functions
│   │   ├── emitter.js           # own Set-based subscribe/notify
│   │   ├── history.js           # two-stack undo/redo (command pattern)
│   │   ├── search.js            # pure runSearch()
│   │   ├── sample-data.js       # nested seed structure
│   │   └── index.js             # public exports
│   ├── sdkInstance.js           # single SDK instance (module level, StrictMode-safe)
│   ├── context/SdkContext.jsx   # provides the sdk instance
│   ├── store/uiStore.js         # plain-JS UI store (no React): selection, expansion, error
│   ├── hooks/
│   │   ├── useSdk.js            # reads sdk from context
│   │   ├── useTree.js           # useSyncExternalStore(sdk.subscribe, sdk.getSnapshot)
│   │   ├── useUiSelector.js     # useSyncExternalStore with a selector on uiStore
│   │   ├── useActions.js        # create / rename / move / delete / undo / redo / bulk delete
│   │   ├── usePruneUi.js        # SDK change -> remove stale ids from uiStore
│   │   ├── useSearch.js         # local search state + sdk.search
│   │   ├── useActivity.js       # sdk.getActivityLog keyed off the SDK version
│   │   └── useDebouncedValue.js # query debounce
│   ├── components/
│   │   ├── Layout/AppLayout.jsx
│   │   ├── Toolbar/Toolbar.jsx
│   │   ├── Tree/FileTree.jsx
│   │   ├── Tree/TreeNode.jsx    # recursive, memoized, has the required console.log
│   │   ├── Search/SearchPanel.jsx
│   │   ├── Search/SearchControls.jsx
│   │   ├── Search/SearchResults.jsx
│   │   ├── Details/DetailsPanel.jsx
│   │   ├── Activity/ActivityPanel.jsx
│   │   ├── Common/ErrorBanner.jsx
│   │   ├── Common/NameDialog.jsx
│   │   └── Common/MoveDialog.jsx
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── tests/
│   ├── setup.js                 # SDK (node) setup
│   ├── ui-setup.js              # UI (jsdom) setup: jest-dom + cleanup
│   ├── sdk/                     # 142 SDK tests across 9 suites
│   └── ui/                      # 53 UI tests across 9 suites
├── examples/node-demo.js        # non-React usage script
├── docs/API.md                  # full API reference
└── README.md
```

## Architecture

### Data model

Internal SDK state is a **normalized flat map**, not nested objects:

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

### SDK vs React responsibilities

- **SDK**: owns all file data; the single source of truth. Emits events; exposes a cached, structurally shared snapshot for `useSyncExternalStore`.
- **React**: owns only UI state (selection, expansion, search inputs, pending/error) in a separate plain-JS `uiStore`. Never copies the tree into `useState`.

```
UI action → sdk.rename(...) → validate → mutate → emit
                                                     │
UI ←── useSyncExternalStore(sdk.subscribe, sdk.getSnapshot)
```

### State placement

| State | Where | Why |
|---|---|---|
| File tree, history, activity | SDK | Source of truth; framework-independent |
| `selectedId`, `selectedIds`, `expandedIds`, `error`, `pending` | `uiStore` (plain JS) | UI-only; same `useSyncExternalStore` + selector pattern |
| Search query, filters, page | `useState` inside `SearchPanel` | Typing must never re-render the tree |
| Dialog visibility | `useState` in `App` | Pure view state |

### Pruning

`usePruneUi()` subscribes once in `App`. On every SDK change it collects existing ids from the snapshot and calls `uiStore.reconcile(ids)`, which drops stale ids from `selectedId`, `selectedIds`, and `expandedIds` — but only creates new state objects when something was actually removed.

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

**UI bonus:** the multi-select "Delete selected" button uses `sdk.transaction`, so bulk delete is one atomic step and one undo restores everything. Descendants of other selected items are filtered out first (deleting a parent already removes its children), and the selection is kept on failure.

## Search

`sdk.search(query, options)` — case-insensitive substring match on names across the whole tree (root excluded), computed fresh on every call. Supports `type` filter, `sortBy` (`name`/`type`/`path`), `order`, and pagination. Empty query returns an empty result (`total: 0`). Invalid options throw `INVALID_OPTIONS`. Full details in [docs/API.md](docs/API.md).

The React `SearchPanel` debounces the query (200 ms), keeps all state local (typing never re-renders the tree), and recomputes results with `useMemo` on `[debouncedQuery, options, sdkVersion]` so results always reflect the latest mutations.

## React integration and re-render optimization

### Techniques

| Technique | Why it is appropriate |
|---|---|
| `useSyncExternalStore` with SDK snapshot | Correct subscription cleanup, no tearing, no duplicate subscriptions |
| Structural sharing in SDK snapshots | Unchanged subtrees keep the same reference, so `React.memo` can skip them |
| `React.memo(TreeNode)` | Skips subtrees whose `node` prop reference did not change |
| Per-node selector subscriptions (`isExpanded`, `isSelected`, `isChecked`) | Expand and select re-render only the affected node, not the whole tree |
| Stable action functions (`useMemo` on `[sdk]`) | Prevents breaking memoization via changing props |
| Primitive props only (`node`, `depth` numbers) | Cheap equality checks |
| Search state local to `SearchPanel` | Typing never re-renders the tree |
| Debounced query (200 ms) | Fewer SDK calls |
| SDK instance at module level via context | StrictMode-safe; one instance |

### Re-render observations (actual results)

`console.log('render TreeNode', node.name)` in `TreeNode` was used to record these:

| Action | Observed `TreeNode` logs | Why |
|---|---|---|
| Expand a folder | The folder, plus newly mounted children on expand | Only its `isExpanded` flipped; children mount for the first time |
| Collapse a folder | Only that folder | Children unmount (not re-rendered) |
| Select a file | The previously selected node and the newly selected node | Only their `isSelected` changed |
| Create an item | The new node, its parent, and ancestors up to root | Ancestor references changed (structural sharing); siblings' subtree objects reused, so `React.memo` skips them |
| Rename an item | The item and its ancestors | Same reason; siblings skipped |
| Delete a folder with descendants | Its ancestors only | Descendants unmount, not re-render |
| Type in the search box | **No** `TreeNode` logs | Search state is not shared with the tree |
| Undo/redo | Only the nodes whose references changed | Snapshot sharing |

## Bonus features completed

- **Transactions** — atomic batches with rollback, one history entry, one notification.
- **Activity log** — capped, frozen, human-readable messages for every successful change including undo/redo and transactions.
- **Injectable `idGenerator`** — deterministic tests and demos.
- **Deterministic snapshot sorting** — folders-first, then name, with id tie-break.
- **Multi-select + bulk delete** — checkboxes + Ctrl/Cmd-click, "N selected" counter, one-transaction bulk delete, selection kept on failure, single undo restores all.
- **Keyboard support** — Enter selects, Left/Right arrows collapse/expand.
- **Pending UX** — 300 ms simulated UI-layer delay (off in tests) so the "Working…" state is visible.

## Design decisions

1. **SDK is the sole source of truth for file data** — React never copies the tree into `useState`.
2. **UI state lives in a plain-JS store** (`uiStore`) with `useSyncExternalStore` + selector subscriptions, so tree nodes subscribe only to their own booleans.
3. **Search state is local to `SearchPanel`** — typing never touches the tree.
4. **One SDK instance, created once at module level** and provided through context — StrictMode-safe.
5. **Every user action goes through `useActions()`** — one place for try/catch, pending, error, and follow-up UI rules (auto-expand parent after create, expand target after move).
6. **Prune on every SDK change** — stale selection and expansion are removed automatically.
7. **UI hints are not enforcement** — the Move dialog disables invalid targets as a convenience, but the SDK is the judge and its error is shown if anything gets through.
8. **Bulk delete filters descendants first** — a selected parent and child in one transaction would otherwise fail on NOT_FOUND and roll back.
9. **On failed bulk delete the selection is kept** — the SDK rolled back, so nothing was actually deleted.
10. **Restored (undone) folders come back collapsed** — pruning dropped their expanded id while they were deleted; this is documented behavior.

## Testing

**195 Vitest tests across 18 suites** (142 SDK in node + 53 UI in jsdom):

### SDK (9 suites)

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
| `edge-cases` | 12-level deep nesting (create/path/search/delete/undo), rapid 30-op sequence with undo-all/redo-all, trimmed names, 255/256-char boundary |

A structural `assertInvariants(sdk)` helper runs at the end of nearly every test: parent/child consistency, no cycles, no orphans, unique sibling names, files childless.

### UI (9 suites, jsdom + React Testing Library)

| Suite | Covers |
|---|---|
| `rendering` | root + children visible, collapse hides children, expand shows them, selection details, placeholder |
| `updates` | create/rename via UI, external SDK mutation appears in the tree |
| `errors` | duplicate → friendly banner, dismiss, no activity entry on failure, dialog stays open, empty name disabled |
| `subscriptions` | subscribe on mount / unsubscribe on unmount, no duplicates under StrictMode, no throw after unmount |
| `selection` | delete clears selection, undo restores collapsed, prune removes expanded ids, rename keeps state, move keeps expansion |
| `search` | nested results with location, type filter, sort order, pagination, rename updates results, invalid options, empty query, select result expands ancestors |
| `undo-redo` | buttons disabled/enabled correctly, tooltips, redo cleared on new action, nested subtree restore |
| `multi-select` | check/count, bulk delete clears selection, one undo restores all, descendant filtering, failure keeps selection + shows error, clear link, Ctrl-click, root not checkable |
| `render-counts` | search typing → 0 TreeNode logs; expand/collapse/create log only affected nodes |

Test helper: `tests/ui/helpers/renderApp.jsx` creates a **fresh SDK per test**, resets the UI store, and disables the fake delay (`NODE_ENV=test`).

```bash
npm test                          # everything
npx vitest run --project sdk      # SDK only
npx vitest run --project ui       # UI only
node examples/node-demo.js        # framework independence
```

## Known limitations and incomplete requirements

**No planned requirements are incomplete** — all required features and both bonus features are fully implemented, tested, and documented. The items below are deliberate design limitations, not unfinished work:

- **In-memory only** — no persistence; a refresh resets everything.
- **Synchronous SDK** — any "pending" UX belongs to the UI layer (a 300 ms fake delay is used for demonstration; off in tests).
- **History capped** (default 100); oldest entries are dropped.
- **Nested transactions** not supported; async transaction callbacks are rejected.
- **Search is a linear scan** (fine for small/medium trees; an index would be needed at 100k nodes).
- **No drag-and-drop, no file contents, no virtualization, no cross-tab sync.**
- **Restored folders come back collapsed** after undo of a delete (pruning dropped their expanded id).
- Move dialog uses a `<select>` of folder paths rather than a full tree picker (documented simplification).
- Shift-click range selection is not implemented (Ctrl/Cmd-click toggles instead).

## Submission checklist

All nine required submission items and where to find them:

| # | Requirement | Where |
|---|---|---|
| 1 | JavaScript SDK source code | [`src/sdk/`](src/sdk/) — pure JS, zero React/DOM imports |
| 2 | React application source code | [`src/`](src/) — components, hooks, store, context |
| 3 | Instructions for installing dependencies and running the application | [Install, run, test](#install-run-test) — `npm install` / `npm run dev` |
| 4 | Instructions for running automated tests | [Install, run, test](#install-run-test) and [Testing](#testing) — `npm test` (plus `--project sdk` / `--project ui`) |
| 5 | Documentation of public methods, parameters, return values, and usage examples | [docs/API.md](docs/API.md) — every method with params, returns, errors, and examples |
| 6 | Data model and architecture explanation | [Architecture](#architecture) — flat-map model, mutation pipeline, SDK vs React responsibilities, state placement, data-flow diagram |
| 7 | Undo/redo implementation explanation | [Undo / redo](#undo--redo) — command pattern, two stacks, redo-cleared rule, history cap, delete-restores-subtree |
| 8 | List of completed bonus features | [Bonus features completed](#bonus-features-completed) — transactions, activity log, multi-select/bulk delete, keyboard support, and more |
| 9 | Known limitations and incomplete requirements | [Known limitations and incomplete requirements](#known-limitations-and-incomplete-requirements) — no requirements incomplete; limitations listed honestly |

## Documentation

- [docs/API.md](docs/API.md) — full API reference with parameters, return values, errors, and examples.
