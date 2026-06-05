// Cursor-based pagination (§13c). Never OFFSET — a full index scan to the offset is wasteful and
// gives inconsistent results under concurrent writes. The cursor is the last seen sort key
// (a timestamp), base64url-encoded so it is opaque to clients.

export const PAGE_SIZE = 50;

export function encodeCursor(value: Date): string {
  return Buffer.from(value.toISOString()).toString("base64url");
}

export function decodeCursor(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const iso = Buffer.from(raw, "base64url").toString("utf8");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

// Build the response page. `sortKey` extracts the cursor field from the last row.
export function page<T>(rows: T[], sortKey: (row: T) => Date, limit = PAGE_SIZE): Page<T> {
  const nextCursor = rows.length === limit ? encodeCursor(sortKey(rows[rows.length - 1]!)) : null;
  return { data: rows, nextCursor };
}
