// A table's public link (pen test 2026-11-28, V-30).
//
// The link was /embed/tables/<id>: the table's bare internal id, the same id
// in every internal URL, notification and copied link. Turning it on exposed
// the table to everyone who ever had an internal link (former members,
// removed guests, a pasted Slack message), and off then on brought the same
// URL back. Doc public links already carry a secret.
//
// Now the link is /embed/tables/<id>.<signature>: an HMAC of the table id and
// its public-link generation (DataTable.publicEpoch), keyed from the server's
// auth secret. The generation goes up each time the link is turned on or
// reset, so every older link stops working, and nothing secret is stored: the
// generation is a plain counter. A table made public before this (no
// generation) keeps its bare-id link until its link is turned off or reset.
//
// Server-only.

import { createHmac, timingSafeEqual } from "node:crypto";

const LABEL = "workwrk:table-public-link:v1";

function key(): Buffer | null {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(LABEL).digest();
}

/** The signature for this table and generation, or null when the server has no key. */
export function tablePublicSignature(tableId: string, epoch: number): string | null {
  const k = key();
  if (!k) return null;
  return createHmac("sha256", k).update(`${tableId}:${epoch}`).digest("base64url").slice(0, 32);
}

/** What goes after /embed/tables/ and /api/public/tables/: the id, signed when the table has a generation. */
export function tablePublicRef(table: { id: string; publicEpoch: number | null }): string | null {
  if (table.publicEpoch == null) return table.id;
  const sig = tablePublicSignature(table.id, table.publicEpoch);
  return sig ? `${table.id}.${sig}` : null;
}

/** The id and the signature (null when none) a public request names. */
export function parseTablePublicRef(ref: string): { id: string; signature: string | null } {
  const at = ref.indexOf(".");
  return at < 0 ? { id: ref, signature: null } : { id: ref.slice(0, at), signature: ref.slice(at + 1) || null };
}

/**
 * Whether a public request's signature opens this table: a table with a
 * generation needs its current signature; one without (made public before
 * V-30) answers its bare id only.
 */
export function tablePublicRefValid(table: { id: string; publicEpoch: number | null }, signature: string | null): boolean {
  if (table.publicEpoch == null) return signature === null;
  if (!signature) return false;
  const want = tablePublicSignature(table.id, table.publicEpoch);
  if (!want) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
