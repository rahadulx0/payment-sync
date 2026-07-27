/**
 * Time helpers (CLAUDE.md rule 2, ADR-8).
 *
 * Storage/computation is UTC. Provider SMS bodies carry local `Asia/Dhaka`
 * timestamps (UTC+06, no DST — ever). Device clocks are untrusted; skew is
 * measured against server time.
 */

const DHAKA_OFFSET_MINUTES = 6 * 60;
const MS_PER_MINUTE = 60_000;
const TWO_DIGIT_YEAR_PIVOT = 70;

const BENGALI_DIGIT_ZERO = 0x09e6;
const ASCII_DIGIT_ZERO = 0x30;

function toAsciiDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code >= BENGALI_DIGIT_ZERO && code <= BENGALI_DIGIT_ZERO + 9) {
      out += String.fromCharCode(ASCII_DIGIT_ZERO + (code - BENGALI_DIGIT_ZERO));
    } else {
      out += ch;
    }
  }
  return out;
}

export class TimeParseError extends Error {
  constructor(raw: string, formats: readonly string[]) {
    super(`Cannot parse timestamp ${JSON.stringify(raw)} with formats [${formats.join(', ')}]`);
    this.name = 'TimeParseError';
  }
}

export function nowUtc(): Date {
  return new Date();
}

/** server_now − device_now, in seconds. Positive ⇒ device clock is behind. */
export function clockSkewSeconds(serverNow: Date, deviceNow: Date): number {
  return Math.round((serverNow.getTime() - deviceNow.getTime()) / 1000);
}

const TOKEN_PATTERNS: Record<string, string> = {
  yyyy: '(?<yyyy>\\d{4})',
  yy: '(?<yy>\\d{2})',
  MM: '(?<MM>\\d{2})',
  dd: '(?<dd>\\d{2})',
  HH: '(?<HH>\\d{2})',
  mm: '(?<mm>\\d{2})',
  ss: '(?<ss>\\d{2})',
};

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatToRegex(format: string): RegExp {
  const tokenRe = /yyyy|yy|MM|dd|HH|mm|ss/g;
  let pattern = '';
  let lastIndex = 0;
  for (const match of format.matchAll(tokenRe)) {
    const idx = match.index;
    const token = match[0];
    pattern += escapeRegex(format.slice(lastIndex, idx));
    pattern += TOKEN_PATTERNS[token] ?? '';
    lastIndex = idx + token.length;
  }
  pattern += escapeRegex(format.slice(lastIndex));
  return new RegExp(`^${pattern}$`);
}

function pivotYear(yy: number): number {
  return yy < TWO_DIGIT_YEAR_PIVOT ? 2000 + yy : 1900 + yy;
}

/** Read back the Dhaka-local components of a UTC instant, to reject rolled-over dates (e.g. 31/02). */
function dhakaComponents(utcMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const d = new Date(utcMs + DHAKA_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/**
 * Parse a provider timestamp (local Dhaka time) to a UTC `Date`. Tries each
 * format in order; throws `TimeParseError` if none match or the date is invalid.
 */
export function parseProviderTimestamp(
  raw: string,
  formats: readonly string[],
  tz = 'Asia/Dhaka',
): Date {
  if (tz !== 'Asia/Dhaka') {
    throw new TimeParseError(raw, formats);
  }
  const input = toAsciiDigits(raw).trim();
  for (const format of formats) {
    const groups = formatToRegex(format).exec(input)?.groups;
    if (!groups) continue;

    const yyyy = groups['yyyy'];
    const yy = groups['yy'];
    const year = yyyy !== undefined ? Number(yyyy) : pivotYear(Number(yy ?? '0'));
    const month = Number(groups['MM'] ?? '0');
    const day = Number(groups['dd'] ?? '0');
    const hh = groups['HH'];
    const mmGroup = groups['mm'];
    const ss = groups['ss'];
    const hour = hh !== undefined ? Number(hh) : 0;
    const minute = mmGroup !== undefined ? Number(mmGroup) : 0;
    const second = ss !== undefined ? Number(ss) : 0;

    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      continue;
    }

    const utcMs =
      Date.UTC(year, month - 1, day, hour, minute, second) - DHAKA_OFFSET_MINUTES * MS_PER_MINUTE;
    const c = dhakaComponents(utcMs);
    if (
      c.year === year &&
      c.month === month &&
      c.day === day &&
      c.hour === hour &&
      c.minute === minute &&
      c.second === second
    ) {
      return new Date(utcMs);
    }
  }
  throw new TimeParseError(raw, formats);
}

/** Render a UTC instant as an ISO-8601 string in Asia/Dhaka (+06:00) for presentation. */
export function toDhaka(date: Date): string {
  const c = dhakaComponents(date.getTime());
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}+06:00`;
}
