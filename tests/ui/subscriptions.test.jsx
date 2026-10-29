import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { StrictMode } from 'react';
import App from '../../src/App.jsx';
import { FileExplorerSDK, createSampleData } from '../../src/sdk/index.js';
import { uiStore } from '../../src/store/uiStore.js';

function makeSdk() {
  return new FileExplorerSDK({ initialData: createSampleData() });
}

describe('subscription cleanup', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const sdk = makeSdk();
    uiStore.reset();

    const { unmount } = render(<App sdk={sdk} />);
    expect(sdk.listenerCount()).toBeGreaterThan(0);

    unmount();
    expect(sdk.listenerCount()).toBe(0);
  });

  it('has no duplicate subscriptions under StrictMode', () => {
    const sdk = makeSdk();
    uiStore.reset();

    const { unmount } = render(
      <StrictMode>
        <App sdk={sdk} />
      </StrictMode>
    );

    // Expected: one SDK subscriber (prune) + one per useSyncExternalStore
    // mount. StrictMode double-invokes effects but must clean up, so the
    // count equals the expected number, not double it.
    const count = sdk.listenerCount();
    expect(count).toBeGreaterThan(0);
    // Sanity: a leaked double-mount would roughly double the count.
    // Compare against a known-good single render of the same tree:
    const single = makeSdk();
    uiStore.reset();
    const singleUtils = render(<App sdk={single} />);
    const singleCount = single.listenerCount();
    singleUtils.unmount();
    expect(count).toBe(singleCount);

    unmount();
    expect(sdk.listenerCount()).toBe(0);
  });

  it('does not throw when the SDK changes after unmount', () => {
    const sdk = makeSdk();
    uiStore.reset();

    const { unmount } = render(<App sdk={sdk} />);
    unmount();

    expect(() => {
      act(() => {
        sdk.createFile(sdk.getRootId(), 'after-unmount.txt');
      });
    }).not.toThrow();
  });

  it('uiStore notifies only its own subscribers', () => {
    const sdk = makeSdk();
    uiStore.reset();
    const before = uiStore.listenerCount();

    const { unmount } = render(<App sdk={sdk} />);
    expect(uiStore.listenerCount()).toBeGreaterThan(before);

    unmount();
    expect(uiStore.listenerCount()).toBe(before);
    expect(sdk.listenerCount()).toBe(0);
  });
});
