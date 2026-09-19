// One place that turns a denial PAYLOAD into a sentence a person can read.
//
// The item routes answer a refusal as `{ error: "no_access", reason: "<code>" }`
// — machine codes, on purpose, so the server never has to guess the wording of
// a client. Every caller then did `toast(d?.error ?? "Couldn't delete")`, so
// what the user actually saw was the literal string `no_access`. This module is
// the transcription: a caller's own override first, then the reason, then the
// generic code, then the caller's fallback sentence. Pure and client-safe (no
// imports).
//
// The keys below are the complete set of `reason` values the item routes emit
// today (grep `reason: "` under src/app/api/items and src/lib/item-*.ts). A
// reason with no line here falls back to the caller's sentence, which is still
// a sentence — never a code.

/** The shape every item route's refusal body has. Extra keys are ignored. */
export interface DenialPayload {
  error?: unknown;
  reason?: unknown;
  role?: unknown;
  requestAccess?: unknown;
}

const REASONS: Record<string, string> = {
  role_too_low: "You don't have permission to do that on this task.",
  moderation_needs_full_access:
    "Only someone with full access to this List can delete another person's comment.",
  not_comment_author: "You can only edit your own comments.",
  list_read_only: "You can read this List but not change what's in it.",
  source_list_read_only: "You can't move this task out of its current List.",
  target_list_read_only: "You can't add tasks to that List.",
  personal_list_not_a_move_target: "A Personal List only holds its owner's own tasks.",
  unknown_assignee: "That person is no longer in this workspace. Refresh and pick again.",
};

/** The generic codes a route answers when it has no more specific reason. */
const CODES: Record<string, string> = {
  no_access: "You don't have permission to do that.",
  Forbidden: "You don't have permission to do that.",
  Unauthorized: "Your session has expired. Sign in again.",
  "Not found": "That's no longer there.",
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * The sentence to show for a refusal body.
 *
 * @param payload   the parsed JSON body of a non-ok response (may be anything)
 * @param fallback  what to say when nothing in the body is recognisable
 * @param overrides per-reason wording for this one call site, for the cases
 *                  where the route cannot know the context — `role_too_low` on
 *                  a delete means "creator or full access", on a move it does
 *                  not.
 */
export function accessMessage(
  payload: unknown,
  fallback: string,
  overrides?: Record<string, string>,
): string {
  const p = (payload ?? {}) as DenialPayload;
  const reason = asString(p.reason);
  if (reason && overrides?.[reason]) return overrides[reason];
  if (reason && REASONS[reason]) return REASONS[reason];
  const code = asString(p.error);
  if (code && CODES[code]) return CODES[code];
  // A route that answered with a real sentence (`err.message` from a throw)
  // keeps it: those are already written for people.
  if (code && !/^[a-z0-9_]+$/.test(code)) return code;
  return fallback;
}

/** True when the refusal is one the viewer could ask their way out of. */
export function canRequestAccess(payload: unknown): boolean {
  return (payload as DenialPayload | null)?.requestAccess === true;
}
