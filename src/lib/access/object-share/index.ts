// The one dialog's objects beside the nodes (batch 7), dispatched by kind.
// The API routes call these for an ObjectShareKind, and only while
// objectShareOn(): with ACCESS_V2_TABLES off they answer 404 and never get here.

import type { AccessPanel, GrantWriteBody, GrantWriteResult, ObjectShareKind, PanelRole } from "../access-panel";
import { GrantError } from "../grants";
import type { ObjectShareCtx } from "./common";
import { checkSopFolderAccess, removeSopFolderGrant, setSopFolderGrant, sopFolderPanel } from "./sop-folder";
import { checkToolAccess, removeToolGrant, setToolGrant, toolPanel } from "./tool";

export { objectShareCtxFromSession, objectShareOn, type ObjectShareCtx } from "./common";

export type ObjectCheckResult = { userId: string; name: string; role: string; sentence: string } | "not_found" | "forbidden" | "not_in_org";

interface Adapter {
  panel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null>;
  set(ctx: ObjectShareCtx, id: string, body: GrantWriteBody): Promise<GrantWriteResult>;
  remove(ctx: ObjectShareCtx, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult>;
  check(ctx: ObjectShareCtx, id: string, userId: string): Promise<ObjectCheckResult>;
}

const ADAPTERS: Partial<Record<ObjectShareKind, Adapter>> = {
  sop_folder: { panel: sopFolderPanel, set: setSopFolderGrant, remove: removeSopFolderGrant, check: checkSopFolderAccess },
  tool: { panel: toolPanel, set: setToolGrant, remove: removeToolGrant, check: checkToolAccess },
};

function adapterOf(kind: ObjectShareKind): Adapter {
  const a = ADAPTERS[kind];
  if (!a) throw new GrantError("not_found");
  return a;
}

/** Null when the viewer cannot open who has access here (the route's 404). */
export async function objectAccessPanel(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string): Promise<AccessPanel | null> {
  const a = ADAPTERS[kind];
  return a ? a.panel(ctx, id) : null;
}

export async function setObjectGrant(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string, body: GrantWriteBody): Promise<GrantWriteResult> {
  return adapterOf(kind).set(ctx, id, body);
}

export async function removeObjectGrant(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult> {
  return adapterOf(kind).remove(ctx, id, input);
}

export async function checkObjectAccess(ctx: ObjectShareCtx, kind: ObjectShareKind, id: string, userId: string): Promise<ObjectCheckResult> {
  const a = ADAPTERS[kind];
  return a ? a.check(ctx, id, userId) : "not_found";
}
