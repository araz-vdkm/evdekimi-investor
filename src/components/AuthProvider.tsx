import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export type User = {
  username: string;
  isAdmin: boolean;
  isPlatformAdmin?: boolean;
  code?: string;
  villas?: any[];
  investorName?: string;
  email?: string;
  phone?: string;
  payoutCurrency?: string;
  bankName?: string;
  accountNumber?: string;
  beneficiaryName?: string;
  swift?: string;
  country?: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (user: User) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const saved = localStorage.getItem('app_user');
      sessionStorage.removeItem('app_google_access_token');

      if (!saved) {
        if (!cancelled) setLoading(false);
        return;
      }

      let parsed: User | null = null;
      try {
        parsed = JSON.parse(saved);
      } catch {
        localStorage.removeItem('app_user');
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/link-status', { credentials: 'include' });
        if (!res.ok) {
          localStorage.removeItem('app_user');
          if (!cancelled) setUser(null);
          return;
        }
        // The stored user object can outlive the session cookie's view of who
        // this is (it survives re-logins and cookie re-issues), so trust the
        // server's flags over the saved copy. Without this, a stale
        // isPlatformAdmin left admin-only tabs on screen while every
        // /api/admin/* call behind them returned 403.
        const status = await res.json().catch(() => null);
        let resolved = parsed as User;
        if (status && typeof status.isPlatformAdmin === 'boolean') {
          if (
            status.isPlatformAdmin !== !!parsed.isPlatformAdmin ||
            (typeof status.isAdmin === 'boolean' && status.isAdmin !== !!parsed.isAdmin)
          ) {
            resolved = {
              ...parsed,
              isPlatformAdmin: status.isPlatformAdmin,
              isAdmin: typeof status.isAdmin === 'boolean' ? status.isAdmin : parsed.isAdmin,
            };
            localStorage.setItem('app_user', JSON.stringify(resolved));
          }
        }
        if (!cancelled) setUser(resolved);
      } catch {
        localStorage.removeItem('app_user');
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = (u: User) => {
    setUser(u);
    localStorage.setItem('app_user', JSON.stringify(u));
    sessionStorage.removeItem('app_google_access_token');
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('app_user');
    sessionStorage.removeItem('app_google_access_token');
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    import('../lib/firebase').then(({ auth }) => auth.signOut()).catch(() => {});
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
