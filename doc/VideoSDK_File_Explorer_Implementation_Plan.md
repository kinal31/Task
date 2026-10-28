# VideoSDK File Explorer: Implementation Plan

## Step 0: What to use and what not to use

### Must use
- JavaScript (not TypeScript, since the task says "Use JavaScript and React"), React, and Vite
- Vitest with React Testing Library and jsdom for tests (standard libraries are allowed for setup, styling, and testing)
- Plain CSS or CSS modules. Visual polish isn't graded.
- Hooks: `useSyncExternalStore`, `useState`, `useReducer`, `useMemo`, `useCallback`, `React.memo`, and custom hooks
- A `console.log` inside the recursive tree node component, so you can observe re-renders

### Must not use
- File-management libraries, event-emitter libraries (mitt, eventemitter3, etc.), or undo/redo libraries (redux-undo and similar). Build all of these yourself.
- React state, Redux, Zustand, or Context as the source of truth for file data. The SDK owns the data.
- A backend, database, localStorage-as-truth, or the real disk (not required by the task)
- Importing React (or anything DOM-related) inside the SDK. It must run in plain Node or a non-React app.
- Exposing internal objects directly. Always return copies or frozen snapshots.

### Optional
- Tailwind or a small UI library for styling
- `crypto.randomUUID()` for ids (built in, no library needed)

---

## Step 1: Project setup (30 min)

```
file-explorer/
├── src/
│   ├── sdk/                 # pure JS, no React
│   │   ├── FileExplorerSDK.js
│   │   ├── errors.js
│   │   ├── validators.js
│   │   ├── search.js
│   │   ├── history.js
│   │   ├── emitter.js       # your own subscribe/notify
│   │   └── index.js
│   ├── hooks/               # useFileExplorer, useSelection, useExpanded, useSearch
│   ├── components/          # Tree, TreeNode, Toolbar, SearchBar, DetailsPanel, ActivityPanel, ErrorBanner
│   ├── App.jsx
│   └── main.jsx
├── tests/sdk/ and tests/ui/
├── docs/ (API.md, ARCHITECTURE.md)
└── README.md
```

Set up with `npm create vite@latest` (React JS template), then add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom`.

---

## Step 2: Design the data model (before coding)

Use a **normalized flat map**, not nested objects:

```js
nodes: Map<id, { id, name, type: 'file'|'folder', parentId, childIds: [] }>
rootId
```

Why: lookups by id are O(1), move and rename are simple, identity is preserved naturally, and validation is easy. Build the nested tree only when `getTree()` is called.

Other decisions to make now:
- Root folder "My Files" has `parentId: null` and can't be renamed, moved, or deleted.
- Files have no `childIds`, so "files can't contain items" is enforced both structurally and by validation.
- Version counter: increment `version` on every successful change. React uses it for snapshot caching.
- Name uniqueness: compare `name.trim().toLowerCase()` among siblings. Reject empty names and names containing `/`.

---

## Step 3: Error handling

Create a custom `FileExplorerError extends Error` with a `code` field:

`DUPLICATE_NAME`, `NOT_FOUND`, `INVALID_PARENT` (parent is a file), `INVALID_MOVE` (into itself or a descendant), `INVALID_NAME`, `ROOT_PROTECTED`, `INVALID_OPTIONS`, `NOTHING_TO_UNDO`, `NOTHING_TO_REDO`.

**Rule:** validate everything first and mutate only afterward. That is how failed operations never corrupt state or create history entries.

---

## Step 4: Core SDK methods

| Requirement | Method |
|---|---|
| Get structure | `getTree()` returns a nested deep-frozen clone |
| Get item | `getItem(id)` returns a clone, or throws `NOT_FOUND` |
| Create file/folder | `createFile(parentId, name)`, `createFolder(parentId, name)` |
| Rename | `rename(id, newName)` |
| Move | `move(id, newParentId)`, with a walk up the ancestors to block moving into a descendant |
| Delete | `delete(id)`, which removes the whole subtree |
| Path helper | `getPath(id)` returns e.g. `My Files / Documents / Resume.pdf` |
| Subscribe | `subscribe(listener)` returns an `unsubscribe` function |
| Undo/redo | `undo()`, `redo()`, `canUndo()`, `canRedo()` |
| Search | `search(query, options)` |
| Transactions | `transaction(fn)` (bonus) |

Return values: mutating methods return the affected item (a clone). Never return internal references.

---

## Step 5: Undo/redo design

Use the **command pattern**: each successful operation pushes an entry with enough data to reverse and reapply it.

- **Create:** undo removes the node; redo re-inserts it **with the same id**
- **Rename:** store `oldName` and `newName`
- **Move:** store `oldParentId`, `newParentId`, and the old index
- **Delete:** store the **entire removed subtree** (all nodes, plus the parent and index). Undo re-inserts them with their original ids, which gives full nested restoration.

History: two stacks, `undoStack` and `redoStack`.
- A new successful operation after an undo **clears the redo stack**. Document this.
- Failed operations push nothing, since validation happens before the push.
- Cap history size (e.g. 100) and note it as a design decision.
- Undo and redo should also validate. With strict LIFO order, name conflicts normally can't occur on undo, which you can explain in the docs.

---

## Step 6: Transactions (bonus, worth doing)

Approach: **snapshot, work on a draft, then commit or restore**.

```js
sdk.transaction(tx => {
  tx.delete(id1);
  tx.move(id2, folderId);
});
```

1. Take a snapshot of the state before.
2. Run the operations with notifications and history **suppressed**.
3. If anything throws, restore the snapshot, create no history entry, and send no notification. Rethrow the error.
4. If it all succeeds, push **one composite history entry** and notify listeners **once**.

For the composite entry, either store before/after snapshots (structural copies) and swap them on undo/redo, or collect the child commands and reverse them in reverse order. Pick one and document it.

---

## Step 7: Search (in the SDK)

```js
sdk.search('res', {
  type: 'all' | 'file' | 'folder',
  sortBy: 'name' | 'type' | 'path',
  order: 'asc' | 'desc',
  page: 1,
  pageSize: 10
})
// -> { items: [{ id, name, type, path }], total, page, pageSize, totalPages }
```

- Case-insensitive substring match across all nodes (exclude the root)
- Empty query returns an empty result (or all items; document your choice). Invalid options throw `INVALID_OPTIONS`.
- Read-only and computed fresh from current state, so results always reflect mutations.

---

## Step 8: Notifications

Write your own tiny emitter with a `Set` of listeners:
- `subscribe(fn)` returns an unsubscribe function that is safe to call twice
- Notify after each successful change with an event payload like `{ type: 'delete', itemId, version }`
- A listener that throws shouldn't break the other listeners (try/catch each)
- Keep a capped activity log inside the SDK (or build it in React from events) for the activity panel

---

## Step 9: React integration

**Custom hook with `useSyncExternalStore`:**

```js
const tree = useSyncExternalStore(sdk.subscribe, sdk.getSnapshot);
```

This is the cleanest answer to "subscribe, avoid duplicates, clean up on unmount." `getSnapshot` must return a **cached** reference that only changes when the version changes. Otherwise you get an infinite loop.

**State placement (UI state only, in React):**
- `selectedId` and `expandedIds` (a Set), in a context or in the top component
- `searchQuery`, search options, `pendingAction`, and `error`
- On every SDK change, **prune**: if the selected item no longer exists, clear it. Drop deleted ids from `expandedIds`. After a move, keep the expanded state. Auto-expand the parent after a create.

**Async and pending:** the SDK is synchronous, so wrap actions in a hook (`runAction`) that sets pending, runs the call in try/catch, sets the error, and clears pending. To demonstrate pending states, add a tiny simulated delay in the UI layer, not in the SDK.

---

## Step 10: Components

- `App`: layout and providers
- `Toolbar`: new file, new folder, rename, move, delete, undo, redo
- `FileTree` → `TreeNode` (recursive, with the `console.log`)
- `SearchPanel` + `SearchResults`: controls, sorting, pagination
- `DetailsPanel`: name, type, id, path, children count
- `ActivityPanel`: recent changes
- `ErrorBanner`
- Dialogs or inline inputs for name entry and the move target picker

---

## Step 11: Re-render optimization (graded explicitly)

1. **Structural sharing in the snapshot.** When one node changes, only it and its ancestors get new object references. Unchanged siblings keep the same reference.
2. **`React.memo(TreeNode)`** so unchanged subtrees skip re-rendering.
3. **Stable callbacks** (`useCallback`) and primitive props (`isSelected`, `isExpanded` booleans) rather than whole sets.
4. **Keep search state out of the tree**, so typing in the search box doesn't re-render the tree.
5. **Split contexts** (selection and expansion separately from the SDK data).

Then add a short table in your README of what you observed in the console for each action (expand, select, create, rename, delete, search typing) and why.

---

## Step 12: Bonus multi-select

- `selectedIds` as a Set, with checkboxes or Ctrl/Cmd-click
- Show "N selected"
- The bulk delete button calls `sdk.transaction(...)`, so it's one undo step
- On success, clear the selection. On failure, keep it and show the error.
- Watch for a selected folder whose child is also selected. Deleting the parent already removes the child, so skip descendants whose ancestors are being deleted, or the transaction will fail on a missing id.

---

## Step 13: Tests

**SDK (Vitest):**
- CRUD for files and folders
- Duplicate names (case-insensitive)
- File-as-parent rejection
- Move into self or descendant
- Root protection
- Search: nested, filter, sort, pagination, bad options, updates after mutations, no mutation
- Undo/redo for all four operations
- Nested restore after delete
- Redo cleared after a new action
- Failed operation leaves no history
- Subscribe and unsubscribe
- Immutability (mutate a returned object, then verify the SDK is unchanged)
- Transaction rollback and single undo

**React (RTL):**
- Renders the tree
- UI updates after create
- Error message on a duplicate
- Unsubscribe on unmount (spy on the listener count)
- No duplicate subscriptions under StrictMode
- Selection cleared after deleting the selected item

---

## Step 14: Documentation (don't leave this to the end)

`README.md` must include:
- Install and run instructions
- Test commands
- The SDK API (each method with parameters, returns, errors, and an example)
- Data model and architecture
- Undo/redo explanation
- Transaction explanation
- Re-render observations
- Bonus features completed
- Known limitations (e.g. no persistence, in-memory only, history cap, synchronous SDK, no drag-and-drop)

---

## Suggested 2-day schedule

| When | Work |
|---|---|
| Day 1 | Steps 1–8 (setup, model, errors, CRUD, validation, search, history, emitter, transactions), with SDK tests written alongside each feature |
| Day 2 morning | Steps 9–10 (hooks and components) |
| Day 2 afternoon | Steps 11–13 (optimization, multi-select, UI tests) |
| Final hour | Step 14 (docs), a clean `npm install && npm test` check from scratch, and a final review of the constraints list |

---

## Common mistakes to avoid

- Returning internal node objects (violates rule 8)
- Giving undone items a new id (breaks "preserve identity")
- Pushing a history entry before validation succeeds
- `getSnapshot` returning a new object on every call (infinite render loop)
- Leaving stale `selectedId` or expanded ids after delete
- Forgetting to notify after undo and redo
- Putting any React import in `src/sdk`
