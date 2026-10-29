import { useEffect, useState } from 'react';

/** Returns `value` after it has stayed unchanged for `ms` milliseconds. */
export function useDebouncedValue(value, ms = 200) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}
