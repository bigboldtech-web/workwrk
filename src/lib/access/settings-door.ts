// The Workspace settings door as ONE server decision (Phase 8 stage E fix).
//
// The page gate (components/settings/settings-gate.tsx), the reader sidebar in
// /api/boot and the data APIs behind the reader pages (Members, Teams, the
// role counts, the Access model, the invitations list) all ask this one
// function, so a page the gate opens never shows ErrorState because its API
// still reads the older rule, and an API never serves a page the gate shuts.
//
//   flags off / log-only   today's table (settings-legacy.ts) decides, the
//                          Owner split applied on Billing, Security and API
//   ACCESS_V2_RESOLVER on  the engine's page table decides (log-only off),
//                          with the Owner split's floor (settings-gate-engine)
//
// Server-only: reads the session and the database.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LEGACY_SETTINGS_RULES, OWNER_SETTINGS_PAGES, legacySettingsAllows } from "./settings-legacy";
import { accessV2Resolver, settingsGateLogOnly } from "./flags";
import { SETTINGS_GATE_AUDIT_COLLAPSE_MS, engineWithOwnerFloor, logSettingsGateDisagreement, settingsGateAuditRow, settingsGateDecision, settingsGateMode } from "./settings-gate-engine";
import { logActivity } from "@/lib/activity";
import { freshMayManageOwnerPage, freshWorkspaceActor, scopeForOwnerPage, sessionIsWorkspaceAdmin, sessionMayManageOwnerPage, type FreshActor } from "./workspace-admin";
import { legacyIsManagerLevel } from "./legacy-levels";
import type { SettingsPageKey } from "./types";

type SessionLike = { user?: { id?: string; accessLevel?: string; organizationId?: string } } | null | undefined;

/**
 * The person as the DATABASE has them now, for the door. The session token is
 * re-checked only every five minutes (src/lib/auth.ts REVALIDATE_MS), so an
 * Admin demoted a moment ago still carries an Admin claim: before this the
 * page gate and the reader APIs (Members, Teams, the invitations list) kept
 * opening for that stale claim while every write already refused it. Read
 * only when the session claims the manager tier or above, the only claims
 * that open a door the legacy table guards, so a Member pays nothing (null).
 */
export async function freshDoorActor(session: unknown): Promise<FreshActor | null> {
  const level = (session as SessionLike)?.user?.accessLevel;
  if (!legacyIsManagerLevel(level)) return null;
  return freshWorkspaceActor(session);
}

/**
 * Today's table, asked of BOTH the session's claim and the database's level
 * when the latter was read: a demotion lands now (the database says no), a
 * promotion still lands on the next session check (the claim says no), the
 * same both-must-agree rule freshWorkspaceActor applies to writes.
 */
async function legacyDoor(page: SettingsPageKey, session: SessionLike, fresh: FreshActor | null): Promise<boolean> {
  if (!LEGACY_SETTINGS_RULES[page]) return true;
  const ok = legacySettingsAllows(page, session?.user?.accessLevel ?? null);
  if (!ok) return false;
  if (fresh) {
    if (!fresh.ok || !legacySettingsAllows(page, fresh.level)) return false;
    if (!OWNER_SETTINGS_PAGES.has(page)) return true;
    return freshMayManageOwnerPage(fresh, scopeForOwnerPage(page));
  }
  if (!OWNER_SETTINGS_PAGES.has(page)) return true;
  return sessionMayManageOwnerPage(session, scopeForOwnerPage(page));
}

/**
 * May the signed-in person open this Workspace settings page (and read the
 * data its cards load)? Pass the session when the caller already holds it,
 * and `fresh` (freshDoorActor) when the caller asks about several pages or
 * needs the fresh actor itself, so the database is read once per request.
 */
export async function settingsDoorAllows(
  page: SettingsPageKey,
  sessionIn?: unknown,
  opts: { visit?: boolean; fresh?: FreshActor | null } = {},
): Promise<boolean> {
  const session = (sessionIn ?? (await getServerSession(authOptions))) as SessionLike;
  if (!session?.user?.id) return false;
  const fresh = opts.fresh !== undefined ? opts.fresh : await freshDoorActor(session);
  // A session the database no longer backs (signed out elsewhere, a
  // demotion's tokenVersion bump, removed) opens no door at all, under the
  // engine too: nothing below may read the stale claim as an answer.
  if (fresh && !fresh.ok) return false;
  const legacy = await legacyDoor(page, session, fresh);
  const mode = settingsGateMode({ resolver: accessV2Resolver(), logOnly: settingsGateLogOnly() });
  if (mode === "legacy" || !LEGACY_SETTINGS_RULES[page]) return legacy;
  const { can, viewerFromSession } = await import("./index");
  const viewer = await viewerFromSession();
  if (!viewer) return legacy;
  const decision = await can(viewer, "view", { type: "settings", page });
  const ownerPage = OWNER_SETTINGS_PAGES.has(page);
  const inputs = {
    legacy,
    engine: decision.allowed,
    ownerPage,
    workspaceAdmin: fresh ? fresh.ok && fresh.admin : sessionIsWorkspaceAdmin(session),
    mayManageOwnerPage: ownerPage
      ? fresh
        ? freshMayManageOwnerPage(fresh, scopeForOwnerPage(page))
        : await sessionMayManageOwnerPage(session, scopeForOwnerPage(page))
      : false,
  };
  const verdict = settingsGateDecision(mode, inputs);
  if (verdict.disagree) {
    const engine = engineWithOwnerFloor(inputs);
    logSettingsGateDisagreement({ userId: viewer.userId, organizationId: viewer.organizationId, page, legacy, engine, mode });
    // The log-only week also leaves an audit row per person per page per day
    // (Workspace settings > Audit log, filter "access.settings_gate"), so the
    // founder reads the would-be denials from the product, not only stderr.
    // Only a real page visit writes one (the page gate passes `visit`): boot's
    // reader sidebar and the reader APIs ask about pages nobody opened. The
    // one-row-a-day collapse dedupes (the stderr sample above is shared with
    // those callers, so it cannot).
    if (mode === "observe" && opts.visit) {
      const { SETTINGS_PAGES } = await import("@/lib/settings-registry");
      const row = settingsGateAuditRow({ page, label: SETTINGS_PAGES[page]?.label, legacy, engine });
      void logActivity({
        ...row,
        actorId: viewer.userId,
        organizationId: viewer.organizationId,
        targetType: "SettingsPage",
        targetId: page,
        collapseWithinMs: SETTINGS_GATE_AUDIT_COLLAPSE_MS,
      });
    }
  }
  return verdict.allowed;
}

/** The reader pages below Admin (Members, Structure, Access, Scoring) this person opens now. */
export async function settingsReaderPagesFor(sessionIn?: unknown): Promise<SettingsPageKey[]> {
  const session = (sessionIn ?? (await getServerSession(authOptions))) as SessionLike;
  const candidates: SettingsPageKey[] = ["members", "structure", "access", "scoring"];
  const out: SettingsPageKey[] = [];
  const fresh = await freshDoorActor(session);
  for (const p of candidates) if (await settingsDoorAllows(p, session, { fresh })) out.push(p);
  return out;
}
