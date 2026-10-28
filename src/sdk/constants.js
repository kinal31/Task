/**
 * Shared constants for the File Explorer SDK.
 */

export const NODE_TYPES = Object.freeze({
  FILE: 'file',
  FOLDER: 'folder',
});

export const DEFAULT_ROOT_NAME = 'My Files';
export const DEFAULT_HISTORY_LIMIT = 100;
export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_NAME_LENGTH = 255;
export const ROOT_PARENT_ID = null;

export const SEARCH_DEFAULTS = Object.freeze({
  type: 'all',
  sortBy: 'name',
  order: 'asc',
  page: 1,
  pageSize: 10,
});

export const SEARCH_TYPES = Object.freeze(['all', 'file', 'folder']);
export const SEARCH_SORT_BY = Object.freeze(['name', 'type', 'path']);
export const SEARCH_ORDERS = Object.freeze(['asc', 'desc']);
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;

export const HISTORY_COMMAND_TYPES = Object.freeze({
  CREATE: 'create',
  RENAME: 'rename',
  MOVE: 'move',
  DELETE: 'delete',
  TRANSACTION: 'transaction',
});
