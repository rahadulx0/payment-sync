/**
 * Presentation helpers. Money is NEVER rendered from a float — amounts arrive as
 * decimal strings and are formatted by grouping the integer part (CLAUDE.md rule 1).
 * Times present in Asia/Dhaka (the operator's timezone) with the absolute value
 * available on hover elsewhere.
 */

const DHAKA = 'Asia/Dhaka';

/** Format a decimal-string amount like "1250.5" → "1,250.50" (string math only). */
export function formatMoney(decimal: string, currency = 'BDT'): string {
  const trimmed = decimal.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf('.');
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracRaw = dot === -1 ? '' : unsigned.slice(dot + 1);
  const frac = `${fracRaw}00`.slice(0, 2);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${negative ? '-' : ''}${grouped}.${frac}`;
}

export function formatDateTimeDhaka(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DHAKA,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/** "3 min ago", "2 h ago", "just now"; `now` injectable for deterministic tests. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((now - then) / 1000);
  if (secs < 0) return 'in the future';
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${String(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const days = Math.round(hours / 24);
  return `${String(days)} d ago`;
}

/** Online iff the last heartbeat is within `thresholdMin` (default 30). */
export function isOnline(
  lastHeartbeatIso: string | null,
  now: number = Date.now(),
  thresholdMin = 30,
): boolean {
  if (lastHeartbeatIso === null) return false;
  return now - new Date(lastHeartbeatIso).getTime() <= thresholdMin * 60 * 1000;
}
