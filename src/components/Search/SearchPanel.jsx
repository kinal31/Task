import { useCallback } from 'react';
import { useSearch } from '../../hooks/useSearch.js';
import SearchControls from './SearchControls.jsx';
import SearchResults from './SearchResults.jsx';

/**
 * Search panel. All state is local to this component, so typing in the
 * search box never re-renders the tree.
 */
export default function SearchPanel({ onSelectResult }) {
  const search = useSearch();

  const handleSelect = useCallback(
    (item) => {
      onSelectResult(item);
    },
    [onSelectResult]
  );

  return (
    <section className="panel search-panel" aria-label="Search" data-testid="search-panel">
      <h2 className="panel-title">Search</h2>
      <SearchControls search={search} />
      {search.error && (
        <p className="inline-error" role="alert" data-testid="search-error">
          {search.error.message}
        </p>
      )}
      <SearchResults search={search} onSelect={handleSelect} />
    </section>
  );
}
