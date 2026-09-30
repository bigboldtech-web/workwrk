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
import { engineWithOwnerFloor, logSettingsGateDisagreement, settingsGateDecision, settingsGateMode } from "./settings-gate-engine";
import { scopeForOwnerPage, sessionIsWorkspaceAdmin, sessionMayManageOwnerPage } from "./workspace-admin";
import type { SettingsPageKey } from "./types";

type SessionLike = { user?: { id?: string; accessLevel?: string; organizationId?: string } } | null | undefined;

async function legacyDoor(page: SettingsPageKey, session: SessionLike): Promise<boolean> {
  if (!LEGACY_SETTINGS_RULES[page]) return true;
  const ok = legacySettingsAllows(page, session?.user?.accessLevel ?? null);
  if (!ok || !OWNER_SETTINGS_PAGES.has(page)) return ok;
  return sessionMayManageOwnerPage(session, scopeForOwnerPage(page));
}

/**
 * May the signed-in person open this Workspace settings page (and read the
 * data its cards load)? Pass the session when the caller already holds it.
 */
export async function settingsDoorAllows(page: SettingsPageKey, sessionIn?: unknown): Promise<boolean> {
  const session = (sessionIn ?? (await getServerSession(authOptions))) as SessionLike;
  if (!session?.user?.id) return false;
  const legacy = await legacyDoor(page, session);
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
    workspaceAdmin: sessionIsWorkspaceAdmin(session),
    mayManageOwnerPage: ownerPage ? await sessionMayManageOwnerPage(session, scopeForOwnerPage(page)) : false,
  };
  const verdict = settingsGateDecision(mode, inputs);
  if (verdict.disagree) {
    logSettingsGateDisagreement({ userId: viewer.userId, organizationId: viewer.organizationId, page, legacy, engine: engineWithOwnerFloor(inputs), mode });
  }
  return verdict.allowed;
}

/** The reader pages below Admin (Members, Structure, Access, Scoring) this person opens now. */
export async function settingsReaderPagesFor(sessionIn?: unknown): Promise<SettingsPageKey[]> {
  const candidates: SettingsPageKey[] = ["members", "structure", "access", "scoring"];
  const out: SettingsPageKey[] = [];
  for (const p of candidates) if (await settingsDoorAllows(p, sessionIn)) out.push(p);
  return out;
}
