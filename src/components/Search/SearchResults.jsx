export default function SearchResults({ search, onSelect }) {
  const { query, debouncedQuery, result, page, setPage } = search;

  if (!query.trim()) {
    return (
      <p className="placeholder" data-testid="search-empty">
        Type to search.
      </p>
    );
  }

  if (!result || result.total === 0) {
    if (debouncedQuery.trim() && !search.error) {
      return (
        <p className="placeholder" data-testid="search-no-results">
          No matches.
        </p>
      );
    }
    return null;
  }

  const { items, total, totalPages } = result;

  return (
    <div className="search-results" data-testid="search-results">
      <p className="search-summary" data-testid="search-summary">
        {total} result{total === 1 ? '' : 's'}
      </p>
      <ul className="search-list" role="list">
        {items.map((item) => (
          <li key={item.id} className="search-item">
            <button
              type="button"
              className="search-item-button"
              onClick={() => onSelect(item)}
              data-testid={`search-result-${item.id}`}
            >
              <span className="search-item-icon" aria-hidden="true">
                {item.type === 'folder' ? '📁' : '📄'}
              </span>
              <span className="search-item-name">{item.name}</span>
              <span className="search-item-type" data-testid={`search-type-${item.id}`}>
                {item.type}
              </span>
              <span className="search-item-location">{item.location || item.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="pagination" data-testid="pagination">
          <button
            type="button"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            data-testid="page-prev"
          >
            Previous
          </button>
          <span data-testid="page-info">
            Page {result.page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            data-testid="page-next"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
