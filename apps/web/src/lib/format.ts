import type { OrderDto, TicketDto } from '@bestellsystem/shared';

export { formatEuro } from '@bestellsystem/shared';

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function minutesSince(iso: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export function orderPlace(o: Pick<OrderDto | TicketDto, 'kind' | 'areaName' | 'tableLabel' | 'pickupNumber'>) {
  return o.kind === 'togo' ? `Abholnr. ${o.pickupNumber}` : `${o.areaName ?? ''} · Tisch ${o.tableLabel ?? '?'}`;
}

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
