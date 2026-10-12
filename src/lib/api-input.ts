// Values the public API and the integrations ingest take from a caller, read
// one way, so a value that is not what the field holds is the caller's
// mistake (a 400 that says what to send), never a throw deep in a write
// (a bare 500). Docs-found fixes batch 3: a bad `date` on POST /api/v1/tasks
// became an Invalid Date that failed inside the create, and a numeric string
// `slaHours` was stored as text and read back as null.
//
// Pure: no imports.

export type Parsed<T> = { ok: true; value: T } | { ok: false };

/** A date and time: an ISO string or epoch milliseconds. Absent or empty is null. */
export function parseApiDate(raw: unknown): Parsed<Date | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false };
  const d = new Date(typeof raw === "string" ? raw.trim() : raw);
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d };
}

export const API_DATE_RULE = "must be a date and time, such as 2026-10-12T09:00:00Z";

/**
 * One of `allowed` (an enum's values, in capitals), matched in any case and
 * answered in capitals, as GET /api/v1/sops and POST /api/v1/tasks read
 * theirs. Absent or empty is null; anything else is refused. Docs-found
 * fixes batch 5: GET /api/v1/people passed its `status` to the read as sent,
 * so a value outside UserStatus failed inside Prisma and answered a bare 500.
 */
export function parseApiEnum(raw: unknown, allowed: readonly string[]): Parsed<string | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const up = raw.trim().toUpperCase();
  return allowed.includes(up) ? { ok: true, value: up } : { ok: false };
}

/** The 400's words for a value outside its list: "status must be one of ACTIVE, INACTIVE, ...". */
export function apiEnumRule(field: string, allowed: readonly string[]): string {
  return `${field} must be one of ${allowed.join(", ")}`;
}

/**
 * Hours for a task's SLA: a number, or a string of one. Absent, empty, zero
 * or below is no SLA (null), as it always was; anything else is refused.
 */
export function parseSlaHours(raw: unknown): Parsed<number | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n > 0 ? n : null };
}
