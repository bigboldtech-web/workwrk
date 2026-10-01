// Folders — second tier of the Space > Folder > Board nesting. Folders
// can nest inside other Folders; nesting depth is capped at 6 by app
// code (the DB allows deeper, but the sidebar UI doesn't render past 6
// levels). Folders inherit their Space's visibility for Phase 1; the
// Phase 6 resolver may add per-Folder ACLs later.

import { prisma } from "@/lib/prisma";
import { delegatedNodeRole } from "@/lib/access/delegate";
import { legacyAllows, type LegacyInputs, type VisibilityValue } from "@/lib/access/parity";
import { withArchivedBy } from "@/lib/archived-by";
import { loadPathEvidence } from "@/lib/access/node-world";
import { NodeEvaluator, placementContainers, roleAtLeast } from "@/lib/access/node-rules";
import { nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { lockParentFolder } from "@/lib/access/node-placement";

const MAX_FOLDER_DEPTH = 6;

export type FolderVisibility = "PRIVATE" | "WORKSPACE" | "ORG";

// The org-admin ladder now has one copy, in src/lib/access/legacy-levels.ts.

/** Can this viewer see a folder? A PRIVATE folder is visible only to its owner
 *  and org admins; WORKSPACE/ORG folders are gated by the Space, not here.
 *  NOTE: this is the coarse SPACE-member view. A folder-only grantee (a
 *  FolderMember on a PRIVATE folder) is handled separately by
 *  `folderAccessForSpace` — this predicate would hide such a folder, so the
 *  scoped path never routes through it. */
export function folderVisibleTo(
  folder: { visibility: string | null; ownerId: string | null },
  userId: string | null | undefined,
  accessLevel: string | null | undefined,
): boolean {
  // Delegate (migration step 1), and the one delegate that stays SYNCHRONOUS.
  // parity.ts's transcription is a pure function over a struct, so this helper
  // keeps its exact signature (a row, not an id) and its three call sites
  // (api/spaces/[id]/children:172, spaces/[slug]/page.tsx:230,
  // folders/[id]/page.tsx:105) need no await and no change.
  //
  // A null userId cannot match a row's ownerId, so the empty-string stand-in
  // below reproduces folder.ts:28's `!!userId &&` guard exactly: Folder.ownerId
  // is either null (no match, since the struct's userId is "") or a real id.
  const inputs: LegacyInputs = {
    userId: userId ?? "",
    organizationId: "",
    accessLevel: accessLevel ?? null,
    folder: {
      id: "",
      organizationId: "",
      spaceId: "",
      visibility: (folder.visibility ?? "WORKSPACE") as VisibilityValue,
      ownerId: folder.ownerId,
      memberRole: null,
    },
  };
  return legacyAllows(inputs, "folderVisibleTo");
}

// ── Granular folder access ─────────────────────────────────────────
//
// Access is ADDITIVE and INHERITED downward: a Space grant sees every folder;
// a FolderMember grant lets a NON-space-member reach exactly that folder (and
// its subtree) and nothing else. These helpers answer, for the sidebar tree
// and the space listing, "how much of this Space can the viewer see?".

/** How much of a Space a viewer can see.
 *  - "full": org admin, ORG-visibility, or a SpaceMember → the whole Space.
 *  - "scoped": no Space grant but one+ FolderMember grants → ONLY those
 *    folders (and their subtrees). The Space appears as a bare container.
 *  - "none": neither → the Space is invisible to them. */
export type FolderAccessMode =
  | { mode: "full" }
  | { mode: "scoped"; folderIds: Set<string> }
  | { mode: "none" };

export async function folderAccessForSpace(
  spaceId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<FolderAccessMode> {
  // Derived from the one resolver: "full" when the viewer holds a role on the
  // Space, "scoped" when the Space is a path container for them (the ids are
  // the Folders they were given inside it, or that hold what they were
  // given), "none" otherwise.
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { organizationId: true } });
  if (!space) return { mode: "none" };
  const ctx = nodeCtxFromLevel(userId, space.organizationId, accessLevel);
  const d = await nodeRole(ctx, { kind: "space", id: spaceId });
  if (roleAtLeast(d.role, "VIEW")) return { mode: "full" };
  if (ctx.orgAdmin) return { mode: "full" };
  const evidence = await loadPathEvidence(ctx);
  const ev = new NodeEvaluator(evidence.rows, evidence.grants);
  const folderIds = new Set<string>();
  for (const ref of evidence.candidates) {
    if (!roleAtLeast(ev.strict(ref).role, "VIEW")) continue;
    const chain = placementContainers(evidence.rows, ref);
    if (chain[chain.length - 1]?.id !== spaceId) continue;
    if (ref.kind === "folder") folderIds.add(ref.id);
    else {
      const top = chain.find((c) => c.kind === "folder");
      if (top) folderIds.add(top.id);
    }
  }
  return folderIds.size > 0 ? { mode: "scoped", folderIds } : { mode: "none" };
}

/** Every folder id the viewer can reach through a folder grant — the directly
 *  granted folders PLUS all their descendants (a grant cascades downward). Used
 *  by content surfaces (search, Library) to admit a folder-grantee's OWN folder
 *  content WITHOUT widening them to the whole Space. Empty set = no grants (the
 *  common case), so callers can skip the extra work. */
export async function accessibleFolderIds(userId: string): Promise<Set<string>> {
  const grants = await prisma.folderMember.findMany({
    where: { userId, folder: { archivedAt: null } },
    select: { folderId: true, folder: { select: { spaceId: true } } },
  });
  if (grants.length === 0) return new Set();
  const grantedIds = grants.map((g) => g.folderId);
  const spaceIds = [...new Set(grants.map((g) => g.folder.spaceId))];
  // Descendants live in the same space(s); one query, then BFS down.
  const allFolders = await prisma.folder.findMany({
    where: { spaceId: { in: spaceIds }, archivedAt: null },
    select: { id: true, parentFolderId: true },
  });
  const childrenByParent = new Map<string, string[]>();
  for (const f of allFolders) {
    if (!f.parentFolderId) continue;
    const arr = childrenByParent.get(f.parentFolderId) ?? [];
    arr.push(f.id);
    childrenByParent.set(f.parentFolderId, arr);
  }
  const out = new Set<string>(grantedIds);
  const queue = [...grantedIds];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!out.has(child)) { out.add(child); queue.push(child); }
    }
  }
  return out;
}

/** Spaces the viewer can reach ONLY via a folder grant (not space membership).
 *  Unioned into the sidebar's space list so a folder-only grantee still sees
 *  the Space container holding their folder. Org admins/space members are
 *  covered by the ordinary space queries and need not be included here. */
export async function spaceIdsWithFolderGrant(userId: string): Promise<Set<string>> {
  const grants = await prisma.folderMember.findMany({
    where: { userId, folder: { archivedAt: null } },
    select: { folder: { select: { spaceId: true } } },
  });
  return new Set(grants.map((g) => g.folder.spaceId));
}

/** A viewer's own FolderMember role on a folder, or null. */
export async function folderMemberRole(
  folderId: string,
  userId: string,
): Promise<"OWNER" | "ADMIN" | "MEMBER" | "GUEST" | null> {
  const row = await prisma.folderMember.findUnique({
    where: { folderId_userId: { folderId, userId } },
    select: { role: true },
  });
  return (row?.role as "OWNER" | "ADMIN" | "MEMBER" | "GUEST" | undefined) ?? null;
}

// ── Folder member CRUD (mirror of the Space member helpers) ─────────

export type FolderRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

export async function listFolderMembers(folderId: string) {
  return prisma.folderMember.findMany({
    where: { folderId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function addFolderMember(
  folderId: string,
  userId: string,
  role: FolderRole,
  invitedBy?: string,
) {
  return prisma.folderMember.upsert({
    where: { folderId_userId: { folderId, userId } },
    create: { folderId, userId, role, invitedBy: invitedBy ?? null },
    update: { role },
  });
}

export async function removeFolderMember(folderId: string, userId: string) {
  return prisma.folderMember.delete({
    where: { folderId_userId: { folderId, userId } },
  });
}

/**
 * Can view or higher on one Folder, from the one resolver: its own grant,
 * its owner, an ancestor Folder's grant or its Space, with the PRIVATE cut
 * and the legacy floor. The caller is responsible for the org scope, as
 * before: the Folder row's own org is the world's.
 */
export async function folderReadable(
  folderId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  const folder = await prisma.folder.findUnique({ where: { id: folderId }, select: { organizationId: true } });
  if (!folder) return false;
  const d = await nodeRole(nodeCtxFromLevel(userId, folder.organizationId, accessLevel), { kind: "folder", id: folderId });
  return roleAtLeast(await delegatedNodeRole(userId, folder.organizationId, accessLevel, { kind: "folder", id: folderId }, d.role), "VIEW");
}

export interface FolderSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  spaceId: string;
  parentFolderId: string | null;
  ownerId: string | null;
  visibility: FolderVisibility;
  position: number;
  archivedAt: Date | null;
  childCount: number;
  boardCount: number;
}

/**
 * List folders inside a Space. Returns a flat list; the consumer
 * (sidebar tree builder) reassembles the hierarchy via parentFolderId.
 */
export async function listFoldersInSpace(spaceId: string, opts: { includeArchived?: boolean } = {}): Promise<FolderSummary[]> {
  const rows = await prisma.folder.findMany({
    where: {
      spaceId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      color: true,
      spaceId: true,
      parentFolderId: true,
      ownerId: true,
      visibility: true,
      position: true,
      archivedAt: true,
      // Exclude archived child folders/boards from the counts so they match
      // the (archivedAt: null) lists the sidebar actually renders.
      _count: {
        select: {
          childFolders: { where: { archivedAt: null } },
          boards: { where: { archivedAt: null } },
        },
      },
    },
  });
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    icon: f.icon,
    color: f.color,
    spaceId: f.spaceId,
    parentFolderId: f.parentFolderId,
    ownerId: f.ownerId,
    visibility: f.visibility as FolderVisibility,
    position: f.position,
    archivedAt: f.archivedAt,
    childCount: f._count.childFolders,
    boardCount: f._count.boards,
  }));
}

/**
 * Compute the depth of a folder by walking up to root. Used to enforce
 * the 6-level cap at create/move time. Returns 0 for a root-level folder.
 */
export async function getFolderDepth(folderId: string): Promise<number> {
  let depth = 0;
  let currentId: string | null = folderId;
  while (currentId && depth < MAX_FOLDER_DEPTH + 2) {
    const row: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: currentId },
      select: { parentFolderId: true },
    });
    if (!row?.parentFolderId) break;
    currentId = row.parentFolderId;
    depth += 1;
  }
  return depth;
}

export interface CreateFolderInput {
  organizationId: string;
  spaceId: string;
  parentFolderId?: string | null;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  visibility?: FolderVisibility;
  userId: string;
}

/**
 * Make a Folder. The placement rule (node-rules P3): a Folder's Space is its
 * parent's, never the request's. The parent is read under a share lock inside
 * the create's transaction (node-placement lockParentFolder), so a concurrent
 * move of the parent can never leave the new Folder in the Space the parent
 * just left; a parent in another org or in Trash, or one in a different Space
 * from `spaceId`, is refused. The caller checks who may create here (P1).
 */
export async function createFolder(input: CreateFolderInput): Promise<FolderSummary> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Folder name is required");

  if (input.parentFolderId) {
    const parentDepth = await getFolderDepth(input.parentFolderId);
    if (parentDepth + 1 >= MAX_FOLDER_DEPTH) {
      throw new Error(`Folders can only nest ${MAX_FOLDER_DEPTH} levels deep`);
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    let spaceId = input.spaceId;
    if (input.parentFolderId) {
      const parent = await lockParentFolder(tx, input.organizationId, input.parentFolderId);
      if (!parent) throw new Error("That folder no longer exists or is in Trash.");
      if (parent.spaceId !== input.spaceId) throw new Error("That folder is in another Space.");
      spaceId = parent.spaceId;
    } else {
      const space = await tx.space.findFirst({ where: { id: input.spaceId, organizationId: input.organizationId }, select: { id: true } });
      if (!space) throw new Error("Space not found");
    }

    // Drop new folder at the end of its parent group (max position + 1024).
    // Fractional ordering (the Linear pattern), so insertions between two
    // folders pick the midpoint without renumbering.
    const last = await tx.folder.findFirst({
      where: { spaceId, parentFolderId: input.parentFolderId ?? null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + 1024;

    return tx.folder.create({
      data: {
        organizationId: input.organizationId,
        spaceId,
        parentFolderId: input.parentFolderId ?? null,
        name: trimmed,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        ownerId: input.userId,
        visibility: input.visibility ?? "WORKSPACE",
        position,
      },
      select: {
        id: true, name: true, description: true, icon: true, color: true,
        spaceId: true, parentFolderId: true, ownerId: true, visibility: true, position: true,
        archivedAt: true,
      },
    });
  });

  return { ...created, visibility: created.visibility as FolderVisibility, childCount: 0, boardCount: 0 };
}

/**
 * What a Folder edit may change. Never its Space or its parent: those are a
 * move, and a move goes through node-placement moveFolder (the placement
 * rule, node-rules P2 and P3), which takes the Space from the new parent and
 * carries the whole subtree. This type used to take both, and writing them
 * here is how a sub-folder once landed in another Space's root under a parent
 * that stayed behind.
 */
export interface UpdateFolderInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  position?: number;
  /**
   * access-model Broken #10: a Folder made PRIVATE at creation could never be
   * un-privated. `POST /api/folders` was the only writer of folder visibility
   * in the whole codebase, the share dialog had no control and the "…" menu
   * had no row, so the switch was one-way. It is a normal field now.
   */
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG";
}

/**
 * Is `candidate` inside `folderId`'s subtree (or the folder itself)?
 *
 * The Move guard. `updateFolder` already refused a folder as its own parent,
 * but not as its own GRANDparent: moving A under its child B detached the
 * whole branch from every tree query, because nothing walks a cycle. Bounded
 * by MAX_FOLDER_DEPTH + 2 so corrupt data cannot spin here.
 */
export async function isFolderDescendant(folderId: string, candidate: string): Promise<boolean> {
  if (folderId === candidate) return true;
  let currentId: string | null = candidate;
  for (let hops = 0; currentId && hops < MAX_FOLDER_DEPTH + 2; hops += 1) {
    const row: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: currentId },
      select: { parentFolderId: true },
    });
    if (!row) return false;
    if (row.parentFolderId === folderId) return true;
    currentId = row.parentFolderId;
  }
  return false;
}

/** A client or a transaction: the visibility route writes the Folder and its activity row in one. */
type FolderDb = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function updateFolder(folderId: string, patch: UpdateFolderInput, db: FolderDb = prisma) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Folder name cannot be empty");
    data.name = trimmed;
  }
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.position !== undefined) data.position = patch.position;
  if (patch.visibility !== undefined) data.visibility = patch.visibility;

  return db.folder.update({ where: { id: folderId }, data });
}

export async function archiveFolder(folderId: string, actorId: string | null = null) {
  return withArchivedBy(actorId, (extra) =>
    prisma.folder.update({ where: { id: folderId }, data: { archivedAt: new Date(), ...extra } }),
  );
}

export async function unarchiveFolder(folderId: string) {
  return prisma.folder.update({
    where: { id: folderId },
    data: { archivedAt: null },
  });
}

/**
 * Drag-reorder helper: pick a fractional position between two siblings.
 * Called from the Phase 2 sidebar drag handlers.
 *
 *   moveBetween(prev?.position, next?.position) → number
 *
 * If both bounds are present, returns midpoint. If only one is present,
 * extends by 1024 in the open direction. If neither, returns 0.
 */
export function positionBetween(before?: number | null, after?: number | null): number {
  if (before != null && after != null) return (before + after) / 2;
  if (before != null) return before + 1024;
  if (after != null) return after - 1024;
  return 0;
}
