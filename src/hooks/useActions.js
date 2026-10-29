import { useMemo } from 'react';
import { useSdk } from '../context/SdkContext.jsx';
import { uiStore } from '../store/uiStore.js';

/**
 * Simulated UI-layer delay so the pending state is visible.
 * The SDK itself is synchronous. Turned off in tests via NODE_ENV.
 */
export const ENABLE_FAKE_DELAY =
  typeof process !== 'undefined' &&
  process.env &&
  process.env.NODE_ENV === 'test'
    ? false
    : true;

const FAKE_DELAY_MS = 300;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * All user actions go through this hook. Wraps SDK calls in try/catch,
 * manages pending/error in the UI store, and applies follow-up UI rules
 * (auto-expand parent after create, expand target after move, clear
 * selection after delete). Every returned function is stable (useMemo on [sdk]).
 */
export function useActions() {
  const sdk = useSdk();

  return useMemo(() => {
    async function runAction(name, fn) {
      uiStore.setPending(name);
      try {
        if (ENABLE_FAKE_DELAY) await delay(FAKE_DELAY_MS);
        const result = fn();
        uiStore.clearError();
        return { ok: true, result };
      } catch (err) {
        uiStore.setError(err);
        return { ok: false, error: err };
      } finally {
        uiStore.setPending(null);
      }
    }

    return {
      createFile(parentId, name) {
        return runAction('create-file', () => {
          const node = sdk.createFile(parentId, name);
          uiStore.expand(parentId);
          uiStore.select(node.id);
          return node;
        });
      },

      createFolder(parentId, name) {
        return runAction('create-folder', () => {
          const node = sdk.createFolder(parentId, name);
          uiStore.expand(parentId);
          uiStore.select(node.id);
          return node;
        });
      },

      rename(id, name) {
        return runAction('rename', () => sdk.rename(id, name));
      },

      move(id, targetId) {
        return runAction('move', () => {
          const node = sdk.move(id, targetId);
          uiStore.expand(targetId);
          uiStore.select(node.id);
          return node;
        });
      },

      remove(id) {
        return runAction('delete', () => {
          const result = sdk.delete(id);
          if (uiStore.getState().selectedId === id) {
            uiStore.clearSelection();
          }
          return result;
        });
      },

      undo() {
        return runAction('undo', () => sdk.undo());
      },

      redo() {
        return runAction('redo', () => sdk.redo());
      },

      /**
       * Bulk delete in ONE transaction (one undo step).
       * Filters out descendants of other selected items first, so deleting
       * a parent does not make a child delete throw NOT_FOUND and roll back.
       * On success clears the multi-selection; on failure keeps it.
       */
      bulkDelete(ids) {
        return runAction('bulk-delete', () => {
          const idSet = new Set(ids);
          const topLevel = ids.filter((id) => {
            if (!sdk.hasItem(id)) return true; // let the SDK produce NOT_FOUND
            const path = sdk.getPath(id);
            // skip if any ancestor (excluding self) is also being deleted
            for (let i = 0; i < path.ids.length - 1; i += 1) {
              if (idSet.has(path.ids[i])) return false;
            }
            return true;
          });
          const result = sdk.transaction((tx) => {
            for (const id of topLevel) tx.delete(id);
          });
          uiStore.clearChecked();
          if (idSet.has(uiStore.getState().selectedId)) {
            uiStore.clearSelection();
          }
          return result;
        });
      },
    };
  }, [sdk]);
}
