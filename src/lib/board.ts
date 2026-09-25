// Boards — the unification container that ClickUp calls a "List". A
// Board sits inside a Space (and optionally a Folder), declares an
// itemType + binding, and hosts one or more Views (table/kanban/etc).
//
// Two flavors via `itemType`:
//   - "studio-item" : user-built, columns defined in Board.schema.fields.
//                     Items live in the StudioItem table (or, longer-
//                     term, in a unified Item index). Phase 3 ships
//                     studio-item only; entity-bound boards land in
//                     Phase 3b when the ListBinding resolver does.
//   - "deal" | "task" | "ticket" | …  : entity-bound (Phase 3b)
//
// The Visibility resolver mirrors Space — admins always; otherwise
// the parent Space's membership + visibility decides.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { SpaceRole, Visibility, ViewType } from "@/generated/prisma";
import { legacyAllows } from "@/lib/access/parity";
import { loadBoardInputs } from "@/lib/access/legacy-facts";
import { parseBoardStatuses, type StatusOption } from "@/lib/board-items-shared";
import { withArchivedBy } from "@/lib/archived-by";
import { accessibleFolderIds } from "@/lib/folder";
import { mergeJsonObject, type ListDefaultsInput, type RowColorRule } from "@/lib/list-comfort";
import {
  parseSprintMeta,
  sprintBoardName,
  SPRINT_POINTS_FIELD_KEY,
  SPRINT_POINTS_LABEL,
  type SprintMeta,
} from "@/lib/sprint";
import {
  TASK_LIST_VIEW_TYPES,
  coreListViewRows,
  needsCoreListViews,
  missingCoreListViews,
} from "@/lib/work/list-view-seed";
import { resolveDefaultView, visibleToEveryone, type DefaultViewCandidate } from "@/lib/work/default-view";

// The org-admin ladder moved to src/lib/access/legacy-levels.ts with the
// step-1 pivot; the three gates below read it through parity.ts.

export interface BoardSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  itemType: string;
  spaceId: string | null;
  folderId: string | null;
  productSlug: string | null;
  visibility: Visibility;
  archivedAt: Date | null;
  defaultViewId: string | null;
  viewCount: number;
}

function toSlug(name: string): string {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) ||
    "board"
  );
}

async function uniqueBoardSlug(organizationId: string, desired: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? desired : `${desired}-${i + 1}`;
    const clash = await prisma.board.findFirst({
      where: { organizationId, slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${desired}-${Date.now()}`;
}

export interface CreateBoardInput {
  organizationId: string;
  userId: string;
  spaceId: string;
  folderId?: string | null;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  itemType?: string;             // default "studio-item"
  defaultViewType?: ViewType;    // default KANBAN, the Board
  visibility?: Visibility;
  /** Sprints (migration-free): when set, the board is created as a Sprint —
   *  settings.sprint written, Sprint Points NUMBER field seeded, and (when
   *  the name is empty) auto-named "Sprint N (M/D - M/D)". */
  sprint?: { startDate: string; endDate: string };
}

// Every task List ships with the same four views over the SAME tasks (Board,
// List, Calendar, Gantt: CORE_LIST_VIEWS in src/lib/work/list-view-seed.ts),
// so a task added in one shows in all. Board comes first and is the default by
// rule (src/lib/work/default-view.ts), not by a flag. Non-task Lists (Doc,
// Form, Canvas, Dashboard) are single-view and are left alone.
function isTaskListBoard(itemType: string, viewType: ViewType): boolean {
  return itemType === "studio-item" && TASK_LIST_VIEW_TYPES.has(viewType);
}

/** A seed row from list-view-seed.ts as a View create for this List. */
function seedViewData(
  boardId: string,
  ownerId: string,
  row: { name: string; type: ViewType; isDefault: boolean; config: Record<string, unknown>; displayOrder: number },
) {
  return {
    boardId,
    name: row.name,
    type: row.type,
    isDefault: row.isDefault,
    isShared: true,
    ownerId,
    config: row.config as Prisma.InputJsonValue,
    displayOrder: row.displayOrder,
  };
}

/**
 * Self-heal: ensure an existing task List has the full core view set. Only
 * touches Lists that already have a TABLE view (real task Lists), and only
 * appends the missing core views after the last one, never as the default:
 * it changes no existing view. Returns the number of views created. A List
 * with its full set costs one read and no write.
 *
 * The write takes a per-List advisory lock and re-reads inside it, so two
 * first visits at the same moment cannot both seed a Board (the second waits,
 * finds nothing missing, and writes nothing).
 */
export async function ensureCoreListViews(boardId: string, ownerId: string): Promise<number> {
  const views = await prisma.view.findMany({ where: { boardId }, select: { type: true } });
  if (!needsCoreListViews(views)) return 0;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`core-views:${boardId}`}))`;
    const current = await tx.view.findMany({ where: { boardId }, select: { type: true, displayOrder: true } });
    const missing = needsCoreListViews(current) ? missingCoreListViews(current) : [];
    if (missing.length === 0) return 0;
    let order = current.reduce((max, v) => Math.max(max, v.displayOrder), 0) + 1;
    await tx.view.createMany({
      data: missing.map((v) =>
        seedViewData(boardId, ownerId, { ...v, isDefault: false, displayOrder: order++ }),
      ),
    });
    return missing.length;
  });
}

/**
 * Create a Board with a default View of the given type. For studio-item
 * boards we also seed an empty `schema.fields` array so the field-shelf
 * UI has somewhere to write to.
 */
// Find-or-create the viewer's personal, space-less List board. This backs
// /my-work/personal so it renders through the very same board-table-view as
// every other List — one component, one Item-backed model. Marked by
// productSlug="personal-list" + ownerId.
//
// VISIBILITY IS "PRIVATE", WHICH IS NOT THE SAME AS "ONLY THE OWNER". The one
// rule is the PRIVATE branch of canViewBoard further down this file: members,
// the board owner, the OWNER of its Space (a Personal list has no Space, so
// nobody) and WORKSPACE ADMINS. A company admin can therefore read anybody's
// Personal list. That is deliberate and long-standing, but this comment used
// to say "only the owner sees it", which is the sentence somebody quotes when
// deciding what to put on a Personal list, and it was wrong.
// scripts/MIGRATIONS.md repeats it, because the legacy-task migration moves
// people's tasks and comments onto this board.
export async function getOrCreatePersonalBoard(organizationId: string, userId: string) {
  const existing = await prisma.board.findFirst({
    where: { organizationId, ownerId: userId, productSlug: "personal-list" },
  });
  if (existing) {
    // Self-healing rename, once, for the ONE auto-generated name this product
    // wrote before naming-canon fixed the case. It is the only name in the
    // product nobody chose, so correcting it takes nothing from anybody; a
    // board its owner renamed does not match the string and is left alone.
    if (existing.name === "Personal List") {
      const renamed = await prisma.board
        .update({ where: { id: existing.id }, data: { name: "Personal list" } })
        .catch(() => existing);
      return renamed;
    }
    return existing;
  }
  const slug = `personal-${userId}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: {
          organizationId,
          spaceId: null,
          slug,
          // naming-canon.md: "Personal list", sentence case, one label.
          // Boards created before this are corrected above, on read.
          name: "Personal list",
          itemType: "studio-item",
          productSlug: "personal-list",
          ownerId: userId,
          visibility: "PRIVATE",
          schema: { fields: [] },
          settings: {},
        },
      });
      // The Personal list is just a List that happens to be personal: the same
      // four views as any other List, opening on Board like every List does.
      await tx.view.createMany({
        data: coreListViewRows(null, null).map((row) => seedViewData(board.id, userId, row)),
      });
      return board;
    });
  } catch {
    // Lost the slug race on a concurrent first visit — return the existing row.
    const board = await prisma.board.findFirst({ where: { organizationId, slug } });
    if (board) return board;
    throw new Error("Failed to provision personal board");
  }
}

export async function createBoard(input: CreateBoardInput): Promise<BoardSummary & { defaultViewType: ViewType }> {
  const trimmed = input.name.trim();
  // Sprints may omit the name — it's derived from the sprint number + dates.
  if (!trimmed && !input.sprint) throw new Error("Board name is required");

  // Ensure the Space exists in the org; reject otherwise.
  const space = await prisma.space.findFirst({
    where: { id: input.spaceId, organizationId: input.organizationId },
    select: { id: true, settings: true },
  });
  if (!space) throw new Error("Space not found");

  // Cascade (backbone #1): a new board inherits the Space wizard's
  // workflow statuses. parseBoardStatuses accepts the wizard's
  // { key, label, color, group } shape directly; when the Space has no
  // wizard workflow the board's statuses stay NULL → the default trio.
  const spaceSettings = (space.settings ?? {}) as { workflow?: { statuses?: unknown } };
  const seededStatuses = parseBoardStatuses(spaceSettings.workflow?.statuses);

  // Optional Folder must live in the same Space.
  if (input.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: input.folderId, organizationId: input.organizationId, spaceId: input.spaceId },
      select: { id: true },
    });
    if (!folder) throw new Error("Folder not found in this Space");
  }

  // Sprint identity (migration-free): number the sprint 1 + max among this
  // Space's existing sprint boards (parsed client-side from settings — no
  // JSON-path query; fine at SMB scale). Empty name → the dates-in-name
  // convention "Sprint N (M/D - M/D)".
  let sprintMeta: SprintMeta | null = null;
  let boardName = trimmed;
  if (input.sprint) {
    const siblings = await prisma.board.findMany({
      where: { spaceId: input.spaceId, archivedAt: null },
      select: { settings: true },
    });
    let maxNumber = 0;
    for (const row of siblings) {
      const meta = parseSprintMeta(row.settings);
      if (meta && meta.sprintNumber > maxNumber) maxNumber = meta.sprintNumber;
    }
    const sprintNumber = maxNumber + 1;
    sprintMeta = {
      isSprint: true,
      sprintNumber,
      startDate: input.sprint.startDate,
      endDate: input.sprint.endDate,
    };
    if (!boardName) boardName = sprintBoardName(sprintNumber, input.sprint.startDate, input.sprint.endDate);
  }

  const slug = await uniqueBoardSlug(input.organizationId, toSlug(boardName));
  const itemType = input.itemType ?? "studio-item";
  // Board is every new List's default (decision 8). A caller that asks for
  // another type (a template with a real preference) gets that view pinned
  // by its creator, below.
  const viewType = input.defaultViewType ?? "KANBAN";

  // Sprint task Lists ship with the Sprint Points NUMBER field pre-seeded —
  // exactly the FieldDef addBoardField would produce, so every existing
  // renderer (table column, drawer, FieldShelf) picks it up unchanged.
  const seededSchema: Prisma.InputJsonValue =
    itemType === "studio-item"
      ? sprintMeta
        ? { fields: [{ key: SPRINT_POINTS_FIELD_KEY, label: SPRINT_POINTS_LABEL, type: "NUMBER", position: 0, options: { decimals: 0 } }] }
        : { fields: [] }
      : {};

  const created = await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        folderId: input.folderId ?? null,
        slug,
        name: boardName,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        itemType,
        ownerId: input.userId,
        visibility: input.visibility ?? "WORKSPACE",
        schema: seededSchema,
        settings: (sprintMeta ? { sprint: sprintMeta } : {}) as Prisma.InputJsonValue,
        ...(seededStatuses ? { statuses: seededStatuses as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    // Task Lists ship with the four core views, Board first; non-task Lists
    // (Doc, Form, Canvas...) get just their one view. KANBAN writes no
    // isDefault at all (Board is the default by rule, so there is no Pin
    // glyph nobody set); any other type is written as the creator's pin.
    if (isTaskListBoard(itemType, viewType)) {
      const mark = viewType === "KANBAN" ? null : { byId: input.userId, at: new Date().toISOString() };
      await tx.view.createMany({
        data: coreListViewRows(viewType, mark).map((row) => seedViewData(board.id, input.userId, row)),
      });
      const defaultView = await tx.view.findFirstOrThrow({
        where: { boardId: board.id, type: viewType },
        orderBy: { displayOrder: "asc" },
        select: { id: true, type: true },
      });
      return { board, defaultView };
    }
    const defaultView = await tx.view.create({
      data: {
        boardId: board.id,
        name: viewTypeDefaultLabel(viewType),
        type: viewType,
        isDefault: true,
        isShared: true,
        ownerId: input.userId,
        // The default List opens grouped by status (ClickUp parity); other
        // view types start ungrouped.
        config: viewType === "TABLE" ? { groupBy: "status" } : {},
        displayOrder: 0,
      },
    });
    return { board, defaultView };
  });

  return {
    id: created.board.id,
    slug: created.board.slug,
    name: created.board.name,
    description: created.board.description,
    icon: created.board.icon,
    color: created.board.color,
    itemType: created.board.itemType,
    spaceId: created.board.spaceId,
    folderId: created.board.folderId,
    productSlug: created.board.productSlug,
    visibility: created.board.visibility,
    archivedAt: created.board.archivedAt,
    defaultViewId: created.defaultView.id,
    defaultViewType: created.defaultView.type,
    viewCount: 1,
  };
}

function viewTypeDefaultLabel(t: ViewType): string {
  switch (t) {
    // The default TABLE view renders as a clean grouped task List (ClickUp's
    // basic view). A Monday-style "Table" is a separate, explicitly-added view.
    case "TABLE":    return "List";
    case "KANBAN":   return "Board";
    case "CALENDAR": return "Calendar";
    case "GANTT":    return "Gantt";
    case "TIMELINE": return "Timeline";
    case "FORM":     return "Form";
    case "DOC":      return "Doc";
    case "DASHBOARD":return "Dashboard";
    case "MAP":      return "Map";
    case "WORKLOAD": return "Workload";
    case "WHITEBOARD":return "Canvas";
    case "FILE_GALLERY": return "Gallery";
    case "CHART":    return "Chart";
    default:         return "View";
  }
}

/**
 * Each List's resolved default view (decision 8), in ONE query for all of
 * them. The id is the same for every reader of the List, so only views
 * everyone can see take part (a private default is its owner's alone). Only
 * the three config keys the resolver reads cross the wire (review #37), not
 * whole configs: a List's view config can hold column widths, filters and a
 * dozen more keys per view.
 */
async function resolvedDefaultViewIds(boardIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (boardIds.length === 0) return out;
  const rows = await prisma.$queryRaw<
    Array<{
      boardId: string;
      id: string;
      name: string;
      type: string;
      isDefault: boolean;
      isShared: boolean;
      ownerId: string | null;
      displayOrder: number;
      pinned: unknown;
      grid: unknown;
      variant: unknown;
    }>
  >`
    SELECT "boardId", id, name, type::text AS type, "isDefault", "isShared", "ownerId", "displayOrder",
      CASE WHEN jsonb_typeof(config) = 'object' THEN config -> 'pinned' END AS pinned,
      CASE WHEN jsonb_typeof(config) = 'object' THEN config -> 'grid' END AS grid,
      CASE WHEN jsonb_typeof(config) = 'object' THEN config -> 'variant' END AS variant
    FROM "View" WHERE "boardId" = ANY(${boardIds}::text[])`;
  const byBoard = new Map<string, DefaultViewCandidate[]>();
  for (const r of rows) {
    if (!visibleToEveryone(r)) continue;
    const list = byBoard.get(r.boardId) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      type: r.type,
      isDefault: r.isDefault,
      isShared: r.isShared,
      ownerId: r.ownerId,
      displayOrder: r.displayOrder,
      config: { pinned: r.pinned, grid: r.grid, variant: r.variant },
    });
    byBoard.set(r.boardId, list);
  }
  for (const [boardId, views] of byBoard) {
    views.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    const resolved = resolveDefaultView(views);
    if (resolved) out.set(boardId, resolved.view.id);
  }
  return out;
}

export async function listBoardsInSpace(spaceId: string, opts: { includeArchived?: boolean } = {}): Promise<BoardSummary[]> {
  const rows = await prisma.board.findMany({
    where: { spaceId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { views: true } },
    },
  });
  const defaults = await resolvedDefaultViewIds(rows.map((b) => b.id));
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    color: b.color,
    itemType: b.itemType,
    spaceId: b.spaceId,
    folderId: b.folderId,
    productSlug: b.productSlug,
    visibility: b.visibility,
    archivedAt: b.archivedAt,
    defaultViewId: defaults.get(b.id) ?? null,
    viewCount: b._count.views,
  }));
}

export async function listBoardsInFolder(
  folderId: string,
  opts: { includeArchived?: boolean; organizationId?: string } = {},
): Promise<BoardSummary[]> {
  const rows = await prisma.board.findMany({
    where: {
      folderId,
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { views: true } },
    },
  });
  const defaults = await resolvedDefaultViewIds(rows.map((b) => b.id));
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    color: b.color,
    itemType: b.itemType,
    spaceId: b.spaceId,
    folderId: b.folderId,
    productSlug: b.productSlug,
    visibility: b.visibility,
    archivedAt: b.archivedAt,
    defaultViewId: defaults.get(b.id) ?? null,
    viewCount: b._count.views,
  }));
}

export interface UpdateBoardInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  visibility?: Visibility;
  folderId?: string | null;
  /** Per-List statuses (backbone #1). null = reset to the default trio. */
  statuses?: StatusOption[] | null;
  /** Sprint date edit — only valid on boards that already carry
   *  settings.sprint (read-merge-write; other settings keys untouched). */
  sprint?: { startDate: string; endDate: string };
  /** The List's default task type (`settings.defaultItemTypeId`), written by
   *  the container menu's "Default task type" submenu. Read-merge-write. */
  defaultItemTypeId?: string | null;
  /** Phase 5b, List comfort: default values for NEW tasks (settings.defaults). null clears. */
  defaults?: ListDefaultsInput | null;
  /** Phase 5b, List comfort: conditional row colouring (settings.rowColorRules). null clears. */
  rowColorRules?: RowColorRule[] | null;
}

export async function updateBoard(boardId: string, patch: UpdateBoardInput) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Board name cannot be empty");
    data.name = trimmed;
  }
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.visibility !== undefined) data.visibility = patch.visibility;
  if (patch.folderId !== undefined) data.folderId = patch.folderId;
  // SQL NULL (DbNull) means "use the default set" — distinct from a
  // stored JSON null, which parseBoardStatuses would also reject.
  if (patch.statuses !== undefined) data.statuses = patch.statuses === null ? Prisma.DbNull : patch.statuses;
  // EVERY settings writer (the sprint dates, the default task type, the List
  // defaults and the row colour rules) runs in ONE transaction on the row read
  // FOR UPDATE, and merges over what is STORED (mergeJsonObject; null deletes a
  // key). Two writers used to read the blob, change their key and write the
  // whole thing back, so whichever saved second erased the other's key.
  const settingsWrite =
    patch.sprint !== undefined ||
    patch.defaultItemTypeId !== undefined ||
    patch.defaults !== undefined ||
    patch.rowColorRules !== undefined;
  if (!settingsWrite) return prisma.board.update({ where: { id: boardId }, data });
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ settings: unknown; name: string }>>`SELECT settings, name FROM "Board" WHERE id = ${boardId} FOR UPDATE`;
    const existing = rows[0];
    if (!existing) throw new Error("Board not found");
    const settingsPatch: Record<string, unknown> = {};
    if (patch.sprint !== undefined) {
      // Evaluated on the LOCKED row, so the sprint rule and the name rule see
      // the same state the write is based on.
      const meta = parseSprintMeta(existing.settings);
      if (!meta) throw new Error("Not a sprint List");
      settingsPatch.sprint = { ...meta, startDate: patch.sprint.startDate, endDate: patch.sprint.endDate };
      // Keep the dates-in-name convention true, but only while the name still
      // matches "Sprint N (…"; a user-customized name is left alone.
      if (data.name === undefined && /^Sprint \d+ \(/.test(existing.name)) {
        data.name = sprintBoardName(meta.sprintNumber, patch.sprint.startDate, patch.sprint.endDate);
      }
    }
    if (patch.defaultItemTypeId !== undefined) settingsPatch.defaultItemTypeId = patch.defaultItemTypeId;
    if (patch.defaults !== undefined) settingsPatch.defaults = patch.defaults;
    if (patch.rowColorRules !== undefined) settingsPatch.rowColorRules = patch.rowColorRules;
    data.settings = mergeJsonObject(existing.settings, settingsPatch) as Prisma.InputJsonValue;
    return tx.board.update({ where: { id: boardId }, data });
  });
}

export async function archiveBoard(boardId: string, actorId: string | null = null) {
  return withArchivedBy(actorId, (extra) =>
    prisma.board.update({ where: { id: boardId }, data: { archivedAt: new Date(), ...extra } }),
  );
}

/**
 * Deep-clone a Board into the SAME space/folder: a new board (fresh slug,
 * "(copy)" name, owned by the actor) with its columns (schema), statuses,
 * settings, views, and all NON-archived items copied verbatim — item cell
 * values (metadata) stay valid because the field keys (schema) are unchanged.
 * Fresh ids everywhere; subtasks are re-parented through an old→new map and
 * inserted parents-first. Recurrence anchors are dropped so we don't spawn a
 * second series. History, comments, tags and time entries are NOT copied —
 * they belong to the original. Caller must have already gated edit access.
 */
export async function duplicateBoard(
  sourceId: string,
  actorId: string,
  organizationId: string,
  // spec-spaces-lists section 1 (List menu row 17): the Duplicate confirm has
  // one checkbox, "Include tasks", and it is OFF. The default here is TRUE so
  // that a caller that sends nothing keeps the behaviour it had before the
  // checkbox existed; the dialog sends the answer explicitly either way.
  opts: { includeTasks?: boolean } = {},
): Promise<{ id: string; slug: string; name: string }> {
  const includeTasks = opts.includeTasks !== false;
  const src = await prisma.board.findFirst({ where: { id: sourceId, organizationId } });
  if (!src) throw new Error("Board not found");
  // itemId==id holds only for the studio-item flavor; an entity-bound board
  // (Phase 3b) would clone item ids that point at no real entity, so refuse it.
  if (src.itemType !== "studio-item") {
    throw new Error("This kind of List can't be duplicated yet.");
  }

  const [items, views] = await Promise.all([
    includeTasks
      ? prisma.item.findMany({ where: { boardId: sourceId, archivedAt: null } })
      : Promise.resolve([]),
    prisma.view.findMany({ where: { boardId: sourceId } }),
  ]);

  const name = `${src.name} (copy)`;
  const slug = await uniqueBoardSlug(organizationId, toSlug(name));

  // New id per item, used to re-map subtask parents.
  const idMap = new Map<string, string>();
  for (const it of items) idMap.set(it.id, crypto.randomUUID());

  const clonedItems = items.map((it) => {
    const newId = idMap.get(it.id) as string;
    return {
      id: newId,
      itemId: newId, // satisfies @@unique([itemType, itemId])
      organizationId,
      itemType: it.itemType,
      title: it.title,
      status: it.status,
      ownerId: it.ownerId,
      groupKey: it.groupKey,
      position: it.position,
      startAt: it.startAt,
      dueAt: it.dueAt,
      priority: it.priority,
      itemTypeId: it.itemTypeId,
      workType: it.workType,
      metadata: it.metadata as Prisma.InputJsonValue,
      // A subtask whose parent was archived (and thus not cloned) becomes
      // top-level rather than dangling.
      parentItemId: it.parentItemId ? idMap.get(it.parentItemId) ?? null : null,
    };
  });

  const created = await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        organizationId,
        spaceId: src.spaceId,
        folderId: src.folderId,
        name,
        slug,
        description: src.description,
        icon: src.icon,
        color: src.color,
        itemType: src.itemType,
        productSlug: src.productSlug,
        visibility: src.visibility,
        ownerId: actorId,
        isDefault: false,
        schema: src.schema as Prisma.InputJsonValue,
        // SQL NULL (DbNull), matching updateBoard's "use the default trio"
        // convention — NOT a stored JSON null.
        statuses: src.statuses === null ? Prisma.DbNull : (src.statuses as Prisma.InputJsonValue),
        settings: src.settings as Prisma.InputJsonValue,
      },
    });

    if (views.length > 0) {
      await tx.view.createMany({
        data: views.map((v) => ({
          boardId: board.id,
          name: v.name,
          type: v.type,
          isShared: v.isShared,
          isDefault: v.isDefault,
          // A personal (owned) view becomes the actor's; shared views stay shared.
          ownerId: v.ownerId ? actorId : null,
          displayOrder: v.displayOrder,
          config: v.config as Prisma.InputJsonValue,
        })),
      });
    }

    // Insert items parents-first so subtask FKs resolve.
    const rows = clonedItems.map((r) => ({ ...r, boardId: board.id }));
    const inserted = new Set<string>();
    let remaining = rows;
    while (remaining.length > 0) {
      const ready = remaining.filter((r) => !r.parentItemId || inserted.has(r.parentItemId));
      const batch = ready.length > 0 ? ready : remaining.map((r) => ({ ...r, parentItemId: null }));
      await tx.item.createMany({ data: batch, skipDuplicates: true });
      for (const r of batch) inserted.add(r.id);
      const doneIds = new Set(batch.map((r) => r.id));
      remaining = remaining.filter((r) => !doneIds.has(r.id));
    }

    return board;
  }, { timeout: 30_000, maxWait: 10_000 }); // room for large boards (many items)

  return { id: created.id, slug: created.slug, name };
}

/**
 * Resolve board-level read access, composing Space + Board layers.
 *
 *   visibility = ORG       → any org member can read (overrides Space if Space is stricter)
 *   visibility = WORKSPACE → defer to Space access (the default; "inherit")
 *   visibility = PRIVATE   → BoardMember + Board.ownerId + Space OWNER + org admin only
 *
 * Returns the board row when readable, null otherwise.
 */
export async function getBoardForReader(
  boardId: string,
  userId: string,
  accessLevel: string | null | undefined,
) {
  // Delegate (migration step 1) to parity.ts's transcription of board.ts's
  // seven branches (:614 through :664), including the two this file is known
  // for: the direct BoardMember grant of ANY role, and the private-folder
  // cascade that checks folder.ownerId and never FolderMember. Both stay
  // exactly as they are; the engine's own answers for them differ and are
  // recorded in EXPECTED_MISMATCHES as audit-1.6 rows a and c.
  //
  // The loader issues at most three queries where this body issued four, and
  // returns the identical row shape ({ id, spaceId, visibility, ownerId,
  // organizationId, folderId }) so boards/[id]/items:62's cross-org check and
  // every other field read still compile and behave.
  const { inputs, board } = await loadBoardInputs(
    boardId,
    { userId, accessLevel },
    { folderDepth: "shallow" },
  );
  return legacyAllows(inputs, "getBoardForReader") ? board : null;
}

/**
 * getBoardForReader PLUS the one reader it deliberately does not know about:
 * a FOLDER GRANTEE.
 *
 * `getBoardForReader`'s folder branch consults `folder.ownerId` and never
 * `FolderMember` (its own comment says so), so a person holding a granular
 * folder grant and no Space membership fails it. Granular folder access is a
 * shipped feature that is ADDITIVE and INHERITED downward, and the rest of the
 * product honours it: `folderAccessForSpace` ships every board in a granted
 * folder to the sidebar tree, and the Folder page goes out of its way to keep
 * a grantee working. Reading the board through the strict predicate alone
 * therefore left the grantee with live links into a notFound() page: a dead
 * end with no explanation, on a destination that used to work.
 *
 * Kept as its own function rather than folded into `getBoardForReader`,
 * because that one is transcribed in the frozen parity engine and every API
 * route is pinned to its exact answers. Use this on SURFACES that a grantee is
 * linked to.
 */
export async function getBoardForReaderOrFolderGrantee(
  boardId: string,
  userId: string,
  accessLevel: string | null | undefined,
) {
  const board = await getBoardForReader(boardId, userId, accessLevel);
  if (board) return board;
  const row = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, spaceId: true, visibility: true, ownerId: true, organizationId: true, folderId: true },
  });
  if (!row?.folderId) return null;
  return (await folderGrantCovers(row.folderId, userId)) ? row : null;
}

/**
 * The folder-grant half of getBoardForReaderOrFolderGrantee on its own: does
 * one of this viewer's folder grants cover `folderId`? For a caller that has
 * already run getBoardForReader and already holds the List's folderId (the
 * item gate), so the reader's reads are not repeated. A grant cascades to
 * sub-folders, which is why this is the descendant-aware set and not a single
 * FolderMember lookup.
 */
export async function folderGrantCovers(folderId: string, userId: string): Promise<boolean> {
  const granted = await accessibleFolderIds(userId);
  return granted.has(folderId);
}

/**
 * Edit access check. Org admins always edit. Otherwise:
 *   PRIVATE → BoardMember OWNER/ADMIN, Board.ownerId, or Space OWNER
 *   else    → defer to canEditSpace (Space OWNER/ADMIN)
 */
export async function canEditBoard(
  boardId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  // Delegate (migration step 1) to parity.ts's transcription of board.ts:677-704.
  // The asymmetry it preserves: a BoardMember ADMIN manages only a PRIVATE
  // board, because on any other visibility this function falls through to
  // canEditSpace and the board-level grant is never consulted.
  const { inputs } = await loadBoardInputs(
    boardId,
    { userId, accessLevel },
    { folderDepth: "none" },
  );
  return legacyAllows(inputs, "canEditBoard");
}

/**
 * CONTENT-write access — create / edit / delete tasks and comment. This is the
 * "can a MEMBER make changes" gate, deliberately looser than canEditBoard
 * (which MANAGES the board: fields, settings, members, delete). A GUEST is
 * read-only; MEMBER / ADMIN / OWNER on the board OR the parent Space
 * contribute; org admins and the board owner always do. Additive: the most
 * permissive grant wins. A PRIVATE board is reachable only by an explicit
 * (non-guest) board grant — Space membership doesn't pierce it.
 */
export async function canContributeBoard(
  boardId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  // Delegate (migration step 1) to parity.ts's transcription of board.ts:721-746.
  // A non-guest Space MEMBER still writes, which is the 2026-09-09 decision the
  // schema comment at prisma/schema.prisma:4364-4365 still contradicts; that
  // stale comment is a docs fix, not an access change, and is left alone here.
  const { inputs } = await loadBoardInputs(
    boardId,
    { userId, accessLevel },
    { folderDepth: "none" },
  );
  return legacyAllows(inputs, "canContributeBoard");
}

/**
 * Legacy thin wrapper. Kept so older call sites compile while we
 * migrate them to getBoardForReader. New code should use the resolver.
 */
export async function canReadBoard(boardId: string, userId: string, accessLevel?: string): Promise<boolean> {
  const board = await getBoardForReader(boardId, userId, accessLevel);
  return Boolean(board);
}

export async function listBoardMembers(boardId: string) {
  return prisma.boardMember.findMany({
    where: { boardId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function addBoardMember(boardId: string, userId: string, role: SpaceRole, invitedBy?: string) {
  return prisma.boardMember.upsert({
    where: { boardId_userId: { boardId, userId } },
    create: { boardId, userId, role, invitedBy: invitedBy ?? null },
    update: { role },
  });
}

export async function removeBoardMember(boardId: string, userId: string) {
  return prisma.boardMember.delete({
    where: { boardId_userId: { boardId, userId } },
  });
}
