import { useCallback, useState } from 'react';
import { SdkProvider } from './context/SdkContext.jsx';
import { sdk as defaultSdk } from './sdkInstance.js';
import { useSdk } from './context/SdkContext.jsx';
import { useActions } from './hooks/useActions.js';
import { usePruneUi } from './hooks/usePruneUi.js';
import { useUiSelector } from './hooks/useUiSelector.js';
import { uiStore } from './store/uiStore.js';
import AppLayout from './components/Layout/AppLayout.jsx';
import Toolbar from './components/Toolbar/Toolbar.jsx';
import FileTree from './components/Tree/FileTree.jsx';
import DetailsPanel from './components/Details/DetailsPanel.jsx';
import SearchPanel from './components/Search/SearchPanel.jsx';
import ActivityPanel from './components/Activity/ActivityPanel.jsx';
import ErrorBanner from './components/Common/ErrorBanner.jsx';
import NameDialog from './components/Common/NameDialog.jsx';
import MoveDialog from './components/Common/MoveDialog.jsx';

/**
 * Root component. Owns dialog visibility (pure UI state) and wires the
 * panels together. File data never lives in React state — only the SDK
 * has it. Pruning of stale selection/expansion runs here.
 */
export default function App({ sdk = defaultSdk }) {
  return (
    <SdkProvider sdk={sdk}>
      <AppInner />
    </SdkProvider>
  );
}

function AppInner() {
  usePruneUi();
  const sdk = useSdk();
  const actions = useActions();

  // Dialog state is local UI state:
  // { kind: 'create', type, parentId } | { kind: 'rename', id } | { kind: 'move', id }
  const [dialog, setDialog] = useState(null);
  const selectedId = useUiSelector((s) => s.selectedId);

  const handleCreate = useCallback((type, parentId) => {
    setDialog({ kind: 'create', type, parentId });
  }, []);

  const handleRename = useCallback((id) => {
    if (id) setDialog({ kind: 'rename', id });
  }, []);

  const handleMove = useCallback((id) => {
    if (id) setDialog({ kind: 'move', id });
  }, []);

  const closeDialog = useCallback(() => setDialog(null), []);

  const submitCreate = useCallback(
    (name) =>
      dialog.type === 'file'
        ? actions.createFile(dialog.parentId, name)
        : actions.createFolder(dialog.parentId, name),
    [dialog, actions]
  );

  const submitRename = useCallback(
    (name) => actions.rename(dialog.id, name),
    [dialog, actions]
  );

  const handleMoveTarget = useCallback(
    (targetId) => {
      actions.move(dialog.id, targetId).then((result) => {
        if (result.ok) closeDialog();
      });
    },
    [dialog, actions, closeDialog]
  );

  const handleSelectSearchResult = useCallback(
    (item) => {
      uiStore.select(item.id);
      try {
        const path = sdk.getPath(item.id);
        // Expand all ancestor folders (exclude the item itself).
        uiStore.expandMany(path.ids.slice(0, -1));
      } catch {
        // item may have been deleted; ignore
      }
    },
    [sdk]
  );

  return (
    <>
      <AppLayout
        banner={<ErrorBanner />}
        toolbar={
          <Toolbar onCreate={handleCreate} onRename={handleRename} onMove={handleMove} />
        }
        tree={<FileTree />}
        sidebar={
          <>
            <DetailsPanel />
            <SearchPanel onSelectResult={handleSelectSearchResult} />
            <ActivityPanel />
          </>
        }
      />

      {dialog?.kind === 'create' && (
        <NameDialog
          title={dialog.type === 'file' ? 'New File' : 'New Folder'}
          onSubmit={submitCreate}
          onCancel={closeDialog}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialogWrapper dialog={dialog} onSubmit={submitRename} onCancel={closeDialog} />
      )}
      {dialog?.kind === 'move' && (
        <MoveDialog itemId={dialog.id} onMove={handleMoveTarget} onCancel={closeDialog} />
      )}
    </>
  );
}

function RenameDialogWrapper({ dialog, onSubmit, onCancel }) {
  const sdk = useSdk();
  let initial = '';
  try {
    initial = sdk.getItem(dialog.id).name;
  } catch {
    // item disappeared; dialog will just start empty and fail on submit
  }
  return <NameDialog title="Rename" initialValue={initial} onSubmit={onSubmit} onCancel={onCancel} />;
}
