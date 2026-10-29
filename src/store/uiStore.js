/**
 * Plain-JS UI store (no React import) holding UI-only state:
 * selection, multi-select, expansion, error, and pending action.
 * Reuses the same Set-of-listeners emitter pattern as the SDK.
 */

function createUiEmitter() {
  const listeners = new Set();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit() {
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch {
          // a throwing listener must not break the others
        }
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

const initialState = () => ({
  selectedId: null,
  selectedIds: new Set(),
  expandedIds: new Set(),
  error: null,
  pending: null,
});

let state = initialState();
const emitter = createUiEmitter();

function setState(patch) {
  let changed = false;
  for (const key of Object.keys(patch)) {
    if (!Object.is(state[key], patch[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  emitter.emit();
}

export const uiStore = {
  getState() {
    return state;
  },

  subscribe(fn) {
    return emitter.subscribe(fn);
  },

  listenerCount() {
    return emitter.listenerCount();
  },

  /** Reset to a fresh initial state (used by tests). */
  reset() {
    state = initialState();
    emitter.emit();
  },

  select(id) {
    setState({ selectedId: id });
  },

  clearSelection() {
    setState({ selectedId: null });
  },

  toggleChecked(id) {
    const next = new Set(state.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setState({ selectedIds: next });
  },

  checkIds(ids) {
    const next = new Set(state.selectedIds);
    let added = false;
    for (const id of ids) {
      if (!next.has(id)) {
        next.add(id);
        added = true;
      }
    }
    if (added) setState({ selectedIds: next });
  },

  clearChecked() {
    if (state.selectedIds.size === 0) return;
    setState({ selectedIds: new Set() });
  },

  toggleExpanded(id) {
    const next = new Set(state.expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setState({ expandedIds: next });
  },

  expand(id) {
    if (state.expandedIds.has(id)) return;
    setState({ expandedIds: new Set(state.expandedIds).add(id) });
  },

  expandMany(ids) {
    const next = new Set(state.expandedIds);
    let added = false;
    for (const id of ids) {
      if (!next.has(id)) {
        next.add(id);
        added = true;
      }
    }
    if (added) setState({ expandedIds: next });
  },

  collapse(id) {
    if (!state.expandedIds.has(id)) return;
    const next = new Set(state.expandedIds);
    next.delete(id);
    setState({ expandedIds: next });
  },

  setError(error) {
    setState({ error });
  },

  clearError() {
    if (state.error === null) return;
    setState({ error: null });
  },

  setPending(pending) {
    setState({ pending });
  },

  /**
   * Removes ids that no longer exist in the SDK from selection and expansion.
   * Only creates new state objects when something was actually removed.
   */
  reconcile(existingIds) {
    const patch = {};

    if (state.selectedId !== null && !existingIds.has(state.selectedId)) {
      patch.selectedId = null;
    }

    if (state.selectedIds.size > 0) {
      const next = new Set();
      for (const id of state.selectedIds) {
        if (existingIds.has(id)) next.add(id);
      }
      if (next.size !== state.selectedIds.size) patch.selectedIds = next;
    }

    if (state.expandedIds.size > 0) {
      const next = new Set();
      for (const id of state.expandedIds) {
        if (existingIds.has(id)) next.add(id);
      }
      if (next.size !== state.expandedIds.size) patch.expandedIds = next;
    }

    if (Object.keys(patch).length > 0) setState(patch);
  },
};
