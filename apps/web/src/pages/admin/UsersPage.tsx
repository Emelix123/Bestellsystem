import { ROLE_LABELS, ROLES, type Role } from '@bestellsystem/shared';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/format';
import { useApiData } from '../../lib/useApi';
import { PageTitle } from './AdminApp';

interface User {
  id: number;
  name: string;
  username: string | null;
  roles: Role[];
  active: boolean;
  hasPin: boolean;
  hasPassword: boolean;
  isSuperadmin: boolean;
}

interface Draft {
  id?: number;
  name: string;
  roles: Role[];
  pin: string;
  username: string;
  password: string;
  active: boolean;
  hasPin: boolean;
  hasPassword: boolean;
}

const ROLE_HELP: Record<Role, string> = {
  admin: 'alles, inkl. Einstellungen und Statistik',
  waiter: 'Tischbestellungen',
  togo: 'To-Go-Bestellungen und Abholung',
  station: 'Tablet an Küche/Theke, „ausverkauft“ setzen',
};

export function UsersPage() {
  const { data, error, reload } = useApiData<User[]>('/api/admin/users');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;

  const save = async () => {
    const d = draft!;
    const body: Record<string, unknown> = { name: d.name, roles: d.roles, active: d.active };
    if (d.pin) body.pin = d.pin;
    if (d.username !== '' || d.id) body.username = d.username || null;
    if (d.password) body.password = d.password;
    try {
      if (d.id) await api.patch(`/api/admin/users/${d.id}`, body);
      else await api.post('/api/admin/users', body);
      setDraft(null);
      await reload();
    } catch (err) {
      setDialogError(errorMessage(err));
    }
  };

  return (
    <div>
      <PageTitle title="Benutzer">
        <Button
          onClick={() => {
            setDialogError(null);
            setDraft({ name: '', roles: ['waiter'], pin: '', username: '', password: '', active: true, hasPin: false, hasPassword: false });
          }}
        >
          Neuer Benutzer
        </Button>
      </PageTitle>
      <p className="mb-4 text-sm text-slate-600">
        Bedienungen, Küche und To-Go melden sich mit einer PIN an (4–8 Ziffern, im Verein eindeutig). Admins zusätzlich mit
        Benutzername und Passwort. Der Name erscheint auf den Bons.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((u) => (
          <Card key={u.id} className={cn(!u.active && 'opacity-50')}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{u.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <Badge key={r} tone={r === 'admin' ? 'blue' : 'slate'}>
                      {ROLE_LABELS[r]}
                    </Badge>
                  ))}
                  {u.isSuperadmin && <Badge tone="blue">Betreiber</Badge>}
                  {!u.active && <Badge tone="red">gesperrt</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {[u.hasPin && 'PIN', u.hasPassword && `Login „${u.username}“`].filter(Boolean).join(' · ') || 'keine Anmeldung möglich'}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDialogError(null);
                  setDraft({ ...u, pin: '', username: u.username ?? '', password: '' });
                }}
              >
                Bearbeiten
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}
        footer={
          <>
            {draft?.id && (
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (!confirm('Benutzer löschen? Bestellungen bleiben mit Namen erhalten.')) return;
                  try {
                    await api.delete(`/api/admin/users/${draft.id}`);
                    setDraft(null);
                    await reload();
                  } catch (err) {
                    setDialogError(errorMessage(err));
                  }
                }}
              >
                Löschen
              </Button>
            )}
            <Button onClick={save} disabled={!draft?.name.trim() || draft.roles.length === 0}>
              Speichern
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="Name (steht auf dem Bon)">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </Field>
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Rollen</div>
              <div className="space-y-1">
                {ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-slate-900"
                      checked={draft.roles.includes(r)}
                      onChange={() => setDraft({ ...draft, roles: draft.roles.includes(r) ? draft.roles.filter((x) => x !== r) : [...draft.roles, r] })}
                    />
                    <span className="font-medium">{ROLE_LABELS[r]}</span>
                    <span className="text-xs text-slate-500">{ROLE_HELP[r]}</span>
                  </label>
                ))}
              </div>
            </div>
            <Field label={draft.hasPin ? 'Neue PIN (leer lassen = unverändert)' : 'PIN'}>
              <Input inputMode="numeric" value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="z. B. 4711" />
            </Field>
            {draft.roles.includes('admin') && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Benutzername">
                  <Input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} autoComplete="off" />
                </Field>
                <Field label={draft.hasPassword ? 'Neues Passwort (optional)' : 'Passwort (min. 8 Zeichen)'}>
                  <Input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="new-password" />
                </Field>
              </div>
            )}
            <Toggle checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} label="Aktiv" description="Gesperrte Benutzer können sich nicht anmelden." />
            {dialogError && <ErrorBox>{dialogError}</ErrorBox>}
          </div>
        )}
      </Modal>
    </div>
  );
}
