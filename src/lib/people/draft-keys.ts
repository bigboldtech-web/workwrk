// Local draft keys for performance answers (self review, manager review,
// candor and survey answers). Every key carries the signed-in person's id,
// so on a shared or kiosk browser the next person to sign in never sees,
// restores or submits the previous person's unsent answers. Sign out also
// sweeps the unsent ANONYMOUS answers (candor and survey), which must not sit
// on a shared machine at all; a self or manager review draft is kept for its
// own author (their words are never lost to a sign out, and nobody else can
// read it back through the product). The legacy object-only keys, which
// carried no user, are removed on sight, never read.

export const DRAFT_PREFIXES = ["review-self:", "mgr-review:", "workwrk:candor-answers:", "workwrk:survey-answers:"] as const;
export type DraftPrefix = (typeof DRAFT_PREFIXES)[number];

/** The key for one person's draft of one object. */
export function draftKey(prefix: DraftPrefix, userId: string, objectId: string): string {
  return `${prefix}u:${userId}:${objectId}`;
}

/** The pre-scoping key for an object, which carried no user: removed, never read. */
export function dropLegacyDraft(prefix: DraftPrefix, objectId: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(`${prefix}${objectId}`); } catch { /* storage blocked */ }
}

export const ANONYMOUS_DRAFT_PREFIXES: readonly DraftPrefix[] = ["workwrk:candor-answers:", "workwrk:survey-answers:"];

/** Every unsent anonymous answer on this browser, whoever wrote it (sign out). */
export function clearAllPerformanceDrafts(prefixes: readonly DraftPrefix[] = ANONYMOUS_DRAFT_PREFIXES): void {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) ls.removeItem(k);
  } catch { /* storage blocked */ }
}
