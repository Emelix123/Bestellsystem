import type { PublicTenant } from '@bestellsystem/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, ErrorBox, Field, Input, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { cn } from '../lib/format';
import { useSession } from '../lib/session';
import { storage } from '../lib/storage';

const TENANT_KEY = 'last-tenant';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const [tenants, setTenants] = useState<PublicTenant[] | null>(null);
  const [slug, setSlug] = useState(() => storage.get<string>(TENANT_KEY, ''));
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => {
    (async () => {
      try {
        const setup = await api.get<{ needsSetup: boolean }>('/api/setup');
        if (setup.needsSetup) {
          navigate('/setup', { replace: true });
          return;
        }
        const list = await api.get<PublicTenant[]>('/api/public/tenants');
        setTenants(list);
        if (list.length === 1) setSlug(list[0].slug);
        else if (!list.some((t) => t.slug === slug)) setSlug(list[0]?.slug ?? '');
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = async () => {
    await refresh();
    navigate(from, { replace: true });
  };

  const submitPin = async (value = pin) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/pin', { tenantSlug: slug, pin: value });
      storage.set(TENANT_KEY, slug);
      await done();
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password', { username, password });
      await done();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const press = (key: string) => {
    if (key === '⌫') setPin((p) => p.slice(0, -1));
    else if (key === 'OK') void submitPin();
    else setPin((p) => (p.length < 8 ? p + key : p));
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-900 px-4 py-8">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-white">Bestellsystem</h1>
        <p className="mb-6 text-center text-sm text-slate-400">
          {mode === 'pin' ? 'Mit deiner PIN anmelden' : 'Admin-Anmeldung'}
        </p>

        {mode === 'pin' ? (
          <div className="rounded-3xl bg-white p-5 shadow-xl">
            {tenants === null && !error && (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            )}
            {tenants && tenants.length > 1 && (
              <div className="mb-4">
                <Select value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Verein">
                  {tenants.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {tenants && tenants.length === 1 && (
              <div className="mb-4 text-center text-sm font-semibold text-slate-600">{tenants[0].name}</div>
            )}
            <div className="mb-4 flex h-14 items-center justify-center gap-3" aria-label="PIN">
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span
                  key={i}
                  className={cn('h-4 w-4 rounded-full', i < pin.length ? 'bg-slate-900' : 'bg-slate-200')}
                />
              ))}
            </div>
            {error && (
              <div className="mb-3">
                <ErrorBox>{error}</ErrorBox>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy || !slug}
                  onClick={() => press(k)}
                  className={cn(
                    'h-16 rounded-2xl text-2xl font-bold active:scale-95 disabled:opacity-50',
                    k === 'OK' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-900 active:bg-slate-200',
                  )}
                >
                  {k === 'OK' && busy ? <Spinner /> : k}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={submitPassword} className="space-y-4 rounded-3xl bg-white p-5 shadow-xl">
            <Field label="Benutzername">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
            </Field>
            <Field label="Passwort">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Button type="submit" block size="lg" disabled={busy || !username || !password}>
              {busy ? <Spinner /> : 'Anmelden'}
            </Button>
          </form>
        )}

        <button
          type="button"
          className="mt-6 w-full text-center text-sm text-slate-400 underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === 'pin' ? 'password' : 'pin');
            setError(null);
          }}
        >
          {mode === 'pin' ? 'Admin-Anmeldung mit Passwort' : 'Zurück zur PIN-Anmeldung'}
        </button>
      </div>
    </div>
  );
}
