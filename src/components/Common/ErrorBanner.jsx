import { useUiSelector } from '../../hooks/useUiSelector.js';
import { uiStore } from '../../store/uiStore.js';

const FRIENDLY_MESSAGES = {
  DUPLICATE_NAME: 'An item with this name already exists in this folder.',
  NOT_FOUND: 'That item no longer exists.',
  INVALID_PARENT: 'Cannot create items inside a file.',
  INVALID_MOVE: 'Cannot move an item into itself or one of its descendants.',
  INVALID_NAME: 'That name is not allowed (empty, too long, or contains "/").',
  ROOT_PROTECTED: 'The root folder cannot be renamed, moved, or deleted.',
  INVALID_OPTIONS: 'Invalid search options.',
  INVALID_QUERY: 'Invalid search query.',
  NOTHING_TO_UNDO: 'Nothing to undo.',
  NOTHING_TO_REDO: 'Nothing to redo.',
  TRANSACTION_ERROR: 'The batch operation failed and was rolled back.',
};

function friendlyMessage(error) {
  if (!error) return '';
  return FRIENDLY_MESSAGES[error.code] || error.message || 'Something went wrong.';
}

export default function ErrorBanner() {
  const error = useUiSelector((s) => s.error);
  if (!error) return null;

  return (
    <div className="error-banner" role="alert" data-testid="error-banner">
      <span className="error-message">{friendlyMessage(error)}</span>
      <button
        type="button"
        className="error-dismiss"
        onClick={() => uiStore.clearError()}
        aria-label="Dismiss error"
        data-testid="dismiss-error"
      >
        ×
      </button>
    </div>
  );
}
