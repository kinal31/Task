import { useMemo } from 'react';
import { useSdk } from '../context/SdkContext.jsx';
import { useTree } from './useTree.js';

/**
 * Recent activity entries, recomputed when the SDK version changes.
 * getActivityLog returns a new array each call, so it is derived with
 * useMemo from the tree/version rather than used as a snapshot directly.
 */
export function useActivity(limit = 20) {
  const sdk = useSdk();
  const tree = useTree(); // re-render trigger on SDK changes
  return useMemo(() => {
    void tree;
    return sdk.getActivityLog(limit);
  }, [sdk, tree, limit]);
}
