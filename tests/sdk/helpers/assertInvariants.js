/**
 * Structural invariants of the file tree.
 *
 * `assertInvariants(sdk)` walks the whole tree through the public read API
 * and verifies:
 * - every child's `parentId` matches the parent it is listed under
 * - there are no cycles (no node visited twice)
 * - there are no orphans (every stored node is reachable from the root)
 * - sibling names are unique case-insensitively
 * - files never have children
 *
 * Call it at the end of nearly every test: it is the safety net for
 * "a failed operation never corrupts the structure".
 */
import { expect } from 'vitest';

/**
 * @param {import('../../src/sdk/FileExplorerSDK.js').FileExplorerSDK} sdk
 */
export function assertInvariants(sdk) {
  const rootId = sdk.getRootId();
  /** @type {Set<string>} */
  const visited = new Set();

  const walk = (id, expectedParentId) => {
    expect(visited.has(id), `cycle detected at ${id}`).toBe(false);
    const item = sdk.getItem(id);
    expect(item.parentId, `parentId mismatch for ${id}`).toBe(expectedParentId);
    visited.add(id);

    if (item.type === 'file') {
      expect(item.childIds.length, `file ${id} must have no children`).toBe(0);
    }

    const keys = item.childIds.map(
      (childId) => sdk.getItem(childId).name.trim().toLowerCase()
    );
    expect(new Set(keys).size, `duplicate sibling names under ${id}`).toBe(
      keys.length
    );

    for (const childId of item.childIds) {
      walk(childId, id);
    }
  };

  walk(rootId, null);

  // Orphan / uniqueness check against the full store (test-only peek).
  expect(sdk._nodes.size, 'orphan nodes exist or a node is duplicated').toBe(
    visited.size
  );
  for (const id of sdk._nodes.keys()) {
    expect(visited.has(id), `node ${id} is not reachable from the root`).toBe(
      true
    );
  }
}

/**
 * Collects every node id in the tree (root included) via the public API.
 *
 * @param {import('../../src/sdk/FileExplorerSDK.js').FileExplorerSDK} sdk
 * @returns {string[]}
 */
export function collectAllIds(sdk) {
  const ids = [];
  const walk = (id) => {
    ids.push(id);
    sdk.getItem(id).childIds.forEach(walk);
  };
  walk(sdk.getRootId());
  return ids;
}
