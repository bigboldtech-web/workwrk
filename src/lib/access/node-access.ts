// node-access: THE live resolver for who can open, change and share a
// Space, a Folder, a List (and its tasks), a Doc (and its sub-pages), a
// Table, a Canvas or a Form.
//
// Every reader and every write gate in the product asks this module, through
// the delegates it replaced (space.ts, board.ts, folder.ts, doc-access.ts,
// doc-sharing.ts, table-gate.ts, whiteboard-gate.ts, item-gate.ts,
// file-access.ts and src/lib/access.ts), so the Work tree, the pages, the
// list APIs and the write gates always give one answer. The rules are
// node-rules.ts (pure, tested over a parity grid); the loaders are
// node-world.ts; the only writer of person grants is grants.ts.
//
// WHAT THIS MEANS FOR THE ENGINE. The engine under src/lib/access (resolve,
// facts, ids, gate, guards, enforcement, settings and the rest) stays INERT:
// nothing here calls can() or decide(). parity.ts's transcriptions of the
// helpers node-access replaced are now two things at once: the documented
// pre-node-access baseline, and the source of the legacy floor
// (legacy-floor.ts), which keeps today's reach under the "legacy" Private
// rule. When Phase 8 wires the engine's parity job, it must compare the
// engine against THIS module, not against the transcription.
//
// Server-only: prisma and the session.

import { getServerSession } from "next-auth";
import { authOptions } from "../auth";
import { prisma } from "../prisma";
import { readDocLock } from "../doc-lock";
import {
  ACCESS_NODE_NOUN,
  MANAGE_BAR,
  ROLES_BY_KIND,
  type AccessGeneral,
  type AccessNodeKind,
  type AccessPanel,
  type AccessPerson,
} from "./access-panel";
import {
  NodeEvaluator,
  applyDocLock,
  decideAll,
  emptyRows,
  moveDecision,
  inTrashedFolder,
  nodeCtxFromLevel,
  notepadOwnerOf,
  placementContainers,
  refKey,
  roleAtLeast,
  toContainerRole,
  toDocRole,
  type NodeCtx,
  type NodeDecision,
  type NodeRef,
  type NodeRole,
  type NodeRows,
  type NodeVisibility,
  type PrivateRule,
  type TreeRole,
  type ViewerGrants,
} from "./node-rules";
import { accessEntries, ancestorsOf, assembleSpaceTree, inheritanceOf, keepsRestrictedDoc, nodeName, renderedCounts, type SpaceTreeResult } from "./node-tree";
import {
  loadAllGrants,
  loadOrgAdmins,
  loadPathEvidence,
  loadPeople,
  loadRows,
  loadSpaceWorld,
  loadViewerGrants,
  loadWorld,
  peopleNamedByRows,
  seedsOf,
} from "./node-world";
import { accessGrantTableReady, readAccessModel } from "./access-grant-store";
import { activityNodeRef } from "./access-activity";
import { RULE_1_DENIED_STATUSES } from "./resolve";
import type { Viewer } from "./types";

export { nodeCtxFromLevel };
export type { NodeCtx, NodeDecision, NodeRef, NodeRole, TreeRole };

// ── contexts ─────────────────────────────────────────────────────────

/**
 * The one place a route reads the session for node access. One extra User
 * read: the row's level and org are the authority (a stale token never
 * widens a demoted person), and a deleted or INACTIVE account is denied.
 * Null when signed out.
 */
export async function nodeCtxFromSession(): Promise<NodeCtx | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) return null;
  const row = await prisma.user.findUnique({
    where: { id: u.id },
    select: { organizationId: true, accessLevel: true, status: true, deletedAt: true },
  });
  if (!row) return null;
  const ctx = nodeCtxFromLevel(u.id, row.organizationId ?? u.organizationId, row.accessLevel ?? u.accessLevel);
  ctx.denied = row.deletedAt != null || RULE_1_DENIED_STATUSES.has(String(row.status));
  return ctx;
}

/**
 * For a caller that holds only a person's id (the Ask AI tools, background
 * jobs): the same row read as nodeCtxFromSession, from the User row alone.
 * A person in another org, deleted or INACTIVE is denied, so every decision
 * over this context reads as none.
 */
export async function nodeCtxForUser(userId: string, organizationId: string): Promise<NodeCtx> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, accessLevel: true, status: true, deletedAt: true },
  });
  const ctx = nodeCtxFromLevel(userId, organizationId, row?.accessLevel ?? null);
  ctx.denied = !row || row.organizationId !== organizationId || row.deletedAt != null || RULE_1_DENIED_STATUSES.has(String(row.status));
  return ctx;
}

/** From the engine's Viewer (viewerFromSession). */
export function nodeCtxFromViewer(viewer: Viewer): NodeCtx {
  return {
    userId: viewer.userId,
    organizationId: viewer.organizationId,
    orgAdmin: viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN",
    orgGuest: viewer.orgRole === "GUEST",
    isAgent: viewer.isAgent,
    denied: viewer.deleted === true || (!!viewer.status && RULE_1_DENIED_STATUSES.has(viewer.status)),
  };
}

// ── decisions ────────────────────────────────────────────────────────

const NONE_DECISION: NodeDecision = { role: "none", strictRole: "none", via: { type: "none" }, path: false };

/**
 * Every Space and Folder that is a path container for this viewer (R10),
 * found from their own grant rows only (never a scan of a Space): the
 * containers with no role on the way to a node they hold a strict role on.
 * Keys are refKey strings. Empty for an org admin, who holds a role on every
 * node.
 */
export async function viewerPathContainers(ctx: NodeCtx): Promise<Set<string>> {
  const out = new Set<string>();
  if (ctx.denied || ctx.orgAdmin) return out;
  const evidence = await loadPathEvidence(ctx);
  const ev = new NodeEvaluator(evidence.rows, evidence.grants);
  for (const ref of evidence.candidates) {
    if (!roleAtLeast(ev.strict(ref).role, "VIEW")) continue;
    const chain = placementContainers(evidence.rows, ref);
    if (inTrashedFolder(evidence.rows, chain)) continue;
    for (const c of chain) {
      if (ev.effective(c).role === "none") out.add(refKey(c));
    }
  }
  return out;
}

/**
 * A chain world holds the node and what is above it, never what is below
 * it, so a container that is a path only because of something the viewer was
 * given further down cannot see that from its own world. For a Space or
 * Folder with no role, the viewer's own grants settle it.
 */
async function fillContainerPaths(ctx: NodeCtx, entries: Array<[NodeRef, NodeDecision]>): Promise<void> {
  const open = entries.filter(([r, d]) => (r.kind === "space" || r.kind === "folder") && d.role === "none" && !d.path);
  if (open.length === 0 || ctx.denied || ctx.orgAdmin) return;
  const paths = await viewerPathContainers(ctx);
  for (const [r, d] of open) if (paths.has(refKey(r))) d.path = true;
}

/** One node, one chain world. A Space or Folder with no role also says whether it is a path container. */
export async function nodeRole(ctx: NodeCtx, ref: NodeRef): Promise<NodeDecision> {
  if (ctx.denied) return NONE_DECISION;
  const { rows, grants } = await loadWorld(ctx, [ref]);
  const ev = new NodeEvaluator(rows, grants);
  const d = { ...ev.decision(ref) };
  await fillContainerPaths(ctx, [[ref, d]]);
  return d;
}

/**
 * Many nodes over ONE batch world. Keys are refKey(ref), "kind:id". The
 * path flag of a Space or Folder is exact only with `paths` (one more read of
 * the viewer's own grants); the list readers that only need roles skip it.
 */
export async function nodeRoles(ctx: NodeCtx, refs: NodeRef[], opts: { paths?: boolean } = {}): Promise<Map<string, NodeDecision>> {
  const out = new Map<string, NodeDecision>();
  if (refs.length === 0) return out;
  if (ctx.denied) {
    for (const r of refs) out.set(refKey(r), NONE_DECISION);
    return out;
  }
  const { rows, grants } = await loadWorld(ctx, refs);
  const decided = decideAll(rows, grants, refs);
  if (opts.paths) {
    const entries: Array<[NodeRef, NodeDecision]> = refs.map((r) => {
      const d = { ...(decided.get(refKey(r)) ?? NONE_DECISION) };
      decided.set(refKey(r), d);
      return [r, d];
    });
    await fillContainerPaths(ctx, entries);
  }
  return decided;
}

/** One kind, many ids: id to effective role. */
export async function nodeRoleMap(ctx: NodeCtx, kind: AccessNodeKind, ids: Iterable<string>): Promise<Map<string, NodeRole>> {
  const list = [...new Set(ids)].filter(Boolean);
  const decisions = await nodeRoles(ctx, list.map((id) => ({ kind, id })));
  const out = new Map<string, NodeRole>();
  for (const id of list) out.set(id, decisions.get(`${kind}:${id}`)?.role ?? "none");
  return out;
}

/** The ids of `kind` this viewer holds at least `min` on. */
export async function idsWithRole(ctx: NodeCtx, kind: AccessNodeKind, ids: Iterable<string>, min: "VIEW" | "COMMENT" | "EDIT" | "FULL" = "VIEW"): Promise<Set<string>> {
  const map = await nodeRoleMap(ctx, kind, ids);
  const out = new Set<string>();
  for (const [id, role] of map) if (roleAtLeast(role, min)) out.add(id);
  return out;
}

export async function privateRuleOf(organizationId: string): Promise<PrivateRule> {
  return (await readAccessModel(organizationId).catch(() => null))?.privateRule ?? "legacy";
}

// ── the Space tree ───────────────────────────────────────────────────

/** GET /api/spaces/[id]/children for this viewer, or null (404) when they hold neither a role nor a path. */
export async function spaceTree(ctx: NodeCtx, spaceId: string): Promise<SpaceTreeResult | null> {
  if (ctx.denied) return null;
  const { rows, grants } = await loadSpaceWorld(ctx, [spaceId], { docs: true });
  return assembleSpaceTree({ rows, grants, spaceId });
}

/** The trees of several Spaces over one world (counts on /spaces). */
export async function spaceTrees(ctx: NodeCtx, spaceIds: string[]): Promise<Map<string, SpaceTreeResult | null>> {
  const out = new Map<string, SpaceTreeResult | null>();
  if (spaceIds.length === 0 || ctx.denied) return out;
  const { rows, grants } = await loadSpaceWorld(ctx, spaceIds, { docs: true });
  for (const id of spaceIds) out.set(id, assembleSpaceTree({ rows, grants, spaceId: id }));
  return out;
}

/** One row of GET /api/spaces. Path rows name the Space and nothing else. */
export interface VisibleSpace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parentSpaceId: string | null;
  ownerId: string | null;
  visibility: NodeVisibility | null;
  displayOrder: number;
  archivedAt: Date | null;
  memberCount: number | null;
  folderCount: number | null;
  boardCount: number | null;
  role: TreeRole | null;
  access: "member" | "path";
}

/**
 * The Spaces this viewer holds a role on; with `paths`, also the Spaces they
 * only pass through on the way to something they were given (named, with no
 * role and no counts); with `counts`, folder and List counts of what their
 * tree renders and nothing it hides.
 */
export async function listVisibleSpaces(
  ctx: NodeCtx,
  opts: { paths?: boolean; counts?: boolean; includeArchived?: boolean } = {},
): Promise<VisibleSpace[]> {
  if (ctx.denied) return [];
  const org = ctx.organizationId;
  const archived = opts.includeArchived ? {} : { archivedAt: null };
  const rows = await prisma.space.findMany({
    where: ctx.orgAdmin
      ? { organizationId: org, ...archived }
      : { organizationId: org, ...archived, OR: [{ visibility: "ORG" }, { members: { some: { userId: ctx.userId } } }] },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, slug: true, name: true, description: true, icon: true, color: true, parentSpaceId: true, ownerId: true,
      visibility: true, displayOrder: true, archivedAt: true,
      _count: { select: { members: true } },
      members: { where: { userId: ctx.userId }, select: { role: true }, take: 1 },
    },
  });
  const out: VisibleSpace[] = rows.map((s) => {
    const memberRole = s.members[0]?.role ?? null;
    const role: NodeRole = ctx.orgAdmin
      ? "FULL"
      : memberRole === "OWNER"
        ? "OWNER"
        : memberRole === "ADMIN"
          ? "FULL"
          : memberRole === "MEMBER"
            ? "EDIT"
            : "VIEW";
    return {
      id: s.id, slug: s.slug, name: s.name, description: s.description, icon: s.icon, color: s.color,
      parentSpaceId: s.parentSpaceId, ownerId: s.ownerId, visibility: s.visibility as NodeVisibility,
      displayOrder: s.displayOrder, archivedAt: s.archivedAt, memberCount: s._count.members,
      folderCount: null, boardCount: null, role: toContainerRole(role), access: "member",
    };
  });

  if (opts.paths && !ctx.orgAdmin) {
    const have = new Set(out.map((s) => s.id));
    const evidence = await loadPathEvidence(ctx);
    const ev = new NodeEvaluator(evidence.rows, evidence.grants);
    const pathIds = new Set<string>();
    for (const ref of evidence.candidates) {
      if (!roleAtLeast(ev.strict(ref).role, "VIEW")) continue;
      const chain = placementContainers(evidence.rows, ref);
      if (inTrashedFolder(evidence.rows, chain)) continue;
      const top = chain[chain.length - 1];
      if (top?.kind === "space" && !have.has(top.id) && ev.effective(top).role === "none") pathIds.add(top.id);
    }
    if (pathIds.size) {
      const paths = await prisma.space.findMany({
        where: { id: { in: [...pathIds] }, organizationId: org, ...archived },
        select: { id: true, slug: true, name: true, icon: true, color: true, displayOrder: true, archivedAt: true },
      });
      for (const p of paths) {
        out.push({
          id: p.id, slug: p.slug, name: p.name, description: null, icon: p.icon, color: p.color, parentSpaceId: null,
          ownerId: null, visibility: null, displayOrder: p.displayOrder, archivedAt: p.archivedAt, memberCount: null,
          folderCount: null, boardCount: null, role: null, access: "path",
        });
      }
      out.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    }
  }

  if (opts.counts && out.length) {
    const trees = await spaceTrees(ctx, out.map((s) => s.id));
    for (const s of out) {
      if (s.access === "path") continue; // a path row carries no counts
      const tree = trees.get(s.id);
      if (!tree) continue;
      const c = renderedCounts(tree);
      s.folderCount = c.folders;
      s.boardCount = c.lists;
    }
  }
  return out;
}

// ── activity rows ────────────────────────────────────────────────────

/**
 * For a page of activity rows: may the viewer open each row's node target?
 * One world for every node the rows name. The answer is true or false for a
 * row whose target is a Space, Folder, List, doc, table, canvas or form, and
 * null for any other target (a task, a person, a setting), which the callers
 * leave as they were.
 */
export async function activityTargetsReadable<T extends { targetType: string | null; targetId: string | null }>(
  ctx: NodeCtx,
  rows: readonly T[],
): Promise<Array<boolean | null>> {
  const refs = rows.map((r) => activityNodeRef(r.targetType, r.targetId));
  const wanted = refs.filter((r): r is NodeRef => r !== null);
  if (wanted.length === 0) return refs.map(() => null);
  const decisions = await nodeRoles(ctx, wanted);
  return refs.map((r) => (r ? roleAtLeast(decisions.get(refKey(r))?.role ?? "none", "VIEW") : null));
}

// ── crumbs ───────────────────────────────────────────────────────────

export interface NodePathStep {
  kind: AccessNodeKind;
  id: string;
  name: string;
  /** The Space's or List's slug; null for the other kinds. */
  slug: string | null;
  icon: string | null;
  color: string | null;
  readable: boolean;
  /** A path container (R10): named, opened as a PathContainerView. */
  path: boolean;
}

/**
 * The containers and pages above a node, ROOT FIRST, each with what the
 * viewer may do with it. Nothing the viewer can neither open nor pass
 * through is ever named: such a step stops the walk from that point down
 * being named (the crumb shows no gap).
 */
export async function nodePath(ctx: NodeCtx, ref: NodeRef): Promise<NodePathStep[]> {
  return (await nodePathWorld(ctx, ref)).steps;
}

/**
 * nodePath with the world it was read from and the node's own decision, for
 * the Work placement, which names the facts on the chain (a doc's anchor, a
 * task) from the same org-scoped rows the decisions came from.
 */
export async function nodePathWorld(ctx: NodeCtx, ref: NodeRef): Promise<{ steps: NodePathStep[]; rows: NodeRows; self: NodeDecision }> {
  if (ctx.denied) return { steps: [], rows: emptyRows(ctx.organizationId), self: NONE_DECISION };
  const { rows, grants } = await loadWorld(ctx, [ref], { chain: true });
  const steps = nodePathIn(rows, grants, ref);
  const self = { ...new NodeEvaluator(rows, grants).decision(ref) };
  // A floor-only node marks no path above it; the viewer's own grants may
  // still make a step a path (something else they were given sits below it).
  if (!ctx.orgAdmin && (steps.some((s) => !s.readable && !s.path) || ((ref.kind === "space" || ref.kind === "folder") && self.role === "none"))) {
    const paths = await viewerPathContainers(ctx);
    for (const s of steps) if (!s.readable && paths.has(refKey({ kind: s.kind, id: s.id }))) s.path = true;
    if ((ref.kind === "space" || ref.kind === "folder") && self.role === "none" && paths.has(refKey(ref))) self.path = true;
  }
  return { steps, rows, self };
}

export function nodePathIn(rows: NodeRows, grants: ViewerGrants, ref: NodeRef): NodePathStep[] {
  const ev = new NodeEvaluator(rows, grants);
  const steps: NodePathStep[] = [];
  for (const a of [...ancestorsOf(rows, ref)].reverse()) {
    const d = ev.decision(a);
    const readable = roleAtLeast(d.role, "VIEW");
    const slug = a.kind === "space" ? rows.spaces.get(a.id)?.slug ?? null : a.kind === "list" ? rows.lists.get(a.id)?.slug ?? null : null;
    const icon = a.kind === "space" ? rows.spaces.get(a.id)?.icon ?? null : a.kind === "folder" ? rows.folders.get(a.id)?.icon ?? null : a.kind === "list" ? rows.lists.get(a.id)?.icon ?? null : null;
    const color = a.kind === "space" ? rows.spaces.get(a.id)?.color ?? null : a.kind === "folder" ? rows.folders.get(a.id)?.color ?? null : a.kind === "list" ? rows.lists.get(a.id)?.color ?? null : null;
    steps.push({ kind: a.kind, id: a.id, name: nodeName(rows, a), slug, icon, color, readable, path: d.path });
  }
  return steps;
}

// ── write gates ──────────────────────────────────────────────────────

export type CreateWhat = "list" | "folder" | "canvas" | "table" | "file";

/**
 * May the viewer create `what` inside this container (null: nowhere, the
 * org)? Full access on a Folder creates Lists, sub-folders and canvases in it
 * (W2) and never reads the Space; the Space root keeps canEditSpace for Lists
 * and Folders, and Can view for canvases and tables, as today.
 */
export async function canCreateAt(ctx: NodeCtx, container: { kind: "space" | "folder"; id: string } | null, what: CreateWhat): Promise<boolean> {
  if (ctx.denied) return false;
  if (!container) return what === "file" || what === "canvas" || what === "table" ? !ctx.orgGuest || ctx.orgAdmin : false;
  const d = await nodeRole(ctx, container);
  if (what === "file") {
    if (container.kind === "folder") return roleAtLeast(d.role, "VIEW");
    return roleAtLeast(d.role, "VIEW") || d.path;
  }
  if (container.kind === "folder") {
    if (roleAtLeast(d.role, "FULL")) return true;
    return (what === "list" || what === "folder") && (await containerGate(ctx, container)) === "ok";
  }
  if (what === "list" || what === "folder") return roleAtLeast(d.role, "FULL");
  return roleAtLeast(d.role, "VIEW");
}

/**
 * The gate for making a List or a Folder inside a container: "ok", or the
 * answer a route gives ("not_found" when the viewer can neither open the
 * container nor pass through it, "forbidden" when they can but may not
 * create there). Full access on the container, or, for a Folder under the
 * legacy Private rule, today's canEditSpace on its Space: a Space OWNER or
 * ADMIN made Lists and Folders in every Folder of their Space before
 * node-access, a Private one that does not name them included (A8).
 */
export async function containerGate(ctx: NodeCtx, container: { kind: "space" | "folder"; id: string }): Promise<"ok" | "forbidden" | "not_found"> {
  if (ctx.denied) return "not_found";
  const { rows, grants } = await loadWorld(ctx, [container]);
  const ev = new NodeEvaluator(rows, grants);
  const d = { ...ev.decision(container) };
  if (roleAtLeast(d.role, "FULL")) return "ok";
  if (container.kind === "folder" && ev.legacyManagesSpace(rows.folders.get(container.id)?.spaceId)) return "ok";
  if (d.role === "none") {
    await fillContainerPaths(ctx, [[container, d]]);
    if (!d.path) return "not_found";
  }
  return "forbidden";
}

/**
 * Today's answer alone for one node (the legacy floor), "none" under the
 * strict Private rule. For the write gates that keep a capability HEAD gave
 * below the strict role (A8): it reads only rows from before the cutoff, so a
 * grant made by this release never earns it.
 */
export async function legacyFloorRole(ctx: NodeCtx, ref: NodeRef): Promise<NodeRole> {
  if (ctx.denied) return "none";
  const { rows, grants } = await loadWorld(ctx, [ref], { chain: true });
  return new NodeEvaluator(rows, grants).floorRole(ref);
}

/**
 * May the viewer create a doc here? The anchor must be one they reach (a
 * note only under their own name), and a parent page must be one they can
 * read, in the same org, never under someone else's note.
 */
export async function canCreateDocAt(
  ctx: NodeCtx,
  anchor: { entityType: string | null; entityId: string | null } | null,
  parentId: string | null,
): Promise<boolean> {
  if (ctx.denied) return false;
  const refs: NodeRef[] = [];
  const anchorRef = anchorRefOf(anchor);
  if (anchorRef && anchorRef !== "open" && anchorRef !== "note") refs.push(anchorRef);
  if (parentId) refs.push({ kind: "doc", id: parentId });
  if (anchorRef === "note" && anchor?.entityId !== ctx.userId) return false;
  if (anchor?.entityType === "BOARD_ITEM" && anchor.entityId) {
    const item = await prisma.item.findFirst({ where: { id: anchor.entityId, organizationId: ctx.organizationId }, select: { boardId: true } });
    if (!item) return false;
    refs.push({ kind: "list", id: item.boardId });
  }
  if (refs.length === 0) return true;
  const { rows, grants } = await loadWorld(ctx, refs);
  const ev = new NodeEvaluator(rows, grants);
  for (const r of refs) {
    if (r.kind === "doc") {
      const parent = rows.docs.get(r.id);
      if (!parent) return false;
      const note = notepadOwnerOf(rows, parent);
      if (note !== undefined && note !== ctx.userId) return false;
    }
    if (!roleAtLeast(ev.effective(r).role, "VIEW")) return false;
  }
  return true;
}

function anchorRefOf(anchor: { entityType: string | null; entityId: string | null } | null): NodeRef | "open" | "note" | null {
  if (!anchor?.entityType || !anchor.entityId) return null;
  switch (anchor.entityType) {
    case "SPACE":
      return { kind: "space", id: anchor.entityId };
    case "FOLDER":
      return { kind: "folder", id: anchor.entityId };
    case "BOARD":
      return { kind: "list", id: anchor.entityId };
    case "BOARD_ITEM":
      return null; // resolved through its List by the caller
    case "NOTEPAD":
      return "note";
    default:
      return "open";
  }
}

export type MoveDest = { kind: "space"; id: string } | { kind: "folder"; id: string } | { kind: "none" };

/** May the viewer move this node to `dest`? The rules are node-rules moveDecision's. */
export async function moveAllowed(ctx: NodeCtx, ref: NodeRef, dest: MoveDest): Promise<boolean> {
  if (ctx.denied) return false;
  const destRef: NodeRef | null = dest.kind === "none" ? null : dest;
  const { rows, grants } = await loadWorld(ctx, destRef ? [ref, destRef] : [ref], { chain: true });
  return moveDecision(rows, grants, ref, destRef);
}

// ── docs ─────────────────────────────────────────────────────────────

export interface DocRoleInfo {
  /** The role on the page right now: the lock applied (R6h). */
  role: NodeRole;
  /** The role before the lock, which the sharing and manage gates read. */
  unlockedRole: NodeRole;
  /** requireDocRole's vocabulary, from the unlocked role: "edit", "view" or null. */
  legacy: "edit" | "view" | null;
  canComment: boolean;
  canShare: boolean;
  canManage: boolean;
  locked: boolean;
}

export function docRoleInfo(decisionRole: NodeRole, locked: boolean): DocRoleInfo {
  const role = applyDocLock(decisionRole, locked);
  return {
    role,
    unlockedRole: decisionRole,
    legacy: toDocRole(decisionRole),
    canComment: roleAtLeast(role, "COMMENT"),
    canShare: roleAtLeast(decisionRole, MANAGE_BAR.doc),
    canManage: roleAtLeast(decisionRole, "FULL"),
    locked,
  };
}

export async function docRoleFor(ctx: NodeCtx, docId: string): Promise<DocRoleInfo> {
  const [d, lock] = await Promise.all([nodeRole(ctx, { kind: "doc", id: docId }), readDocLock(docId).catch(() => null)]);
  return docRoleInfo(d.role, !!lock?.lockedById);
}

// ── forms ────────────────────────────────────────────────────────────

/** R9 RESPONSES: may the viewer read (and export) this form's responses? */
export async function formResponsesAllowed(ctx: NodeCtx, formId: string): Promise<boolean> {
  if (ctx.denied) return false;
  const { rows, grants } = await loadWorld(ctx, [{ kind: "form", id: formId }]);
  return new NodeEvaluator(rows, grants).formResponsesAllowed(formId);
}

/** Which of these people may read this form's responses (the notify and daily summary fan-outs). */
export async function usersWhoCanReadResponses(organizationId: string, formId: string, among: Iterable<string>): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(among)];
  if (ids.length === 0) return out;
  const rows = await loadRows(organizationId, seedsOf([{ kind: "form", id: formId }]));
  const [all, people] = await Promise.all([loadAllGrants(rows), loadPeople(organizationId, ids)]);
  for (const [id, p] of people) {
    const g = all.get(id);
    const grants: ViewerGrants = { viewer: p.viewer, space: g?.space ?? new Map(), folder: g?.folder ?? new Map(), list: g?.list ?? new Map(), object: g?.object ?? new Map(), since: g?.since };
    if (new NodeEvaluator(rows, grants).formResponsesAllowed(formId)) out.add(id);
  }
  return out;
}

// ── everyone who can read one node ───────────────────────────────────

/**
 * Who among `among` (or, without it, everyone with a row on the node's chain
 * and its owners) holds at least `min` on the node: one world with every
 * person's rows, for the fan-out filters and the roster. Org-wide reach is
 * evaluated per candidate, so a person with no row still reads an org-wide
 * Space when they are among the candidates.
 */
export async function usersWhoCanRead(
  organizationId: string,
  ref: NodeRef,
  opts: { min?: "VIEW" | "COMMENT" | "EDIT" | "FULL"; among?: Iterable<string> } = {},
): Promise<Map<string, NodeRole>> {
  const min = opts.min ?? "VIEW";
  const rows = await loadRows(organizationId, seedsOf([ref]));
  const all = await loadAllGrants(rows);
  const candidates = opts.among ? [...new Set(opts.among)] : [...new Set([...all.keys(), ...peopleNamedByRows(rows)])];
  const people = await loadPeople(organizationId, candidates);
  const out = new Map<string, NodeRole>();
  for (const [id, p] of people) {
    const g = all.get(id);
    const grants: ViewerGrants = { viewer: p.viewer, space: g?.space ?? new Map(), folder: g?.folder ?? new Map(), list: g?.list ?? new Map(), object: g?.object ?? new Map(), since: g?.since };
    const role = new NodeEvaluator(rows, grants).effective(ref).role;
    if (roleAtLeast(role, min)) out.set(id, role);
  }
  return out;
}

// ── the Manage access panel ──────────────────────────────────────────

function nodeHref(rows: NodeRows, ref: NodeRef): string | null {
  const enc = encodeURIComponent;
  switch (ref.kind) {
    case "space": {
      const s = rows.spaces.get(ref.id);
      return s ? `/spaces/${enc(s.slug)}` : null;
    }
    case "folder":
      return `/folders/${enc(ref.id)}`;
    case "list": {
      const l = rows.lists.get(ref.id);
      return l ? `/boards/${enc(l.slug)}` : null;
    }
    case "doc":
      return `/work/docs/${enc(ref.id)}`;
    case "table":
      return `/work/tables/${enc(ref.id)}`;
    case "canvas":
      return `/work/canvas/${enc(ref.id)}`;
    case "form":
      return `/work/forms/${enc(ref.id)}`;
  }
}

function spaceOfNode(rows: NodeRows, ref: NodeRef) {
  const chain = ref.kind === "space" ? [ref] : placementContainers(rows, ref);
  const top = chain[chain.length - 1];
  return top?.kind === "space" ? rows.spaces.get(top.id) ?? null : null;
}

async function generalOf(rows: NodeRows, ref: NodeRef, canShare: boolean, viewerId: string): Promise<AccessGeneral> {
  const space = spaceOfNode(rows, ref);
  const orgWideSpace = ref.kind !== "space" && space && space.visibility === "ORG" ? { id: space.id, name: space.name } : null;
  let visibility: AccessGeneral["visibility"] = null;
  let restricted: boolean | null = null;
  let publicLink: AccessGeneral["publicLink"] = null;
  if (ref.kind === "space") visibility = rows.spaces.get(ref.id)?.visibility ?? null;
  if (ref.kind === "folder") visibility = rows.folders.get(ref.id)?.visibility ?? null;
  if (ref.kind === "list") visibility = rows.lists.get(ref.id)?.visibility ?? null;
  if (ref.kind === "doc") {
    const entry = rows.docSharing.get(ref.id);
    restricted = entry?.restricted === true;
    const on = !!entry?.publicSecret;
    publicLink = { on, allowed: true, url: on && canShare ? `/share/doc/${ref.id}.${entry?.publicSecret}` : null };
  }
  if (ref.kind === "table" || ref.kind === "form") {
    const row = ref.kind === "table"
      ? await prisma.dataTable.findFirst({ where: { id: ref.id, organizationId: rows.organizationId }, select: { isPublic: true } })
      : await prisma.formDefinition.findFirst({ where: { id: ref.id, organizationId: rows.organizationId }, select: { isPublic: true } });
    const on = !!row?.isPublic;
    // The public addresses object-share-dialog.tsx builds: the table's embed,
    // the form's public responder.
    publicLink = { on, allowed: true, url: on && canShare ? (ref.kind === "table" ? `/embed/tables/${ref.id}` : `/forms/${ref.id}/respond`) : null };
  }
  const { inheritsFrom, restrictedAbove } = inheritanceOf(rows, ref);
  const out: AccessGeneral = { visibility, restricted, publicLink, orgWideSpace, privateRule: rows.privateRule, inheritsFrom, restrictedAbove };
  if (ref.kind === "doc") out.viewerKeepsIfRestricted = keepsRestrictedDoc(rows, ref.id, viewerId);
  return out;
}

/**
 * GET /api/access/:kind/:id. Null when the viewer cannot open the node (a
 * path container is not a role), which the route answers as 404.
 */
export async function accessPanel(ctx: NodeCtx, ref: NodeRef): Promise<AccessPanel | null> {
  if (ctx.denied) return null;
  const rows = await loadRows(ctx.organizationId, seedsOf([ref]));
  const [actorGrants, all, admins, org, grantsReady] = await Promise.all([
    loadViewerGrants(ctx, rows),
    loadAllGrants(rows),
    loadOrgAdmins(ctx.organizationId),
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
    ref.kind === "table" || ref.kind === "canvas" || ref.kind === "form" ? accessGrantTableReady() : Promise.resolve(true),
  ]);
  rows.orgAdmins = admins;
  const actorRole = new NodeEvaluator(rows, actorGrants).effective(ref).role;
  if (!roleAtLeast(actorRole, "VIEW")) return null;

  const ids = [...new Set([...all.keys(), ...peopleNamedByRows(rows)])];
  const facts = await loadPeople(ctx.organizationId, ids);
  const people = [...facts.values()].map((p) => {
    const g = all.get(p.id);
    const grants: ViewerGrants = { viewer: p.viewer, space: g?.space ?? new Map(), folder: g?.folder ?? new Map(), list: g?.list ?? new Map(), object: g?.object ?? new Map(), since: g?.since };
    const person: AccessPerson = { id: p.id, name: p.name, email: p.email, avatar: p.avatar, active: p.active };
    return { person, grants };
  });

  const orgName = org?.name ?? "your organization";
  const entries = accessEntries({ rows, ref, people, viewer: actorGrants, orgName, hrefOf: (r) => nodeHref(rows, r) });
  const space = spaceOfNode(rows, ref);
  const notepadOwner = entries.notepadOwnerId ? people.find((p) => p.person.id === entries.notepadOwnerId)?.person ?? null : null;
  const canShareDoc = ref.kind === "doc" && roleAtLeast(actorRole, MANAGE_BAR.doc);

  return {
    node: {
      kind: ref.kind,
      id: ref.id,
      name: nodeName(rows, ref),
      noun: ACCESS_NODE_NOUN[ref.kind],
      href: nodeHref(rows, ref) ?? "/",
      space: space ? { id: space.id, name: space.name, slug: space.slug, href: `/spaces/${encodeURIComponent(space.slug)}` } : null,
      notepadOwner,
    },
    viewer: entries.notepadOwnerId
      ? { role: entries.viewer.role, canManage: false, maxGrant: null, isAgent: entries.viewer.isAgent }
      : { role: entries.viewer.role, canManage: entries.viewer.canManage, maxGrant: entries.viewer.maxGrant, isAgent: entries.viewer.isAgent },
    roles: ROLES_BY_KIND[ref.kind],
    general: await generalOf(rows, ref, ref.kind === "doc" ? canShareDoc : entries.viewer.canManage, ctx.userId),
    direct: entries.direct,
    inherited: entries.inherited,
    inheritedMore: entries.inheritedMore,
    hiddenInherited: entries.hiddenInherited,
    everyone: entries.everyone,
    admins: entries.admins,
    orgName,
    grantsAvailable: grantsReady,
  };
}
