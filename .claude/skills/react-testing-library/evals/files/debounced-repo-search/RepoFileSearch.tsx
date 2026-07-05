import { useEffect, useRef, useState, type ChangeEvent } from 'react';

export interface RepoFileSearchProps {
  onQueryChange: (query: string) => void;
  debounceMs?: number;
}

/**
 * Filter input for repo-intel's file browser. Debounces keystrokes so we
 * don't re-run the (expensive) file index search on every character typed.
 */
export function RepoFileSearch({ onQueryChange, debounceMs = 300 }: RepoFileSearchProps) {
  const [value, setValue] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onQueryChange(next), debounceMs);
  };

  return (
    <div>
      <label htmlFor="repo-file-search">Search files</label>
      <input id="repo-file-search" value={value} onChange={handleChange} />
    </div>
  );
}
