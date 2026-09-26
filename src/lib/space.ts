// Spaces — top-level grouping in the ClickUp-style shell. A Space
// contains Folders and Boards; it's user-defined (Decision D1 = B).
// Visibility tiers: PRIVATE (members only), WORKSPACE (members +
// org admins), ORG (every member of the org). Org admins have
// implicit access to every Space without a SpaceMember row.
//
// Phase 1 only ships data-layer helpers. The Phase 6 access resolver
// will fold these checks into a single canonical entrypoint.

import { prisma } from "@/lib/prisma";
import type { Prisma, Space, SpaceRole, Visibility } from "@/generated/prisma";
import { createEntityLink } from "@/lib/entity-link";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { legacyAllows, type SpaceRoleValue, type VisibilityValue } from "@/lib/access/parity";
import { emptyLegacyInputs, loadSpaceInputs } from "@/lib/access/legacy-facts";
import { spaceContainerRole, type ContainerRole } from "@/lib/work/container-menu";
import { withArchivedBy } from "@/lib/archived-by";
import { accessibleFolderIds } from "@/lib/folder";
import { decideSpaceLists } from "@/lib/work/space-lists";
import { mergeSpaceSettings, spaceModulesPatch } from "@/lib/work/space-default-view";

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
  /**
   * The viewer's object role on this Space ("full" | "edit" | "view"), derived
   * from the same membership `canEditSpace` / `canContributeSpace` read. Every
   * surface that renders a container "…" needs it, and the sidebar cannot
   * afford one async access call per row.
   */
  role: ContainerRole;
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
  opts: { accessLevel?: string; includeArchived?: boolean; includeFolderContainers?: boolean } = {},
): Promise<SpaceSummary[]> {
  const isAdmin = isOrgAdminAccessLevel(opts.accessLevel);
  // `includeFolderContainers` widens the list to spaces the viewer can reach
  // ONLY via a folder grant — a container for the folder they were shared. It
  // returns space metadata only (name/icon/counts), NEVER space content, so it
  // is safe here even though a folder-only grantee is not a full space reader.
  // Callers that fan out to space-scoped CONTENT must not pass it.
  const folderContainerClause = opts.includeFolderContainers
    ? [{ folders: { some: { archivedAt: null, members: { some: { userId } } } } }]
    : [];
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
          ...folderContainerClause,
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
      // Counts must exclude archived (trashed) folders/boards — the actual
      // lists do (board.ts / folder.ts filter archivedAt: null), so an
      // unfiltered count reads higher than what the sidebar can show.
      _count: {
        select: {
          members: true,
          folders: { where: { archivedAt: null } },
          boards: { where: { archivedAt: null } },
        },
      },
      // The viewer's own membership row, for the per-Space role below.
      members: { where: { userId }, select: { role: true }, take: 1 },
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
    role: spaceContainerRole({ isOrgAdmin: isAdmin, memberRole: s.members[0]?.role ?? null }),
  }));
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
 * Read access check. Org admins always read. Otherwise:
 *   - ORG visibility → any org member reads.
 *   - WORKSPACE / PRIVATE → must have a SpaceMember row.
 * Returns the Space row if readable; null otherwise.
 */
export async function getSpaceForReader(spaceId: string, userId: string, accessLevel?: string) {
  // Delegate (migration step 1). The row is loaded by the engine's legacy
  // facts loader with the same include this function used, and the decision is
  // parity.ts's transcription of space.ts:199-203. No org filter is applied
  // here today and none is added: the loader fills organizationId from the row
  // so the comparison can never narrow. The row itself is still the return
  // value, so every caller that reads space.settings or space.organizationId
  // is untouched.
  const { inputs, space } = await loadSpaceInputs(spaceId, { userId, accessLevel });
  return legacyAllows(inputs, "getSpaceForReader") ? space : null;
}

/**
 * Edit access check. Org admins always edit. Otherwise a SpaceMember
 * row with role OWNER or ADMIN is required.
 */
export async function canEditSpace(spaceId: string, userId: string, accessLevel?: string): Promise<boolean> {
  // Delegate (migration step 1) to parity.ts's transcription of space.ts:211-216.
  // The admin branch is first there as it was here, so an org admin still
  // issues no query at all.
  const viewer = { userId, accessLevel };
  const inputs = isOrgAdminAccessLevel(accessLevel)
    ? emptyLegacyInputs(viewer)
    : (await loadSpaceInputs(spaceId, viewer)).inputs;
  return legacyAllows(inputs, "canEditSpace");
}

/**
 * CONTENT-write check — can this user create/edit content in the Space (tasks,
 * comments), as opposed to MANAGING it (members, settings, structure, which
 * stay on canEditSpace = OWNER/ADMIN). A plain MEMBER contributes; a GUEST is
 * read-only. This is what lets a Space "member" actually make changes.
 */
export async function canContributeSpace(spaceId: string, userId: string, accessLevel?: string): Promise<boolean> {
  // Delegate (migration step 1) to parity.ts's transcription of space.ts:226-231.
  const viewer = { userId, accessLevel };
  const inputs = isOrgAdminAccessLevel(accessLevel)
    ? emptyLegacyInputs(viewer)
    : (await loadSpaceInputs(spaceId, viewer)).inputs;
  return legacyAllows(inputs, "canContributeSpace");
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
  /** The viewer's own BoardMember role on it. */
  memberRole: SpaceRole | null;
  /** canContributeBoard's answer: may this viewer create and change its tasks? */
  canContribute: boolean;
}

/**
 * Every List of one Space the viewer can read, in the Work sidebar's order,
 * with whether they may write in each, and how many of its folders they see.
 *
 * Why one function. The Space page used to pick its Lists with an inline
 * rule that read only the ROOT folders' Lists and never read BoardMember or
 * FolderMember: a List in a sub-folder was missing from every cross-List tab,
 * a PRIVATE List shared to someone never appeared for them, and the header
 * counted every List, readable or not. This is now the one answer for Bird's
 * eye, every other Space tab, the header's count and GET /api/boards?spaceId=.
 *
 * Cost, whatever the List count: four reads in parallel (the Space with the
 * viewer's SpaceMember row, its live folders, its live Lists with the
 * viewer's BoardMember row, the viewer's folder grants, which an org admin
 * skips), then every decision in memory through the frozen transcriptions
 * (src/lib/work/space-lists.ts). Member rows arrive as relation includes on
 * org-scoped reads; the member tables are never queried on their own.
 *
 * The caller gates the Space first. A Space outside the viewer's org, or one
 * that does not exist, answers no Lists.
 */
export async function readableListsInSpace(
  spaceId: string,
  viewer: SpaceViewer,
  opts: { includeSchema?: boolean; includeSettings?: boolean; includeArchived?: boolean } = {},
): Promise<{ lists: SpaceListRow[]; folderCount: number }> {
  const live = opts.includeArchived ? {} : { archivedAt: null };
  const includeSettings = opts.includeSettings === true;
  const includeSchema = opts.includeSchema === true;
  const [space, folders, boards, granted] = await Promise.all([
    prisma.space.findFirst({
      where: { id: spaceId, organizationId: viewer.organizationId },
      select: {
        id: true,
        organizationId: true,
        visibility: true,
        ownerId: true,
        members: { where: { userId: viewer.userId }, select: { role: true } },
      },
    }),
    prisma.folder.findMany({
      where: { spaceId, organizationId: viewer.organizationId, ...live },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, parentFolderId: true, visibility: true, ownerId: true },
    }),
    prisma.board.findMany({
      where: { spaceId, organizationId: viewer.organizationId, ...live },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        icon: true,
        color: true,
        visibility: true,
        ownerId: true,
        folderId: true,
        statuses: true,
        settings: includeSettings,
        schema: includeSchema,
        members: { where: { userId: viewer.userId }, select: { role: true } },
      },
    }),
    isOrgAdminAccessLevel(viewer.accessLevel) ? Promise.resolve(new Set<string>()) : accessibleFolderIds(viewer.userId),
  ]);
  if (!space) return { lists: [], folderCount: 0 };

  const { lists, visibleFolderCount } = decideSpaceLists(viewer, {
    space: {
      id: space.id,
      organizationId: space.organizationId,
      visibility: space.visibility as VisibilityValue,
      ownerId: space.ownerId,
      memberRole: (space.members[0]?.role as SpaceRoleValue | undefined) ?? null,
    },
    folders,
    boards: boards.map((b) => ({ ...b, memberRole: (b.members[0]?.role as SpaceRoleValue | undefined) ?? null })),
    granted,
  });
  return {
    lists: lists.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      icon: b.icon,
      color: b.color,
      visibility: b.visibility,
      ownerId: b.ownerId,
      folderId: b.folderId,
      statuses: b.statuses,
      ...(includeSettings ? { settings: b.settings } : {}),
      ...(includeSchema ? { schema: b.schema } : {}),
      memberRole: b.memberRole,
      canContribute: b.canContribute,
    })),
    folderCount: visibleFolderCount,
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

  return prisma.space.update({ where: { id: spaceId }, data });
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
