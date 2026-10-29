import { useCallback, useMemo, useState } from 'react';
import { useSdk } from '../context/SdkContext.jsx';
import { useTree } from './useTree.js';
import { useDebouncedValue } from './useDebouncedValue.js';

/**
 * Local search state + memoized sdk.search call.
 * State is fully local so typing never re-renders the tree.
 * useTree() triggers a re-render on every SDK change, and the SDK version
 * is in the memo deps so results always reflect the latest mutations.
 */
export function useSearch() {
  const sdk = useSdk();
  useTree(); // re-render trigger on SDK changes (tree not needed directly)
  const sdkVersion = sdk.getVersion();

  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const debouncedQuery = useDebouncedValue(query, 200);

  const options = useMemo(
    () => ({ type, sortBy, order, page, pageSize }),
    [type, sortBy, order, page, pageSize]
  );

  const { result, error } = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return {
        result: {
          items: [],
          total: 0,
          page: 1,
          pageSize,
          totalPages: 0,
          query: debouncedQuery,
        },
        error: null,
      };
    }
    try {
      return { result: sdk.search(debouncedQuery, options), error: null };
    } catch (err) {
      return { result: null, error: err };
    }
  }, [debouncedQuery, options, sdkVersion, sdk, pageSize]);

  const updateQuery = useCallback((v) => {
    setQuery(v);
    setPage(1);
  }, []);
  const updateType = useCallback((v) => {
    setType(v);
    setPage(1);
  }, []);
  const updateSortBy = useCallback((v) => {
    setSortBy(v);
    setPage(1);
  }, []);
  const updateOrder = useCallback((v) => {
    setOrder(v);
    setPage(1);
  }, []);
  const updatePageSize = useCallback((v) => {
    setPageSize(v);
    setPage(1);
  }, []);

  return {
    query,
    setQuery: updateQuery,
    type,
    setType: updateType,
    sortBy,
    setSortBy: updateSortBy,
    order,
    setOrder: updateOrder,
    page,
    setPage,
    pageSize,
    setPageSize: updatePageSize,
    debouncedQuery,
    result,
    error,
  };
}
