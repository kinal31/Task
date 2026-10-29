import { useActivity } from '../../hooks/useActivity.js';

/**
 * Recent SDK activity, newest first. Derived with useMemo from the SDK
 * version (via useTree inside useActivity), never used as a raw snapshot.
 */
export default function ActivityPanel({ limit = 20 }) {
  const entries = useActivity(limit);
  const newestFirst = [...entries].reverse();

  return (
    <section className="panel activity-panel" aria-label="Activity" data-testid="activity-panel">
      <h2 className="panel-title">Activity</h2>
      {newestFirst.length === 0 ? (
        <p className="placeholder">No activity yet.</p>
      ) : (
        <ul className="activity-list" role="list">
          {newestFirst.map((entry) => (
            <li key={entry.id} className="activity-item" data-testid={`activity-${entry.type}`}>
              <span className={`activity-badge activity-badge-${entry.type}`}>
                {entry.type}
              </span>
              <span className="activity-message">{entry.message}</span>
              <span className="activity-time">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
