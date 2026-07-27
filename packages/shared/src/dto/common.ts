/** Wire primitives shared across DTOs. */

/** Money on the wire is always a 2-decimal string, e.g. "1250.00" (never a number). */
export type DecimalString = string;

/** ISO-8601 with offset, e.g. "2026-07-27T10:15:00+06:00". */
export type IsoTimestamp = string;

export interface CursorPageQuery {
  cursor?: string;
  limit?: number;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}
