/**
 * Pure search over the nodes Map. No SDK instance required, no mutation.
 *
 * Behavior:
 * - `query` must be a string (INVALID_QUERY otherwise). It is trimmed.
 * - An **empty query returns an empty result** with `total: 0` (documented
 *   choice: searching for "nothing" matches nothing, which also makes the
 *   UI's "type to search" state trivial).
 * - Matching is a case-insensitive substring test on `name`, across all
 *   nodes except the root.
 * - One DFS from the root carries the path along, so path computation is
 *   O(1) amortized per node, not O(n × depth).
 * - Results are freshly computed frozen objects on every call, so they
 *   always reflect the latest mutations and can never alias internal state.
 */

import { FileExplorerError, ErrorCodes } from './errors.js';
import {
  SEARCH_TYPES,
  SEARCH_SORT_BY,
  SEARCH_ORDERS,
  MIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
  NODE_TYPES,
} from './constants.js';

/**
 * @typedef {object} SearchItem
 * @property {string} id
 * @property {string} name
 * @property {'file'|'folder'} type
 * @property {string} path - full path including the item itself
 * @property {string} location - the parent's path text (what the UI shows)
 */

/**
 * @typedef {object} SearchOptions
 * @property {'all'|'file'|'folder'} [type='all']
 * @property {'name'|'type'|'path'} [sortBy='name']
 * @property {'asc'|'desc'} [order='asc']
 * @property {number} [page=1]
 * @property {number} [pageSize=10]
 */

/**
 * @typedef {object} SearchResult
 * @property {SearchItem[]} items
 * @property {number} total
 * @property {number} page
 * @property {number} pageSize
 * @property {number} totalPages - 0 when there are no matches
 * @property {string} query - the trimmed query
 */

/**
 * Validates search options, throwing INVALID_OPTIONS for unknown values.
 * @private
 * @param {SearchOptions} options
 * @returns {Required<SearchOptions>}
 */
function resolveOptions(options) {
  const {
    type = 'all',
    sortBy = 'name',
    order = 'asc',
    page = 1,
    pageSize = 10,
  } = options ?? {};

  if (!SEARCH_TYPES.includes(type)) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_OPTIONS,
      `Invalid type "${type}"; expected one of ${SEARCH_TYPES.join(', ')}`,
      { type }
    );
  }
  if (!SEARCH_SORT_BY.includes(sortBy)) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_OPTIONS,
      `Invalid sortBy "${sortBy}"; expected one of ${SEARCH_SORT_BY.join(', ')}`,
      { sortBy }
    );
  }
  if (!SEARCH_ORDERS.includes(order)) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_OPTIONS,
      `Invalid order "${order}"; expected one of ${SEARCH_ORDERS.join(', ')}`,
      { order }
    );
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_OPTIONS,
      `Invalid page ${page}; expected an integer >= 1`,
      { page }
    );
  }
  if (
    !Number.isInteger(pageSize) ||
    pageSize < MIN_PAGE_SIZE ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_OPTIONS,
      `Invalid pageSize ${pageSize}; expected an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`,
      { pageSize }
    );
  }

  return { type, sortBy, order, page, pageSize };
}

const COMPARATORS = {
  name: (a, b) => a.name.localeCompare(b.name),
  type: (a, b) => a.type.localeCompare(b.type),
  path: (a, b) => a.path.localeCompare(b.path),
};

/**
 * Runs a search over the whole tree.
 *
 * @param {Map<string, object>} nodes
 * @param {string} rootId - excluded from results
 * @param {string} query
 * @param {SearchOptions} [options]
 * @returns {Readonly<SearchResult>}
 * @throws {FileExplorerError} INVALID_QUERY | INVALID_OPTIONS
 */
export function runSearch(nodes, rootId, query, options) {
  if (typeof query !== 'string') {
    throw new FileExplorerError(
      ErrorCodes.INVALID_QUERY,
      'query must be a string',
      query
    );
  }

  const trimmed = query.trim();
  const resolved = resolveOptions(options);

  if (trimmed === '') {
    return Object.freeze({
      items: Object.freeze([]),
      total: 0,
      page: resolved.page,
      pageSize: resolved.pageSize,
      totalPages: 0,
      query: trimmed,
    });
  }

  const needle = trimmed.toLowerCase();

  /** @type {SearchItem[]} */
  const matches = [];

  // One DFS carrying the path of names and ids along.
  const walk = (id, pathNames, pathIds) => {
    const node = nodes.get(id);
    const nextPathNames = [...pathNames, node.name];
    const nextPathIds = [...pathIds, id];

    if (id !== rootId && node.name.toLowerCase().includes(needle)) {
      if (resolved.type === 'all' || node.type === resolved.type) {
        matches.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nextPathNames.join(' / '),
          location: pathNames.join(' / '),
        });
      }
    }

    if (node.type === NODE_TYPES.FOLDER) {
      for (const childId of node.childIds) {
        walk(childId, nextPathNames, nextPathIds);
      }
    }
  };

  walk(rootId, [], []);

  // Stable comparator with an id tie-break so ordering is deterministic.
  const compare = COMPARATORS[resolved.sortBy];
  matches.sort((a, b) => {
    const primary = compare(a, b);
    if (primary !== 0) return resolved.order === 'desc' ? -primary : primary;
    if (a.id === b.id) return 0;
    const byId = a.id < b.id ? -1 : 1;
    return resolved.order === 'desc' ? -byId : byId;
  });

  const total = matches.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / resolved.pageSize);
  const start = (resolved.page - 1) * resolved.pageSize;
  // A page beyond totalPages yields empty items with correct totals.
  const pageItems = resolved.page > totalPages && totalPages !== 0
    ? []
    : matches.slice(start, start + resolved.pageSize);

  return Object.freeze({
    items: Object.freeze(
      pageItems.map((item) => Object.freeze({ ...item }))
    ),
    total,
    page: resolved.page,
    pageSize: resolved.pageSize,
    totalPages,
    query: trimmed,
  });
}
