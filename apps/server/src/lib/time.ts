export function makeTimeFormatter(timezone: string) {
  const fmt = new Intl.DateTimeFormat('de-DE', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  return (date: Date) => fmt.format(date);
}

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}
