/**
 * Error types and codes for the File Explorer SDK.
 */

/**
 * Stable, machine-readable error codes. Every SDK failure throws a
 * `FileExplorerError` whose `code` is one of these values.
 */
export const ErrorCodes = Object.freeze({
  DUPLICATE_NAME: 'DUPLICATE_NAME',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_PARENT: 'INVALID_PARENT',
  INVALID_MOVE: 'INVALID_MOVE',
  INVALID_NAME: 'INVALID_NAME',
  ROOT_PROTECTED: 'ROOT_PROTECTED',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_QUERY: 'INVALID_QUERY',
  NOTHING_TO_UNDO: 'NOTHING_TO_UNDO',
  NOTHING_TO_REDO: 'NOTHING_TO_REDO',
  TRANSACTION_ERROR: 'TRANSACTION_ERROR',
});

/**
 * Custom error thrown by every SDK failure path.
 *
 * @param {string} code - One of {@link ErrorCodes}.
 * @param {string} message - Human-readable description.
 * @param {*} [details] - Optional extra context (e.g. the offending name).
 */
export class FileExplorerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'FileExplorerError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/**
 * Convenience constructor.
 *
 * @param {string} code
 * @param {string} message
 * @param {*} [details]
 * @returns {FileExplorerError}
 */
export function createError(code, message, details) {
  return new FileExplorerError(code, message, details);
}
