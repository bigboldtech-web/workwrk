// A list tool's cursor (docs/plans/mcp-server.md 4.5): base64url of
// { u, i }, the updatedAt and id of the row a page ended on, read back as
// the keyset collect-readable.ts olderThan pages by. It carries no access:
// a cursor someone made up only says where to start reading, and every row
// after it is still gated for the caller. Pure.

export interface CursorAt {
  id: string;
  updatedAt: Date;
}

/** The cursor for the row a page ended on. */
export function encodeCursor(at: CursorAt): string {
  return Buffer.from(JSON.stringify({ u: at.updatedAt.toISOString(), i: at.id }), "utf8").toString("base64url");
}

/** A cursor read back, or null when it is not one this server gave. */
export function decodeCursor(raw: unknown): CursorAt | null {
  if (typeof raw !== "string" || !raw || raw.length > 500 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const { u, i } = v as { u?: unknown; i?: unknown };
    if (typeof u !== "string" || typeof i !== "string" || !i || i.length > 64) return null;
    const at = new Date(u);
    if (Number.isNaN(at.getTime())) return null;
    return { id: i, updatedAt: at };
  } catch {
    return null;
  }
}
