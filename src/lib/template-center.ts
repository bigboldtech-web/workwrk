// Template Center materialize logic. Turns a saved `Template.payload`
// into real entities:
//   TASK       -> returns the create-task modal config (client fills the modal)
//   LIST       -> creates a Board (+ statuses, fields, views, seed items)
//   SPACE      -> creates a Space (+ workflow) and its child Lists
//   FOLDER     -> creates a Folder (+ its child Lists)
//   DOC        -> creates a Doc anchored to a Space
//   WHITEBOARD -> creates a Canvas in a Space (and a Folder when given one)
//   VIEW       -> creates a saved view on a List
// Reuses createBoard / createSpace / createFolder / createBoardItem so all the
// normal invariants (slugging, default view, status cascade) hold.
//
// The last four used to 400 with "Applying {kind} templates is not supported
// yet" (audit High #6): the Template Center let a person pick a Folder, Doc,
// View or Canvas template and then refused it. Every kind materializes here
// now, and src/lib/templates/kinds.ts decides where the person lands.

import { prisma } from "@/lib/prisma";
import { createBoard } from "@/lib/board";
import { createSpace } from "@/lib/space";
import { createFolder } from "@/lib/folder";
import { createBoardItem } from "@/lib/board-items";
import type { ViewType, Prisma } from "@/generated/prisma";
import type { StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import {
  resolveDefaultView,
  visibleToEveryone,
  withPinnedDefault,
  withoutPinnedDefault,
} from "@/lib/work/default-view";
import { planTemplateViews, templateDefaultViewType } from "@/lib/work/list-view-seed";

/**
 * Who may create a Space, as one exported set.
 *
 * POST /api/spaces enforces this floor with its own private copy. The Space
 * template apply route needs the SAME answer (applying a Space template
 * creates a Space), and a second private copy is how the two drift, so the set
 * lives here and both read it.
 */
export const SPACE_CREATE_LEVELS: ReadonlySet<string> = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD",
]);

// Payload shapes. Loose: validated leniently at apply time.

export interface ListTemplatePayload {
  icon?: string;
  color?: string;
  statuses?: StatusOption[];
  fields?: FieldDef[];
  /** `pinned` marks the view the List opens on (the source List's pinned default). */
  views?: Array<{ type: ViewType; name?: string; config?: Record<string, unknown>; pinned?: boolean }>;
  items?: Array<{ title: string; status?: string; priority?: string; metadata?: Record<string, unknown> }>;
  /**
   * The type of the source List's default view. Older snapshots recorded the
   * raw isDefault type, which was almost always TABLE (the old system
   * default), so TABLE reads as no preference: see templateDefaultViewType.
   */
  defaultView?: ViewType;
}

export interface SpaceTemplatePayload {
  icon?: string;
  color?: string;
  workflow?: Record<string, unknown>; // { statuses, views, modules, defaultView }
  lists?: Array<{ name: string } & ListTemplatePayload>;
}

const VIEW_LABEL: Record<string, string> = {
  TABLE: "List", KANBAN: "Board", GANTT: "Gantt", CALENDAR: "Calendar",
  TIMELINE: "Timeline", CHART: "Chart", DOC: "Doc", FORM: "Form",
  DASHBOARD: "Dashboard", MAP: "Map", WORKLOAD: "Workload",
  WHITEBOARD: "Canvas", FILE_GALLERY: "Files",
};
function viewLabel(t: ViewType): string {
  return VIEW_LABEL[t] ?? String(t).charAt(0) + String(t).slice(1).toLowerCase();
}

// ── LIST: create a Board from a list template ──────────────────────

export async function applyListTemplate(
  payload: ListTemplatePayload,
  ctx: { organizationId: string; userId: string; spaceId: string; folderId?: string | null; name: string },
): Promise<{ boardId: string; slug: string }> {
  // Board unless the template carries a real preference (review #33).
  const defaultViewType = templateDefaultViewType(payload) as ViewType;
  const board = await createBoard({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    spaceId: ctx.spaceId,
    folderId: ctx.folderId ?? null,
    name: ctx.name,
    icon: payload.icon,
    color: payload.color,
    defaultViewType,
  });

  // Statuses + custom fields land on the Board row.
  const data: Prisma.BoardUpdateInput = {};
  if (Array.isArray(payload.statuses) && payload.statuses.length) {
    data.statuses = payload.statuses as unknown as Prisma.InputJsonValue;
  }
  if (Array.isArray(payload.fields) && payload.fields.length) {
    data.schema = { fields: payload.fields } as unknown as Prisma.InputJsonValue;
  }
  if (Object.keys(data).length) {
    await prisma.board.update({ where: { id: board.id }, data });
  }

  // The template's views, laid over the ones createBoard just made. The old
  // loop skipped only the default type and created everything else, so every
  // snapshot of an ordinary List came back with a second Board, Calendar and
  // Gantt beside createBoard's own, on colliding displayOrders. A payload
  // view that matches a created one by type and name IS that view now.
  const payloadViews = (Array.isArray(payload.views) ? payload.views : []).filter(
    (v): v is NonNullable<typeof v> => typeof v?.type === "string",
  );
  if (payloadViews.length > 0) {
    const created = await prisma.view.findMany({
      where: { boardId: board.id },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true, displayOrder: true, config: true },
    });
    const plan = planTemplateViews(created, payloadViews, (t) => viewLabel(t as ViewType));
    if (plan.updates.length > 0 || plan.creates.length > 0) {
      const mark = { byId: ctx.userId, at: new Date().toISOString() };
      const pins = plan.updates.some((u) => u.pin) || plan.creates.some((cr) => cr.pin);
      // One transaction: the template's views land together or not at all.
      // No List lock is taken for the pin: the List is seconds old and nobody
      // else can see it yet.
      await prisma.$transaction(async (tx) => {
        if (pins) {
          await tx.$executeRaw`
            UPDATE "View" SET "isDefault" = false,
              "config" = CASE WHEN jsonb_typeof("config") = 'object' THEN "config" - 'pinned' ELSE "config" END,
              "updatedAt" = NOW()
            WHERE "boardId" = ${board.id}
              AND ("isDefault" = true OR ("config" -> 'pinned') IS NOT NULL)`;
        }
        for (const u of plan.updates) {
          await tx.view.update({
            where: { id: u.id },
            data: u.pin
              ? { isDefault: true, config: withPinnedDefault(u.config, mark) as Prisma.InputJsonValue }
              : { config: u.config as Prisma.InputJsonValue },
          });
        }
        for (const cr of plan.creates) {
          await tx.view.create({
            data: {
              boardId: board.id,
              name: cr.name,
              type: cr.type as ViewType,
              isShared: true,
              ownerId: ctx.userId,
              isDefault: cr.pin,
              config: (cr.pin ? withPinnedDefault(cr.config, mark) : cr.config) as Prisma.InputJsonValue,
              displayOrder: cr.displayOrder,
            },
          });
        }
      });
    }
  }

  // Seed items.
  for (const it of payload.items ?? []) {
    if (!it?.title) continue;
    await createBoardItem({
      organizationId: ctx.organizationId,
      boardId: board.id,
      title: it.title,
      status: it.status,
      priority: it.priority ?? null,
      metadata: it.metadata ?? {},
      actorId: ctx.userId,
    });
  }

  return { boardId: board.id, slug: board.slug };
}

// ── SPACE: create a Space + its child Lists ────────────────────────

export async function applySpaceTemplate(
  payload: SpaceTemplatePayload,
  ctx: { organizationId: string; userId: string; name: string; visibility?: "PRIVATE" | "WORKSPACE" | "ORG" },
): Promise<{ spaceId: string; slug: string }> {
  const space = await createSpace({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    name: ctx.name,
    icon: payload.icon,
    color: payload.color,
    visibility: ctx.visibility,
    settings: payload.workflow ? { workflow: payload.workflow } : undefined,
  });

  for (const list of payload.lists ?? []) {
    if (!list?.name) continue;
    await applyListTemplate(list, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      spaceId: space.id,
      name: list.name,
    });
  }

  return { spaceId: space.id, slug: space.slug };
}

// ── FOLDER: create a Folder and the Lists it carries ───────────────

export interface FolderTemplatePayload {
  icon?: string;
  color?: string;
  description?: string;
  lists?: Array<{ name: string } & ListTemplatePayload>;
}

export async function applyFolderTemplate(
  payload: FolderTemplatePayload,
  ctx: { organizationId: string; userId: string; spaceId: string; parentFolderId?: string | null; name: string },
): Promise<{ folderId: string; spaceId: string }> {
  const folder = await createFolder({
    organizationId: ctx.organizationId,
    spaceId: ctx.spaceId,
    parentFolderId: ctx.parentFolderId ?? undefined,
    name: ctx.name,
    description: payload.description,
    icon: payload.icon,
    color: payload.color,
    userId: ctx.userId,
  });

  for (const list of payload.lists ?? []) {
    if (!list?.name) continue;
    await applyListTemplate(list, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      spaceId: ctx.spaceId,
      folderId: folder.id,
      name: list.name,
    });
  }

  return { folderId: folder.id, spaceId: ctx.spaceId };
}

// ── DOC: create a Doc anchored to a Space ──────────────────────────

export interface DocTemplatePayload {
  /** The block-editor document, stored exactly as the Doc column holds it. */
  content?: unknown;
  title?: string;
}

export async function applyDocTemplate(
  payload: DocTemplatePayload,
  ctx: { organizationId: string; userId: string; spaceId: string | null; name: string },
): Promise<{ docId: string }> {
  const doc = await prisma.doc.create({
    data: {
      organizationId: ctx.organizationId,
      title: ctx.name,
      content: (payload.content ?? {}) as Prisma.InputJsonValue,
      entityType: ctx.spaceId ? "SPACE" : null,
      entityId: ctx.spaceId,
      position: Date.now(),
      createdById: ctx.userId,
      // Every Doc has at least one version, the same invariant POST /api/docs holds.
      versions: { create: { version: 1, title: ctx.name, content: (payload.content ?? {}) as Prisma.InputJsonValue, authorId: ctx.userId } },
    },
    select: { id: true },
  });
  return { docId: doc.id };
}

// ── WHITEBOARD (the canon word is Canvas) ──────────────────────────

export interface WhiteboardTemplatePayload {
  scene?: unknown;
  description?: string;
}

export async function applyWhiteboardTemplate(
  payload: WhiteboardTemplatePayload,
  ctx: { organizationId: string; userId: string; spaceId: string | null; folderId?: string | null; name: string },
): Promise<{ whiteboardId: string }> {
  const base = {
    organizationId: ctx.organizationId,
    name: ctx.name,
    description: payload.description ?? null,
    scene: (payload.scene ?? {}) as Prisma.InputJsonValue,
    ownerId: ctx.userId,
    spaceId: ctx.spaceId,
  };
  // Whiteboard.folderId ships in 2026-09-19-canvas-folder.sql; a database that
  // has not had it applied yet must still get its Canvas, so the folder anchor
  // is the part that degrades, never the create.
  try {
    const wb = await prisma.whiteboard.create({
      data: { ...base, folderId: ctx.folderId ?? undefined },
      select: { id: true },
    });
    return { whiteboardId: wb.id };
  } catch (err) {
    // Only the ONE failure this retry is for. A bare catch turned a transient
    // connection failure, a constraint violation or a bad scene payload into a
    // silent SECOND create with the folder anchor quietly dropped, and told
    // the caller it had succeeded. Anything that is not "this column or
    // relation does not exist" is rethrown.
    if (!ctx.folderId || !isUnknownFolderColumn(err)) throw err;
    const wb = await prisma.whiteboard.create({ data: base, select: { id: true } });
    return { whiteboardId: wb.id };
  }
}

/** Is this the error a database or client that predates `Whiteboard.folderId` raises? */
function isUnknownFolderColumn(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown };
  // P2022 is Prisma's "column does not exist"; the client-side validation
  // error for an unknown field is not coded, so the message is the only tell.
  if (e?.code === "P2022") return true;
  const message = typeof e?.message === "string" ? e.message : "";
  return message.includes("folderId");
}

// ── VIEW: add a saved view to an existing List ─────────────────────

export interface ViewTemplatePayload {
  type?: ViewType;
  config?: Record<string, unknown>;
  isShared?: boolean;
}

export async function applyViewTemplate(
  payload: ViewTemplatePayload,
  ctx: { userId: string; boardId: string; name: string },
): Promise<{ viewId: string; boardId: string }> {
  const type: ViewType = payload.type ?? "TABLE";
  const last = await prisma.view.findFirst({
    where: { boardId: ctx.boardId },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const view = await prisma.view.create({
    data: {
      boardId: ctx.boardId,
      name: ctx.name,
      type,
      config: (payload.config ?? {}) as Prisma.InputJsonValue,
      // Shared unless the template says otherwise, matching what "+ View"
      // writes: a template applied by one person is for the List, not for them.
      isShared: payload.isShared !== false,
      ownerId: ctx.userId,
      displayOrder: (last?.displayOrder ?? 0) + 1,
    },
    select: { id: true },
  });
  return { viewId: view.id, boardId: ctx.boardId };
}

// ── Snapshot existing entities into template payloads ──────────────
// Powers "Save as template" from a List or Space.

/** Snapshot a Board's structure (statuses, fields, views) into a LIST
 *  payload. Returns null if the board is missing. Items are intentionally
 *  NOT captured: templates seed structure, not a board's live work. */
export async function snapshotBoard(boardId: string): Promise<{ name: string; payload: ListTemplatePayload } | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    include: { views: { orderBy: { displayOrder: "asc" } } },
  });
  if (!board) return null;
  const schema = (board.schema ?? {}) as { fields?: FieldDef[] };
  // The List's default as the resolver sees it for everyone (a template is
  // for the List, not for one reader), recorded as `pinned` on that view when
  // it is somebody's choice. The stored mark itself never goes into the
  // payload: the List a template creates gets a fresh one, by whoever applies it.
  const resolved = resolveDefaultView(
    board.views
      .filter(visibleToEveryone)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
  );
  const payload: ListTemplatePayload = {
    icon: board.icon ?? undefined,
    color: board.color ?? undefined,
    statuses: Array.isArray(board.statuses) ? (board.statuses as unknown as StatusOption[]) : undefined,
    fields: Array.isArray(schema.fields) ? schema.fields : undefined,
    views: board.views.map((v) => ({
      type: v.type,
      name: v.name,
      config: withoutPinnedDefault(v.config),
      ...(resolved?.pinned && resolved.view.id === v.id ? { pinned: true } : {}),
    })),
    ...(resolved ? { defaultView: resolved.view.type } : {}),
  };
  return { name: board.name, payload };
}

/** Snapshot a Space (its workflow settings + each child Board's structure)
 *  into a SPACE payload. Returns null if the space is missing. */
/**
 * Snapshot a Folder's structure (its Lists) into a FOLDER payload.
 *
 * The Folder "…" menu offered "Save as template" and posted source:"FOLDER" to
 * a route whose schema was z.enum(["LIST","SPACE"]), so every click answered
 * 400 and the menu printed the raw server string "Invalid body". The row is
 * real in the spec (section 1, row 10) and applyFolderTemplate has always
 * known how to materialize one; only the snapshot half was missing.
 */
export async function snapshotFolder(folderId: string): Promise<{ name: string; payload: FolderTemplatePayload } | null> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: { boards: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!folder) return null;
  const lists: Array<{ name: string } & ListTemplatePayload> = [];
  for (const b of folder.boards) {
    const snap = await snapshotBoard(b.id);
    if (snap) lists.push({ name: snap.name, ...snap.payload });
  }
  const payload: FolderTemplatePayload = {
    icon: folder.icon ?? undefined,
    color: folder.color ?? undefined,
    description: folder.description ?? undefined,
    lists,
  };
  return { name: folder.name, payload };
}

export async function snapshotSpace(spaceId: string): Promise<{ name: string; payload: SpaceTemplatePayload } | null> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    include: { boards: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!space) return null;
  const settings = (space.settings ?? {}) as { workflow?: Record<string, unknown> };
  const lists: Array<{ name: string } & ListTemplatePayload> = [];
  for (const b of space.boards) {
    const snap = await snapshotBoard(b.id);
    if (snap) lists.push({ name: snap.name, ...snap.payload });
  }
  const payload: SpaceTemplatePayload = {
    icon: space.icon ?? undefined,
    color: space.color ?? undefined,
    workflow: settings.workflow,
    lists,
  };
  return { name: space.name, payload };
}
