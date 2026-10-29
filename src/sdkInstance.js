/**
 * The single SDK instance for the app, created once at module level.
 * Creating it inside a component would produce two instances under StrictMode.
 */
import { FileExplorerSDK, createSampleData } from './sdk/index.js';

export const sdk = new FileExplorerSDK({
  initialData: createSampleData(),
});
