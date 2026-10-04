// The one dialog on an SOP folder (batch 7; access-model-spec sections 6.1
// and 14, Broken #21), over SOPFolderAccess, the store every SOP gate reads
// (src/lib/sop-access.ts: sopVisibilityWhere, folderGrantRole,
// canWriteToFolder). Served only while ACCESS_V2_TABLES is on (common.ts).
//
//   roles      Full access, Can edit, Can view: OWNER, EDITOR, VIEWER
//   who sees   an org admin, and anyone holding a role on the folder or on a
//              folder above it (grants cascade down the tree)
//   who shares an org admin, and anyone with Full access on the folder or on a
//              folder above it, which is what OWNER always promised and the
//              admin-only access route never let them do (Broken #21); never
//              an Agent; never above their own role
//   writes     one row at a time in a transaction that locks the folder row,
//              with the role the dialog showed checked (409 when it moved),
//              and an access activity row; never the replace-all PATCH
//
// A Can edit row tells the truth about the workspace role too: someone whose
// role cannot edit SOPs reads the folder's drafts but cannot save them.

import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/api-helpers";
import { RULE_1_DENIED_STATUSES } from "../resolve";
import type { SOPFolderRole } from "@/generated/prisma";
import { GrantError } from "../grants";
import {
  ACCESS_NODE_NOUN, ROLES_BY_KIND, shareRoleLabel,
  type AccessDirectEntry, type AccessInheritedEntry, type AccessPanel, type AccessVia, type GrantChange, type GrantWriteBody,
  type GrantWriteResult, type PanelRole,
} from "../access-panel";
import {
  NO_GENERAL, USER_SELECT, answerRequests, notifyObjectGrantee, objectActivity, orgAdminCount, orgNameOf, personOf, rank,
  targetInOrg, type ObjectShareCtx, type Tx,
} from "./common";

const KIND = "sop_folder" as const;
const INHERITED_PER_VIA = 20;

const ROLE_OF: Readonly<Record<SOPFolderRole, PanelRole>> = { OWNER: "FULL", EDITOR: "EDIT", VIEWER: "VIEW" };
const STORED_OF: Readonly<Partial<Record<PanelRole, SOPFolderRole>>> = { FULL: "OWNER", EDIT: "EDITOR", VIEW: "VIEWER" };

type ChainRow = { id: string; name: string; parentId: string | null };

const hrefOf = (id: string) => `/sops?folderId=${encodeURIComponent(id)}`;

/** The folder and every folder above it, nearest first. A loop in the tree (never on sane data) stops at 50. */
async function chainOf(db: Tx | typeof prisma, organizationId: string, folderId: string): Promise<ChainRow[]> {
  return db.$queryRaw<ChainRow[]>`
    WITH RECURSIVE chain AS (
      SELECT id, name, "parentId", 0 AS depth FROM "SOPFolder" WHERE id = ${folderId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT f.id, f.name, f."parentId", c.depth + 1 FROM "SOPFolder" f JOIN chain c ON f.id = c."parentId"
      WHERE c.depth < 50 AND f."organizationId" = ${organizationId}
    )
    SELECT id, name, "parentId" FROM chain ORDER BY depth`;
}

type AccessRow = { folderId: string; userId: string; role: SOPFolderRole };

/** The role a person holds at chain position `from` (that folder or above): grants cascade down. */
function roleFrom(rows: readonly AccessRow[], chain: readonly ChainRow[], from: number, userId: string): { role: PanelRole; at: number } | null {
  let best: { role: PanelRole; at: number } | null = null;
  for (let i = from; i < chain.length; i++) {
    for (const r of rows) {
      if (r.userId !== userId || r.folderId !== chain[i].id) continue;
      const role = ROLE_OF[r.role];
      // The strongest wins; on a tie the nearest folder names it.
      if (!best || rank(role) > rank(best.role)) best = { role, at: i };
    }
  }
  return best;
}

function viewerRoleAt(ctx: ObjectShareCtx, rows: readonly AccessRow[], chain: readonly ChainRow[], at: number): PanelRole | null {
  if (ctx.orgAdmin) return "FULL";
  return roleFrom(rows, chain, at, ctx.userId)?.role ?? null;
}

const managesWith = (ctx: ObjectShareCtx, role: PanelRole | null) => !ctx.isAgent && (ctx.orgAdmin || role === "FULL");

async function editsSops(userId: string, organizationId: string, accessLevel: string): Promise<boolean> {
  return hasPermission({ user: { id: userId, organizationId, accessLevel } }, "sops", "edit").catch(() => true);
}

const NO_SOP_EDIT_NOTE = "Their workspace role can't edit SOPs: they read the drafts here but can't save changes.";
const ADMIN_LEVELS: ReadonlySet<string> = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);
const AGENT_OWNER_NOTE = "An Agent never changes who can open a folder, so this works as Can edit.";
const AGENT_OWNER_NO_EDIT_NOTE = "An Agent never changes who can open a folder, and its workspace role can't edit SOPs: it reads the drafts here but can't save changes.";

/** The caveat a role at this folder carries for this person: the Agent rule and the workspace-role rule, together. */
async function roleNote(userId: string, organizationId: string, level: string, role: PanelRole): Promise<string | undefined> {
  if (rank(role) < rank("EDIT")) return undefined;
  const edits = await editsSops(userId, organizationId, level);
  if (level === "AGENT" && rank(role) >= rank("FULL")) return edits ? AGENT_OWNER_NOTE : AGENT_OWNER_NO_EDIT_NOTE;
  return edits ? undefined : NO_SOP_EDIT_NOTE;
}

/** A folder above this one, named only when the viewer can open it; else "a place you cannot open". */
function viaAt(ctx: ObjectShareCtx, rows: readonly AccessRow[], chain: readonly ChainRow[], at: number): AccessVia {
  if (!ctx.orgAdmin && !viewerRoleAt(ctx, rows, chain, at)) return { type: "hidden" };
  return { type: "node", kind: KIND, id: chain[at].id, name: chain[at].name, href: hrefOf(chain[at].id), canManage: managesWith(ctx, viewerRoleAt(ctx, rows, chain, at)) };
}

export async function sopFolderPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  const chain = await chainOf(prisma, ctx.organizationId, id);
  if (chain.length === 0) return null;
  const folder = chain[0];
  const rows = await prisma.sOPFolderAccess.findMany({
    where: { folderId: { in: chain.map((c) => c.id) } },
    select: { folderId: true, userId: true, role: true, user: { select: { ...USER_SELECT, accessLevel: true } } },
  });
  const live = rows.filter((r) => r.user && !r.user.deletedAt);
  const viewerRole = viewerRoleAt(ctx, live, chain, 0);
  // Only someone who holds a role here, or an admin, reads who has access.
  if (!viewerRole) return null;
  const canManage = managesWith(ctx, viewerRole);
  const maxGrant: PanelRole | null = canManage ? (ctx.orgAdmin ? "FULL" : viewerRole) : null;

  const viaFor = (at: number): AccessVia => viaAt(ctx, live, chain, at);
  const levelOf = new Map(live.map((r) => [r.userId, String(r.user.accessLevel)]));

  const people = new Map(live.map((r) => [r.userId, r.user]));
  const direct: AccessDirectEntry[] = [];
  for (const r of live.filter((x) => x.folderId === folder.id)) {
    const role = ROLE_OF[r.role];
    const above = roleFrom(live, chain, 1, r.userId);
    const editable = canManage && !!maxGrant && rank(role) <= rank(maxGrant);
    const self = r.userId === ctx.userId;
    // Another way in at this role or above. For the viewer's own row an equal
    // role counts too, so removing it is never called a loss of managing.
    // A deactivated account opens nothing, so it reaches nothing another way either.
    const active = personOf(r.user).active;
    let alsoVia: AccessDirectEntry["alsoVia"] = active && above && (rank(above.role) > rank(role) || (self && rank(above.role) >= rank(role))) ? { role: above.role, via: viaFor(above.at) } : null;
    // An Owner or Admin opens and changes every SOP folder, whatever their row says.
    if ((self && ctx.orgAdmin) || (active && ADMIN_LEVELS.has(String(r.user.accessLevel)))) alsoVia = { role: "FULL", via: { type: "org_admin", orgName: await orgNameOf(ctx.organizationId) } };
    const entry: AccessDirectEntry = {
      person: personOf(r.user),
      role,
      owner: false,
      source: "SOPFolderAccess",
      editable,
      removable: editable,
      lastFull: false,
      cap: false,
      alsoVia,
    };
    // The caveat follows the strongest role the row shows, its own or the one beside it.
    const shown = alsoVia && rank(alsoVia.role) > rank(role) ? alsoVia.role : role;
    const note = await roleNote(r.userId, ctx.organizationId, String(r.user.accessLevel), shown);
    if (note) entry.note = note;
    direct.push(entry);
  }
  direct.sort((a, b) => rank(b.role) - rank(a.role) || a.person.name.localeCompare(b.person.name));

  // From the folders above, for the people not listed here, grouped by the
  // folder their strongest role comes from (nearest first).
  const listed = new Set(direct.map((d) => d.person.id));
  const groups = new Map<number, AccessInheritedEntry[]>();
  for (const userId of new Set(live.map((r) => r.userId))) {
    if (listed.has(userId)) continue;
    const from = roleFrom(live, chain, 1, userId);
    const user = people.get(userId);
    if (!from || !user) continue;
    // The admins line speaks for Owners and Admins (as node-tree does), and a
    // deactivated account reaches no folder through the ones above it.
    if (ADMIN_LEVELS.has(levelOf.get(userId) ?? "") || !personOf(user).active) continue;
    const list = groups.get(from.at) ?? [];
    const entry: AccessInheritedEntry = { person: personOf(user), role: from.role, via: viaFor(from.at) };
    const note = await roleNote(userId, ctx.organizationId, levelOf.get(userId) ?? "EMPLOYEE", from.role);
    if (note) entry.note = note;
    list.push(entry);
    groups.set(from.at, list);
  }
  const inherited: AccessInheritedEntry[] = [];
  const inheritedMore: AccessPanel["inheritedMore"] = [];
  for (const at of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(at)!.sort((a, b) => rank(b.role) - rank(a.role) || a.person.name.localeCompare(b.person.name));
    inherited.push(...list.slice(0, INHERITED_PER_VIA));
    if (list.length > INHERITED_PER_VIA) inheritedMore.push({ via: viaFor(at), more: list.length - INHERITED_PER_VIA });
  }

  // Who else holds a role is for the people who manage the folder, as GET
  // /api/sop-folders/[id]/access keeps it (admins only there; Full access
  // here, Broken #21): everyone else sees their own row and a count.
  let shownDirect = direct;
  let shownInherited = inherited;
  let shownMore = inheritedMore;
  let others = 0;
  if (!canManage) {
    shownDirect = direct.filter((d) => d.person.id === ctx.userId);
    shownInherited = inherited.filter((e) => e.person.id === ctx.userId);
    shownMore = [];
    const everyone = new Set([...direct.map((d) => d.person.id), ...[...groups.values()].flat().map((e) => e.person.id)]);
    everyone.delete(ctx.userId);
    others = everyone.size;
  }

  const [orgName, adminCount] = await Promise.all([orgNameOf(ctx.organizationId), orgAdminCount(ctx.organizationId)]);
  return {
    node: { kind: KIND, id: folder.id, name: folder.name, noun: ACCESS_NODE_NOUN[KIND], href: hrefOf(folder.id), space: null, notepadOwner: null },
    viewer: { role: viewerRole, canManage, maxGrant, isAgent: ctx.isAgent },
    roles: ROLES_BY_KIND[KIND],
    general: NO_GENERAL,
    direct: shownDirect,
    inherited: shownInherited,
    inheritedMore: shownMore,
    hiddenInherited: [],
    everyone: null,
    admins: { count: adminCount },
    notes: [
      ...(others > 0 ? [`Shared with ${others} more ${others === 1 ? "person" : "people"}. Only the people who manage this folder see who.`] : []),
      `Everyone listed here also opens the folders inside ${folder.name}.`,
    ],
    orgName,
    grantsAvailable: true,
  };
}

async function freshPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  return sopFolderPanel(ctx, id).catch(() => null);
}

/** The actor's right to change who has access, read inside the transaction from the locked folder's chain. */
async function actorGate(tx: Tx, ctx: ObjectShareCtx, id: string): Promise<{ chain: ChainRow[]; maxGrant: PanelRole; mine: AccessRow[] }> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SOPFolder" WHERE id = ${id} AND "organizationId" = ${ctx.organizationId} FOR UPDATE`;
  if (locked.length === 0) throw new GrantError("not_found");
  const chain = await chainOf(tx, ctx.organizationId, id);
  const mine = await tx.sOPFolderAccess.findMany({ where: { userId: ctx.userId, folderId: { in: chain.map((c) => c.id) } }, select: { folderId: true, userId: true, role: true } });
  const role = viewerRoleAt(ctx, mine, chain, 0);
  if (!role) throw new GrantError("not_found");
  if (!managesWith(ctx, role)) throw new GrantError("forbidden");
  return { chain, maxGrant: ctx.orgAdmin ? "FULL" : role, mine };
}

async function withFreshPanel<T>(ctx: ObjectShareCtx, id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GrantError && err.code === "conflict") err.panel = await freshPanel(ctx, id);
    throw err;
  }
}

export async function setSopFolderGrant(ctx: ObjectShareCtx, id: string, body: GrantWriteBody): Promise<GrantWriteResult> {
  const role = body.role;
  const stored = STORED_OF[role];
  if (!stored || !ROLES_BY_KIND[KIND].includes(role)) throw new GrantError("invalid_role");
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const { maxGrant } = await actorGate(tx, ctx, id);
      if (rank(role) > rank(maxGrant)) throw new GrantError("above_own_role");
      const target = await targetInOrg(tx, ctx.organizationId, body.userId);
      if (!target) throw new GrantError("not_in_org");
      // The person's own row, locked: an older route writes these rows
      // without the object's lock, so the row judged is the row written.
      const [cur] = await tx.$queryRaw<{ role: SOPFolderRole }[]>`SELECT "role"::text AS role FROM "SOPFolderAccess" WHERE "folderId" = ${id} AND "userId" = ${body.userId} FOR UPDATE`;
      const curRole = cur ? ROLE_OF[cur.role] : null;
      if (body.expected !== undefined && (body.expected ?? null) !== curRole) throw new GrantError("conflict");
      // Nobody changes the access of someone who holds more than they may give.
      if (curRole && rank(curRole) > rank(maxGrant)) throw new GrantError("above_own_role");
      const mode = body.mode ?? "set";
      if (curRole && (curRole === role || (mode === "raise" && rank(curRole) >= rank(role)))) {
        return { noChange: true, previousRole: curRole, role: curRole, how: "none" as const };
      }
      await tx.sOPFolderAccess.upsert({
        where: { folderId_userId: { folderId: id, userId: body.userId } },
        create: { folderId: id, userId: body.userId, role: stored },
        update: { role: stored },
      });
      await objectActivity(tx, ctx, KIND, id, curRole ? "access.role_changed" : "access.granted", {
        granteeId: body.userId, role: stored, previousRole: cur?.role ?? null, store: "SOPFolderAccess",
      });
      // The role they work at: an Agent never changes who opens a folder, so
      // Full access is Can edit for it, and a raise that changes nothing it
      // can do is told to nobody.
      const works = (r: PanelRole | null) => (r && target.accessLevel === "AGENT" && r === "FULL" ? "EDIT" : r);
      const how = !curRole ? ("shared" as const) : rank(works(role)) > rank(works(curRole)) ? ("upgraded" as const) : ("none" as const);
      return { noChange: false, previousRole: curRole, role, how, worksAt: works(role) ?? role };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  if (!out.noChange) {
    if (out.how !== "none" && panel) await notifyObjectGrantee(ctx, KIND, { id, name: panel.node.name, href: panel.node.href }, body.userId, "worksAt" in out ? out.worksAt : role, out.how);
    await answerRequests(ctx, KIND, id, body.userId, role);
  }
  const change: GrantChange = { userId: body.userId, role: out.role, previousRole: out.previousRole, noChange: out.noChange, stillReaches: null, keepsInside: [] };
  return { panel, change };
}

export async function removeSopFolderGrant(ctx: ObjectShareCtx, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult> {
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const { chain, maxGrant, mine } = await actorGate(tx, ctx, id);
      // The person's own row, locked: an older route writes these rows
      // without the object's lock, so the row judged is the row written.
      const [cur] = await tx.$queryRaw<{ role: SOPFolderRole }[]>`SELECT "role"::text AS role FROM "SOPFolderAccess" WHERE "folderId" = ${id} AND "userId" = ${input.userId} FOR UPDATE`;
      const curRole = cur ? ROLE_OF[cur.role] : null;
      // Removing a row that is not there changed nothing: a retry is a
      // success, whatever role the retry still names.
      if (!cur || !curRole) return { noChange: true, previousRole: null, above: null as { role: PanelRole; at: number } | null, chain, mine };
      if (input.expected !== undefined && (input.expected ?? null) !== curRole) throw new GrantError("conflict");
      if (rank(curRole) > rank(maxGrant)) throw new GrantError("above_own_role");
      await tx.sOPFolderAccess.delete({ where: { folderId_userId: { folderId: id, userId: input.userId } } });
      await objectActivity(tx, ctx, KIND, id, "access.revoked", { granteeId: input.userId, role: null, previousRole: cur.role, store: "SOPFolderAccess" });
      const rest = await tx.sOPFolderAccess.findMany({ where: { userId: input.userId, folderId: { in: chain.map((c) => c.id) } }, select: { folderId: true, userId: true, role: true } });
      const target = await tx.user.findFirst({ where: { id: input.userId, organizationId: ctx.organizationId, deletedAt: null }, select: { accessLevel: true, status: true } });
      // A deactivated account keeps nothing: no admin reach, no folder above.
      const active = !!target && !RULE_1_DENIED_STATUSES.has(String(target.status));
      return {
        noChange: false,
        previousRole: curRole,
        above: active ? roleFrom(rest, chain, 1, input.userId) : null,
        chain,
        mine,
        admin: active && ADMIN_LEVELS.has(String(target!.accessLevel)),
        agent: String(target?.accessLevel) === "AGENT",
      };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  // Still reaches it through a folder above: said after the removal, as for
  // a node, and named only when the viewer can open that folder.
  // An Owner or Admin keeps every folder: said first, as for a node.
  const stillReaches = "admin" in out && out.admin
    ? { role: "FULL" as PanelRole, via: { type: "org_admin" as const, orgName: await orgNameOf(ctx.organizationId) } }
    : out.above
      // An Agent works at Can edit, whatever the folder above gives it.
      ? { role: ("agent" in out && out.agent && out.above.role === "FULL" ? "EDIT" : out.above.role) as PanelRole, via: viaAt(ctx, out.mine, out.chain, out.above.at) }
      : null;
  const change: GrantChange = { userId: input.userId, role: null, previousRole: out.previousRole, noChange: out.noChange, stillReaches, keepsInside: [] };
  return { panel, change };
}

/** Check access: what one person can do in this folder, and why. */
export async function checkSopFolderAccess(
  ctx: ObjectShareCtx,
  id: string,
  userId: string,
): Promise<{ userId: string; name: string; role: string; sentence: string } | "not_found" | "forbidden" | "not_in_org"> {
  const chain = await chainOf(prisma, ctx.organizationId, id);
  if (chain.length === 0) return "not_found";
  const rows = await prisma.sOPFolderAccess.findMany({ where: { folderId: { in: chain.map((c) => c.id) } }, select: { folderId: true, userId: true, role: true } });
  const mine = viewerRoleAt(ctx, rows, chain, 0);
  if (!mine) return "not_found";
  if (!managesWith(ctx, mine)) return "forbidden";
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId: ctx.organizationId, deletedAt: null }, select: { firstName: true, lastName: true, email: true, accessLevel: true, status: true } });
  if (!person) return "not_in_org";
  const name = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email;
  if (RULE_1_DENIED_STATUSES.has(String(person.status))) return { userId, name, role: "none", sentence: "No access. Their account is deactivated." };
  const level = String(person.accessLevel);
  if (level === "SUPER_ADMIN" || level === "COMPANY_ADMIN") {
    return { userId, name, role: "FULL", sentence: `${shareRoleLabel(KIND, "FULL")}. They are an Owner or Admin, and Admins see every SOP folder.` };
  }
  const from = roleFrom(rows, chain, 0, userId);
  if (!from) return { userId, name, role: "none", sentence: "No access. Nothing shares this folder with them, or any folder above it." };
  const named = ctx.orgAdmin || !!viewerRoleAt(ctx, rows, chain, from.at);
  const where = from.at === 0 ? "Shared with them directly." : named ? `From SOP folder ${chain[from.at].name}.` : "From a folder above it.";
  if (level === "AGENT" && from.role === "FULL") {
    const noEdit = !(await editsSops(userId, ctx.organizationId, level)) ? ` ${NO_SOP_EDIT_NOTE}` : "";
    return { userId, name, role: "EDIT", sentence: `${shareRoleLabel(KIND, "EDIT")}. ${where} An Agent never changes who can open a folder.${noEdit}` };
  }
  const caveat = rank(from.role) >= rank("EDIT") && !(await editsSops(userId, ctx.organizationId, level)) ? ` ${NO_SOP_EDIT_NOTE}` : "";
  return { userId, name, role: from.role, sentence: `${shareRoleLabel(KIND, from.role)}. ${where}${caveat}` };
}

/** What this person holds on the folder now (an Owner or Admin every folder; else the strongest row on it or above it), or null. */
export async function sopFolderHeldRole(organizationId: string, folderId: string, userId: string): Promise<PanelRole | null> {
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { accessLevel: true } });
  if (!person) return null;
  if (ADMIN_LEVELS.has(String(person.accessLevel))) return "FULL";
  const chain = await chainOf(prisma, organizationId, folderId);
  if (chain.length === 0) return null;
  const rows = await prisma.sOPFolderAccess.findMany({ where: { userId, folderId: { in: chain.map((c) => c.id) } }, select: { folderId: true, userId: true, role: true } });
  return roleFrom(rows, chain, 0, userId)?.role ?? null;
}
