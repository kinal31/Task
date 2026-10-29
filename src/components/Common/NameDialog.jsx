import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Modal dialog for entering a name (create or rename).
 * Local state for the text; submits via onSubmit(name) which returns a
 * promise resolving to { ok }. Stays open on failure so the user can fix
 * the name; closes on success. Enter submits, Escape cancels.
 */
export default function NameDialog({ title, initialValue = '', onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = useCallback(async () => {
    const name = value.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      const result = await onSubmit(name);
      if (alive.current && result?.ok) {
        onCancel();
      }
    } finally {
      if (alive.current) setSubmitting(false);
    }
  }, [value, submitting, onSubmit, onCancel]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    },
    [submit, onCancel]
  );

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        data-testid="name-dialog"
      >
        <h3 className="dialog-title">{title}</h3>
        <input
          ref={inputRef}
          type="text"
          className="dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Name"
          data-testid="name-input"
        />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} data-testid="name-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={submitting || !value.trim()}
            data-testid="name-submit"
          >
            {submitting ? 'Working…' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
