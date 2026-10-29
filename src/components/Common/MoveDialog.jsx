import { useCallback, useMemo, useState } from 'react';
import { useSdk } from '../../context/SdkContext.jsx';
import { useTree } from '../../hooks/useTree.js';

/**
 * Target-folder picker. A native <select> of all folders with their full
 * paths — a simplified version of a tree picker (per the plan's fallback).
 * Disables the moved item and its descendants as a UI hint; the SDK still
 * enforces the rule and its error is shown if something gets past this.
 */
export default function MoveDialog({ itemId, onMove, onCancel }) {
  const sdk = useSdk();
  const tree = useTree(); // re-render on SDK changes
  const [targetId, setTargetId] = useState('');

  const item = useMemo(() => {
    void tree;
    try {
      return sdk.getItem(itemId);
    } catch {
      return null;
    }
  }, [sdk, itemId, tree]);

  const descendantIds = useMemo(() => {
    if (!item || item.type !== 'folder') return new Set();
    const ids = new Set();
    const walk = (node) => {
      for (const childId of node.childIds) {
        ids.add(childId);
        const child = sdk.getItem(childId);
        if (child.type === 'folder') walk(child);
      }
    };
    walk(item);
    return ids;
  }, [sdk, item]);

  const folders = useMemo(() => {
    const list = [];
    const walkTree = (node, pathNames) => {
      const nextPath = [...pathNames, node.name];
      if (node.type === 'folder') {
        const disabled = node.id === itemId || descendantIds.has(node.id);
        list.push({
          id: node.id,
          label: `${nextPath.join(' / ')}${disabled ? ' (cannot move here)' : ''}`,
          disabled,
        });
      }
      for (const child of node.children) walkTree(child, nextPath);
    };
    walkTree(tree, []);
    return list;
  }, [tree, itemId, descendantIds]);

  const handleSubmit = useCallback(() => {
    if (targetId) onMove(targetId);
  }, [targetId, onMove]);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Move item"
        onClick={(e) => e.stopPropagation()}
        data-testid="move-dialog"
      >
        <h3 className="dialog-title">
          Move “{item?.name ?? 'item'}” to…
        </h3>
        <select
          className="dialog-input"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          aria-label="Target folder"
          data-testid="move-target"
        >
          <option value="">Choose a folder…</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id} disabled={folder.disabled}>
              {folder.label}
            </option>
          ))}
        </select>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} data-testid="move-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleSubmit}
            disabled={!targetId}
            data-testid="move-submit"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
