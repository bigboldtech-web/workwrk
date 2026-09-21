// task-load-failure.ts: the ONE translation from "GET /api/items/[id] did not
// answer 200" into a sentence that names the cause.
//
// WHY THIS FILE EXISTS. Every non-404, non-403 answer used to collapse into
// "Couldn't load this task". A 401 (the session lapsed), a 500 (the database
// is missing a column the release reads), a 502 (pm2 was mid-reload) and an
// offline tab all read the same, so the report that came back was "it says it
// could not load" and nothing else, and every guess about the cause was a
// guess. The page and the drawer both render from this, so they cannot drift.
//
// It is pure (no fetch, no DOM) so the vitest suite pins every sentence.

export type TaskMissingReason = "legacy_task_not_migrated";

export interface TaskLoadFailure {
  /** The HTTP status, or 0 when the request never reached a server. */
  status: number;
  /** One sentence in the reader's words. Never "could not load". */
  message: string;
  /**
   * What the server said, verbatim, when it said anything a person can act
   * on: the database error behind a 500, the route's own `error` string. Null
   * when there is nothing beyond the status.
   */
  detail: string | null;
}

/** The shape every item route answers a failure with (src/lib/item-gate.ts). */
export interface ItemFailureBody {
  error?: unknown;
  reason?: unknown;
  detail?: unknown;
  hint?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The 404 branch: does the body say WHICH kind of not-found this is?
 *
 * The gate answers `reason: "legacy_task_not_migrated"` when the id is a row
 * on the old `Task` table that the viewer owns and no forwarding address
 * exists for it yet. That is the one not-found a reader can act on, so it is
 * the one the hosts name.
 */
export function missingReasonFrom(body: ItemFailureBody | null | undefined): TaskMissingReason | null {
  return body?.reason === "legacy_task_not_migrated" ? "legacy_task_not_migrated" : null;
}

/**
 * Describe a failed load. `status` 0 means the fetch threw (offline, DNS, a
 * reload that killed the socket); anything else is what the server answered.
 */
export function describeTaskLoadFailure(status: number, body: ItemFailureBody | null | undefined): TaskLoadFailure {
  const serverError = str(body?.error);
  const serverDetail = str(body?.detail);
  const hint = str(body?.hint);
  // The route's own `error` is a code ("server_error", "no_access") more often
  // than a sentence, so the sentence comes from `detail` first and the code is
  // kept only when it is all there is.
  const detailParts = [serverDetail, hint].filter((v): v is string => Boolean(v));
  const detail = detailParts.length ? detailParts.join(" ") : serverError && serverError !== "server_error" ? serverError : null;

  if (status === 0) {
    return { status, message: "The request never reached the server. Check your connection and retry.", detail: null };
  }
  if (status === 401) {
    return { status, message: "Your session has expired. Sign in again to open this task.", detail: null };
  }
  if (status === 410) {
    return { status, message: "This task's address has been retired.", detail };
  }
  if (status === 429) {
    return { status, message: "Too many requests. Wait a moment and retry.", detail: null };
  }
  if (status >= 500) {
    return {
      status,
      message: `The server failed while loading this task (HTTP ${status}).`,
      detail: detail ?? "The server sent no reason. The pm2 log on the box has the stack trace.",
    };
  }
  return { status, message: `The server refused this request (HTTP ${status}).`, detail };
}
