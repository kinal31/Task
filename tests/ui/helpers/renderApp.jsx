import { render } from '@testing-library/react';
import App from '../../../src/App.jsx';
import { FileExplorerSDK, createSampleData } from '../../../src/sdk/index.js';
import { uiStore } from '../../../src/store/uiStore.js';

/**
 * Renders the app with a fresh SDK and a reset UI store so tests never
 * leak state. The fake action delay is already off under NODE_ENV=test.
 *
 * @param {{ sdk?: FileExplorerSDK, withSampleData?: boolean }} [options]
 */
export function renderApp(options = {}) {
  const { withSampleData = true } = options;
  const sdk =
    options.sdk ??
    new FileExplorerSDK(withSampleData ? { initialData: createSampleData() } : {});

  uiStore.reset();

  const utils = render(<App sdk={sdk} />);
  return {
    sdk,
    uiStore,
    ...utils,
  };
}
