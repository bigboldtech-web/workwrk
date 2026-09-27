// A create that can be retried without making a second row.
//
// A POST whose answer is lost (a timeout, a dropped connection) may still
// have committed. Retrying it blindly makes a second row, which for a
// report schedule means every recipient gets every email twice. So a create
// surface picks the new row's id itself, once, and sends the same id with
// every retry of that one create. The server creates the row under that id,
// and when the id is already taken by the same person in the same org it
// answers with the row it made the first time instead of a second one.
//
// No schema change: an id column accepts any string, and this shape (a "c"
// and 24 base 36 characters) sits beside the cuid ids Prisma makes, so no
// code that reads ids can tell them apart. Another person's row under the
// same id (only possible by copying one) is refused, never returned.
//
// Pure: the random source is passed in by the browser caller.

const ID_RE = /^c[0-9a-z]{24}$/;
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A fresh id for one create, from 24 random bytes. */
export function newCreateRequestId(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(24);
  let out = "c";
  for (let i = 0; i < 24; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function defaultRandom(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** The request id a create body carries, or null when it has none or a malformed one. */
export function readCreateRequestId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const v = (body as { requestId?: unknown }).requestId;
  return typeof v === "string" && ID_RE.test(v) ? v : null;
}

/** The body without its request id, for a validator that refuses unknown keys. */
export function withoutRequestId(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("requestId" in body)) return body;
  const { requestId: _drop, ...rest } = body as Record<string, unknown>;
  void _drop;
  return rest;
}

/**
 * What a create does when a row already has its id: the same person's row in
 * the same org is the first attempt's answer (replay); anything else is a
 * refusal that names nothing about the row.
 */
export function createReplayDecision(
  existing: { organizationId: string; creatorId: string | null } | null,
  caller: { organizationId: string; userId: string },
): "create" | "replay" | "refuse" {
  if (!existing) return "create";
  return existing.organizationId === caller.organizationId && existing.creatorId === caller.userId ? "replay" : "refuse";
}
