// The one dialog's objects beside the nodes (batch 7), dispatched by kind.
// The API routes call these for an ObjectShareKind, and only while
// objectShareOn(): with ACCESS_V2_TABLES off they answer 404 and never get here.

import type { AccessPanel, GrantWriteBody, GrantWriteResult, ObjectShareKind, PanelRole } from "../access-panel";
import { GrantError } from "../grants";
import { requireApp } from "@/lib/app-gate";
import { accessV2Resolver, settingsGateLogOnly } from "../flags";
import { settingsGateMode } from "../settings-gate-engine";
import type { ObjectShareCtx } from "./common";
import { checkSopFolderAccess, removeSopFolderGrant, setSopFolderGrant, sopFolderPanel } from "./sop-folder";
import { checkToolAccess, removeToolGrant, setToolGrant, toolPanel } from "./tool";
import { checkGoalAccess, goalPanel, removeGoalGrant, setGoalGrant } from "./goal";
import { checkTeamAccess, removeTeamGrant, setTeamGrant, teamPanel } from "./team";

export { objectShareCtxFromSession, objectShareOn, type ObjectShareCtx } from "./common";

export type ObjectCheckResult = { userId: string; name: string; role: string; sentence: string } | "not_found" | "forbidden" | "not_in_org";

interface Adapter {
  panel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null>;
  set(ctx: ObjectShareCtx, id: string, body: GrantWriteBody): Promise<GrantWriteResult>;
  remove(ctx: ObjectShareCtx, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult>;
  check(ctx: ObjectShareCtx, id: string, userId: string): Promise<ObjectCheckResult>;
}

const ADAPTERS: Readonly<Record<ObjectShareKind, Adapter>> = {
  sop_folder: { panel: sopFolderPanel, set: setSopFolderGrant, remove: removeSopFolderGrant, check: checkSopFolderAccess },
  tool: { panel: toolPanel, set: setToolGrant, remove: removeToolGrant, check: checkToolAccess },
  goal: { panel: goalPanel, set: setGoalGrant, remove: removeGoalGrant, check: checkGoalAccess },
  team: { panel: teamPanel, set: setTeamGrant, remove: removeTeamGrant, check: checkTeamAccess },
};

/**
 * Each kind's app door, exactly as that object's own pages and routes keep it
 * (round 2: the dialog is never stricter or looser than the object itself):
 *
 *   tool        the Tools app row, always (tools/layout.tsx AppKeyGate and
 *               every /api/tools route's requireTools)
 *   goal        the goal page's rule (requireGoalPage + FlaggedAppKeyGate):
 *               a Guest or an INACTIVE account never; a hidden or floored
 *               Goals app only once the engine enforces app gates
 *   sop_folder  none: no SOP page or route reads the app row
 *   team        none here: Settings > Members, whose door the team writer
 *               checks itself
 */
async function appOpen(kind: ObjectShareKind): Promise<boolean> {
  if (kind === "tool") return !("error" in (await requireApp("tools")));
  if (kind === "goal") {
    const { viewerFromSession, can } = await import("../index");
    const viewer = await viewerFromSession();
    if (!viewer) return false;
    const decision = await can(viewer, "view", { type: "app", key: "goals" });
    if (decision.allowed) return true;
    if (!decision.discoverable) return false;
    return settingsGateMode({ resolver: accessV2Resolver(), logOnly: settingsGateLogOnly() }) !== "engine";
  }
  return true;
}

/** Is this kind's app open to the person asking? (The Access requests card offers a grant only then.) */
export async function objectAppOpen(kind: ObjectShareKind): Promise<boolean> {
  return appOpen(kind).catch(() => false);
}

async function adapterOf(kind: ObjectShareKind): Promise<Adapter> {
  if (!(await appOpen(kind))) throw new GrantError("not_found");
  return ADAPTERS[kind];
}

/** Null when the viewer cannot open who has access here (the route's 404). */
export async function objectAccessPanel(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string): Promise<AccessPanel | null> {
  if (!(await appOpen(kind))) return null;
  return ADAPTERS[kind].panel(ctx, id);
}

export async function setObjectGrant(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string, body: GrantWriteBody): Promise<GrantWriteResult> {
  return (await adapterOf(kind)).set(ctx, id, body);
}

export async function removeObjectGrant(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult> {
  return (await adapterOf(kind)).remove(ctx, id, input);
}

export async function checkObjectAccess(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string, userId: string): Promise<ObjectCheckResult> {
  if (!(await appOpen(kind))) return "not_found";
  return ADAPTERS[kind].check(ctx, id, userId);
}
