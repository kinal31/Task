import { useSyncExternalStore } from 'react';
import { useSdk } from '../context/SdkContext.jsx';

/**
 * Subscribes to the SDK snapshot (nested tree with structural sharing).
 * getSnapshot is cached per version by the SDK, so this never loops.
 */
export function useTree() {
  const sdk = useSdk();
  return useSyncExternalStore(sdk.subscribe, sdk.getSnapshot);
}
