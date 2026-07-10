import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface PermissionsContextValue {
  canEditRoles: boolean;
  canRemoveMembers: boolean;
  canInvite: boolean;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

interface PermissionsProviderProps {
  workspaceRole: 'owner' | 'admin' | 'member';
  children: ReactNode;
}

export function PermissionsProvider({ workspaceRole, children }: PermissionsProviderProps) {
  const [permissions, setPermissions] = useState<PermissionsContextValue>({
    canEditRoles: false,
    canRemoveMembers: false,
    canInvite: false,
  });

  useEffect(() => {
    setPermissions({
      canEditRoles: workspaceRole === 'owner',
      canRemoveMembers: workspaceRole === 'owner' || workspaceRole === 'admin',
      canInvite: workspaceRole !== 'member',
    });
  }, [workspaceRole]);

  return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within a PermissionsProvider');
  return ctx;
}
