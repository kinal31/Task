/**
 * Pure validation functions. Each takes the nodes Map (read-only) and either
 * returns a normalized value or throws a `FileExplorerError`.
 *
 * Rule of the SDK: validate everything first, mutate only afterward.
 * That is how failed operations never corrupt state or create history.
 */

import { FileExplorerError, ErrorCodes } from './errors.js';
import { NODE_TYPES, MAX_NAME_LENGTH } from './constants.js';
import { normalizeName, nameKey } from './utils.js';

/**
 * @param {Map<string, object>} nodes
 * @param {string} id
 * @returns {object} the node
 * @throws {FileExplorerError} NOT_FOUND
 */
export function requireNode(nodes, id) {
  const node = nodes.get(id);
  if (!node) {
    throw new FileExplorerError(
      ErrorCodes.NOT_FOUND,
      `No item with id "${id}"`,
      id
    );
  }
  return node;
}

/**
 * Requires an existing *folder* (used for create targets).
 * @param {Map<string, object>} nodes
 * @param {string} id
 * @returns {object} the folder node
 * @throws {FileExplorerError} NOT_FOUND | INVALID_PARENT
 */
export function requireFolder(nodes, id) {
  const node = requireNode(nodes, id);
  if (node.type !== NODE_TYPES.FOLDER) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_PARENT,
      `"${node.name}" is a file and cannot contain items`,
      id
    );
  }
  return node;
}

/**
 * Normalizes and validates a raw name.
 * @param {*} raw
 * @returns {string} the trimmed name
 * @throws {FileExplorerError} INVALID_NAME for empty names, names containing
 *   `/`, names longer than 255 characters, or non-string input
 */
export function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_NAME,
      'Name must not be empty',
      raw
    );
  }
  if (name.includes('/')) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_NAME,
      'Name must not contain "/"',
      raw
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new FileExplorerError(
      ErrorCodes.INVALID_NAME,
      `Name must be at most ${MAX_NAME_LENGTH} characters`,
      raw
    );
  }
  return name;
}

/**
 * Asserts that `name` is free among the children of `parentId`.
 * Comparison is trimmed + lowercased; `ignoreId` (the item being renamed or
 * moved) is excluded, so a case-only rename of an item to itself is allowed.
 *
 * @param {Map<string, object>} nodes
 * @param {string} parentId
 * @param {string} name - already validated/trimmed
 * @param {string} [ignoreId]
 * @throws {FileExplorerError} DUPLICATE_NAME
 */
export function assertNameAvailable(nodes, parentId, name, ignoreId) {
  const parent = nodes.get(parentId);
  if (!parent) return; // callers require the parent first; nothing to check
  const key = nameKey(name);
  for (const childId of parent.childIds) {
    if (childId === ignoreId) continue;
    const sibling = nodes.get(childId);
    if (sibling && nameKey(sibling.name) === key) {
      throw new FileExplorerError(
        ErrorCodes.DUPLICATE_NAME,
        `An item named "${sibling.name}" already exists here`,
        name
      );
    }
  }
}
