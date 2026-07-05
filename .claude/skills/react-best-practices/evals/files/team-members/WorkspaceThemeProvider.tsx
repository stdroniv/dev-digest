import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface WorkspaceThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue | null>(null);

interface WorkspaceThemeProviderProps {
  initialTheme?: Theme;
  children: ReactNode;
}

export function WorkspaceThemeProvider({ initialTheme = 'light', children }: WorkspaceThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <WorkspaceThemeContext.Provider value={value}>{children}</WorkspaceThemeContext.Provider>;
}

export function useWorkspaceTheme() {
  const ctx = useContext(WorkspaceThemeContext);
  if (!ctx) throw new Error('useWorkspaceTheme must be used within a WorkspaceThemeProvider');
  return ctx;
}
