const TYPES = ['all', 'file', 'folder'];
const SORT_BY = ['name', 'type', 'path'];
const ORDERS = ['asc', 'desc'];
const PAGE_SIZES = [5, 10, 20, 50];

export default function SearchControls({ search }) {
  const {
    query,
    setQuery,
    type,
    setType,
    sortBy,
    setSortBy,
    order,
    setOrder,
    pageSize,
    setPageSize,
  } = search;

  return (
    <div className="search-controls" data-testid="search-controls">
      <input
        type="search"
        className="search-input"
        placeholder="Search files and folders…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search query"
        data-testid="search-input"
      />
      <div className="search-filters">
        <label>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by type"
            data-testid="search-type"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort by"
            data-testid="search-sort"
          >
            {SORT_BY.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Order
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            aria-label="Sort order"
            data-testid="search-order"
          >
            {ORDERS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label>
          Per page
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="Page size"
            data-testid="search-page-size"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
