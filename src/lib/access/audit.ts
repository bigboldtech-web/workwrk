// logDenial (access-model-spec 5.1 and invariant 16): a real person hit a
// wall, so the founder can read, after the flip, who was locked out of what.
//
// Written by requireCan (every API refusal) and gatePage (a page's "view"
// refused), ONLY when the decision was discoverable: a not-discoverable
// denial is an id probe or an object outside the person's world and is
// never logged (shouldLogDenial). Sampled to one row per viewer per target
// per 10 minutes (DENIAL_SAMPLE_WINDOW_MS), in this process and, across
// processes, by collapsing into the last row of the window.
//
// Never throws and never decides: a failure to write is logged to stderr and
// the refusal goes out exactly as it would have.
//
// Server-only.

import { logActivity } from "@/lib/activity";
import { DENIAL_SAMPLE_WINDOW_MS, denialAuditRow, denialSampleKey, denialTarget, shouldLogDenial } from "./guards";
import type { Action, Decision, ObjectRef, Viewer } from "./types";

const lastLogged = new Map<string, number>();
const MAX_KEYS = 20000;

export function logDenial(viewer: Viewer, action: Action, ref: ObjectRef, decision: Decision, now: number = Date.now()): void {
  try {
    if (decision.allowed) return;
    const t = denialTarget(ref);
    const key = denialSampleKey(viewer.userId, t.type, `${t.id}:${action}`);
    const last = lastLogged.get(key) ?? null;
    if (!shouldLogDenial({ discoverable: decision.discoverable, lastLoggedAt: last, now })) return;
    if (lastLogged.size >= MAX_KEYS) lastLogged.clear();
    lastLogged.set(key, now);
    void logActivity({
      ...denialAuditRow(action, ref, decision),
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      collapseWithinMs: DENIAL_SAMPLE_WINDOW_MS,
    }).catch((err: unknown) => console.error("access.denied log failed", err));
  } catch (err) {
    console.error("access.denied log failed", err);
  }
}
