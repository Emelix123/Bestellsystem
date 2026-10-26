import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveStatus } from '../lib/live';
import { useOutbox } from '../lib/outbox';
import { useSession } from '../lib/session';
import { cn } from '../lib/format';

export function ConnectionDot() {
  const connected = useLiveStatus();
  const { pending } = useOutbox();
  return (
    <span className="flex items-center gap-2 text-xs font-medium">
      {pending.length > 0 && (
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-slate-950">{pending.length} wartet</span>
      )}
      <span
        className={cn('h-2.5 w-2.5 rounded-full', connected ? 'bg-emerald-400' : 'animate-pulse bg-red-500')}
        title={connected ? 'Verbunden' : 'Keine Live-Verbindung'}
      />
    </span>
  );
}

export function TopBar({
  title,
  subtitle,
  back,
  right,
  dark = true,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string | (() => void);
  right?: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex min-h-14 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]',
        dark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900 shadow-sm',
        className,
      )}
    >
      {back && (
        <button
          type="button"
          onClick={() => (typeof back === 'string' ? navigate(back) : back())}
          className="-ml-1 flex h-11 w-11 items-center justify-center rounded-xl text-2xl hover:bg-white/10"
          aria-label="Zurück"
        >
          ‹
        </button>
      )}
      <div className="min-w-0 flex-1 py-2">
        <div className="truncate text-lg font-bold leading-tight">{title}</div>
        {subtitle && <div className="truncate text-xs opacity-70">{subtitle}</div>}
      </div>
      {right}
      <ConnectionDot />
      <UserMenu />
    </header>
  );
}

function UserMenu() {
  const { me, logout } = useSession();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <details className="relative">
      <summary className="flex h-11 cursor-pointer list-none items-center rounded-xl px-2 text-sm font-semibold hover:bg-white/10">
        {me.user.name} ▾
      </summary>
      <div className="absolute right-0 mt-1 w-56 overflow-hidden rounded-2xl bg-white text-slate-900 shadow-xl ring-1 ring-slate-200">
        <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{me.tenant?.name}</div>
        <Link to="/" className="block px-4 py-3 text-sm hover:bg-slate-50">
          Bereich wechseln
        </Link>
        <button
          type="button"
          className="block w-full px-4 py-3 text-left text-sm text-red-700 hover:bg-red-50"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          Abmelden
        </button>
      </div>
    </details>
  );
}
