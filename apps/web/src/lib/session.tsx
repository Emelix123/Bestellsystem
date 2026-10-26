import type { MeResponse, Role } from '@bestellsystem/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { live } from './live';

interface SessionState {
  me: MeResponse | null;
  loading: boolean;
  /** Server nicht erreichbar (im Gegensatz zu "nicht angemeldet"). */
  offline: boolean;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<MeResponse>('/api/auth/me');
      setMe(data);
      setOffline(false);
      live.restart();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setOffline(false);
        live.stop();
      } else {
        setOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setMe(null);
      live.stop();
    }
  }, []);

  // Server nicht erreichbar (WLAN weg): regelmäßig neu versuchen.
  useEffect(() => {
    if (!offline) return;
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [offline, refresh]);

  useEffect(() => {
    void refresh();
    const expired = () => setMe(null);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ me, loading, offline, refresh, logout }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider fehlt');
  return ctx;
}

export function can(me: MeResponse | null, ...roles: Role[]) {
  if (!me) return false;
  if (me.user.isSuperadmin || me.user.roles.includes('admin')) return true;
  return roles.some((r) => me.user.roles.includes(r));
}
