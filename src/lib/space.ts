// Spaces — top-level grouping in the ClickUp-style shell. A Space
// contains Folders and Boards; it's user-defined (Decision D1 = B).
// Visibility tiers: PRIVATE (members only), WORKSPACE (members +
// org admins), ORG (every member of the org). Org admins have
// implicit access to every Space without a SpaceMember row.
//
// Phase 1 only ships data-layer helpers. The Phase 6 access resolver
// will fold these checks into a single canonical entrypoint.

import { prisma } from "@/lib/prisma";
import { delegatedNodeRole } from "@/lib/access/delegate";
import type { Prisma, Space, SpaceRole, Visibility } from "@/generated/prisma";
import { createEntityLink } from "@/lib/entity-link";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { type ContainerRole } from "@/lib/work/container-menu";
import { withArchivedBy } from "@/lib/archived-by";
import { decide, emptyGrants, emptyRows, nodeCtxFromLevel, roleAtLeast, spaceNestVerdict, toContainerRole, type MemberRole, type NodeRole, type NodeVisibility, type TreeRole } from "@/lib/access/node-rules";
import { listVisibleSpaces, nodeRole, nodeRoleMap, spaceTree } from "@/lib/access/node-access";
import { renderedCounts, type FolderNode, type ListNode, type SpaceTreeResult } from "@/lib/access/node-tree";
import { mergeSpaceSettings, spaceModulesPatch } from "@/lib/work/space-default-view";

/**
 * One row of the Space list. A PATH row (access "path": a Space the viewer
 * only passes through on the way to a Folder, List, doc, table or canvas
 * they were given) names the Space and nothing else: role, visibility,
 * description, owner, parent and every count are null.
 */
export interface SpaceSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parentSpaceId: string | null;
  ownerId: string | null;
  visibility: Visibility | null;
  displayOrder: number;
  archivedAt: Date | null;
  memberCount: number | null;
  /** Null unless counts were asked for; then only what the viewer's tree renders. */
  folderCount: number | null;
  boardCount: number | null;
  /**
   * The viewer's role on this Space ("full" | "edit" | "view"), from the one
   * resolver (src/lib/access/node-access.ts). Null on a path row, which the
   * tree renders as the reader's menu with no create trigger.
   */
  role: ContainerRole | null;
  access: "member" | "path";
}

function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "space"
  );
}

/**
 * A free Space slug for `name` in this org.
 *
 * Exported because `POST /api/spaces/[id]/duplicate` needs the same rule the
 * create path uses; two copies of a uniqueness loop is how "Design (copy)" and
 * "Design (copy)" end up fighting over one slug.
 */
export async function uniqueSpaceSlug(organizationId: string, name: string): Promise<string> {
  return uniqueSlug(organizationId, toSlug(name));
}

async function uniqueSlug(organizationId: string, desired: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? desired : `${desired}-${i + 1}`;
    const clash = await prisma.space.findFirst({
      where: { organizationId, slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${desired}-${Date.now()}`;
}

/** Is the user an org-level admin (implicit access to every Space)?
 *  Delegate: the ladder lives in src/lib/access/legacy-levels.ts, which is the
 *  one copy the engine, the rail tiers and the page gates all read. */
export function isOrgAdminAccessLevel(accessLevel: string | null | undefined): boolean {
  return legacyIsAdminLevel(accessLevel);
}

/**
 * The Spaces a user holds a role on, from the one resolver
 * (node-access listVisibleSpaces). `paths` adds the Spaces they only pass
 * through on the way to something they were given, as bare named rows;
 * `counts` fills folderCount and boardCount with what their tree renders.
 * Without either, only Spaces with a role come back: a caller that fans out
 * to Space-scoped content must never pass `paths`.
 *
 * Archived Spaces are excluded unless `includeArchived`.
 */
export async function listSpacesForUser(
  userId: string,
  organizationId: string,
  opts: { accessLevel?: string; includeArchived?: boolean; paths?: boolean; counts?: boolean } = {},
): Promise<SpaceSummary[]> {
  const ctx = nodeCtxFromLevel(userId, organizationId, opts.accessLevel);
  const rows = await listVisibleSpaces(ctx, { paths: opts.paths, counts: opts.counts, includeArchived: opts.includeArchived });
  return rows.map((r) => ({ ...r, visibility: r.visibility as Visibility | null }));
}

/**
 * Batch visibility check. Given a set of spaceIds, returns the subset
 * the viewer can read. Used by Library endpoints to filter out items
 * pinned to Spaces the viewer isn't in.
 *
 * Org admins see all → returns the full input set.
 * Otherwise: ORG-visibility Spaces + Spaces the viewer is a member of.
 *
 * One query per category instead of N — safe for big result pages.
 */
export async function visibleSpaceIds(
  spaceIds: string[],
  userId: string,
  accessLevel: string | null | undefined,
): Promise<Set<string>> {
  if (spaceIds.length === 0) return new Set();
  const unique = Array.from(new Set(spaceIds));
  if (isOrgAdminAccessLevel(accessLevel)) return new Set(unique);

  // IMPORTANT: this set means "spaces the viewer can FULLY read" — every
  // caller (files, search, boards, tables, whiteboards, entity-links) treats
  // membership here as "may read everything space-scoped". A folder-only grant
  // must NEVER widen it, or those endpoints would leak space-wide content
  // (board/task/whiteboard names, signed file URLs) beyond the granted folder.
  // Folder-grant containers are surfaced ONLY in the sidebar space list, via
  // listSpacesForUser({ includeFolderContainers: true }).
  const [orgVis, memberOf] = await Promise.all([
    prisma.space.findMany({
      where: { id: { in: unique }, visibility: "ORG" },
      select: { id: true },
    }),
    prisma.spaceMember.findMany({
      where: { userId, spaceId: { in: unique } },
      select: { spaceId: true },
    }),
  ]);
  const out = new Set<string>();
  for (const s of orgVis) out.add(s.id);
  for (const m of memberOf) out.add(m.spaceId);
  return out;
}

/**
 * The viewer's role on one Space, decided by node-rules R2 over the Space row
 * and the viewer's own SpaceMember row, which is everything that rule reads,
 * so the delegates below issue the one query they always issued. No org
 * filter is applied here today and none is added: callers compare
 * space.organizationId themselves.
 */
async function spaceRoleOf(spaceId: string, userId: string, accessLevel: string | null | undefined) {
  const row = await prisma.space.findUnique({
    where: { id: spaceId },
    include: { members: { where: { userId }, select: { role: true } } },
  });
  if (!row) return { row: null, role: "none" as NodeRole };
  const ctx = nodeCtxFromLevel(userId, row.organizationId, accessLevel);
  const rows = emptyRows(row.organizationId);
  rows.spaces.set(row.id, {
    id: row.id, organizationId: row.organizationId, name: row.name, slug: row.slug, icon: row.icon, color: row.color,
    visibility: row.visibility as NodeVisibility, ownerId: row.ownerId,
  });
  const grants = emptyGrants(ctx);
  const own = row.members[0]?.role as MemberRole | undefined;
  if (own) grants.space.set(row.id, own);
  const live = decide(rows, grants, { kind: "space", id: row.id }).role;
  return { row, role: await delegatedNodeRole(userId, row.organizationId, accessLevel, { kind: "space", id: row.id }, live) };
}

/**
 * Read access check: the viewer holds Can view or higher on the Space (an org
 * admin, any SpaceMember row, or an org-wide Space). Returns the Space row
 * (with the viewer's own membership) when readable; null otherwise.
 */
export async function getSpaceForReader(spaceId: string, userId: string, accessLevel?: string) {
  const { row, role } = await spaceRoleOf(spaceId, userId, accessLevel);
  return row && roleAtLeast(role, "VIEW") ? row : null;
}

/** Full access on the Space: an org admin, or a SpaceMember OWNER or ADMIN row. */
export async function canEditSpace(spaceId: string, userId: string, accessLevel?: string): Promise<boolean> {
  if (isOrgAdminAccessLevel(accessLevel)) return true;
  const { role } = await spaceRoleOf(spaceId, userId, accessLevel);
  return roleAtLeast(role, "FULL");
}

/**
 * CONTENT-write check: Can edit or higher on the Space (a MEMBER contributes,
 * a GUEST reads), as opposed to MANAGING it, which stays canEditSpace.
 */
export async function canContributeSpace(spaceId: string, userId: string, accessLevel?: string): Promise<boolean> {
  if (isOrgAdminAccessLevel(accessLevel)) return true;
  const { role } = await spaceRoleOf(spaceId, userId, accessLevel);
  return roleAtLeast(role, "EDIT");
}

/**
 * The one check for nesting a Space under another, or taking it to the top
 * level (POST /api/spaces/[id]/move and a parentSpaceId in PATCH
 * /api/spaces/[id]): node-rules spaceNestVerdict, the placement rule's P2 for
 * Space nesting. Full access on the Space itself, on the parent it leaves
 * (so Full access on a sub-Space alone never pulls it out of a parent the
 * person has no role on) and on the parent it goes under; a parent in
 * another org, out of sight, archived, the Space itself or one of its own
 * sub-Spaces is refused. Null when the move may go ahead.
 */
export async function spaceReparentRefusal(
  spaceId: string,
  parentSpaceId: string | null,
  viewer: { userId: string; organizationId: string; accessLevel?: string },
): Promise<{ status: 400 | 403 | 404; error: string } | null> {
  const org = viewer.organizationId;
  const self = await prisma.space.findFirst({ where: { id: spaceId, organizationId: org }, select: { parentSpaceId: true } });
  if (!self) return { status: 404, error: "Not found" };
  const currentId = self.parentSpaceId ?? null;
  // The parent it leaves is asked nothing: a Space's place under a parent
  // carries no access, and its OWNER or ADMIN moves it (node-rules
  // spaceNestVerdict, P7).
  const managesSpace = await canEditSpace(spaceId, viewer.userId, viewer.accessLevel);
  let dest: Parameters<typeof spaceNestVerdict>[0]["dest"] = null;
  if (parentSpaceId) {
    const parent = parentSpaceId === spaceId
      ? null
      : await prisma.space.findFirst({ where: { id: parentSpaceId, organizationId: org }, select: { id: true, archivedAt: true } });
    const [sees, manages] = parent
      ? await Promise.all([
          getSpaceForReader(parentSpaceId, viewer.userId, viewer.accessLevel).then((r) => !!r),
          canEditSpace(parentSpaceId, viewer.userId, viewer.accessLevel),
        ])
      : [false, false];
    // Walk UP from the proposed parent; reaching this Space means the parent
    // is one of its own descendants.
    let cycle = false;
    let cursor: string | null = parent ? parentSpaceId : null;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === spaceId) { cycle = true; break; }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const p: { parentSpaceId: string | null } | null = await prisma.space.findFirst({
        where: { id: cursor, organizationId: org },
        select: { parentSpaceId: true },
      });
      cursor = p?.parentSpaceId ?? null;
    }
    dest = { id: parentSpaceId, found: parentSpaceId === spaceId || !!parent, sees: parentSpaceId === spaceId || sees, archived: !!parent?.archivedAt, manages, cycle };
  }
  const verdict = spaceNestVerdict({ spaceId, managesSpace, current: currentId ? { id: currentId } : null, dest });
  return verdict.ok ? null : { status: verdict.status, error: verdict.error };
}

export interface SpaceNestDestinations {
  /** The top level (no parent): pickable when the move there would be accepted. */
  top: { pickable: boolean; current: boolean };
  /** The Spaces this one could go under, each pickable when the move would be accepted, and its current parent (Here now). */
  spaces: Array<{ id: string; name: string; slug: string; icon: string | null; color: string | null; pickable: boolean; current: boolean }>;
  /** Why nothing is pickable, when the Space cannot move anywhere for this viewer. */
  refusal?: string;
}

/**
 * P5 for Space nesting: exactly the parents spaces/[id]/move accepts for this
 * viewer, from the same verdict (node-rules spaceNestVerdict) the route asks,
 * so the Move dialog never offers a place the move refuses. Full access on the
 * Space and on the parent it goes under (the parent it leaves is asked
 * nothing); never the Space itself, one of its own sub-Spaces, or an archived
 * Space. Null when the viewer cannot open the Space.
 */
export async function spaceNestDestinations(
  spaceId: string,
  viewer: { userId: string; organizationId: string; accessLevel?: string },
): Promise<SpaceNestDestinations | null> {
  const org = viewer.organizationId;
  const self = await getSpaceForReader(spaceId, viewer.userId, viewer.accessLevel);
  if (!self || self.organizationId !== org) return null;
  const currentId = self.parentSpaceId ?? null;
  const ctx = nodeCtxFromLevel(viewer.userId, org, viewer.accessLevel);
  const [visible, all, managesSpace] = await Promise.all([
    listVisibleSpaces(ctx),
    prisma.space.findMany({ where: { organizationId: org }, select: { id: true, parentSpaceId: true } }),
    canEditSpace(spaceId, viewer.userId, viewer.accessLevel),
  ]);
  // Its own sub-Spaces, at any depth: never a parent for it.
  const below = new Set<string>([spaceId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of all) {
      if (r.parentSpaceId && below.has(r.parentSpaceId) && !below.has(r.id)) {
        below.add(r.id);
        grew = true;
      }
    }
  }
  const current = currentId ? { id: currentId } : null;
  const verdictFor = (dest: Parameters<typeof spaceNestVerdict>[0]["dest"]) => spaceNestVerdict({ spaceId, managesSpace, current, dest });
  const top = verdictFor(null);
  const candidates = visible.filter((s) => s.id !== spaceId && !s.archivedAt);
  const manages = await Promise.all(candidates.map((s) => canEditSpace(s.id, viewer.userId, viewer.accessLevel)));
  const spaces = candidates.map((s, i) => {
    const v = verdictFor({ id: s.id, found: true, sees: true, archived: false, manages: manages[i], cycle: below.has(s.id) });
    return { id: s.id, name: s.name, slug: s.slug, icon: s.icon, color: s.color, pickable: v.ok && !v.same, current: s.id === currentId };
  });
  const listed = spaces.filter((s) => s.pickable || s.current);
  const topPick = top.ok && !top.same;
  const nothing = !topPick && !listed.some((s) => s.pickable);
  const refusal = !nothing ? undefined : !managesSpace ? "You need Full access to this Space to move it." : undefined;
  return { top: { pickable: topPick, current: currentId === null }, spaces: listed, ...(refusal ? { refusal } : {}) };
}

// ── A viewer, whole ─────────────────────────────────────────────────
//
// The session unwrap (itemCtx) the Bird's eye routes hand in. The Space gates
// themselves are Phase 5b's wrappers in list-links-server.ts (spaceForViewer,
// canContributeSpaceFor); this file only reads the Lists.

export interface SpaceViewer {
  userId: string;
  organizationId: string;
  accessLevel: string | null | undefined;
}

// ── The Lists of a Space this viewer can read ───────────────────────

/** One readable List of a Space, in Work tree order. */
export interface SpaceListRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: Visibility;
  ownerId: string | null;
  folderId: string | null;
  statuses: Prisma.JsonValue | null;
  /** Present only when asked for (includeSettings). */
  settings?: Prisma.JsonValue;
  /** Present only when asked for (includeSchema). */
  schema?: Prisma.JsonValue;
  /** The viewer's role on it, from the one resolver: the Work tree's row role. */
  role: TreeRole;
  /** Can edit or higher: may this viewer create and change its tasks? */
  canContribute: boolean;
}

/**
 * Every List of one Space the viewer can read, in the Work sidebar's order,
 * with the viewer's role on each and whether they may write in it, plus how
 * many of the Space's folders they see.
 *
 * ONE answer, the resolver's. The tree is exactly what GET
 * /api/spaces/[id]/children renders for this viewer (node-access spaceTree,
 * assembled by node-tree.ts): every List they can open at every depth, a
 * PRIVATE List or a PRIVATE Folder that does not name them left out, a Folder
 * grant reaching the Lists inside it without any Space row, and nothing else.
 * Bird's eye, every other Space tab, the header's count and the sidebar are
 * therefore one walk and cannot disagree, and an unreadable List is never
 * named or counted anywhere. `opts.tree` hands in a tree the caller already
 * built (the Space page), so the world is loaded once per request.
 *
 * Before this the answer came from a second predicate (the frozen legacy
 * transcriptions, four reads and an in-memory decision) that knew nothing of
 * the Private cut or of a Folder grant's own role. The walk gives the
 * readable set and each List's role; the columns the tabs need (statuses,
 * and schema when asked) come from one org-scoped read of exactly those
 * Lists. No member table is read here: a grant is only ever read through
 * the resolver.
 *
 * The caller gates the Space first. A Space outside the viewer's org, or one
 * that does not exist, answers no Lists.
 */
export async function readableListsInSpace(
  spaceId: string,
  viewer: SpaceViewer,
  opts: { includeSchema?: boolean; includeSettings?: boolean; tree?: SpaceTreeResult | null } = {},
): Promise<{ lists: SpaceListRow[]; folderCount: number }> {
  const includeSettings = opts.includeSettings === true;
  const includeSchema = opts.includeSchema === true;
  const ctx = nodeCtxFromLevel(viewer.userId, viewer.organizationId, viewer.accessLevel);
  const tree = opts.tree !== undefined ? opts.tree : await spaceTree(ctx, spaceId);
  if (!tree) return { lists: [], folderCount: 0 };

  // The sidebar's order: root folders by position, inside each folder its
  // child folders first and then its Lists, and the Space's root Lists after
  // every folder, at any depth.
  const ordered: Array<{ node: ListNode; folderId: string | null }> = [];
  const walk = (folders: FolderNode[]) => {
    for (const f of folders) {
      walk(f.childFolders);
      for (const l of f.boards) ordered.push({ node: l, folderId: f.id });
    }
  };
  walk(tree.folders);
  for (const l of tree.boards) ordered.push({ node: l, folderId: null });
  const folderCount = renderedCounts(tree).folders;
  if (ordered.length === 0) return { lists: [], folderCount };

  // The columns the walk does not carry, for exactly the readable Lists.
  const rows = await prisma.board.findMany({
    where: { id: { in: ordered.map((o) => o.node.id) }, organizationId: viewer.organizationId, archivedAt: null },
    select: { id: true, statuses: true, schema: includeSchema },
  });
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const lists: SpaceListRow[] = [];
  for (const { node, folderId } of ordered) {
    const row = byId.get(node.id);
    if (!row) continue;
    lists.push({
      id: node.id,
      slug: node.slug,
      name: node.name,
      icon: node.icon,
      color: node.color,
      visibility: node.visibility as Visibility,
      ownerId: node.ownerId,
      folderId,
      statuses: row.statuses,
      ...(includeSettings ? { settings: node.settings as Prisma.JsonValue } : {}),
      ...(includeSchema ? { schema: row.schema } : {}),
      role: node.role,
      canContribute: node.role === "full" || node.role === "edit",
    });
  }
  return { lists, folderCount };
}

// ── The Lists of one Folder this viewer can read ────────────────────

/**
 * A Folder and every live Folder below it, in the sidebar's walk: each
 * Folder's sub-folders first (by position, then name, depth first), then the
 * Folder itself, so its own Lists come after theirs, as readableListsInSpace
 * orders a Space. `folders` is the Space's live Folders.
 */
export function folderShelfOrder(
  folders: ReadonlyArray<{ id: string; parentFolderId: string | null; position: number; name: string }>,
  rootId: string,
): string[] {
  const children = new Map<string, Array<(typeof folders)[number]>>();
  for (const f of folders) {
    if (!f.parentFolderId) continue;
    const at = children.get(f.parentFolderId);
    if (at) at.push(f);
    else children.set(f.parentFolderId, [f]);
  }
  for (const arr of children.values()) arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const c of children.get(id) ?? []) walk(c.id);
    order.push(id);
  };
  walk(rootId);
  return order;
}

/** One List on a Folder's shelf, or a shelf below it, that the viewer can open. */
export interface FolderListRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: Visibility;
  ownerId: string | null;
  folderId: string;
  updatedAt: Date;
  statuses: Prisma.JsonValue | null;
  /** Present only when asked for (includeSettings). */
  settings?: Prisma.JsonValue;
  /** The viewer's role on it, from the one resolver. */
  role: NodeRole;
}

/**
 * THE FOLDER PAGE'S LISTS: every live List in a Folder and in the live
 * Folders below it that this viewer can open (Can view or higher, nodeRoleMap
 * over one world), in the sidebar's order (folderShelfOrder, then each
 * shelf's Lists by name). The page's Contents and Tasks tabs and its Bird's
 * eye read exactly this, so the three agree on every Folder, including one
 * the Space tree leaves out (a Folder under an archived one, or under a
 * PRIVATE Folder the viewer cannot see). A PRIVATE List, or a List under a
 * PRIVATE sub-folder, the viewer cannot open is never read here.
 */
export async function readableFolderLists(
  folder: { id: string; spaceId: string },
  viewer: SpaceViewer,
  opts: { includeSettings?: boolean } = {},
): Promise<FolderListRow[]> {
  const folders = await prisma.folder.findMany({
    where: { spaceId: folder.spaceId, organizationId: viewer.organizationId, archivedAt: null },
    select: { id: true, parentFolderId: true, position: true, name: true },
  });
  const order = folderShelfOrder(folders, folder.id);
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const boards = await prisma.board.findMany({
    where: { folderId: { in: order }, organizationId: viewer.organizationId, archivedAt: null },
    select: {
      id: true, slug: true, name: true, icon: true, color: true, visibility: true, ownerId: true, folderId: true, updatedAt: true, statuses: true,
      settings: opts.includeSettings === true,
    },
  });
  const ctx = nodeCtxFromLevel(viewer.userId, viewer.organizationId, viewer.accessLevel);
  const roles = await nodeRoleMap(ctx, "list", boards.map((b) => b.id));
  const rows: FolderListRow[] = [];
  for (const b of boards) {
    const role = roles.get(b.id) ?? "none";
    if (!b.folderId || !roleAtLeast(role, "VIEW")) continue;
    const { settings, ...rest } = b;
    rows.push({ ...rest, folderId: b.folderId, visibility: b.visibility as Visibility, role, ...(opts.includeSettings ? { settings: settings as Prisma.JsonValue } : {}) });
  }
  rows.sort((a, b) => (rank.get(a.folderId) ?? 0) - (rank.get(b.folderId) ?? 0) || a.name.localeCompare(b.name));
  return rows;
}

/**
 * A Folder this viewer may open, Can view or higher, or null: the Folder
 * page's own gate (nodeRole, with the PRIVATE cut). A viewer who only passes
 * through it on the way to something below gets null here, as the page shows
 * them its path view and no tabs.
 */
export async function folderForViewer(viewer: SpaceViewer, folderId: string): Promise<{ id: string; spaceId: string; name: string } | null> {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, organizationId: viewer.organizationId, archivedAt: null },
    select: { id: true, spaceId: true, name: true },
  });
  if (!folder) return null;
  const ctx = nodeCtxFromLevel(viewer.userId, viewer.organizationId, viewer.accessLevel);
  const decision = await nodeRole(ctx, { kind: "folder", id: folder.id });
  return roleAtLeast(decision.role, "VIEW") ? folder : null;
}

/** One Folder's Lists (readableFolderLists) as the rows a Space's Bird's eye reads. */
export async function readableListsInFolder(
  folder: { id: string; spaceId: string },
  viewer: SpaceViewer,
  opts: { includeSettings?: boolean } = {},
): Promise<{ lists: SpaceListRow[] }> {
  const rows = await readableFolderLists(folder, viewer, opts);
  return {
    lists: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      icon: r.icon,
      color: r.color,
      visibility: r.visibility,
      ownerId: r.ownerId,
      folderId: r.folderId,
      statuses: r.statuses,
      ...(r.settings !== undefined ? { settings: r.settings } : {}),
      role: toContainerRole(r.role) ?? "view",
      canContribute: roleAtLeast(r.role, "EDIT"),
    })),
  };
}

// ── The one Space.settings writer ───────────────────────────────────

/**
 * Change Space.settings under a row lock.
 *
 * `fn` sees the settings as they are INSIDE the lock and answers the patch
 * to merge (a key set to null is deleted, every other stored key is kept)
 * plus a result for the caller; a decision like "is this view switched off"
 * is therefore made on the row it writes. `data` rides along for the plain
 * columns of the same update. Every writer of settings goes through here
 * (bookmarks, the module toggle, the Space pin), so two of them can no longer
 * erase each other's keys, and a module toggle can no longer drop a pin that
 * was saved a moment earlier. createSpace and the Space duplicate write
 * settings only on insert.
 */
export async function mutateSpaceSettings<T>(
  spaceId: string,
  fn: (settings: unknown) => { patch: Record<string, unknown> | null; result: T },
  data?: Record<string, unknown>,
): Promise<{ found: false } | { found: true; result: T; space: Space }> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`
      SELECT "settings" FROM "Space" WHERE "id" = ${spaceId} FOR UPDATE
    `;
    if (rows.length === 0) return { found: false as const };
    const locked = rows[0].settings;
    const out = fn(locked);
    const hasData = !!data && Object.keys(data).length > 0;
    if (!out.patch && !hasData) {
      const space = await tx.space.findUniqueOrThrow({ where: { id: spaceId } });
      return { found: true as const, result: out.result, space };
    }
    const space = await tx.space.update({
      where: { id: spaceId },
      data: {
        ...(data ?? {}),
        ...(out.patch ? { settings: mergeSpaceSettings(locked, out.patch) as Prisma.InputJsonValue } : {}),
      },
    });
    return { found: true as const, result: out.result, space };
  });
}

export interface CreateSpaceInput {
  organizationId: string;
  userId: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  visibility?: Visibility;
  parentSpaceId?: string;
  // Override the OWNER of the Space. Defaults to userId (the creator).
  // When different, the creator stays on as ADMIN and the chosen user
  // becomes OWNER.
  ownerId?: string;
  // KRA IDs this Space is accountable for. Persisted as EntityLink
  // rows (SPACE → KRA, relationKind=LINKED) so the goal graph can
  // be queried in either direction.
  linkedKraIds?: string[];
  // Free-form wizard payload (preset, defaultPermission, defaultViews,
  // statuses, modules, …). Stored verbatim into Space.settings. Step 2
  // of the wizard expands this; sidebar/board renderers read it back.
  settings?: Record<string, unknown>;
}

/**
 * Create a Space and add the creator as OWNER in a single transaction.
 * Slug is auto-generated; collisions inside the org get `-2`, `-3` …
 */
export async function createSpace(input: CreateSpaceInput): Promise<SpaceSummary> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Space name is required");

  const slug = await uniqueSlug(input.organizationId, toSlug(trimmed));

  // Append at the end of the display order so new Spaces don't elbow
  // existing ones. Max+1 keeps re-ordering cheap (Phase 2 ships
  // drag-reorder which will rebalance as needed).
  const last = await prisma.space.findFirst({
    where: { organizationId: input.organizationId, parentSpaceId: input.parentSpaceId ?? null },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const displayOrder = (last?.displayOrder ?? -1) + 1;

  const ownerOverride = input.ownerId && input.ownerId !== input.userId ? input.ownerId : null;

  const created = await prisma.$transaction(async (tx) => {
    const space = await tx.space.create({
      data: {
        organizationId: input.organizationId,
        slug,
        name: trimmed,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        ownerId: ownerOverride ?? input.userId,
        visibility: input.visibility ?? "WORKSPACE",
        parentSpaceId: input.parentSpaceId ?? null,
        displayOrder,
        ...(input.settings ? { settings: input.settings as object } : {}),
      },
      select: {
        id: true, slug: true, name: true, description: true, icon: true,
        color: true, parentSpaceId: true, ownerId: true, visibility: true,
        displayOrder: true, archivedAt: true,
      },
    });

    if (ownerOverride) {
      // Override case: creator stays in the Space as ADMIN; chosen user
      // is OWNER. Two member rows.
      await tx.spaceMember.createMany({
        data: [
          { spaceId: space.id, userId: ownerOverride, role: "OWNER", invitedBy: input.userId },
          { spaceId: space.id, userId: input.userId, role: "ADMIN" },
        ],
        skipDuplicates: true,
      });
    } else {
      await tx.spaceMember.create({
        data: { spaceId: space.id, userId: input.userId, role: "OWNER" },
      });
    }
    return space;
  });

  // EntityLink rows for KRAs are written outside the transaction so a
  // missing/deleted KRA can't fail the whole Space create. Upsert keeps
  // the call idempotent if the client retries.
  if (input.linkedKraIds && input.linkedKraIds.length > 0) {
    await Promise.all(
      input.linkedKraIds.map((kraId, i) =>
        createEntityLink({
          organizationId: input.organizationId,
          source: { type: "SPACE", id: created.id },
          target: { type: "KRA", id: kraId },
          relationKind: "LINKED",
          position: i,
          createdById: input.userId,
        }).catch(() => null),
      ),
    );
  }

  return {
    ...created,
    memberCount: ownerOverride ? 2 : 1,
    folderCount: 0,
    boardCount: 0,
    // The creator is OWNER (or ADMIN when they named someone else), so either
    // way they hold Full access on the Space they just made.
    role: "full" as const,
    access: "member" as const,
  };
}

export interface UpdateSpaceInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  visibility?: Visibility;
  displayOrder?: number;
  parentSpaceId?: string | null;
  /** Toggle the Space's enabled modules ("ClickApps"). Merged into
   *  settings.workflow.modules — only that array is touched. */
  modules?: string[];
}

/** A client or a transaction: the visibility route writes the Space and its activity row in one. */
type SpaceDb = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function updateSpace(spaceId: string, patch: UpdateSpaceInput, db: SpaceDb = prisma) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Space name cannot be empty");
    data.name = trimmed;
  }
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.visibility !== undefined) data.visibility = patch.visibility;
  if (patch.displayOrder !== undefined) data.displayOrder = patch.displayOrder;
  if (patch.parentSpaceId !== undefined) data.parentSpaceId = patch.parentSpaceId;

  // Modules live inside the settings JSON (settings.workflow.modules). The
  // merge happens on the LOCKED row, so only the modules array (and a pin the
  // new modules hide, see spaceModulesPatch) changes; statuses, views,
  // bookmarks and every other key are preserved, even against a writer that
  // saved one of them a moment ago.
  if (patch.modules !== undefined) {
    const modules = patch.modules;
    const r = await mutateSpaceSettings(spaceId, (s) => ({ patch: spaceModulesPatch(s, modules), result: null }), data);
    if (r.found) return r.space;
    // No row: the same update as before answers the same not-found error.
  }

  return db.space.update({ where: { id: spaceId }, data });
}

/** Soft-archive. archivedAt is set; Phase 2 ships the trash bin UI for restore. */
export async function archiveSpace(spaceId: string, actorId: string | null = null) {
  // Who archived it, so Trash's "Archived by" names the archiver rather than
  // the owner. Null when the caller has no actor: a blank cell is honest.
  // withArchivedBy keeps the archive working if the column is not there yet.
  return withArchivedBy(actorId, (extra) =>
    prisma.space.update({ where: { id: spaceId }, data: { archivedAt: new Date(), ...extra } }),
  );
}

export async function unarchiveSpace(spaceId: string) {
  return prisma.space.update({
    where: { id: spaceId },
    data: { archivedAt: null },
  });
}

// Permanent delete. Boards reference spaceId with onDelete:SetNull (so a bare
// space delete would orphan them), so we delete the space's boards + folders
// first — Board's own children (Items/Views/Members) cascade — then the space
// row itself. All-or-nothing in one transaction.
export async function deleteSpace(spaceId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.board.deleteMany({ where: { spaceId } });
    await tx.folder.deleteMany({ where: { spaceId } });
    await tx.space.delete({ where: { id: spaceId } });
  });
}

export async function listSpaceMembers(spaceId: string) {
  return prisma.spaceMember.findMany({
    where: { spaceId },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function addSpaceMember(spaceId: string, userId: string, role: SpaceRole, invitedBy?: string) {
  return prisma.spaceMember.upsert({
    where: { spaceId_userId: { spaceId, userId } },
    create: { spaceId, userId, role, invitedBy: invitedBy ?? null },
    update: { role },
  });
}

export async function removeSpaceMember(spaceId: string, userId: string) {
  return prisma.spaceMember.delete({
    where: { spaceId_userId: { spaceId, userId } },
  });
}
