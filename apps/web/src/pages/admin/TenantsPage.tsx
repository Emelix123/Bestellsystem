import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, Toggle, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useApiData } from '../../lib/useApi';
import { PageTitle } from './AdminApp';

interface Tenant {
  id: number;
  name: string;
  slug: string;
  users: number;
}

/** Nur für Betreiber (Super-Admin): mehrere Vereine auf einer Installation. */
export function TenantsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { me, refresh } = useSession();
  const { data, error, reload } = useApiData<Tenant[]>(me?.user.isSuperadmin ? '/api/super/tenants' : null);
  const [form, setForm] = useState<{ name: string; adminName: string; username: string; password: string; demo: boolean } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (!me?.user.isSuperadmin) return <ErrorBox>Nur für Betreiber.</ErrorBox>;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;

  const switchTo = async (t: Tenant) => {
    try {
      await api.post('/api/auth/tenant', { tenantId: t.id });
      await refresh();
      toast({ tone: 'success', text: `Arbeite jetzt in „${t.name}“` });
      navigate('/admin');
    } catch (err) {
      toast({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div>
      <PageTitle title="Vereine">
        <Button
          onClick={() => {
            setDialogError(null);
            setForm({ name: '', adminName: '', username: '', password: '', demo: false });
          }}
        >
          Neuer Verein
        </Button>
      </PageTitle>
      <p className="mb-4 text-sm text-slate-600">
        Jeder Verein hat eigene Veranstaltungen, Produkte, Drucker, Benutzer und Einstellungen – vollständig getrennt.
      </p>
      <div className="space-y-3">
        {data.map((t) => (
          <Card key={t.id} className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold">
                {t.name} {me.tenant?.id === t.id && <span className="text-sm font-normal text-emerald-700">(aktuell)</span>}
              </div>
              <div className="text-sm text-slate-500">
                Kürzel {t.slug} · {t.users} Benutzer
              </div>
            </div>
            {me.tenant?.id !== t.id && (
              <Button size="sm" variant="secondary" onClick={() => switchTo(t)}>
                Wechseln
              </Button>
            )}
            {me.user.id && me.tenant?.id !== t.id && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (prompt(`Zum Löschen von „${t.name}“ mit ALLEN Daten bitte das Kürzel eingeben:`) !== t.slug) return;
                  try {
                    await api.delete(`/api/super/tenants/${t.id}`);
                    await reload();
                  } catch (err) {
                    toast({ tone: 'error', text: errorMessage(err) });
                  }
                }}
              >
                Löschen
              </Button>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title="Neuer Verein"
        footer={
          <Button
            onClick={async () => {
              try {
                await api.post('/api/super/tenants', form);
                setForm(null);
                await reload();
              } catch (err) {
                setDialogError(errorMessage(err));
              }
            }}
          >
            Anlegen
          </Button>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="Name des Vereins">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <p className="text-sm text-slate-600">Erster Admin des Vereins:</p>
            <Field label="Name">
              <Input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Benutzername">
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Passwort (min. 8 Zeichen)">
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
              </Field>
            </div>
            <Toggle checked={form.demo} onChange={(demo) => setForm({ ...form, demo })} label="Mit Beispieldaten" />
            {dialogError && <ErrorBox>{dialogError}</ErrorBox>}
          </div>
        )}
      </Modal>
    </div>
  );
}
