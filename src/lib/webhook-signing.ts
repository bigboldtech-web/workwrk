// Which key a webhook subscription's deliveries are signed with, opened from
// the subscription row (src/services/webhookDispatcher.ts, THE SIGNING KEY):
// the secret the receiver was shown, opened from `secretSealed`; on a
// subscription made before the secret was kept, its `secretHash`; and not ok
// when the sealed secret is there but no key on this server opens it, so
// nothing can be signed. The dispatcher and GET /api/webhooks read the same
// answer from here (docs-found fixes batch 4: GET said "secret" for a
// subscription whose secret could not be opened, while every one of its
// deliveries was held).

import { openToken } from "@/lib/connectors/seal";

/** How often a delivery held by an unreadable key is tried again (the dispatcher's holdUnsent). */
export const NOT_SENT_RETRY_MINUTES = 15;

export type SigningKey = { ok: true; key: string; signing: "secret" | "legacy_hash" } | { ok: false };

export function signingKeyOf(sub: { secretHash: string; secretSealed?: unknown }): SigningKey {
  if (sub.secretSealed === null || sub.secretSealed === undefined) return { ok: true, key: sub.secretHash, signing: "legacy_hash" };
  try {
    return { ok: true, key: openToken(sub.secretSealed), signing: "secret" };
  } catch {
    return { ok: false };
  }
}
