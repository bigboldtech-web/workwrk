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

const ADMIN_ACCESS_LEVELS = new Set([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
]);

export interface SpaceSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parentSpaceId: string | null;
  ownerId: string | null;
  visibility: Visibility;
  displayOrder: number;
  archivedAt: Date | null;
  memberCount: number;
  folderCount: number;
  boardCount: number;
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

/** Is the user an org-level admin (implicit access to every Space)? */
export function isOrgAdminAccessLevel(accessLevel: string | null | undefined): boolean {
  return !!accessLevel && ADMIN_ACCESS_LEVELS.has(accessLevel);
}

/**
 * Spaces visible to a user inside their org. Org admins see everything;
 * other users see ORG-visibility Spaces + WORKSPACE-visibility Spaces
 * they're members of + PRIVATE Spaces they're members of.
 *
 * Archived Spaces are excluded by default; pass `includeArchived: true`
 * to see them (admin-only UI surface in Phase 2).
 */
export async function listSpacesForUser(
  userId: string,
  organizationId: string,
  opts: { accessLevel?: string; includeArchived?: boolean } = {},
): Promise<SpaceSummary[]> {
  const isAdmin = isOrgAdminAccessLevel(opts.accessLevel);
  const where = isAdmin
    ? {
        organizationId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
      }
    : {
        organizationId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
        OR: [
          { visibility: "ORG" as Visibility },
          { members: { some: { userId } } },
        ],
      };

  const rows = await prisma.space.findMany({
    where,
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      icon: true,
      color: true,
      parentSpaceId: true,
      ownerId: true,
      visibility: true,
      displayOrder: true,
      archivedAt: true,
      _count: { select: { members: true, folders: true, boards: true } },
    },
  });

  return rows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    icon: s.icon,
    color: s.color,
    parentSpaceId: s.parentSpaceId,
    ownerId: s.ownerId,
    visibility: s.visibility,
    displayOrder: s.displayOrder,
    archivedAt: s.archivedAt,
    memberCount: s._count.members,
    folderCount: s._count.folders,
    boardCount: s._count.boards,
  }));
}

/**
 * Read access check. Org admins always read. Otherwise:
 *   - ORG visibility → any org member reads.
 *   - WORKSPACE / PRIVATE → must have a SpaceMember row.
 * Returns the Space row if readable; null otherwise.
 */
export async function getSpaceForReader(spaceId: string, userId: string, accessLevel?: string) {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    include: { members: { where: { userId }, select: { role: true } } },
  });
  if (!space) return null;
  if (isOrgAdminAccessLevel(accessLevel)) return space;
  if (space.visibility === "ORG") return space;
  if (space.members.length > 0) return space;
  return null;
}

/**
 * Edit access check. Org admins always edit. Otherwise a SpaceMember
 * row with role OWNER or ADMIN is required.
 */
export async function canEditSpace(spaceId: string, userId: string, accessLevel?: string): Promise<boolean> {
  if (isOrgAdminAccessLevel(accessLevel)) return true;
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    select: { role: true },
  });
  return member?.role === "OWNER" || member?.role === "ADMIN";
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
}

export async function updateSpace(spaceId: string, patch: UpdateSpaceInput) {
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

  return prisma.space.update({ where: { id: spaceId }, data });
}

/** Soft-archive. archivedAt is set; Phase 2 ships the trash bin UI for restore. */
export async function archiveSpace(spaceId: string) {
  return prisma.space.update({
    where: { id: spaceId },
    data: { archivedAt: new Date() },
  });
}

export async function unarchiveSpace(spaceId: string) {
  return prisma.space.update({
    where: { id: spaceId },
    data: { archivedAt: null },
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
