// The one dialog's objects beside the nodes (batch 7), dispatched by kind.
// The API routes call these for an ObjectShareKind, and only while
// objectShareOn(): with ACCESS_V2_TABLES off they answer 404 and never get here.

import type { AccessPanel, GrantWriteBody, GrantWriteResult, ObjectShareKind, PanelRole } from "../access-panel";
import type { AppKey } from "../types";
import { GrantError } from "../grants";
import { requireApp } from "@/lib/app-gate";
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
 * The app each kind lives in. Its own page gates on that app row (hidden,
 * floored, Guests, INACTIVE), so the dialog's door does too: a tool, a goal
 * or an SOP folder is "not there" for whoever the app refuses. A team lives
 * in Settings > Members, whose door the team writer checks itself.
 */
const APP_OF: Readonly<Partial<Record<ObjectShareKind, AppKey>>> = { tool: "tools", goal: "goals", sop_folder: "sops" };

async function appOpen(kind: ObjectShareKind): Promise<boolean> {
  const key = APP_OF[kind];
  if (!key) return true;
  return !("error" in (await requireApp(key)));
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
