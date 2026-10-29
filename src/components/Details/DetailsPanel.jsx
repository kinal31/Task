import { useMemo } from 'react';
import { useSdk } from '../../context/SdkContext.jsx';
import { useTree } from '../../hooks/useTree.js';
import { useUiSelector } from '../../hooks/useUiSelector.js';

/**
 * Details panel for the selected item. Depends on the SDK snapshot (via
 * useTree) so it re-renders when the item is renamed or moved.
 */
export default function DetailsPanel() {
  const sdk = useSdk();
  const tree = useTree(); // re-render on SDK changes; also a memo dependency
  const selectedId = useUiSelector((s) => s.selectedId);

  const details = useMemo(() => {
    void tree;
    if (!selectedId) return null;
    try {
      const item = sdk.getItem(selectedId);
      const path = sdk.getPath(selectedId);
      let parent = null;
      if (item.parentId !== null) {
        try {
          parent = sdk.getItem(item.parentId).name;
        } catch {
          parent = null;
        }
      }
      return {
        name: item.name,
        type: item.type,
        id: item.id,
        path: path.text,
        parent,
        childCount: item.childIds.length,
        isRoot: item.parentId === null,
      };
    } catch {
      return null; // item disappeared between selection and render
    }
  }, [sdk, selectedId, tree]);

  if (!details) {
    return (
      <section className="panel details-panel" aria-label="Details" data-testid="details-panel">
        <h2 className="panel-title">Details</h2>
        <p className="placeholder">Select an item to see its details.</p>
      </section>
    );
  }

  return (
    <section className="panel details-panel" aria-label="Details" data-testid="details-panel">
      <h2 className="panel-title">Details</h2>
      <dl className="details-list">
        <div>
          <dt>Name</dt>
          <dd data-testid="details-name">{details.name}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd data-testid="details-type">{details.type}</dd>
        </div>
        <div>
          <dt>ID</dt>
          <dd className="mono" data-testid="details-id">{details.id}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd data-testid="details-path">{details.path}</dd>
        </div>
        <div>
          <dt>Parent</dt>
          <dd>{details.parent ?? (details.isRoot ? '— (root)' : '—')}</dd>
        </div>
        {details.type === 'folder' && (
          <div>
            <dt>Children</dt>
            <dd data-testid="details-children">{details.childCount}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
