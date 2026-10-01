// The log-only week for the app route gates (settings-architecture S7,
// Phase 8 stage F). With SETTINGS_GATE_LOG_ONLY on, an app page that has no
// gate today (FlaggedAppKeyGate) still opens, and this asks the engine what
// it WOULD answer: a hidden or floored app, a Guest on a no-Guest app, a
// viewer outside the audience. Every would-be denial is logged, sampled per
// person per app per 10 minutes on stderr and one audit row a day, so the
// founder reads who a hide or a floor would lock out before it does.
//
// Never throws and never decides: a failure to ask is logged and the page
// renders as it always did.
//
// Server-only.

import { can, viewerFromSession } from "./index";
import { DENIAL_SAMPLE_WINDOW_MS, denialSampleKey } from "./guards";
import { SETTINGS_GATE_AUDIT_COLLAPSE_MS, appRouteAuditRow } from "./settings-gate-engine";
import type { AppKey } from "./types";
import { logActivity } from "@/lib/activity";

const lastLogged = new Map<string, number>();
const MAX_KEYS = 20000;

export async function observeAppRoute(appKey: AppKey, label?: string, now: number = Date.now()): Promise<void> {
  try {
    const viewer = await viewerFromSession();
    if (!viewer) return;
    const decision = await can(viewer, "view", { type: "app", key: appKey });
    if (decision.allowed) return;
    const key = denialSampleKey(viewer.userId, "app", appKey);
    const last = lastLogged.get(key);
    if (last === undefined || now - last >= DENIAL_SAMPLE_WINDOW_MS) {
      if (lastLogged.size >= MAX_KEYS) lastLogged.clear();
      lastLogged.set(key, now);
      console.warn(
        JSON.stringify({ event: "access.app_gate.would_deny", organizationId: viewer.organizationId, userId: viewer.userId, app: appKey, via: decision.via, at: new Date(now).toISOString() }),
      );
    }
    void logActivity({
      ...appRouteAuditRow(appKey, decision.via, label),
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      targetType: "App",
      targetId: appKey,
      collapseWithinMs: SETTINGS_GATE_AUDIT_COLLAPSE_MS,
    });
  } catch (err) {
    console.error("access.app_gate.observe failed", err);
  }
}
