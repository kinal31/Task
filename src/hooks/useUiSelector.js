import { useSyncExternalStore } from 'react';
import { uiStore } from '../store/uiStore.js';

/**
 * Selector-based subscription into the UI store.
 * The selector must return a primitive or a stable reference
 * (boolean, id, count) — returning a new Set/Array each call
 * would cause an infinite render loop.
 */
export function useUiSelector(selector) {
  return useSyncExternalStore(
    uiStore.subscribe,
    () => selector(uiStore.getState())
  );
}
