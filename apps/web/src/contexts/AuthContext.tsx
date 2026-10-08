import { createContext, useContext, useState, type ReactNode } from 'react';
import type { AuthConfig, User } from '../types';

interface AuthContextValue {
  user: User | null;
  setUser: (user: User | null | ((prev: User | null) => User | null)) => void;
  config: AuthConfig;
  setConfig: (config: AuthConfig) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser = null,
  initialConfig = { demoEnabled: false, microsoftEnabled: false, uedEnabled: false },
}: {
  children: ReactNode;
  initialUser?: User | null;
  initialConfig?: AuthConfig;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [config, setConfig] = useState<AuthConfig>(initialConfig);

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        config,
        setConfig,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
