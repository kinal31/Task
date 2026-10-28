/**
 * Public entry point for the File Explorer SDK.
 * Framework-independent: safe to import from plain Node or any UI library.
 */

export { FileExplorerSDK } from './FileExplorerSDK.js';
export { FileExplorerError, ErrorCodes } from './errors.js';
export { createSampleData } from './sample-data.js';
export { NODE_TYPES, DEFAULT_ROOT_NAME } from './constants.js';
