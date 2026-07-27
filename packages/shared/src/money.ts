/**
 * The single money abstraction for the platform (CLAUDE.md rule 1, ADR-7).
 *
 * Money is stored and compared as **integer paisa** (1 BDT = 100 paisa). It is
 * parsed from decimal strings and rendered back to 2-decimal strings on the
 * wire. No float arithmetic ever touches an amount.
 */

const PAISA_PER_TAKA = 100;
/** NUMERIC(14,2) → max 12 integer digits + 2 decimals → 99,999,999,999,999 paisa. */
const MAX_ABS_PAISA = 99_999_999_999_999;

const BENGALI_DIGIT_ZERO = 0x09e6; // '০'
const ASCII_DIGIT_ZERO = 0x30; // '0'

/** Map Bengali numerals (০–৯) to ASCII (0–9); leave everything else untouched. */
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

export class MoneyParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Cannot parse money from ${JSON.stringify(input)}: ${reason}`);
    this.name = 'MoneyParseError';
  }
}

export class Money {
  private constructor(private readonly paisaValue: number) {}

  /** Construct from a known-integer paisa value. */
  static fromPaisa(paisa: number): Money {
    if (!Number.isInteger(paisa)) {
      throw new MoneyParseError(String(paisa), 'paisa must be an integer');
    }
    if (Math.abs(paisa) > MAX_ABS_PAISA) {
      throw new MoneyParseError(String(paisa), 'amount out of range for NUMERIC(14,2)');
    }
    return new Money(paisa);
  }

  /**
   * Parse a decimal string. Tolerates thousands separators, `Tk`/`BDT`/`৳`
   * prefixes and Bengali digits. Throws `MoneyParseError` on any ambiguity —
   * it must never silently return 0 or round (`1.005` is an error, not `1.00`).
   */
  static fromDecimalString(input: string): Money {
    const normalized = toAsciiDigits(input).trim();
    if (normalized.length === 0) {
      throw new MoneyParseError(input, 'empty');
    }
    const cleaned = normalized
      .replace(/^(tk\.?|bdt|৳)\s*/i, '')
      .replace(/\s*(tk|bdt|৳)$/i, '')
      .replace(/[\s,]/g, '');
    // Wire amounts are non-negative; a signed delta only ever comes from subtract().
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      throw new MoneyParseError(input, 'not a valid non-negative amount with up to 2 decimals');
    }
    const dot = cleaned.indexOf('.');
    const intPart = dot === -1 ? cleaned : cleaned.slice(0, dot);
    const fracRaw = dot === -1 ? '' : cleaned.slice(dot + 1);
    const fracPart = `${fracRaw}00`.slice(0, 2);
    return Money.fromPaisa(Number(intPart) * PAISA_PER_TAKA + Number(fracPart));
  }

  /** Accepts a Prisma Decimal, a number, or a string. */
  static fromPrismaDecimal(value: string | number | { toString(): string }): Money {
    return Money.fromDecimalString(String(value));
  }

  static zero(): Money {
    return new Money(0);
  }

  toPaisa(): number {
    return this.paisaValue;
  }

  /** Always two decimal places, e.g. `1250.00`. */
  toDecimalString(): string {
    const negative = this.paisaValue < 0;
    const abs = Math.abs(this.paisaValue);
    const int = Math.floor(abs / PAISA_PER_TAKA);
    const frac = abs % PAISA_PER_TAKA;
    return `${negative ? '-' : ''}${int}.${frac.toString().padStart(2, '0')}`;
  }

  equals(other: Money): boolean {
    return this.paisaValue === other.paisaValue;
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.paisaValue < other.paisaValue) return -1;
    if (this.paisaValue > other.paisaValue) return 1;
    return 0;
  }

  absDiff(other: Money): Money {
    return new Money(Math.abs(this.paisaValue - other.paisaValue));
  }

  /** True when |this − other| ≤ |tolerance|. */
  isWithinTolerance(other: Money, tolerance: Money): boolean {
    return this.absDiff(other).paisaValue <= Math.abs(tolerance.paisaValue);
  }

  add(other: Money): Money {
    return Money.fromPaisa(this.paisaValue + other.paisaValue);
  }

  subtract(other: Money): Money {
    return Money.fromPaisa(this.paisaValue - other.paisaValue);
  }

  isPositive(): boolean {
    return this.paisaValue > 0;
  }
}
