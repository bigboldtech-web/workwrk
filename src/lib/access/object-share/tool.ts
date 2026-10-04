// The one dialog on a tool (batch 7; spec-tools-misc section 2.1), over
// ToolShare and its role (prisma/sql/2026-10-04-tool-share-role.sql), the
// store every tool route reads (src/lib/tools/tool-access.ts). Served only
// while ACCESS_V2_TABLES is on (common.ts), which is also the only time a
// share's role is read: with the flag off every share is Can view.
//
//   roles      Full access (also share and delete it), Can edit (the fields
//              and the saved login), Can view (the tool and its login)
//   who sees   anyone who can see the tool (tool-access.ts canSeeTool)
//   who shares whoever manages it (a manager who added it, or an Owner,
//              Admin, Executive or the People team) and anyone holding a
//              Full access share; never an Agent; never above their own role
//   the owner  the person who added it keeps Full access while their
//              workspace role manages tools, and is pinned; added by someone
//              whose role no longer does, they see it and nothing more, and
//              the row says so and takes a share like anyone's
//   writes     one row at a time in a transaction that locks the tool row,
//              with the role the dialog showed checked (409 when it moved),
//              and an access activity row

import { prisma } from "@/lib/prisma";
import { legacyIsManagerLevel } from "../legacy-levels";
import { GrantError } from "../grants";
import {
  ACCESS_NODE_NOUN, ROLES_BY_KIND, shareRoleLabel,
  type AccessDirectEntry, type AccessPanel, type GrantChange, type GrantWriteBody, type GrantWriteResult, type PanelRole,
} from "../access-panel";
import {
  NO_GENERAL, USER_SELECT, answerRequests, notifyObjectGrantee, objectActivity, orgAdminCount, orgNameOf, personOf, rank,
  targetInOrg, type ObjectShareCtx, type Tx,
} from "./common";
import {
  canManageTool, canShareTool, storedToolShareRole, toolShareRole, toolViewerRole, type ToolRole, type ToolViewer,
} from "@/lib/tools/tool-access";

const KIND = "tool" as const;

/** The four levels the Tools list has always treated as tool admins (legacy-session.ts). */
const TOOL_ADMIN_LEVELS: ReadonlySet<string> = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "HR"]);

const hrefOf = (id: string) => `/tools?tool=${encodeURIComponent(id)}`;

function toolViewerOf(userId: string, accessLevel: string): ToolViewer {
  return { userId, toolAdmin: TOOL_ADMIN_LEVELS.has(accessLevel), isManager: legacyIsManagerLevel(accessLevel), isAgent: accessLevel === "AGENT" };
}

const viewerOf = (ctx: ObjectShareCtx) => toolViewerOf(ctx.userId, ctx.accessLevel);

const OWNER_DEMOTED_NOTE = "Added this tool. Their workspace role no longer changes tools, so they see it and its login only.";
const OWNER_SHARED_NOTE = "Added this tool. Their workspace role no longer changes tools, so this role decides what they can do.";
const TOOL_ADMIN_NOTE = "Full access anyway: their workspace role manages every tool.";

type ToolRow = { id: string; name: string; addedBy: string };

async function loadTool(db: Tx | typeof prisma, organizationId: string, id: string): Promise<ToolRow | null> {
  return db.tool.findFirst({ where: { id, organizationId }, select: { id: true, name: true, addedBy: true } });
}

async function shareRoleOf(db: Tx | typeof prisma, toolId: string, userId: string): Promise<ToolRole | null> {
  const row = await db.toolShare.findUnique({ where: { toolId_userId: { toolId, userId } }, select: { role: true } });
  return toolShareRole(row, true);
}

export async function toolPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  const tool = await loadTool(prisma, ctx.organizationId, id);
  if (!tool) return null;
  const viewer = viewerOf(ctx);
  const mine = await shareRoleOf(prisma, id, ctx.userId);
  const role = toolViewerRole(viewer, tool, mine);
  // Someone who cannot see the tool never learns it exists.
  if (!role) return null;
  const canManage = canShareTool(viewer, tool, mine);
  const maxGrant: PanelRole | null = canManage ? "FULL" : null;

  const [shares, owner] = await Promise.all([
    prisma.toolShare.findMany({ where: { toolId: id }, select: { userId: true, role: true, sharedAt: true }, orderBy: { sharedAt: "asc" } }),
    prisma.user.findFirst({ where: { id: tool.addedBy, organizationId: ctx.organizationId, deletedAt: null }, select: { ...USER_SELECT, accessLevel: true } }),
  ]);
  const users = shares.length
    ? await prisma.user.findMany({ where: { id: { in: shares.map((s) => s.userId) }, organizationId: ctx.organizationId, deletedAt: null }, select: { ...USER_SELECT, accessLevel: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const direct: AccessDirectEntry[] = [];
  const ownerManages = !!owner && canManageTool(toolViewerOf(owner.id, String(owner.accessLevel)), tool);
  if (owner && ownerManages) {
    direct.push({ person: personOf(owner), role: "FULL", owner: true, source: "Owner", editable: false, removable: false, lastFull: false, cap: false, alsoVia: null });
  }
  for (const s of shares) {
    const u = byId.get(s.userId);
    if (!u || (ownerManages && s.userId === tool.addedBy)) continue;
    const shareRole = toolShareRole(s, true) ?? "VIEW";
    const entry: AccessDirectEntry = {
      person: personOf(u),
      role: shareRole,
      owner: false,
      source: "ToolShare",
      editable: canManage,
      removable: canManage,
      lastFull: false,
      cap: false,
      alsoVia: null,
    };
    if (s.userId === tool.addedBy) entry.note = OWNER_SHARED_NOTE;
    else if (shareRole !== "FULL" && canManageTool(toolViewerOf(u.id, String(u.accessLevel)), tool)) entry.note = TOOL_ADMIN_NOTE;
    direct.push(entry);
  }
  // Added by someone whose role no longer changes tools, with no share: they
  // see it as its maker. Giving them a role writes a share like anyone's.
  if (owner && !ownerManages && !shares.some((s) => s.userId === tool.addedBy)) {
    direct.push({ person: personOf(owner), role: "VIEW", owner: false, source: "Owner", editable: canManage, removable: false, lastFull: false, cap: false, alsoVia: null, note: OWNER_DEMOTED_NOTE });
  }
  direct.sort((a, b) => Number(b.owner) - Number(a.owner) || rank(b.role) - rank(a.role) || a.person.name.localeCompare(b.person.name));

  const [orgName, adminCount] = await Promise.all([orgNameOf(ctx.organizationId), orgAdminCount(ctx.organizationId)]);
  return {
    node: { kind: KIND, id: tool.id, name: tool.name, noun: ACCESS_NODE_NOUN[KIND], href: hrefOf(tool.id), space: null, notepadOwner: null },
    viewer: { role, canManage, maxGrant, isAgent: ctx.isAgent },
    roles: ROLES_BY_KIND[KIND],
    general: NO_GENERAL,
    direct,
    inherited: [],
    inheritedMore: [],
    hiddenInherited: [],
    everyone: null,
    admins: { count: adminCount },
    notes: ["Executives and the People team also have Full access to every tool."],
    orgName,
    grantsAvailable: true,
  };
}

async function freshPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  return toolPanel(ctx, id).catch(() => null);
}

/** The actor's right to change who has access, read inside the transaction from the locked tool row. */
async function actorGate(tx: Tx, ctx: ObjectShareCtx, id: string): Promise<ToolRow> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Tool" WHERE id = ${id} AND "organizationId" = ${ctx.organizationId} FOR UPDATE`;
  if (locked.length === 0) throw new GrantError("not_found");
  const tool = await loadTool(tx, ctx.organizationId, id);
  if (!tool) throw new GrantError("not_found");
  const viewer = viewerOf(ctx);
  const mine = await shareRoleOf(tx, id, ctx.userId);
  if (!toolViewerRole(viewer, tool, mine)) throw new GrantError("not_found");
  if (!canShareTool(viewer, tool, mine)) throw new GrantError("forbidden");
  return tool;
}

/** The maker while their role still changes tools: pinned at Full access. */
async function ownerPinned(tx: Tx, organizationId: string, tool: ToolRow, userId: string): Promise<boolean> {
  if (userId !== tool.addedBy) return false;
  const u = await targetInOrg(tx, organizationId, userId);
  return !!u && canManageTool(toolViewerOf(u.id, u.accessLevel), tool);
}

async function withFreshPanel<T>(ctx: ObjectShareCtx, id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GrantError && err.code === "conflict") err.panel = await freshPanel(ctx, id);
    throw err;
  }
}

export async function setToolGrant(ctx: ObjectShareCtx, id: string, body: GrantWriteBody): Promise<GrantWriteResult> {
  const role = body.role;
  if (role !== "FULL" && role !== "EDIT" && role !== "VIEW") throw new GrantError("invalid_role");
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const tool = await actorGate(tx, ctx, id);
      if (!(await targetInOrg(tx, ctx.organizationId, body.userId))) throw new GrantError("not_in_org");
      if (await ownerPinned(tx, ctx.organizationId, tool, body.userId)) throw new GrantError("owner_fixed");
      const cur = await tx.toolShare.findUnique({ where: { toolId_userId: { toolId: id, userId: body.userId } }, select: { role: true } });
      const curRole = toolShareRole(cur, true);
      if (body.expected !== undefined && (body.expected ?? null) !== curRole) throw new GrantError("conflict");
      const mode = body.mode ?? "set";
      if (curRole && (curRole === role || (mode === "raise" && rank(curRole) >= rank(role)))) {
        return { noChange: true, previousRole: curRole, role: curRole, how: "none" as const };
      }
      const stored = storedToolShareRole(role);
      await tx.toolShare.upsert({
        where: { toolId_userId: { toolId: id, userId: body.userId } },
        create: { toolId: id, userId: body.userId, sharedBy: ctx.userId, role: stored },
        update: { role: stored },
      });
      await objectActivity(tx, ctx, KIND, id, curRole ? "access.role_changed" : "access.granted", {
        granteeId: body.userId, role, previousRole: curRole, store: "ToolShare",
      });
      const how = !curRole ? ("shared" as const) : rank(role) > rank(curRole) ? ("upgraded" as const) : ("none" as const);
      return { noChange: false, previousRole: curRole, role, how };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  if (!out.noChange) {
    if (out.how !== "none" && panel) await notifyObjectGrantee(ctx, KIND, { id, name: panel.node.name, href: panel.node.href }, body.userId, role, out.how);
    await answerRequests(ctx, KIND, id, body.userId, role);
  }
  const change: GrantChange = { userId: body.userId, role: out.role, previousRole: out.previousRole, noChange: out.noChange, stillReaches: null, keepsInside: [] };
  return { panel, change };
}

export async function removeToolGrant(ctx: ObjectShareCtx, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult> {
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const tool = await actorGate(tx, ctx, id);
      if (await ownerPinned(tx, ctx.organizationId, tool, input.userId)) throw new GrantError("owner_fixed");
      const cur = await tx.toolShare.findUnique({ where: { toolId_userId: { toolId: id, userId: input.userId } }, select: { role: true } });
      const curRole = toolShareRole(cur, true);
      if (input.expected !== undefined && (input.expected ?? null) !== curRole) throw new GrantError("conflict");
      // Removing a share that is not there changed nothing: a retry is a success.
      if (!curRole) return { noChange: true, previousRole: null, still: null as ToolRole | null };
      await tx.toolShare.delete({ where: { toolId_userId: { toolId: id, userId: input.userId } } });
      await objectActivity(tx, ctx, KIND, id, "access.revoked", { granteeId: input.userId, role: null, previousRole: curRole, store: "ToolShare" });
      // What they keep without the share: their maker's view, or a tool admin's reach.
      const target = await targetInOrg(tx, ctx.organizationId, input.userId);
      const still = target ? toolViewerRole(toolViewerOf(target.id, target.accessLevel), tool, null) : null;
      return { noChange: false, previousRole: curRole, still };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  const stillReaches = out.still
    ? { role: out.still, via: out.still === "FULL" ? ({ type: "org_admin" as const, orgName: panel?.orgName ?? "" }) : ({ type: "owner" as const }) }
    : null;
  const change: GrantChange = { userId: input.userId, role: null, previousRole: out.previousRole, noChange: out.noChange, stillReaches, keepsInside: [] };
  return { panel, change };
}

/** Check access: what one person can do with this tool, and why. */
export async function checkToolAccess(
  ctx: ObjectShareCtx,
  id: string,
  userId: string,
): Promise<{ userId: string; name: string; role: string; sentence: string } | "not_found" | "forbidden" | "not_in_org"> {
  const tool = await loadTool(prisma, ctx.organizationId, id);
  if (!tool) return "not_found";
  const viewer = viewerOf(ctx);
  const mine = await shareRoleOf(prisma, id, ctx.userId);
  if (!toolViewerRole(viewer, tool, mine)) return "not_found";
  if (!canShareTool(viewer, tool, mine)) return "forbidden";
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId: ctx.organizationId, deletedAt: null }, select: { firstName: true, lastName: true, email: true, accessLevel: true } });
  if (!person) return "not_in_org";
  const name = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email;
  const tv = toolViewerOf(userId, String(person.accessLevel));
  const share = await shareRoleOf(prisma, id, userId);
  const role = toolViewerRole(tv, tool, share);
  const label = (r: PanelRole) => shareRoleLabel(KIND, r);
  if (!role) return { userId, name, role: "none", sentence: "No access. This tool is not shared with them." };
  if (canManageTool(tv, tool)) {
    const why = userId === tool.addedBy ? "They added this tool." : "Their workspace role manages every tool.";
    return { userId, name, role: "FULL", sentence: `${label("FULL")}. ${why}` };
  }
  if (tv.isAgent && share === "FULL") return { userId, name, role: "EDIT", sentence: `${label("EDIT")}. Shared with them at Full access, and an Agent never shares or deletes.` };
  if (share) return { userId, name, role, sentence: `${label(role)}. Shared with them directly.` };
  return { userId, name, role, sentence: `${label(role)}. They added this tool, and their workspace role no longer changes tools.` };
}
