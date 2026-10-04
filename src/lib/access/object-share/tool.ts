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
  type AccessDirectEntry, type AccessPanel, type AccessVia, type GrantChange, type GrantWriteBody, type GrantWriteResult, type PanelRole,
} from "../access-panel";
import {
  NO_GENERAL, USER_SELECT, answerRequests, notifyObjectGrantee, objectActivity, orgAdminCount, orgNameOf, personOf, rank,
  targetInOrg, type ObjectShareCtx, type Tx,
} from "./common";
import { APP_CLOSED_NOTE, DOOR_SENTENCE, MAKER_APP_CLOSED_NOTE, appDoorFor, appLimited, appOpenFor } from "./app-door";
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
const AGENT_FULL_NOTE = "An Agent never shares or deletes, so this works as Can edit.";

/**
 * Where a person's Full access by level comes from, in words: an Owner or
 * Admin, or a member type that manages every tool (Executive, People team).
 * An Executive is not an Admin, so they are never called one.
 */
function levelVia(accessLevel: string, orgName: string): AccessVia {
  return accessLevel === "SUPER_ADMIN" || accessLevel === "COMPANY_ADMIN"
    ? { type: "org_admin", orgName }
    : { type: "rule", text: "through their member type, which manages every tool" };
}

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
  const orgName = await orgNameOf(ctx.organizationId);
  // With the Tools app limited in Settings, Apps, a share gives nothing to a
  // person the app keeps out: asked per person only then (round 3).
  const limited = await appLimited(ctx.organizationId, "tool");
  const closedTo = async (userId: string) => limited && (await appDoorFor(ctx.organizationId, userId, "tool")) === "closed";

  const direct: AccessDirectEntry[] = [];
  const ownerManages = !!owner && canManageTool(toolViewerOf(owner.id, String(owner.accessLevel)), tool);
  if (owner && ownerManages) {
    const entry: AccessDirectEntry = { person: personOf(owner), role: "FULL", owner: true, source: "Owner", editable: false, removable: false, lastFull: false, cap: false, alsoVia: null };
    if (await closedTo(owner.id)) entry.note = MAKER_APP_CLOSED_NOTE;
    direct.push(entry);
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
    const level = String(u.accessLevel);
    // Full access by member type whatever the share says: said beside the row
    // (and the viewer's own removal is no loss of the right to share).
    const closed = await closedTo(u.id);
    if (!closed && entry.person.active && canManageTool(toolViewerOf(u.id, level), tool)) entry.alsoVia = { role: "FULL", via: levelVia(level, orgName) };
    if (closed) entry.note = APP_CLOSED_NOTE.tool;
    else if (s.userId === tool.addedBy) entry.note = OWNER_SHARED_NOTE;
    else if (level === "AGENT" && shareRole === "FULL") entry.note = AGENT_FULL_NOTE;
    direct.push(entry);
  }
  // Added by someone whose role no longer changes tools, with no share: they
  // see it as its maker. Giving them a role writes a share like anyone's.
  if (owner && !ownerManages && !shares.some((s) => s.userId === tool.addedBy)) {
    const note = (await closedTo(owner.id)) ? MAKER_APP_CLOSED_NOTE : OWNER_DEMOTED_NOTE;
    direct.push({ person: personOf(owner), role: "VIEW", owner: false, source: "Owner", editable: canManage, removable: false, lastFull: false, cap: false, alsoVia: null, note });
  }
  direct.sort((a, b) => Number(b.owner) - Number(a.owner) || rank(b.role) - rank(a.role) || a.person.name.localeCompare(b.person.name));

  // Who holds a share is for the people who manage the tool, as GET
  // /api/tools and /api/tools/[id] keep it (everyone else gets a count): a
  // Can view or Can edit holder sees the maker, themselves and how many more.
  let shown = direct;
  let hiddenShares = 0;
  if (!canManage) {
    shown = direct.filter((d) => d.source === "Owner" || d.person.id === ctx.userId || d.person.id === tool.addedBy);
    hiddenShares = direct.length - shown.length;
    // What became of the maker's workspace role is not theirs to read (the
    // tool routes name the maker only): to everyone else the maker "added it".
    shown = shown.map((d) => (d.person.id === tool.addedBy && d.person.id !== ctx.userId && d.note ? { ...d, note: "Added this tool." } : d));
  }

  const adminCount = await orgAdminCount(ctx.organizationId);
  return {
    node: { kind: KIND, id: tool.id, name: tool.name, noun: ACCESS_NODE_NOUN[KIND], href: hrefOf(tool.id), space: null, notepadOwner: null },
    viewer: { role, canManage, maxGrant, isAgent: ctx.isAgent },
    roles: ROLES_BY_KIND[KIND],
    general: NO_GENERAL,
    direct: shown,
    inherited: [],
    inheritedMore: [],
    hiddenInherited: [],
    everyone: null,
    admins: { count: adminCount },
    notes: [
      ...(hiddenShares > 0 ? [`Shared with ${hiddenShares} more ${hiddenShares === 1 ? "person" : "people"}. Only the people who manage this tool see who.`] : []),
      // By member type, as the tool gates read it (tool-access.ts), not the People team list.
      limited
        ? "Anyone whose member type is Executive or People team also has Full access to every tool, where the Tools app is open to them."
        : "Anyone whose member type is Executive or People team also has Full access to every tool.",
    ],
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
      const target = await targetInOrg(tx, ctx.organizationId, body.userId);
      if (!target) throw new GrantError("not_in_org");
      if (await ownerPinned(tx, ctx.organizationId, tool, body.userId)) throw new GrantError("owner_fixed");
      // The person's own row, locked: an older route writes these rows
      // without the object's lock, so the row judged is the row written.
      const [cur] = await tx.$queryRaw<{ role: string | null }[]>`SELECT "role" FROM "ToolShare" WHERE "toolId" = ${id} AND "userId" = ${body.userId} FOR UPDATE`;
      const curRole = toolShareRole(cur, true);
      // The role the dialog shows: a maker whose role no longer changes tools
      // reads Can view with no share (the pinned maker was refused above).
      const shown: PanelRole | null = curRole ?? (body.userId === tool.addedBy ? "VIEW" : null);
      if (body.expected !== undefined && (body.expected ?? null) !== shown) throw new GrantError("conflict");
      const mode = body.mode ?? "set";
      if (shown && (shown === role || (mode === "raise" && rank(shown) >= rank(role)))) {
        return { noChange: true, previousRole: shown, role: shown, how: "none" as const };
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
      // The role they work at: an Agent never shares or deletes, so Full
      // access is Can edit for it, and a raise that changes nothing it can
      // do is told to nobody. The maker already saw it: an upgrade, not a share.
      const works = (r: PanelRole | null) => (r && target.accessLevel === "AGENT" && r === "FULL" ? "EDIT" : r);
      const how = !shown ? ("shared" as const) : rank(works(role)) > rank(works(shown)) ? ("upgraded" as const) : ("none" as const);
      return { noChange: false, previousRole: curRole, role, how, worksAt: works(role) ?? role };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  if (!out.noChange) {
    // Nobody is told of a share their Tools app keeps them out of.
    if (out.how !== "none" && panel && (await appOpenFor(ctx.organizationId, body.userId, "tool"))) {
      await notifyObjectGrantee(ctx, KIND, { id, name: panel.node.name, href: panel.node.href }, body.userId, "worksAt" in out ? out.worksAt : role, out.how);
    }
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
      // The person's own row, locked: an older route writes these rows
      // without the object's lock, so the row judged is the row written.
      const [cur] = await tx.$queryRaw<{ role: string | null }[]>`SELECT "role" FROM "ToolShare" WHERE "toolId" = ${id} AND "userId" = ${input.userId} FOR UPDATE`;
      const curRole = toolShareRole(cur, true);
      // Removing a share that is not there changed nothing: a retry is a
      // success, whatever role the retry still names.
      if (!curRole) return { noChange: true, previousRole: null, still: null as ToolRole | null, level: null as string | null };
      if (input.expected !== undefined && (input.expected ?? null) !== curRole) throw new GrantError("conflict");
      await tx.toolShare.delete({ where: { toolId_userId: { toolId: id, userId: input.userId } } });
      await objectActivity(tx, ctx, KIND, id, "access.revoked", { granteeId: input.userId, role: null, previousRole: curRole, store: "ToolShare" });
      // What they keep without the share: their maker's view, or a tool admin's reach.
      const target = await targetInOrg(tx, ctx.organizationId, input.userId);
      const still = target ? toolViewerRole(toolViewerOf(target.id, target.accessLevel), tool, null) : null;
      return { noChange: false, previousRole: curRole, still, level: target?.accessLevel ?? null };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  // Full access left means a member type that manages every tool (an Admin is
  // named as one, an Executive is not); anything less is the maker's view.
  // Said only while the Tools app lets them in (a floor, a deactivated
  // account): the same door their row and Check access ask.
  const keeps = out.still && (await appDoorFor(ctx.organizationId, input.userId, "tool")) === "open";
  const stillReaches = keeps && out.still
    ? { role: out.still, via: out.still === "FULL" && out.level ? levelVia(out.level, panel?.orgName ?? await orgNameOf(ctx.organizationId)) : ({ type: "owner" as const }) }
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
  const share = await shareRoleOf(prisma, id, userId);
  // Someone who may not read member types (not an Admin or a tool admin)
  // learns nothing from a person the tool does not name: their level would
  // come out of the rules (the directory keeps levels from them too).
  if (!ctx.orgAdmin && !TOOL_ADMIN_LEVELS.has(ctx.accessLevel) && userId !== tool.addedBy && share === null) {
    return { userId, name, role: "unknown", sentence: "Not shared with them. Their workspace role may still reach every tool." };
  }
  // A share gives nothing to someone the Tools app keeps out.
  const door = await appDoorFor(ctx.organizationId, userId, "tool");
  if (door !== "open") return { userId, name, role: "none", sentence: DOOR_SENTENCE.tool[door] };
  const tv = toolViewerOf(userId, String(person.accessLevel));
  const role = toolViewerRole(tv, tool, share);
  const label = (r: PanelRole) => shareRoleLabel(KIND, r);
  if (!role) return { userId, name, role: "none", sentence: "No access. This tool is not shared with them." };
  if (canManageTool(tv, tool)) {
    const level = String(person.accessLevel);
    const why = userId === tool.addedBy ? "They added this tool." : level === "SUPER_ADMIN" || level === "COMPANY_ADMIN" ? "They are an Owner or Admin." : "Their member type manages every tool.";
    return { userId, name, role: "FULL", sentence: `${label("FULL")}. ${why}` };
  }
  if (tv.isAgent && share === "FULL") return { userId, name, role: "EDIT", sentence: `${label("EDIT")}. Shared with them at Full access, and an Agent never shares or deletes.` };
  if (share) return { userId, name, role, sentence: `${label(role)}. Shared with them directly.` };
  return { userId, name, role, sentence: `${label(role)}. They added this tool, and their workspace role no longer changes tools.` };
}

/** What this person holds on the tool now (the role its gates give them), or null: what a request answer is measured against. */
export async function toolHeldRole(organizationId: string, toolId: string, userId: string): Promise<PanelRole | null> {
  const [tool, person] = await Promise.all([
    loadTool(prisma, organizationId, toolId),
    prisma.user.findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { accessLevel: true } }),
  ]);
  if (!tool || !person) return null;
  return toolViewerRole(toolViewerOf(userId, String(person.accessLevel)), tool, await shareRoleOf(prisma, toolId, userId));
}
