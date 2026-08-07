import { createHash } from "crypto";

/**
 * Idempotency key builder — dedupes duplicate trigger events.
 *
 * Key = sha256(org + event_key + record_id + event_timestamp), stored
 * on AutomationRun and enforced by @@unique([workflowId, idempotencyKey]):
 * the same event hitting the same workflow twice inserts once; the
 * second insert P2002s and the engine skips it silently.
 *
 * The timestamp comes from the payload when the emitter provides one
 * (createdAt/updatedAt/eventTs); otherwise we bucket "now" to the
 * minute so rapid double-dispatches of the same event still collapse.
 */

export function buildIdempotencyKey(input: {
  organizationId: string;
  eventKey: string;
  recordId: string | null;
  eventTimestamp: string;
}): string {
  const raw = [input.organizationId, input.eventKey, input.recordId ?? "-", input.eventTimestamp].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

/** Pull the best event timestamp out of a flat payload. */
export function extractEventTimestamp(payload: Record<string, unknown>): string {
  const candidates = [payload.eventTs, payload.updatedAt, payload.createdAt];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
    if (c instanceof Date) return c.toISOString();
  }
  // Minute bucket — near-simultaneous duplicate dispatches dedupe.
  const now = new Date();
  now.setSeconds(0, 0);
  return now.toISOString();
}

/** Pull the subject record id out of a flat payload. */
export function extractRecordId(payload: Record<string, unknown>): string | null {
  const candidates = [payload.id, payload.itemId, payload.taskId, payload.recordId];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return null;
}
