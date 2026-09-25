// Dashboard cards, computed under the VIEWER's own access.
//
// Decision 1. A card names Lists (or a Space, or "everything"), and a stored
// List id is never a grant: every card is resolved against what THIS viewer
// can read now, redacted for them (widgets.ts redactWidgetsForReader), and
// computed from the union of those Lists' own tasks and the tasks linked into
// them (resolveListScope). A List the viewer cannot read contributes nothing
// and is never named; a task shown through a link is labelled with the
// readable List it is in scope through (contextBoardFor), never with a home
// the viewer cannot read.
//
// The same path serves the dashboard page (/api/dashboards/[id]/data), the
// builder's preview (/api/dashboards/widget-preview) and the scheduled email
// (src/lib/reports/report-server.ts), so none of them can show more than the
// others.
//
// Server-only: prisma and the access engine's read-side set arithmetic (the
// same accessibleIds call /everything already scopes itself with).

import { prisma } from "@/lib/prisma";
import { accessibleIds } from "@/lib/access/ids";
import type { Viewer } from "@/lib/access/types";
import { getBoardStatuses, isDoneStatus, makeStatusLookup, PRIORITY_OPTIONS, type StatusOption } from "@/lib/board-items-shared";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { fieldKeySets } from "@/lib/list-connect";
import { contextBoardFor } from "@/lib/list-links";
import { listReader, resolveListScope, spaceForViewer, type LinkViewer, type ListReader } from "@/lib/list-links-server";
import { projectRowMetadata } from "@/lib/list-metadata";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { applyWidgetFilter, distribution, ruleActive, sortListRows, statValue, type Bucket, type WidgetRow } from "./widget-math";
import {
  cardVisibility,
  redactWidgetForEditor,
  redactWidgetsForReader,
  type CardVisibility,
  type ChartDisplay,
  type ChartGroupBy,
  type EditorWidget,
  type HiddenWidget,
  type StatMetric,
  type StatScope,
  type Widget,
  type WidgetSource,
} from "./widgets";

/** How many rows a card reads before it says it was cut. */
export const WIDGET_ROW_CAP = 5000;

export interface WidgetReader {
  /** The viewer, for the List read predicate. */
  ctx: LinkViewer;
  /** The same viewer, for the engine's readable-set arithmetic. */
  viewer: Viewer;
  /** The viewer's zone, for due-date rules. */
  zone: string;
  now: Date;
}

export type WidgetResult =
  | { kind: "stat"; value: number; metric: StatMetric; scope: StatScope; truncated?: boolean }
  | { kind: "chart"; groupBy: ChartGroupBy; display: ChartDisplay; buckets: Bucket[]; truncated?: boolean }
  | {
      kind: "list";
      rows: Array<{
        id: string;
        title: string;
        status: string | null;
        statusLabel: string | null;
        statusColor: string | null;
        done: boolean;
        dueAt: string | null;
        priority: string | null;
        list: { id: string; name: string };
        assigneeIds: string[];
        /** The same people, named, for the card's avatars (org members only). */
        assignees: Array<{ id: string; firstName: string; lastName: string; avatar: string | null }>;
      }>;
      total: number;
      truncated?: boolean;
    }
  | { kind: "notes" }
  | { kind: "hidden" }
  | { kind: "empty"; reason: "no_readable_lists" }
  | { kind: "error" };

function isTaskList(b: { itemType: string; settings: unknown; archivedAt: Date | null }): boolean {
  const system = !!b.settings && typeof b.settings === "object" && (b.settings as Record<string, unknown>).system === true;
  return !b.archivedAt && b.itemType === "studio-item" && !system;
}

/**
 * The readable Lists a source resolves to for this viewer, or null when the
 * source itself is unreadable (a Space they cannot read). Memoised per call
 * site so a dashboard with twelve cards over one Space asks once.
 */
export function sourceResolver(r: WidgetReader, reader: ListReader = listReader(r.ctx)) {
  const memo = new Map<string, Promise<string[] | null>>();
  let everything: Promise<string[]> | null = null;
  const allReadable = (): Promise<string[]> => {
    if (!everything) {
      everything = (async () => {
        const ids = await accessibleIds(r.viewer, "list", "VIEW");
        if (ids.readable.size === 0) return [];
        const rows = await prisma.board.findMany({
          where: { id: { in: [...ids.readable] }, organizationId: r.ctx.organizationId, archivedAt: null, itemType: "studio-item" },
          select: { id: true, itemType: true, settings: true, archivedAt: true },
        });
        return rows.filter(isTaskList).map((b) => b.id);
      })();
    }
    return everything;
  };
  return (source: WidgetSource): Promise<string[] | null> => {
    const key = JSON.stringify(source);
    let p = memo.get(key);
    if (!p) {
      p = (async () => {
        if (source.kind === "all") return allReadable();
        if (source.kind === "space") {
          if (!(await spaceForViewer(r.ctx, source.spaceId))) return null;
          const all = new Set(await allReadable());
          const inSpace = await prisma.board.findMany({ where: { spaceId: source.spaceId, organizationId: r.ctx.organizationId, archivedAt: null }, select: { id: true } });
          return inSpace.map((b) => b.id).filter((id) => all.has(id));
        }
        const out: string[] = [];
        for (const id of source.listIds) {
          const b = await reader.row(id);
          if (b && isTaskList(b)) out.push(id);
        }
        return out;
      })();
      memo.set(key, p);
    }
    return p;
  };
}

/**
 * The redaction context for a set of cards and one viewer: every source
 * resolved up front, and the custom field keys of every List involved.
 */
export async function redactionFor(widgets: readonly Widget[], r: WidgetReader, reader: ListReader = listReader(r.ctx)) {
  const resolve = sourceResolver(r, reader);
  const resolved = new Map<string, string[] | null>();
  for (const w of widgets) {
    if (w.kind === "notes" || w.kind === "passthrough") continue;
    const key = JSON.stringify(w.source);
    if (!resolved.has(key)) resolved.set(key, await resolve(w.source));
  }
  const listIds = new Set<string>();
  for (const v of resolved.values()) for (const id of v ?? []) listIds.add(id);
  const boards = listIds.size
    ? await prisma.board.findMany({ where: { id: { in: [...listIds] } }, select: { id: true, schema: true } })
    : [];
  const fieldKeysByList = new Map(boards.map((b) => [b.id, fieldKeySets(parseBoardSchema(b.schema).fields).stored] as const));
  return {
    resolve,
    ctx: {
      readableListsFor: (s: WidgetSource) => resolved.get(JSON.stringify(s)) ?? null,
      fieldKeysByList,
    },
  };
}

/** Cards as this viewer may see them. */
export async function redactForViewer(widgets: readonly Widget[], r: WidgetReader, reader?: ListReader): Promise<Array<Widget | HiddenWidget>> {
  const { ctx } = await redactionFor(widgets, r, reader);
  return redactWidgetsForReader(widgets, ctx);
}

/**
 * Cards as an EDITOR of the dashboard may see them: whole where they can read
 * everything, the readable part flagged `partial` where they can read some,
 * hidden where they can read none. What they cannot read never leaves the
 * server; the PATCH route puts it back with restoreHiddenParts.
 */
export async function redactForEditor(widgets: readonly Widget[], r: WidgetReader, reader?: ListReader): Promise<EditorWidget[]> {
  const { ctx } = await redactionFor(widgets, r, reader);
  return widgets.map((w) => redactWidgetForEditor(w, ctx));
}

/** cardVisibility for this editor over the STORED cards, for restoreHiddenParts. */
export async function editorVisibility(widgets: readonly Widget[], r: WidgetReader, reader?: ListReader): Promise<Map<string, CardVisibility>> {
  const { ctx } = await redactionFor(widgets, r, reader);
  return new Map(widgets.map((w) => [w.id, cardVisibility(w, ctx)] as const));
}

const PRIORITY_BY_VALUE = new Map<string, { label: string; color: string }>(PRIORITY_OPTIONS.map((p) => [p.value, { label: p.label, color: p.color }]));

/**
 * One (already redacted) card's data, under the viewer. Each card fails on
 * its own: a thrown error is logged and answered as { kind: "error" }.
 */
export async function computeWidget(w: Widget | HiddenWidget, r: WidgetReader, reader: ListReader = listReader(r.ctx)): Promise<WidgetResult> {
  if (w.kind === "hidden") return { kind: "hidden" };
  if (w.kind === "notes") return { kind: "notes" };
  if (w.kind === "passthrough") return { kind: "hidden" };
  try {
    const listIds = await sourceResolver(r, reader)(w.source);
    if (!listIds || listIds.length === 0) return { kind: "empty", reason: "no_readable_lists" };
    const scope = await resolveListScope(r.ctx, listIds, reader);
    if (scope.lists.length === 0) return { kind: "empty", reason: "no_readable_lists" };
    const scopeIds = new Set(scope.lists.map((l) => l.id));
    const baseWhere = { AND: [scope.where, { organizationId: r.ctx.organizationId, archivedAt: null, ...NOT_SYSTEM_ITEMS }] };

    // The cheap path: a plain count needs no row in memory.
    const plainCount = w.kind === "stat" && w.metric.op === "count" && w.scope === "total" && !w.filter.hideDone && !w.filter.rules.some(ruleActive);
    if (plainCount) {
      return { kind: "stat", value: await prisma.item.count({ where: baseWhere }), metric: w.metric, scope: w.scope };
    }

    const raw = await prisma.item.findMany({
      where: baseWhere,
      take: WIDGET_ROW_CAP + 1,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, title: true, status: true, priority: true, dueAt: true, startAt: true, createdAt: true, updatedAt: true,
        ownerId: true, assigneeIds: true, itemTypeId: true, boardId: true, metadata: true,
      },
    });
    const truncated = raw.length > WIDGET_ROW_CAP;
    const rowsRaw = raw.slice(0, WIDGET_ROW_CAP);

    // The home Lists' statuses (a status is always its home's) and every
    // List's fields, for the projection each row gets in its labelled List.
    const homeIds = Array.from(new Set(rowsRaw.map((x) => x.boardId)));
    const boards = await prisma.board.findMany({
      where: { id: { in: Array.from(new Set([...homeIds, ...scopeIds])) } },
      select: { id: true, name: true, statuses: true, schema: true },
    });
    const statusesOf = new Map<string, StatusOption[]>(boards.map((b) => [b.id, getBoardStatuses(b)]));
    const fieldsOf = new Map<string, FieldDef[]>(boards.map((b) => [b.id, parseBoardSchema(b.schema).fields]));
    const nameOf = new Map(scope.lists.map((l) => [l.id, l.name] as const));
    const needsTags = w.filter.rules.some((x) => x.field === "tags");
    const tagRows = needsTags && rowsRaw.length
      ? await prisma.tagAssignment.findMany({ where: { entityType: "BOARD_ITEM", entityId: { in: rowsRaw.map((x) => x.id) } }, select: { entityId: true, tagId: true } })
      : [];
    const tagsOf = new Map<string, string[]>();
    for (const t of tagRows) tagsOf.set(t.entityId, [...(tagsOf.get(t.entityId) ?? []), t.tagId]);

    const rows: WidgetRow[] = [];
    for (const it of rowsRaw) {
      const label = contextBoardFor(it.boardId, scope.listsByItem.get(it.id) ?? [], scopeIds);
      if (!label) continue;
      const keys = fieldKeySets(fieldsOf.get(label.boardId) ?? []);
      // Connect values never count toward a card: nothing here can check
      // which connected tasks the viewer may read, so they read as none.
      const { metadata } = label.via === "home"
        ? projectRowMetadata(it.metadata, { kind: "home", contextStoredKeys: keys.stored, contextConnectKeys: keys.connect, readable: () => false })
        : projectRowMetadata(it.metadata, { kind: "linked", listId: label.boardId, homeReadable: await reader.canRead(it.boardId), contextStoredKeys: keys.stored, contextConnectKeys: keys.connect, readable: () => false });
      rows.push({
        id: it.id,
        title: it.title,
        status: it.status,
        done: isDoneStatus(statusesOf.get(it.boardId) ?? getBoardStatuses(null), it.status),
        priority: it.priority,
        dueAt: it.dueAt,
        startAt: it.startAt,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
        ownerId: it.ownerId,
        assigneeIds: it.assigneeIds,
        itemTypeId: it.itemTypeId,
        tagIds: tagsOf.get(it.id) ?? [],
        listId: label.boardId,
        metadata,
      });
    }
    const kept = applyWidgetFilter(rows, w.filter, r.zone);

    if (w.kind === "stat") {
      return { kind: "stat", value: statValue(kept, w.metric, w.scope, r.now), metric: w.metric, scope: w.scope, ...(truncated ? { truncated } : {}) };
    }

    const homeOf = new Map(rowsRaw.map((x) => [x.id, x.boardId] as const));
    const statusLabel = (row: WidgetRow) => {
      const set = statusesOf.get(homeOf.get(row.id) ?? "") ?? getBoardStatuses(null);
      const opt = row.status ? makeStatusLookup(set)[row.status] : undefined;
      return { label: row.status ? opt?.label ?? row.status : null, color: opt?.color ?? null };
    };

    if (w.kind === "chart") {
      const firstStatus = new Map<string, { label: string; color: string | null }>();
      for (const row of kept) if (row.status && !firstStatus.has(row.status)) {
        const s = statusLabel(row);
        firstStatus.set(row.status, { label: s.label ?? row.status, color: s.color });
      }
      let people = new Map<string, string>();
      if (w.groupBy === "assignee") {
        const ids = Array.from(new Set(kept.flatMap((x) => [x.ownerId, ...x.assigneeIds]).filter((v): v is string => !!v)));
        const users = ids.length
          ? await prisma.user.findMany({ where: { id: { in: ids }, organizationId: r.ctx.organizationId }, select: { id: true, firstName: true, lastName: true } })
          : [];
        people = new Map(users.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unnamed"]));
      }
      const groupField = typeof w.groupBy === "object" ? w.groupBy.field : null;
      const choiceLabel = new Map<string, { label: string; color: string | null }>();
      if (groupField) {
        for (const l of scope.lists) {
          const f = (fieldsOf.get(l.id) ?? []).find((x) => x.key === groupField);
          for (const ch of f?.options?.choices ?? []) if (!choiceLabel.has(ch.value)) choiceLabel.set(ch.value, { label: ch.label, color: ch.color ?? null });
        }
      }
      const buckets = distribution(kept, w.groupBy, (key) => {
        if (w.groupBy === "status") return key ? firstStatus.get(key) ?? { label: key, color: null } : { label: "No status", color: null };
        if (w.groupBy === "priority") return key ? PRIORITY_BY_VALUE.get(key) ?? { label: key, color: null } : { label: "No priority", color: null };
        if (w.groupBy === "assignee") return key ? { label: people.get(key) ?? "Unnamed", color: null } : { label: "Unassigned", color: null };
        return key ? choiceLabel.get(key) ?? { label: key, color: null } : { label: "Empty", color: null };
      });
      return { kind: "chart", groupBy: w.groupBy, display: w.display, buckets, ...(truncated ? { truncated } : {}) };
    }

    const page = sortListRows(kept, w.sort, w.limit);
    const peopleOf = (row: WidgetRow) => Array.from(new Set([row.ownerId, ...row.assigneeIds].filter((v): v is string => !!v)));
    // One org-scoped read for the avatars of the whole page; an id with no
    // member row in this org is left out rather than named.
    const pagePeople = Array.from(new Set(page.flatMap(peopleOf)));
    const people = pagePeople.length
      ? await prisma.user.findMany({
          where: { id: { in: pagePeople }, organizationId: r.ctx.organizationId },
          select: { id: true, firstName: true, lastName: true, avatar: true },
        })
      : [];
    const personById = new Map(people.map((u) => [u.id, { id: u.id, firstName: u.firstName ?? "", lastName: u.lastName ?? "", avatar: u.avatar ?? null }] as const));
    return {
      kind: "list",
      total: kept.length,
      rows: page.map((row) => {
        const s = statusLabel(row);
        const ids = peopleOf(row);
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          statusLabel: s.label,
          statusColor: s.color,
          done: row.done,
          dueAt: row.dueAt ? row.dueAt.toISOString() : null,
          priority: row.priority,
          list: { id: row.listId, name: nameOf.get(row.listId) ?? "" },
          assigneeIds: ids,
          assignees: ids.map((id) => personById.get(id)).filter((p): p is NonNullable<typeof p> => !!p),
        };
      }),
      ...(truncated ? { truncated } : {}),
    };
  } catch (err) {
    console.error(`[dashboards] card ${w.id} failed`, err);
    return { kind: "error" };
  }
}
