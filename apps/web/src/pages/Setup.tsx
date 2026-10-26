import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, ErrorBox, Field, Input, Spinner, Toggle } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';

export function Setup() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [form, setForm] = useState({ tenantName: '', adminName: '', username: '', password: '', demo: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/setup', form);
      await refresh();
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-xl">
        <div>
          <h1 className="text-2xl font-bold">Ersteinrichtung</h1>
          <p className="text-sm text-slate-500">
            Legt den ersten Verein und das Betreiber-Konto an. Weitere Vereine können später im Admin-Bereich angelegt werden.
          </p>
        </div>
        <Field label="Name des Vereins">
          <Input value={form.tenantName} onChange={set('tenantName')} placeholder="z. B. TSV Musterdorf" required />
        </Field>
        <Field label="Ihr Name">
          <Input value={form.adminName} onChange={set('adminName')} required />
        </Field>
        <Field label="Benutzername">
          <Input value={form.username} onChange={set('username')} autoComplete="username" required />
        </Field>
        <Field label="Passwort" hint="Mindestens 8 Zeichen">
          <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required />
        </Field>
        <Toggle
          checked={form.demo}
          onChange={(demo) => setForm((f) => ({ ...f, demo }))}
          label="Beispieldaten anlegen"
          description="Ein Demo-Fest mit Küche, Getränken, Bier, To-Go und Simulator-Druckern. PINs: 1111/2222 Bedienung, 3333 Küche, 4444 To-Go."
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" block size="lg" disabled={busy}>
          {busy ? <Spinner /> : 'Einrichten'}
        </Button>
      </form>
    </div>
  );
}
