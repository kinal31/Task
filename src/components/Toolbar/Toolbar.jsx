import { useCallback, useSyncExternalStore } from 'react';
import { useSdk } from '../../context/SdkContext.jsx';
import { useUiSelector } from '../../hooks/useUiSelector.js';
import { useActions } from '../../hooks/useActions.js';
import { uiStore } from '../../store/uiStore.js';

/**
 * Toolbar: create/rename/move/delete, undo/redo, and bulk-delete controls.
 * Undo/redo availability re-evaluates on every SDK change via a primitive
 * selector on useSyncExternalStore (booleans are safe snapshots).
 */
export default function Toolbar({ onCreate, onRename, onMove }) {
  const sdk = useSdk();
  const actions = useActions();

  const selectedId = useUiSelector((s) => s.selectedId);
  const checkedCount = useUiSelector((s) => s.selectedIds.size);
  const pending = useUiSelector((s) => s.pending);

  const canUndo = useSyncExternalStore(sdk.subscribe, () => sdk.canUndo());
  const canRedo = useSyncExternalStore(sdk.subscribe, () => sdk.canRedo());
  const history = useSyncExternalStore(sdk.subscribe, () => {
    const h = sdk.getHistory();
    // Primitive-ish stable snapshot: join labels so the reference only
    // changes when the labels actually change.
    return `${h.undo[0] ?? ''}|${h.redo[0] ?? ''}`;
  });

  const selectedNode = useCallback(() => {
    if (!selectedId) return null;
    try {
      return sdk.getItem(selectedId);
    } catch {
      return null;
    }
  }, [sdk, selectedId, /* re-read when selection or tree changes */ history]);

  const node = selectedNode();
  const isRoot = selectedId === sdk.getRootId();
  const canMutateSelection = Boolean(node) && !isRoot;

  // Parent for new items: selected folder, or the selected file's parent,
  // or root when nothing is selected.
  const createParentId = (() => {
    if (!node) return sdk.getRootId();
    if (node.type === 'folder') return node.id;
    return node.parentId;
  })();

  const handleUndoTooltip = () => {
    const h = sdk.getHistory();
    const label = h.undo[0];
    return label ? `Undo: ${label}` : 'Undo';
  };
  const handleRedoTooltip = () => {
    const h = sdk.getHistory();
    const label = h.redo[0];
    return label ? `Redo: ${label}` : 'Redo';
  };

  const handleBulkDelete = useCallback(() => {
    const ids = [...uiStore.getState().selectedIds];
    if (ids.length > 0) actions.bulkDelete(ids);
  }, [actions]);

  const handleClearChecked = useCallback(() => {
    uiStore.clearChecked();
  }, []);

  const disabled = Boolean(pending);

  return (
    <header className="toolbar" role="toolbar" aria-label="File actions" data-testid="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          onClick={() => onCreate('file', createParentId)}
          disabled={disabled}
          data-testid="new-file"
        >
          New File
        </button>
        <button
          type="button"
          onClick={() => onCreate('folder', createParentId)}
          disabled={disabled}
          data-testid="new-folder"
        >
          New Folder
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          onClick={() => onRename(selectedId)}
          disabled={disabled || !canMutateSelection}
          data-testid="rename"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => onMove(selectedId)}
          disabled={disabled || !canMutateSelection}
          data-testid="move"
        >
          Move
        </button>
        <button
          type="button"
          onClick={() => actions.remove(selectedId)}
          disabled={disabled || !canMutateSelection}
          data-testid="delete"
        >
          Delete
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          onClick={() => actions.undo()}
          disabled={disabled || !canUndo}
          title={handleUndoTooltip()}
          data-testid="undo"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => actions.redo()}
          disabled={disabled || !canRedo}
          title={handleRedoTooltip()}
          data-testid="redo"
        >
          Redo
        </button>
      </div>

      <div className="toolbar-group toolbar-bulk">
        <span className="bulk-count" data-testid="bulk-count">
          {checkedCount} selected
        </span>
        <button
          type="button"
          onClick={handleBulkDelete}
          disabled={disabled || checkedCount === 0}
          data-testid="bulk-delete"
        >
          Delete selected
        </button>
        {checkedCount > 0 && (
          <button
            type="button"
            className="link"
            onClick={handleClearChecked}
            disabled={disabled}
            data-testid="clear-checked"
          >
            Clear selection
          </button>
        )}
      </div>

      {pending && (
        <span className="toolbar-pending" role="status" data-testid="pending">
          Working…
        </span>
      )}
    </header>
  );
}
