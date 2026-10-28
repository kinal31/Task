# Remaining Items After Day 1 and Day 2

Day 1 and Day 2 cover all the required work and both bonuses. A few things are left outside those two plans.

---

## 1. Submission checklist (maps to section 8 of the task)

- [ ] 1. SDK source code
- [ ] 2. React app source code
- [ ] 3. Install and run instructions
- [ ] 4. Test instructions
- [ ] 5. API documentation with examples
- [ ] 6. Data model and architecture explanation
- [ ] 7. Undo/redo explanation
- [ ] 8. List of completed bonus features
- [ ] 9. Known limitations and any incomplete requirements

Tick each one off against your README before you submit.

---

## 2. Final review pass (1 to 2 hours, if you have time left)

- Re-read the task's requirement lists (3.1 to 3.4, 4.1 to 4.3, 5, 7) line by line and confirm each has code, a test, and a doc mention.
- Check section 7 again: no event-emitter, undo/redo, or file-management libraries, and no React state as the source of truth.
- Test edge cases by hand:
  - Names with leading or trailing spaces
  - Very long names
  - Deep nesting (10 or more levels)
  - Undoing everything and then redoing everything
  - A rapid sequence of actions
- Run the app in StrictMode and in a production build (`npm run build && npm run preview`), since behavior can differ.
- Review the README as a reviewer would. A reviewer should be able to run and understand the project in under 10 minutes.

---

## 3. Packaging

- [ ] Add a `.gitignore` that excludes `node_modules` and `dist`
- [ ] Use clean, meaningful commit messages if you submit a Git repository
- [ ] If you submit a ZIP, leave out `node_modules`
- [ ] Do a fresh clone or unzip, then run `npm install && npm test && npm run dev` once

---

## 4. Interview preparation (likely follow-up questions)

- Why a flat Map instead of nested objects?
- How does structural sharing work, and why does it matter for `React.memo`?
- Why `useSyncExternalStore` instead of `useEffect` plus `useState`?
- What happens to redo history after a new action?
- How does transaction rollback work, and what are its limits?
- What would you change to scale this to 100,000 nodes? (Virtualized tree, indexed search, persistence.)

---

## 5. Optional extras (only if everything above is done)

- Keyboard navigation and drag-and-drop
- Persistence to `localStorage` as a convenience. The in-memory SDK must stay the source of truth.
- A backend. The task says none is required, so leave it out unless you have spare time. If you add one, keep it fully outside the SDK, and mention it as an extra in the README.

---

## Priority note

The most valuable use of any spare time is the documentation and the re-render observations. Those are the parts reviewers most often find missing.
