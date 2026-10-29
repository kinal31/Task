import React, { useCallback } from 'react';
import { useUiSelector } from '../../hooks/useUiSelector.js';
import { useActions } from '../../hooks/useActions.js';
import { uiStore } from '../../store/uiStore.js';

/**
 * Recursive tree node. Memoized so unchanged subtrees skip re-rendering
 * (the SDK snapshot uses structural sharing: only changed nodes and their
 * ancestors get new references). Per-node selector subscriptions mean
 * expand/select re-render only the affected node.
 */
const TreeNode = React.memo(function TreeNode({ node, depth }) {
  // Required by the task: observe which nodes re-render.
  console.log('render TreeNode', node.name);

  const isExpanded = useUiSelector((s) => s.expandedIds.has(node.id));
  const isSelected = useUiSelector((s) => s.selectedId === node.id);
  const isChecked = useUiSelector((s) => s.selectedIds.has(node.id));
  const isRoot = node.parentId === null;
  const isFolder = node.type === 'folder';

  const handleRowClick = useCallback(
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        if (!isRoot) uiStore.toggleChecked(node.id);
        return;
      }
      uiStore.select(node.id);
    },
    [node.id, isRoot]
  );

  const handleArrowClick = useCallback(
    (event) => {
      event.stopPropagation();
      uiStore.toggleExpanded(node.id);
    },
    [node.id]
  );

  const handleCheckboxChange = useCallback(() => {
    uiStore.toggleChecked(node.id);
  }, [node.id]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter') {
        uiStore.select(node.id);
      } else if (event.key === 'ArrowRight' && isFolder && !isExpanded) {
        uiStore.expand(node.id);
      } else if (event.key === 'ArrowLeft' && isFolder && isExpanded) {
        uiStore.collapse(node.id);
      }
    },
    [node.id, isFolder, isExpanded]
  );

  return (
    <li
      role="treeitem"
      aria-expanded={isFolder ? isExpanded : undefined}
      aria-selected={isSelected}
      className={`tree-node${isSelected ? ' is-selected' : ''}`}
      data-testid={`tree-node-${node.id}`}
    >
      <div
        className="tree-row"
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {!isRoot && (
          <input
            type="checkbox"
            className="tree-checkbox"
            checked={isChecked}
            onChange={handleCheckboxChange}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${node.name}`}
            data-testid={`checkbox-${node.id}`}
          />
        )}
        {isFolder ? (
          <button
            type="button"
            className="tree-arrow"
            onClick={handleArrowClick}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            data-testid={`arrow-${node.id}`}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-arrow-spacer" aria-hidden="true" />
        )}
        <span className="tree-icon" aria-hidden="true">
          {isFolder ? '📁' : '📄'}
        </span>
        <span className="tree-name">{node.name}</span>
      </div>
      {isFolder && isExpanded && node.children.length > 0 && (
        <ul role="group" className="tree-children">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
});

export default TreeNode;
