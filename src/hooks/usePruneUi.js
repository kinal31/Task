import { useEffect } from 'react';
import { useSdk } from '../context/SdkContext.jsx';
import { uiStore } from '../store/uiStore.js';

/**
 * Called once in App. Expands the root on mount (so the tree is visible
 * immediately) and, on every SDK change, removes selected and expanded ids
 * that no longer exist from the UI store.
 */
export function usePruneUi() {
  const sdk = useSdk();

  useEffect(() => {
    uiStore.expand(sdk.getRootId());

    const run = () => {
      const snapshot = sdk.getSnapshot();
      const ids = new Set();
      const walk = (node) => {
        ids.add(node.id);
        for (const child of node.children) walk(child);
      };
      walk(snapshot);
      uiStore.reconcile(ids);
    };
    run();
    return sdk.subscribe(run);
  }, [sdk]);
}
