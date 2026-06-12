// Template Center materialize logic. Turns a saved `Template.payload`
// into real entities:
//   TASK  → returns the create-task modal config (client fills the modal)
//   LIST  → creates a Board (+ statuses, fields, views, seed items)
//   SPACE → creates a Space (+ workflow) and its child Lists
// Reuses createBoard / createSpace / createBoardItem so all the normal
// invariants (slugging, default view, status cascade) hold.

import { prisma } from "@/lib/prisma";
import { createBoard } from "@/lib/board";
import { createSpace } from "@/lib/space";
import { createBoardItem } from "@/lib/board-items";
import type { ViewType, Prisma } from "@/generated/prisma";
import type { StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

// ── Payload shapes (loose — validated leniently at apply time) ─────

export interface ListTemplatePayload {
  icon?: string;
  color?: string;
  statuses?: StatusOption[];
  fields?: FieldDef[];
  views?: Array<{ type: ViewType; name?: string; config?: Record<string, unknown> }>;
  items?: Array<{ title: string; status?: string; priority?: string; metadata?: Record<string, unknown> }>;
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
  WHITEBOARD: "Whiteboard", FILE_GALLERY: "Files",
};
function viewLabel(t: ViewType): string {
  return VIEW_LABEL[t] ?? String(t).charAt(0) + String(t).slice(1).toLowerCase();
}

// ── LIST: create a Board from a list template ──────────────────────

export async function applyListTemplate(
  payload: ListTemplatePayload,
  ctx: { organizationId: string; userId: string; spaceId: string; folderId?: string | null; name: string },
): Promise<{ boardId: string; slug: string }> {
  const defaultView = payload.defaultView ?? "TABLE";
  const board = await createBoard({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    spaceId: ctx.spaceId,
    folderId: ctx.folderId ?? null,
    name: ctx.name,
    icon: payload.icon,
    color: payload.color,
    defaultViewType: defaultView,
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

  // Extra views beyond the default createBoard already made.
  if (Array.isArray(payload.views)) {
    let order = 1;
    for (const v of payload.views) {
      if (!v?.type || v.type === defaultView) continue;
      await prisma.view.create({
        data: {
          boardId: board.id,
          name: v.name ?? viewLabel(v.type),
          type: v.type,
          isShared: true,
          ownerId: ctx.userId,
          config: (v.config ?? {}) as object,
          displayOrder: order++,
        },
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
