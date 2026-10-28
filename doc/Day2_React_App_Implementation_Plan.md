# Day 2 Plan: React App, Optimization, Bonus, UI Tests and Docs

**Goal for the day:** a React app that uses the Day 1 SDK for *every* file-management operation, with clean component structure, controlled re-renders, multi-select bulk delete, UI tests, and finished documentation.

**Total: about 9 to 10 hours.** Day 1 must be green (`npx vitest run tests/sdk`) before you start. If transactions are not done yet, finish them first (see "If you fall behind").

---

## Core design decisions (lock these in first, 30 min)

1. **The SDK is the only source of truth for file data.** React never copies the tree into `useState`. Components read it through `useSyncExternalStore(sdk.subscribe, sdk.getSnapshot)`.
2. **UI state lives in a small separate UI store, not in the SDK and not in one big `useState`.** It holds `selectedId`, `selectedIds` (multi-select), `expandedIds`, and `error`. Use the same `useSyncExternalStore` pattern with **selector subscriptions**, so a tree node subscribes only to `isExpanded(id)` and `isSelected(id)` and re-renders only when its own boolean flips. This is the main optimization.
3. **Search state is local to the search panel** (`useState` inside `SearchPanel`). Typing never touches the tree.
4. **One SDK instance, created once** at module level (`src/sdkInstance.js`) and provided through a context. Do not create it inside a component, or StrictMode will create two.
5. **Every user action goes through one `useActions()` hook** that wraps SDK calls in try/catch, sets pending and error state, and applies the follow-up UI rules (auto-expand parent after create, clear selection after delete).
6. **Prune on every SDK change.** One subscription at the App level removes selected and expanded ids that no longer exist in the SDK.
7. **Do not import React in `src/sdk`.** Do not put file data in Context, Redux, or Zustand.

---

## Folder layout for Day 2

```
src/
├── sdkInstance.js              # new FileExplorerSDK(...) created once
├── context/
│   └── SdkContext.jsx          # provides the sdk instance
├── store/
│   └── uiStore.js              # plain JS UI store (no React import): selection, expanded, error
├── hooks/
│   ├── useSdk.js               # reads sdk from context
│   ├── useTree.js              # useSyncExternalStore(sdk.subscribe, sdk.getSnapshot)
│   ├── useUiSelector.js        # useSyncExternalStore with a selector on uiStore
│   ├── useActions.js           # create / rename / move / delete / undo / redo / bulk delete
│   ├── usePruneUi.js           # SDK change -> remove stale ids from uiStore
│   ├── useSearch.js            # local search state + sdk.search
│   └── useActivity.js          # sdk.getActivityLog bound to the sdk version
├── components/
│   ├── Layout/AppLayout.jsx
│   ├── Toolbar/Toolbar.jsx
│   ├── Tree/FileTree.jsx
│   ├── Tree/TreeNode.jsx       # recursive, memoized, has the console.log
│   ├── Search/SearchPanel.jsx
│   ├── Search/SearchControls.jsx
│   ├── Search/SearchResults.jsx
│   ├── Details/DetailsPanel.jsx
│   ├── Activity/ActivityPanel.jsx
│   ├── Common/ErrorBanner.jsx
│   ├── Common/NameDialog.jsx   # create / rename input
│   └── Common/MoveDialog.jsx   # target folder picker
├── App.jsx
└── main.jsx
tests/ui/
docs/
```

---

## Phase 1: Wiring and the UI store (1 hr)

**Files:** `sdkInstance.js`, `SdkContext.jsx`, `useSdk.js`, `useTree.js`, `uiStore.js`, `useUiSelector.js`

**`uiStore.js` (plain JS, no React):**
- State: `{ selectedId: null, selectedIds: Set, expandedIds: Set, error: null }`
- Methods: `getState()`, `subscribe(fn)`, `select(id)`, `toggleChecked(id)`, `clearChecked()`, `toggleExpanded(id)`, `expand(id)`, `setError(err)`, `clearError()`, `reconcile(existingIds)`
- Every setter creates **new** Set objects (never mutate), and skips notifying when nothing changed.
- Reuse the same emitter pattern you built in Day 1.

**`useUiSelector(selector)`:**
```js
const value = useSyncExternalStore(uiStore.subscribe, () => selector(uiStore.getState()));
```
The selector must return a **primitive or a stable reference** (a boolean, an id, a count). That is why `isExpanded(id)` works and returning `new Set(...)` does not (infinite loop).

**`useTree()`:** just `useSyncExternalStore(sdk.subscribe, sdk.getSnapshot)`. Because `getSnapshot` returns a cached reference, there is no loop and no extra work.

**Test now:** a tiny component that renders the root name from `useTree()`. Create a folder from the console and watch it update.

---

## Phase 2: Recursive tree and expand/collapse (1.5 hr)

**`FileTree`:** reads the snapshot root and renders `<TreeNode node={root} depth={0} />`. This is the only component that needs the whole tree.

**`TreeNode` (the core component):**
```jsx
const TreeNode = React.memo(function TreeNode({ node, depth }) {
  console.log('render TreeNode', node.name);          // required by the task
  const isExpanded = useUiSelector(s => s.expandedIds.has(node.id));
  const isSelected = useUiSelector(s => s.selectedId === node.id);
  const isChecked  = useUiSelector(s => s.selectedIds.has(node.id));
  const actions = useActions();                        // stable callbacks
  ...
  return (
    <li role="treeitem" aria-expanded={isExpanded}>
      <Row ... />
      {node.type === 'folder' && isExpanded && (
        <ul role="group">
          {node.children.map(c => <TreeNode key={c.id} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
});
```

Rules:
- Props are only `node` (stable reference thanks to structural sharing) and `depth` (a number). No callbacks or Sets as props.
- **Keys are `node.id`**, never the index or name, so renames and moves keep component identity.
- Expand/collapse and select call `uiStore` methods, not the SDK.
- Clicking a file selects it. Clicking a folder row selects it, and the arrow toggles expand.
- Add basic keyboard support if time allows (Enter to select, Left/Right arrows to collapse/expand).

**Test now:** expand and collapse, and check the console. Only the clicked node should log.

---

## Phase 3: Actions, pending state and errors (1.5 hr)

**`useActions()`** returns **stable** functions (wrap in `useCallback` with `[sdk]` deps, or build once with `useMemo`):

| Action | SDK call | Follow-up UI rule |
|---|---|---|
| `createFile(parentId, name)` | `sdk.createFile` | expand parent, select new item |
| `createFolder(parentId, name)` | `sdk.createFolder` | expand parent, select new item |
| `rename(id, name)` | `sdk.rename` | keep selection and expansion |
| `move(id, targetId)` | `sdk.move` | expand target, keep item selected |
| `remove(id)` | `sdk.delete` | selection and expansion cleaned by prune |
| `bulkDelete(ids)` | `sdk.transaction` | see Phase 9 |
| `undo()` / `redo()` | `sdk.undo` / `sdk.redo` | prune handles stale ids |

**`runAction(name, fn)` wrapper:**
1. Set `pending = name`.
2. Optional: `await` a short fake delay (about 300 ms) *in the UI layer only*, so the pending state is visible. Make it easy to switch off (a constant or env flag), and **turn it off in tests**.
3. Run `fn()` in try/catch. On success clear the error. On failure call `uiStore.setError(err)`, using `err.code` and `err.message`.
4. Always clear pending in `finally`.
5. Return `true` or `false` so dialogs know whether to close.

**Pending state:** keep it in a small store (or in the same UI store) and read it with a selector. Disable toolbar buttons while pending, and show "Working..." text.

**Guard against stale async results:** if the component that started the action unmounts, do not set local state. Use an `isMounted` ref in dialogs.

**`ErrorBanner`:** reads `error` through a selector. It shows the message with a dismiss button. Errors clear on the next successful action or when dismissed. Map error codes to friendly text (for example `DUPLICATE_NAME` becomes "An item with this name already exists in this folder").

---

## Phase 4: Toolbar, dialogs and the move picker (1.5 hr)

**`Toolbar`:** buttons for New File, New Folder, Rename, Move, Delete, Undo, Redo.
- Reads `selectedId` through a selector. Rename, Move, and Delete are disabled when nothing is selected, and Rename, Move, and Delete are also disabled for the root.
- New File and New Folder create inside the selected folder. If a **file** is selected, create in its parent. If nothing is selected, use the root.
- Undo and Redo are disabled from `sdk.canUndo()` and `sdk.canRedo()`. These must re-evaluate on every SDK change, so read them through a `useSyncExternalStore` on the SDK with a primitive selector, for example `useSyncExternalStore(sdk.subscribe, () => sdk.canUndo())`. Booleans are safe snapshots.
- Show undo/redo labels in the button tooltip using `sdk.getHistory()`.

**`NameDialog`:** an inline input or small modal. Local `useState` for the text. Submit calls the action, closes on success, and stays open on failure so the user can fix the name. Enter submits and Escape cancels.

**`MoveDialog`:** shows the folder tree (a simplified recursive list) and lets the user pick a target.
- Disable the moved item and its descendants in the picker as a convenience, **but do not rely on this**. The SDK still enforces the rule, and the UI should show the SDK error if someone gets past it. Keep the SDK as the judge.
- A native `<select>` of all folders with their paths (`sdk.getPath`) is an acceptable simpler version.

**Test now:** try every invalid case by hand: duplicate name, empty name, move into own child, rename root.

---

## Phase 5: Details, Search and Activity panels (1.5 hr)

**`DetailsPanel`:**
- Reads `selectedId` by selector, then `sdk.getItem(id)` and `sdk.getPath(id)`. Wrap in a safe lookup, since the item may disappear.
- Shows name, type, id, full path, parent name, and number of children (folders).
- When nothing is selected, show a placeholder.
- It must re-render when the selected item is renamed or moved, so it also depends on the SDK version (via `useTree()` or `useSyncExternalStore` on `sdk.getVersion`).

**`SearchPanel` (state fully local):**
- `useState` for `query`, `type`, `sortBy`, `order`, `page`, `pageSize`.
- Debounce the query (about 200 ms) with a small `useDebouncedValue` hook, so the SDK is not called on every keystroke. Keep the *input* responsive and debounce only the value used for searching.
- Compute results with `useMemo(() => sdk.search(debouncedQuery, options), [debouncedQuery, options, version])`. Include the SDK version in the dependencies so results refresh after tree changes (the "search reflects changes" requirement).
- Wrap `sdk.search` in try/catch and show an inline error for invalid options (the SDK throws `INVALID_OPTIONS`). Never let it crash the render.
- Reset `page` to 1 when the query, type, sort, or page size changes.
- **`SearchResults`:** each row shows name, type icon, and location (path). Clicking a result selects it, **expands all ancestor folders** (use `sdk.getPath(id).ids`), and scrolls it into view.
- Pagination controls: previous, next, "Page X of Y", page size select.
- Empty states: empty query ("Type to search"), no results ("No matches").

**`ActivityPanel`:**
- Reads `sdk.getActivityLog(20)` keyed off the SDK version (use `useMemo` on `[version]`, or a `useSyncExternalStore` with a cached snapshot).
- **Careful:** if `getActivityLog` returns a new array each call, do not use it directly as a `useSyncExternalStore` snapshot. Either cache it in the SDK by version, or derive it with `useMemo` from the version number.
- Shows time, type badge, and message, newest first. Include undo and redo events.

---

## Phase 6: Consistency, pruning and selection rules (1 hr)

**`usePruneUi()`:** called once in `App`.
```js
useEffect(() => {
  const run = () => uiStore.reconcile(collectIds(sdk.getSnapshot()));   // or a cheaper sdk.hasItem(id)
  run();
  return sdk.subscribe(run);         // cleanup = unsubscribe
}, [sdk]);
```

`reconcile(existingIds)`:
- `selectedId`: set to null if it no longer exists.
- `selectedIds`: remove stale ids.
- `expandedIds`: remove stale ids.
- Only create new state objects if something was actually removed (avoids needless notifications).

Behavior to verify by hand and by test:
- Delete the selected folder: selection clears, its descendants are removed from expanded state.
- **Undo a delete:** the folder returns with the same ids. Decide and document whether it comes back expanded. Simple choice: it returns collapsed, because pruning dropped its id.
- Move a folder: it keeps its expanded state, because the id is unchanged.
- Rename: nothing changes in UI state.
- Undo a create: the new item disappears and selection clears via prune.
- Deleting a parent while a child is selected: selection clears.

**StrictMode check:** wrap in `<React.StrictMode>` and confirm that the SDK `listenerCount()` stays at the expected number after mount (one per active subscriber, no leaks).

---

## Phase 7: Re-render optimization and observation (1 hr)

**Techniques (document each with the reason):**

| Technique | Why it is appropriate |
|---|---|
| `useSyncExternalStore` with SDK snapshot | Correct subscription cleanup, no tearing, no duplicate subscriptions |
| Structural sharing in SDK snapshots (Day 1) | Unchanged subtrees keep the same reference, so `React.memo` can skip them |
| `React.memo(TreeNode)` | Skips subtrees whose `node` prop reference did not change |
| Per-node selector subscriptions (`isExpanded`, `isSelected`) | Expand and select re-render only the affected node, not the whole tree |
| Stable action functions (`useCallback` or `useMemo`) | Prevents breaking memoization via changing props |
| Primitive props only | Cheap equality checks |
| Search state local to `SearchPanel` | Typing never re-renders the tree |
| Debounced query | Fewer SDK calls |

**Observation exercise (the task requires this):** open the console, clear it before each action, and record what logs. Fill in this table for the README with your **actual** results:

| Action | Expected `TreeNode` logs | Why |
|---|---|---|
| Expand or collapse a folder | Only that folder, plus newly shown children on expand | Only its `isExpanded` flipped |
| Select a file | The previously selected node and the newly selected node | Only their `isSelected` changed |
| Create an item | New node, its parent, and ancestors up to root | Ancestor references changed (structural sharing) |
| Rename an item | The item and its ancestors | Same reason; siblings are skipped |
| Delete a folder with descendants | Its ancestors only (descendants are unmounted, not re-rendered) | The subtree is gone |
| Type in the search box | **No** `TreeNode` logs | Search state is not shared with the tree |
| Undo/redo | Only the nodes whose references changed | Snapshot sharing |

If a result differs from the table (for example, every node logs on select), find out why. Usual causes: a callback or Set passed as a prop, an inline object prop, an unstable `useActions` return value, or `getSnapshot` returning new references.

Optional: use React DevTools "Highlight updates" and take a screenshot for the README.

---

## Phase 8: Bonus A, transactions in the UI (30 min)

Transactions already exist from Day 1. Show them in the UI:
- A "Bulk" action uses `sdk.transaction` (next phase).
- The Activity panel shows one "transaction" entry, and one Undo reverses the entire batch.
- Document the API and rollback behavior in `docs/API.md`.

---

## Phase 9: Bonus B, multi-select and bulk delete (1 hr)

**UI:**
- A checkbox on each tree row, plus Ctrl/Cmd-click to toggle. (Shift-click range selection is optional.)
- Stored in `selectedIds` (a Set) in the UI store, **separate from the single `selectedId`** used by the details panel.
- Toolbar shows "N selected" and a "Delete selected" button (disabled at 0), plus a "Clear selection" link.
- The root cannot be checked.

**`bulkDelete(ids)`:**
```js
const ids = [...uiStore.getState().selectedIds];
const topLevel = ids.filter(id => !hasSelectedAncestor(id, ids));   // skip descendants of other selected items
await runAction('bulk-delete', () =>
  sdk.transaction(tx => { topLevel.forEach(id => tx.delete(id)); })
);
```
- **Filter out descendants first.** If a folder and its child are both selected, deleting the folder already removes the child, and a second `delete` would throw `NOT_FOUND` and roll back the whole transaction. Use `sdk.getPath(id).ids` to test for a selected ancestor.
- **On success:** `uiStore.clearChecked()`. Prune handles `selectedId`.
- **On failure:** the SDK rolled back, so keep `selectedIds` unchanged and show the error banner. Do not clear anything.
- One Undo restores everything that was deleted, because it was one transaction.

**Test by hand:** select 3 items including a parent and its child, delete, then undo once. Everything returns. Then force a failure, for example by deleting one of the selected items with the SDK from the console first, and confirm the selection is preserved.

---

## Phase 10: Automated UI tests (1.5 hr)

**Setup (`vitest.config.js` / `vite.config.js`):** `environment: 'jsdom'`, `setupFiles: ['./tests/setup.js']`, `globals: true`. In `setup.js` import `@testing-library/jest-dom` and add cleanup after each test.

**Test helper:** `renderApp({ sdk })`. It creates a **fresh SDK per test**, wraps the app in `SdkContext`, and resets the UI store, so tests do not leak state. Disable the fake action delay.

**Tests to write (one file per area):**

1. **Rendering:** the initial tree shows the root and expected children; collapsed folders hide their children; expanding shows them.
2. **UI updates after SDK changes:** create a folder through the UI and see it appear; rename shows the new name; an SDK mutation made *outside* React (call `sdk.createFile` directly inside `act`) also appears.
3. **Error handling:** create a duplicate name and see the error banner with a friendly message; the tree is unchanged; dismissing the banner clears it; a failed action does not add an activity entry.
4. **Subscription cleanup:** `sdk.listenerCount()` is greater than 0 after mount and returns to 0 after `unmount()`; no duplicate subscriptions under `<StrictMode>` (count equals the expected number, not doubled); an SDK change after unmount does not warn or throw.
5. **Selection consistency:** select an item and delete it, and the details panel shows the placeholder; undo restores the item; expanded state is pruned for a deleted folder.
6. **Search:** typing shows nested results with location; the type filter works; changing the sort changes the order; pagination moves pages; renaming an item updates the visible results; an invalid option shows an inline error rather than crashing.
7. **Undo/redo UI:** buttons are disabled initially; enabled after an action; clicking Undo restores the tree; Redo reapplies.
8. **Multi-select (bonus):** check 2 items and see "2 selected"; bulk delete removes them and clears the selection; after a forced failure the selection stays and the error shows; one undo restores all.
9. **Render count (optional but impressive):** spy on `console.log` and assert that typing in the search box produces zero `TreeNode` logs, and that expanding one folder logs only that node.

Use `userEvent` over `fireEvent`, `findBy...` for async, and `within(...)` to scope queries to panels. Wrap direct SDK calls in `act(...)`.

---

## Phase 11: Documentation and submission polish (1.5 hr)

**`README.md`:**
1. Overview and feature list
2. Install, run (`npm install`, `npm run dev`), and test (`npm test`) commands
3. Folder structure
4. Architecture: data model, SDK vs React responsibilities, data flow diagram (ASCII is fine)
5. Undo/redo explanation (command pattern, two stacks, redo cleared on new action, history cap, failures never recorded, delete stores the subtree)
6. Transaction explanation (snapshot, suppress, commit or restore, one history entry, one notification)
7. Search behavior (empty query choice, sorting, pagination, validation)
8. React integration and re-render observations (the table from Phase 7 with your real results)
9. Completed bonus features
10. Design decisions
11. **Known limitations** (see below)

**`docs/API.md`:** every public method with parameters, return value, errors thrown, and a short example. Include the error code table and the event payload shapes for `subscribe`.

**`docs/ARCHITECTURE.md`:** may be merged into the README if short, but the task wants it explicitly, so keep a clear section.

**Known limitations to state honestly:** in-memory only (a refresh resets everything), synchronous SDK (UI-level fake delay only), history capped at the limit, nested transactions not supported, async transaction callbacks rejected, no drag-and-drop, no file contents, no persistence, no virtualization for very large trees, no cross-tab sync, and search is a linear scan.

**Final verification (do from scratch):**
- [ ] Delete `node_modules`, run `npm install && npm test && npm run build`
- [ ] Run `npm run dev` and do a full manual pass of every feature
- [ ] `grep -ri "react" src/sdk` returns nothing
- [ ] `node examples/node-demo.js` still works
- [ ] No leftover debugging code, except the required `console.log` in `TreeNode`
- [ ] Zip without `node_modules` (or push to git with a `.gitignore`)

---

## Suggested hourly schedule

| Time | Work |
|---|---|
| 0:00 to 0:30 | Lock design decisions, folder layout |
| 0:30 to 1:30 | Phase 1: wiring, UI store, hooks |
| 1:30 to 3:00 | Phase 2: recursive tree, expand/collapse |
| 3:00 to 4:30 | Phase 3 and 4: actions, errors, toolbar, dialogs |
| 4:30 to 6:00 | Phase 5: details, search, activity panels |
| 6:00 to 7:00 | Phase 6 and 7: pruning, re-render observation |
| 7:00 to 8:00 | Phase 8 and 9: transactions in UI, multi-select |
| 8:00 to 9:30 | Phase 10: UI tests |
| 9:30 to 11:00 | Phase 11: docs and final verification |

If your day is shorter, compress by writing tests alongside each phase instead of at the end.

---

## Common mistakes to avoid

- Storing the tree in `useState`, or copying the snapshot into state (violates the source-of-truth rule)
- `getSnapshot` or a selector returning a **new object, array, or Set** on every call (infinite render loop)
- Passing `expandedIds` or `selectedIds` Sets as props to every node (defeats memoization)
- Inline arrow functions or object literals as props to memoized components
- Using array index or name as a React key
- Creating the SDK instance inside a component
- Subscribing inside `useEffect` and forgetting to return the unsubscribe function
- Stale `selectedId` or expanded ids after delete or undo
- Letting the UI enforce rules instead of the SDK (UI hints are fine, but the SDK must be the judge)
- Bulk-deleting a parent and its selected child in the same transaction without filtering descendants
- Clearing the multi-selection on a **failed** bulk delete
- Calling `sdk.search` with every keystroke and no error handling
- Leaving the fake action delay on in tests (slow, flaky tests)
- Forgetting the required `console.log` in the recursive component

---

## Day 2 "done" checklist

- [ ] The app uses only SDK methods for file operations, and no file data lives in React state
- [ ] Recursive tree with expand/collapse; selecting, creating, renaming, moving, and deleting all work
- [ ] Search with filter, sort, pagination, and location display; results refresh after mutations
- [ ] Details panel, activity panel, undo/redo buttons, and error banner all work
- [ ] Stale selection and expansion are pruned after delete and undo
- [ ] `console.log` in `TreeNode`, and the observation table filled in with real results
- [ ] Bonus: bulk delete uses one transaction and one undo step; selection kept on failure
- [ ] UI tests cover rendering, updates, errors, subscription cleanup (including StrictMode), search, and undo/redo
- [ ] README, `docs/API.md`, architecture, undo/redo, bonus list, and limitations are complete
- [ ] A clean install, test, and build pass from scratch

---

## If you fall behind

Cut in this order: (1) keyboard navigation and shift-click range select, (2) the `MoveDialog` tree picker (use a plain `<select>` instead), (3) the optional render-count test, (4) the debounce (call search directly, memoized). **Never cut** the pruning logic, subscription cleanup tests, the error handling UI, the re-render observation write-up, or the known limitations section. They map directly to the evaluation criteria in the task.
