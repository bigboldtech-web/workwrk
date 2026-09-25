// Spaces — top-level grouping in the ClickUp-style shell. A Space
// contains Folders and Boards; it's user-defined (Decision D1 = B).
// Visibility tiers: PRIVATE (members only), WORKSPACE (members +
// org admins), ORG (every member of the org). Org admins have
// implicit access to every Space without a SpaceMember row.
//
// Phase 1 only ships data-layer helpers. The Phase 6 access resolver
// will fold these checks into a single canonical entrypoint.

import { prisma } from "@/lib/prisma";
import type { SpaceRole, Visibility } from "@/generated/prisma";
import { createEntityLink } from "@/lib/entity-link";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { type ContainerRole } from "@/lib/work/container-menu";
import { withArchivedBy } from "@/lib/archived-by";
import { decide, emptyGrants, emptyRows, nodeCtxFromLevel, roleAtLeast, type MemberRole, type NodeRole, type NodeVisibility } from "@/lib/access/node-rules";
import { listVisibleSpaces } from "@/lib/access/node-access";

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
  return { row, role: decide(rows, grants, { kind: "space", id: row.id }).role };
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

  // Modules live inside the settings JSON (settings.workflow.modules). Read the
  // current blob and merge so we only touch the modules array — statuses,
  // views, defaultView, etc. are preserved.
  if (patch.modules !== undefined) {
    const current = await db.space.findUnique({ where: { id: spaceId }, select: { settings: true } });
    const settings = (current?.settings && typeof current.settings === "object" ? current.settings : {}) as Record<string, unknown>;
    const workflow = (settings.workflow && typeof settings.workflow === "object" ? settings.workflow : {}) as Record<string, unknown>;
    data.settings = { ...settings, workflow: { ...workflow, modules: patch.modules } };
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
