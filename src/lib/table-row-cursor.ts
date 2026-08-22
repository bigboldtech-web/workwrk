// Opaque keyset cursor for GET /api/tables/[id]/rows (Tables Phase 5a
// streaming transport). Encodes the (position, id) of the last row in a
// chunk so the next request can resume strictly after it. Kept as a pure
// module (no Prisma, no Next) because the route.ts convention only allows
// HTTP-method exports and vitest only includes src/lib, so this is the one
// place the encode/decode contract can be unit-tested.

export type RowCursor = {
  // Row sort key. Float-capable by contract even though today's column is
  // Int, so the transport survives if positions ever become fractional
  // (midpoint inserts). The route layers its own schema-specific guard.
  position: number;
  // Unique tiebreak: positions can duplicate across separate inserts (only
  // the batch route rejects intra-request duplicates).
  id: string;
};

// Real cursors are ~40 chars ({"p":<n>,"i":"<cuid>"} base64url'd). The cap
// exists so a crafted query param cannot make the server JSON.parse
// megabytes; anything larger is by definition not ours.
const MAX_CURSOR_CHARS = 512;
// cuids are well under 40 chars; 128 leaves headroom without accepting an
// arbitrary payload as the tiebreak.
const MAX_ID_CHARS = 128;

export function encodeRowCursor(cursor: RowCursor): string {
  // base64url keeps the value query-param-safe without percent-encoding.
  return Buffer.from(JSON.stringify({ p: cursor.position, i: cursor.id }), "utf8").toString("base64url");
}

// Returns null for anything encodeRowCursor could not have minted; the
// route maps null to a 400, never a crash and never a widened query.
export function decodeRowCursor(raw: string): RowCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_CHARS) return null;
  let parsed: unknown;
  try {
    // Buffer's base64url decode is lenient about stray characters; the JSON
    // parse plus the shape checks below are the real gate.
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const p = (parsed as { p?: unknown }).p;
  const i = (parsed as { i?: unknown }).i;
  // Number.isFinite rejects non-numbers and crafted overflow JSON like
  // {"p":1e999}, which parses to Infinity, in one check.
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  if (typeof i !== "string" || i.length === 0 || i.length > MAX_ID_CHARS) return null;
  return { position: p, id: i };
}
