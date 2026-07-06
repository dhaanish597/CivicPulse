import React, { createContext, useContext, useMemo, useState } from 'react';

export type UserRole = 'citizen' | 'officer' | 'admin';

export interface RoleSession {
  role: UserRole;
  name: string;
  ward?: number;
  locality?: string;
}

interface RoleContextValue {
  roleSession: RoleSession | null;
  setRoleSession: (session: RoleSession) => void;
  resetRole: () => void;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [roleSession, setRoleSession] = useState<RoleSession | null>(null);
  const value = useMemo<RoleContextValue>(() => ({
    roleSession,
    setRoleSession,
    resetRole: () => setRoleSession(null),
  }), [roleSession]);

  return (
    <RoleContext.Provider value={value}>
      {children}
    </RoleContext.Provider>
  );
};

export function useRole() {
  const value = useContext(RoleContext);
  if (!value) {
    throw new Error('useRole must be used inside RoleProvider.');
  }

  return value;
}
