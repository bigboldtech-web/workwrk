// Space detail — ClickUp-style chrome (rebuilt 2026-06-03 design pivot,
// extended 2026-06-03 Phase 11 to surface the wizard payload).
//
// White background, breadcrumb, title row with Ask AI + Share,
// then About card (preset/owner/KRAs/modules) + folder/board content.
// The "+ New Folder" and "+ New Board" buttons live in SpaceActions
// (client island) on the right side.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createElement } from "react";
import {
  Folder as FolderIcon, Lock,
  Sparkles, Users as UsersIcon, User as UserIconSmall,
  FileText, Bookmark,
  LayoutDashboard, List as ListIcon, Kanban, Calendar as CalendarIcon, GanttChart,
  ChevronLeft, ChevronRight, ChevronDown, X,
  ListFilter, Glasses, Zap,
} from "lucide-react";
import Link from "next/link";
import { SpaceActions } from "@/components/layout/os/space-actions";
import { SpaceQuickStart } from "@/components/layout/os/space-quick-start";
import { SpaceShareButton } from "@/components/layout/os/space-share-button";
import { SpaceFavoriteButton } from "@/components/layout/os/space-favorite-button";
import { ListCsvExport } from "@/components/board-view/list-csv-export";
import { getEffectivePreferences } from "@/lib/preferences";
import { ShareBoardButton } from "@/components/layout/os/share-board-button";
import { BoardMoreTrigger } from "@/components/layout/os/board-more-menu";
import { FolderMoreTrigger } from "@/components/layout/os/folder-more-menu";
import { getSpaceIcon } from "@/components/layout/os/space-icon-catalog";
import { OverviewCustomizeBanner, OverviewToolbar } from "@/components/layout/os/overview-customize";
import type { WorkflowConfig } from "@/components/layout/os/space-wizard-types";

export const dynamic = "force-dynamic";

const DEFAULT_SPACE_COLOR = "#71717A";

function parseMonthParam(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1970 || year > 2200 || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

function formatMonthParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay();
  out.setDate(out.getDate() - dow);
  return out;
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

function readWorkflow(settings: unknown): WorkflowConfig | null {
  if (!settings || typeof settings !== "object") return null;
  const w = (settings as Record<string, unknown>).workflow;
  if (!w || typeof w !== "object") return null;
  return w as WorkflowConfig;
}

type SpaceView = "overview" | "list" | "board" | "team" | "calendar" | "gantt";
const VIEW_TABS: { key: SpaceView; label: string; Icon: typeof ListIcon; enabled: boolean }[] = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard, enabled: true },
  { key: "list", label: "List", Icon: ListIcon, enabled: true },
  { key: "board", label: "Board", Icon: Kanban, enabled: true },
  { key: "team", label: "Team", Icon: UsersIcon, enabled: true },
  { key: "calendar", label: "Calendar", Icon: CalendarIcon, enabled: true },
  { key: "gantt", label: "Gantt", Icon: GanttChart, enabled: true },
];

type ListSort = "updated" | "title" | "status" | "board";
const LIST_SORTS: { key: ListSort; label: string }[] = [
  { key: "updated", label: "Recently updated" },
  { key: "title", label: "Title (A→Z)" },
  { key: "status", label: "Status" },
  { key: "board", label: "Board" },
];

type ListDue = "any" | "overdue" | "today" | "week" | "month";
const LIST_DUE_OPTIONS: { key: ListDue; label: string }[] = [
  { key: "any", label: "Any due date" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Due this week" },
  { key: "month", label: "Due this month" },
];

type ListGroupBy = "none" | "status" | "board" | "owner";
const LIST_GROUPS: { key: ListGroupBy; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "status", label: "Group by status" },
  { key: "board", label: "Group by board" },
  { key: "owner", label: "Group by owner" },
];

interface ListUrlOpts {
  sort: ListSort;
  statuses: Set<string> | null;
  owners: Set<string> | null;
  groupBy: ListGroupBy;
  due: ListDue;
}

export default async function SpacePage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; month?: string; sort?: string; status?: string; owner?: string; groupBy?: string; due?: string }>;
}) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const rawView = sp.view ?? "overview";
  const view: SpaceView = (VIEW_TABS.find((t) => t.key === rawView && t.enabled)?.key ?? "overview") as SpaceView;
  const listSort: ListSort = (LIST_SORTS.find((s) => s.key === sp.sort)?.key ?? "updated") as ListSort;
  const listStatusFilter = sp.status
    ? new Set(sp.status.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const listOwnerFilter = sp.owner
    ? new Set(sp.owner.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const listGroupBy: ListGroupBy =
    (LIST_GROUPS.find((g) => g.key === sp.groupBy)?.key ?? "none") as ListGroupBy;
  const listDue: ListDue =
    (LIST_DUE_OPTIONS.find((d) => d.key === sp.due)?.key ?? "any") as ListDue;

  // Calendar month param — "YYYY-MM" format. Falls back to current
  // month if absent or unparseable. Used only when view === "calendar"
  // but parsed unconditionally so the Calendar render branch can stay
  // pure.
  const parsedMonth = parseMonthParam(sp.month);
  const calendarBase = parsedMonth ?? new Date();
  const monthStart = new Date(calendarBase.getFullYear(), calendarBase.getMonth(), 1);
  const monthEnd = new Date(calendarBase.getFullYear(), calendarBase.getMonth() + 1, 1);
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const space = await prisma.space.findFirst({
    where: { slug, organizationId: u.organizationId },
    include: {
      _count: { select: { members: true, folders: true, boards: true } },
      folders: {
        where: { archivedAt: null, parentFolderId: null },
        orderBy: { position: "asc" },
        include: {
          _count: { select: { boards: true, childFolders: true } },
          boards: {
            where: { archivedAt: null },
            orderBy: { name: "asc" },
            select: {
              id: true, slug: true, name: true, icon: true, color: true,
              itemType: true, visibility: true, ownerId: true, schema: true,
              views: { where: { isDefault: true }, take: 1, select: { type: true } },
            },
          },
        },
      },
      boards: {
        where: { archivedAt: null, folderId: null },
        orderBy: { name: "asc" },
        select: {
          id: true, slug: true, name: true, icon: true, color: true,
          itemType: true, visibility: true, ownerId: true, schema: true,
          views: { where: { isDefault: true }, take: 1, select: { type: true } },
        },
      },
    },
  });
  if (!space) notFound();

  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: space.id, userId: u.id } },
    select: { role: true },
  });
  if (!isAdmin && space.visibility !== "ORG" && !membership) notFound();
  const isSpaceOwner = membership?.role === "OWNER";

  const workflow = readWorkflow(space.settings);

  // Collect every board under this Space (root + folder-nested) so the
  // dashboard cards can scope their queries without an extra round
  // trip. PRIVATE boards drop out of the aggregate cards for viewers
  // who aren't admin/Space-OWNER/board-owner — leaking item titles or
  // status counts from a board the viewer can't read is the same
  // class of leak Phase 22b closed on the Library APIs.
  const allBoards = [
    ...space.boards,
    ...space.folders.flatMap((f) => f.boards),
  ];

  // Build a boardId → date-field key map for the Calendar tab. Each
  // board's first DATE-typed field is the calendar-projection target,
  // matching how the per-board CalendarView picks `calendarField`
  // in board-view.tsx. Items without a value at that key are
  // excluded from the calendar grid (no "fall back to createdAt"
  // mixing — that mixed surface was misleading).
  const dateKeyByBoard = new Map<string, string>();
  for (const b of allBoards) {
    const schema = b.schema as { fields?: Array<{ key: string; fieldType: string }> } | null;
    const dateField = schema?.fields?.find((f) => f.fieldType === "DATE");
    if (dateField?.key) dateKeyByBoard.set(b.id, dateField.key);
  }
  const ownedPrivateIds = allBoards
    .filter((b) => b.visibility === "PRIVATE" && b.ownerId === u.id)
    .map((b) => b.id);
  const boardIds = (isAdmin || isSpaceOwner)
    ? allBoards.map((b) => b.id)
    : [
        ...allBoards.filter((b) => b.visibility !== "PRIVATE").map((b) => b.id),
        ...ownedPrivateIds,
      ];

  // Recent Docs + tables + recent items + status counts + prefs in
  // parallel. All are read-only chrome; missing rows degrade gracefully.
  const [recentDocs, spaceTables, recentItems, statusGroups, prefs] = await Promise.all([
    prisma.doc.findMany({
      where: {
        organizationId: u.organizationId,
        entityType: "SPACE",
        entityId: space.id,
        archivedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, title: true, excerpt: true, updatedAt: true },
    }),
    prisma.dataTable.findMany({
      where: { organizationId: u.organizationId, spaceId: space.id },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true, name: true, description: true,
        _count: { select: { rows: true } },
      },
    }),
    boardIds.length > 0
      ? prisma.item.findMany({
          where: { boardId: { in: boardIds }, archivedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 8,
          select: {
            id: true, title: true, status: true, updatedAt: true,
            board: { select: { slug: true, name: true } },
          },
        })
      : Promise.resolve([] as never[]),
    boardIds.length > 0
      ? prisma.item.groupBy({
          by: ["status"],
          where: { boardId: { in: boardIds }, archivedAt: null },
          _count: { _all: true },
        })
      : Promise.resolve([] as { status: string | null; _count: { _all: number } }[]),
    getEffectivePreferences(u.id, u.organizationId),
  ]);
  const initiallySpaceStarred = Array.isArray(prefs?.home?.favoriteSpaceIds)
    ? prefs.home.favoriteSpaceIds.includes(space.id)
    : false;

  const hasContent =
    space.folders.length > 0 ||
    space.boards.length > 0 ||
    recentDocs.length > 0 ||
    spaceTables.length > 0 ||
    recentItems.length > 0;

  // List + Board + Team views share the same cross-board item pull.
  // Cap at 200 for v1; future phases add pagination + filters. Board
  // + Team always sort by recency (cards in columns are recency-ordered);
  // List view sort is user-controlled via ?sort=.
  const sortClause = view === "list"
    ? (
        listSort === "title"
          ? [{ title: "asc" as const }]
          : listSort === "status"
          ? [{ status: "asc" as const }, { updatedAt: "desc" as const }]
          : listSort === "board"
          ? [{ board: { name: "asc" as const } }, { updatedAt: "desc" as const }]
          : [{ updatedAt: "desc" as const }]
      )
    : [{ updatedAt: "desc" as const }];
  // Status + owner filters only apply to List view. Board view uses
  // status as the column grouping (filtering would empty columns),
  // and owner-filtering inside columns is a future cut.
  const wantsStatusFilter = view === "list" && listStatusFilter && listStatusFilter.size > 0;
  const wantsOwnerFilter = view === "list" && listOwnerFilter && listOwnerFilter.size > 0;

  // Due-date filter window — uses the Phase 58 dueAt column. Only
  // applied on List view; the rest of the views use dueAt for their
  // own projections (Calendar, Gantt) or ignore it entirely (Board,
  // Team). "Overdue" means dueAt < today AND not in any future window.
  const today0 = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const tomorrow0 = new Date(today0.getFullYear(), today0.getMonth(), today0.getDate() + 1);
  const weekStart0 = startOfWeek(today0);
  const weekEnd0 = new Date(weekStart0.getFullYear(), weekStart0.getMonth(), weekStart0.getDate() + 7);
  const monthStart0 = new Date(today0.getFullYear(), today0.getMonth(), 1);
  const monthEnd0 = new Date(today0.getFullYear(), today0.getMonth() + 1, 1);
  const dueWhere = view === "list"
    ? (
        listDue === "overdue" ? { dueAt: { lt: today0 } }
        : listDue === "today" ? { dueAt: { gte: today0, lt: tomorrow0 } }
        : listDue === "week" ? { dueAt: { gte: weekStart0, lt: weekEnd0 } }
        : listDue === "month" ? { dueAt: { gte: monthStart0, lt: monthEnd0 } }
        : {}
      )
    : {};
  const crossBoardItems = (view === "list" || view === "board" || view === "team") && boardIds.length > 0
    ? await prisma.item.findMany({
        where: {
          boardId: { in: boardIds },
          archivedAt: null,
          ...(wantsStatusFilter ? { status: { in: Array.from(listStatusFilter) } } : {}),
          ...(wantsOwnerFilter ? { ownerId: { in: Array.from(listOwnerFilter) } } : {}),
          ...dueWhere,
        },
        orderBy: sortClause,
        take: 200,
        select: {
          id: true, title: true, status: true, updatedAt: true, ownerId: true,
          board: { select: { slug: true, name: true } },
        },
      })
    : [];

  // Build the owner facet list when on List or Team view — distinct
  // owners currently active in items across visible boards. Fed into
  // the List filter dropdown AND the Team view column order.
  const wantsOwnerFacets = view === "list" || view === "team";
  const ownerStats = wantsOwnerFacets && boardIds.length > 0
    ? await prisma.item.groupBy({
        by: ["ownerId"],
        where: { boardId: { in: boardIds }, archivedAt: null, ownerId: { not: null } },
        _count: { _all: true },
      })
    : [];
  const ownerIds = ownerStats.map((o) => o.ownerId).filter((id): id is string => Boolean(id));
  const ownerUsers = ownerIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
    : [];
  const ownerById = new Map(ownerUsers.map((u) => [u.id, u]));
  const ownerFacets = ownerStats
    .map((o) => {
      if (!o.ownerId) return null;
      const user = ownerById.get(o.ownerId);
      if (!user) return null;
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email;
      return { id: o.ownerId, name, avatar: user.avatar, count: o._count._all };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.count - a.count);

  // Calendar fetch: pull a wide window of items (any with a DATE field
  // value possibly landing in the displayed month). We can't filter by
  // a per-board JSON metadata key in Prisma generically, so we
  // over-fetch + project + filter in app code. Cap at 600.
  const calendarFetchStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 6, 1);
  const calendarFetchEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 12, 1);
  const calendarItemsRaw = view === "calendar" && boardIds.length > 0
    ? await prisma.item.findMany({
        where: {
          boardId: { in: boardIds },
          archivedAt: null,
          // Two-path filter: either dueAt is in the displayed month
          // (Phase 58 direct column path) OR createdAt is in the wider
          // 18-month window (legacy metadata-projection fallback for
          // items that haven't set dueAt yet). Indexed on both columns.
          OR: [
            { dueAt: { gte: monthStart, lt: monthEnd } },
            {
              dueAt: null,
              createdAt: { gte: calendarFetchStart, lt: calendarFetchEnd },
            },
          ],
        },
        take: 600,
        select: {
          id: true, title: true, status: true, createdAt: true, dueAt: true, metadata: true,
          boardId: true,
          board: { select: { slug: true, name: true } },
        },
      })
    : [];

  // Gantt fetch — same projection pattern as Calendar, but the window
  // is 12 weeks (starting on a Sunday on or before today by default,
  // overridable via ?month= which we reuse for week anchoring). Bars
  // span a single week today; future Item.startAt+dueAt columns let
  // them span actual durations.
  const ganttWeekCount = 12;
  const ganttAnchor = new Date(calendarBase);
  const ganttStart = startOfWeek(ganttAnchor);
  const ganttEnd = new Date(ganttStart.getFullYear(), ganttStart.getMonth(), ganttStart.getDate() + ganttWeekCount * 7);
  const ganttItemsRaw = view === "gantt" && boardIds.length > 0
    ? await prisma.item.findMany({
        where: {
          boardId: { in: boardIds },
          archivedAt: null,
          // Dual-path: Phase 58 dueAt direct OR metadata-fallback window
          OR: [
            { dueAt: { gte: ganttStart, lt: ganttEnd } },
            {
              dueAt: null,
              createdAt: { gte: new Date(ganttStart.getFullYear(), ganttStart.getMonth() - 6, 1), lt: new Date(ganttEnd.getFullYear(), ganttEnd.getMonth() + 6, 1) },
            },
          ],
        },
        take: 600,
        select: {
          id: true, title: true, status: true, createdAt: true,
          startAt: true, dueAt: true, metadata: true,
          boardId: true,
          board: { select: { slug: true, name: true } },
        },
      })
    : [];
  const ganttItems = ganttItemsRaw
    .map((it) => {
      // Determine the effective end date (dueAt OR metadata projection)
      let endDate: Date | null = null;
      if (it.dueAt) {
        endDate = it.dueAt;
      } else {
        const key = dateKeyByBoard.get(it.boardId);
        if (key) {
          const meta = it.metadata as Record<string, unknown> | null;
          const raw = meta?.[key];
          if (typeof raw === "string" || raw instanceof Date) {
            const parsed = raw instanceof Date ? raw : new Date(raw);
            if (!Number.isNaN(parsed.getTime())) endDate = parsed;
          }
        }
      }
      if (!endDate) return null;
      // Start date is startAt if set; else equal to end (single-day marker)
      const startDate = it.startAt ?? endDate;
      // Skip items whose range falls entirely outside the visible window
      if (endDate < ganttStart || startDate >= ganttEnd) return null;
      return {
        id: it.id,
        title: it.title,
        status: it.status,
        startDate: startDate < ganttStart ? ganttStart : startDate,
        endDate: endDate >= ganttEnd ? new Date(ganttEnd.getTime() - 1) : endDate,
        boardId: it.boardId,
        board: it.board,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // Project effective date: Item.dueAt wins if set (Phase 58 path),
  // else fall back to the board's DATE field metadata projection.
  // Items with neither are excluded. Filter to the displayed month.
  const calendarItems = calendarItemsRaw
    .map((it) => {
      let eff: Date | null = null;
      if (it.dueAt) {
        eff = it.dueAt;
      } else {
        const key = dateKeyByBoard.get(it.boardId);
        if (!key) return null;
        const meta = it.metadata as Record<string, unknown> | null;
        const raw = meta?.[key];
        if (typeof raw !== "string" && !(raw instanceof Date)) return null;
        const parsed = raw instanceof Date ? raw : new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        eff = parsed;
      }
      if (!eff || eff < monthStart || eff >= monthEnd) return null;
      return {
        id: it.id,
        title: it.title,
        status: it.status,
        date: eff,
        board: it.board,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Build status-bar segments from groupBy + workflow palette. Empty
  // status (no preset, never set) is bucketed under "Unset".
  const statusPalette = new Map(
    (workflow?.statuses ?? []).map((s) => [s.key, { label: s.label, color: s.color, group: s.group }]),
  );
  const statusTotal = statusGroups.reduce((acc, g) => acc + g._count._all, 0);
  const statusSegments = statusGroups
    .map((g) => {
      const key = g.status ?? "__unset__";
      const palette = g.status ? statusPalette.get(g.status) : null;
      return {
        key,
        label: palette?.label ?? (g.status ?? "Unset"),
        color: palette?.color ?? "#A1A1AA",
        count: g._count._all,
        pct: statusTotal > 0 ? (g._count._all / statusTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.count - a.count);
  const accent = space.color ?? DEFAULT_SPACE_COLOR;
  const Icon = getSpaceIcon(space.icon);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb + title row */}
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/spaces" className="hover:text-zinc-900">Spaces</Link>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold uppercase shrink-0"
            style={{ backgroundColor: accent }}
          >
            {Icon ? createElement(Icon, { className: "h-4 w-4" }) : (space.name[0] ?? "?")}
          </span>
          <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-1.5 min-w-0">
            <span className="truncate">{space.name}</span>
            <button
              type="button"
              aria-label="Space menu"
              title="Space menu"
              className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {space.visibility === "PRIVATE" ? (
              <Lock className="w-3.5 h-3.5 text-zinc-400" />
            ) : null}
            <SpaceFavoriteButton spaceId={space.id} initiallyStarred={initiallySpaceStarred} />
            <button
              type="button"
              aria-label="Filter Space"
              title="Filter"
              className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            >
              <ListFilter className="w-3.5 h-3.5" />
            </button>
          </h1>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Reader mode"
            title="Reader mode"
            className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500"
          >
            <Glasses className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
            title="Automations"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            Automate
          </button>
          <button
            type="button"
            className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
            Ask
          </button>
          <SpaceShareButton
            spaceId={space.id}
            spaceName={space.name}
            initialVisibility={space.visibility}
          />
        </div>
        {space.description ? (
          <p className="text-sm text-zinc-600 mt-2 max-w-[640px]">{space.description}</p>
        ) : null}
      </div>

      {/* Action row */}
      <div className="px-6 pb-3 flex items-center gap-2">
        <SpaceActions spaceId={space.id} />
      </div>

      {/* View tabs — matches ClickUp's Space-level view switcher.
          Overview + List are functional; others stub until the
          cross-board renderers ship. */}
      <div className="px-6 border-b border-zinc-100">
        <div className="flex items-center gap-0.5 -mb-px">
          {VIEW_TABS.map((t) => {
            const active = view === t.key;
            const className = `inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] border-b-2 transition-colors ${
              active
                ? "border-zinc-900 text-zinc-900 font-medium"
                : t.enabled
                  ? "border-transparent text-zinc-500 hover:text-zinc-900 hover:border-zinc-200"
                  : "border-transparent text-zinc-400 cursor-not-allowed"
            }`;
            if (t.enabled) {
              return (
                <Link
                  key={t.key}
                  href={t.key === "overview" ? `/spaces/${space.slug}` : `/spaces/${space.slug}?view=${t.key}`}
                  className={className}
                >
                  <t.Icon className="w-3.5 h-3.5" />
                  {t.label}
                </Link>
              );
            }
            return (
              <span key={t.key} className={className} aria-disabled="true" title="Coming soon">
                <t.Icon className="w-3.5 h-3.5" />
                {t.label}
                <span className="ml-1 text-[9px] uppercase tracking-wide text-zinc-400 bg-zinc-100 px-1 py-px rounded">
                  soon
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {view === "list" ? (
          <SpaceListSection
            items={crossBoardItems}
            accent={accent}
            statusPalette={statusPalette}
            workflowStatuses={workflow?.statuses ?? []}
            ownerFacets={ownerFacets}
            opts={{
              sort: listSort,
              statuses: listStatusFilter,
              owners: listOwnerFilter,
              groupBy: listGroupBy,
              due: listDue,
            }}
            viewerId={u.id}
            spaceSlug={space.slug}
          />
        ) : null}
        {view === "board" ? (
          <SpaceBoardSection
            items={crossBoardItems}
            workflowStatuses={workflow?.statuses ?? []}
            statusPalette={statusPalette}
            accent={accent}
          />
        ) : null}
        {view === "team" ? (
          <SpaceTeamSection
            items={crossBoardItems}
            ownerFacets={ownerFacets}
            statusPalette={statusPalette}
            accent={accent}
            spaceSlug={space.slug}
          />
        ) : null}
        {view === "calendar" ? (
          <SpaceCalendarSection
            items={calendarItems}
            monthStart={monthStart}
            spaceSlug={space.slug}
            statusPalette={statusPalette}
            accent={accent}
          />
        ) : null}
        {view === "gantt" ? (
          <SpaceGanttSection
            items={ganttItems}
            weekStart={ganttStart}
            weekCount={ganttWeekCount}
            spaceSlug={space.slug}
            statusPalette={statusPalette}
            accent={accent}
          />
        ) : null}
        {view === "overview" && !hasContent ? (
          <SpaceQuickStart spaceId={space.id} accent={accent} />
        ) : view === "overview" ? (
          <div className="space-y-4">
            <OverviewCustomizeBanner />
            <OverviewToolbar />
            {/* Row 1: Recent · Docs · Bookmarks */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
              <OverviewCard title="Recent">
                {recentItems.length === 0 ? (
                  <p className="text-xs text-zinc-500 px-2 py-3">No recent activity yet.</p>
                ) : (
                  <ul className="-mx-2">
                    {recentItems.map((it) => (
                      <li key={it.id}>
                        <Link
                          href={`/boards/${it.board.slug}?item=${it.id}`}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 transition-colors rounded text-[12.5px]"
                        >
                          <ListIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <span className="text-zinc-900 truncate">{it.title}</span>
                          <span className="text-zinc-400 shrink-0">·</span>
                          <span className="text-zinc-500 truncate">in {it.board.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </OverviewCard>

              <OverviewCard title="Docs">
                {recentDocs.length === 0 ? (
                  <p className="text-xs text-zinc-500 px-2 py-3">No docs in this Space yet.</p>
                ) : (
                  <ul className="-mx-2">
                    {recentDocs.map((d) => (
                      <li key={d.id}>
                        <Link
                          href={`/docs/${d.id}`}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 transition-colors rounded text-[12.5px]"
                        >
                          <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <span className="text-zinc-900 truncate">{d.title}</span>
                          <span className="text-zinc-400 shrink-0">·</span>
                          <span className="text-zinc-500 truncate">in {d.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </OverviewCard>

              <OverviewCard title="Bookmarks">
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-100 mb-2">
                    <Bookmark className="w-4 h-4 text-zinc-500" />
                  </span>
                  <p className="text-[11.5px] text-zinc-600 max-w-[240px] mb-3">
                    Bookmarks make it easy to save items or any URL from around the web.
                  </p>
                  <button
                    type="button"
                    disabled
                    title="Coming soon"
                    className="text-[11.5px] px-3 py-1.5 rounded-md bg-zinc-100 text-zinc-500 cursor-not-allowed"
                  >
                    Add Bookmark
                  </button>
                </div>
              </OverviewCard>
            </div>

            {/* Folders */}
            {space.folders.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold text-zinc-900 mb-2">Folders</h2>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {space.folders.map((f) => (
                    <li
                      key={f.id}
                      className="group/folder flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                    >
                      <FolderIcon className="w-4 h-4 text-zinc-500 shrink-0" />
                      <span className="text-sm text-zinc-900 truncate flex-1">{f.name}</span>
                      <span className="opacity-0 group-hover/folder:opacity-100 transition-opacity">
                        <FolderMoreTrigger
                          folder={{ id: f.id, name: f.name, icon: f.icon, color: f.color }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Lists table — Name · Color · Progress · Owner columns */}
            {allBoards.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold text-zinc-900 mb-2">Lists</h2>
                <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
                  <div className="grid grid-cols-[1fr_120px_160px_120px] items-center px-3 py-2 border-b border-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500">
                    <span>Name</span>
                    <span>Color</span>
                    <span>Progress</span>
                    <span>Owner</span>
                  </div>
                  <ul>
                    {allBoards.map((b) => (
                      <li
                        key={b.id}
                        className="group/board grid grid-cols-[1fr_120px_160px_120px] items-center px-3 py-2 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors"
                      >
                        <Link
                          href={`/boards/${b.slug}`}
                          className="flex items-center gap-2 min-w-0"
                        >
                          <ListIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <span className="text-[12.5px] text-zinc-900 truncate">{b.name}</span>
                        </Link>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-sm"
                            style={{ background: b.color ?? "#A1A1AA" }}
                            aria-hidden
                          />
                          <span className="text-[11px] text-zinc-500">{b.color ?? "—"}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 rounded-full bg-zinc-100 overflow-hidden">
                            <span className="block h-full bg-zinc-300" style={{ width: "0%" }} />
                          </span>
                          <span className="text-[10.5px] text-zinc-500 tabular-nums shrink-0">0/—</span>
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <span className="opacity-0 group-hover/board:opacity-100 transition-opacity inline-flex items-center gap-0.5">
                            <ShareBoardButton
                              boardId={b.id}
                              boardName={b.name}
                              visibility={b.visibility}
                              parentSpaceName={space.name}
                            />
                            <BoardMoreTrigger
                              board={{ id: b.id, name: b.name, icon: b.icon, color: b.color }}
                            />
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}

            {/* Row 3: Resources · Workload by Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <OverviewCard title="Resources">
                <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-zinc-200 rounded-md">
                  <span className="text-[11.5px] text-zinc-500">
                    Drop files here or <span className="text-zinc-700 underline">attach</span>
                  </span>
                </div>
              </OverviewCard>

              <OverviewCard title="Workload by Status">
                {statusTotal === 0 ? (
                  <p className="text-xs text-zinc-500 px-2 py-3">No items yet to chart.</p>
                ) : (
                  <div className="flex items-center gap-6">
                    <div
                      className="w-32 h-32 rounded-full shrink-0"
                      role="img"
                      aria-label={`Status pie across ${statusTotal} items`}
                      style={{ background: buildConicGradient(statusSegments) }}
                    >
                      <div className="w-full h-full rounded-full" style={{
                        background: "radial-gradient(circle, transparent 38%, transparent 38%)",
                      }} />
                    </div>
                    <ul className="flex-1 grid grid-cols-1 gap-1.5 min-w-0">
                      {statusSegments.map((s) => (
                        <li key={s.key} className="flex items-center gap-2 text-[11.5px]">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: s.color }}
                            aria-hidden
                          />
                          <span className="text-zinc-700 truncate flex-1 uppercase tracking-wide">{s.label}</span>
                          <span className="text-zinc-500 tabular-nums">{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </OverviewCard>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface GanttItem {
  id: string;
  title: string;
  status: string | null;
  startDate: Date;
  endDate: Date;
  boardId: string;
  board: { slug: string; name: string };
}

function SpaceGanttSection({
  items,
  weekStart,
  weekCount,
  spaceSlug,
  statusPalette,
  accent,
}: {
  items: GanttItem[];
  weekStart: Date;
  weekCount: number;
  spaceSlug: string;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  accent: string;
}) {
  const prevAnchor = new Date(weekStart.getFullYear(), weekStart.getMonth() - 1, weekStart.getDate());
  const nextAnchor = new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, weekStart.getDate());
  const now = new Date();
  const buildHref = (d: Date) =>
    `/spaces/${spaceSlug}?view=gantt&month=${formatMonthParam(d)}`;
  const isCurrentWindow =
    weekStart.getTime() <= now.getTime() &&
    now.getTime() < new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + weekCount * 7).getTime();
  const rangeLabel = `${weekStart.toLocaleString("default", { month: "short", day: "numeric" })} — ${
    new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + weekCount * 7 - 1).toLocaleString("default", { month: "short", day: "numeric", year: "numeric" })
  }`;

  // Build week columns + group items by board.
  const weeks: Date[] = Array.from({ length: weekCount }, (_, i) => {
    return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i * 7);
  });
  type Board = { id: string; slug: string; name: string };
  const boardOrder: Board[] = [];
  const seenBoards = new Set<string>();
  for (const it of items) {
    if (!seenBoards.has(it.boardId)) {
      boardOrder.push({ id: it.boardId, slug: it.board.slug, name: it.board.name });
      seenBoards.add(it.boardId);
    }
  }
  boardOrder.sort((a, b) => a.name.localeCompare(b.name));
  const itemsByBoard = new Map<string, GanttItem[]>();
  for (const it of items) {
    const arr = itemsByBoard.get(it.boardId) ?? [];
    arr.push(it);
    itemsByBoard.set(it.boardId, arr);
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex items-center rounded-md border border-zinc-200 bg-white">
          <Link
            href={buildHref(prevAnchor)}
            className="inline-flex items-center justify-center h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-l-md"
            aria-label="Earlier"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={buildHref(nextAnchor)}
            className="inline-flex items-center justify-center h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border-l border-zinc-200"
            aria-label="Later"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={`/spaces/${spaceSlug}?view=gantt`}
            aria-disabled={isCurrentWindow}
            className={`h-7 px-2.5 text-[11px] font-medium border-l border-zinc-200 inline-flex items-center rounded-r-md ${
              isCurrentWindow
                ? "text-zinc-400 cursor-default"
                : "text-zinc-700 hover:bg-zinc-50"
            }`}
            tabIndex={isCurrentWindow ? -1 : undefined}
          >
            Today
          </Link>
        </div>
        <h2 className="text-[13px] font-semibold text-zinc-900">{rangeLabel}</h2>
        <div className="flex-1" />
        <span className="text-[10.5px] text-zinc-400 hidden sm:inline">
          Items with startAt + dueAt render as duration bars · single-day items show as markers
        </span>
      </div>

      {boardOrder.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
          <div className="text-sm font-medium text-zinc-900 mb-1">No items on the timeline</div>
          <p className="text-xs text-zinc-500">
            Add a DATE field to a Board and assign dates to surface items here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-x-auto">
          <div
            className="grid text-[11px]"
            style={{ gridTemplateColumns: `200px repeat(${weekCount}, minmax(96px, 1fr))` }}
          >
            <div className="bg-zinc-50 border-b border-zinc-200 px-3 py-2 text-[10.5px] uppercase tracking-wide text-zinc-500 font-semibold sticky left-0 z-10">
              Board
            </div>
            {weeks.map((w, i) => {
              const isThisWeek =
                w.getFullYear() === now.getFullYear() &&
                w.getMonth() === now.getMonth() &&
                w.getDate() <= now.getDate() &&
                now.getDate() < w.getDate() + 7;
              return (
                <div
                  key={i}
                  className={`border-l border-zinc-100 border-b border-zinc-200 px-2 py-2 text-[10.5px] font-medium ${
                    isThisWeek ? "text-zinc-900 bg-zinc-50" : "text-zinc-500 bg-zinc-50"
                  }`}
                >
                  {w.toLocaleString("default", { month: "short", day: "numeric" })}
                </div>
              );
            })}
            {boardOrder.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                weekStart={weekStart}
                weekCount={weekCount}
                items={itemsByBoard.get(b.id) ?? []}
                statusPalette={statusPalette}
                accent={accent}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function BoardRow({
  board,
  weekStart,
  weekCount,
  items,
  statusPalette,
  accent,
}: {
  board: { id: string; slug: string; name: string };
  weekStart: Date;
  weekCount: number;
  items: GanttItem[];
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  accent: string;
}) {
  const totalDays = weekCount * 7;
  const msPerDay = 86_400_000;

  // Lane-pack: greedy first-fit. Each bar gets a lane index; bars in
  // the same lane never overlap. Output: { item, lane } per bar.
  type Bar = { item: GanttItem; startCol: number; spanCols: number; lane: number };
  const sorted = [...items].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const lanes: number[] = []; // index = lane, value = lastEndCol (exclusive)
  const bars: Bar[] = sorted.map((it) => {
    const startDay = Math.max(0, Math.floor((it.startDate.getTime() - weekStart.getTime()) / msPerDay));
    const endDay = Math.min(totalDays - 1, Math.floor((it.endDate.getTime() - weekStart.getTime()) / msPerDay));
    const startCol = startDay;
    const spanCols = Math.max(1, endDay - startDay + 1);
    // Place in first lane with capacity
    let lane = lanes.findIndex((endIdx) => endIdx <= startCol);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = startCol + spanCols;
    return { item: it, startCol, spanCols, lane };
  });
  const laneCount = Math.max(1, lanes.length);
  const rowHeight = laneCount * 22 + 12; // 22px per bar + breathing room

  return (
    <>
      <div
        className="border-b border-zinc-100 px-3 py-2 text-[12px] font-medium text-zinc-800 truncate sticky left-0 bg-white z-10 flex items-center"
        style={{ minHeight: rowHeight }}
      >
        <Link href={`/boards/${board.slug}`} className="hover:text-zinc-900 truncate">{board.name}</Link>
      </div>
      <div
        className="border-l border-zinc-100 border-b border-zinc-100 relative"
        style={{ gridColumn: `2 / span ${weekCount}`, minHeight: rowHeight }}
      >
        {/* Week column dividers as light vertical lines */}
        {Array.from({ length: weekCount - 1 }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-zinc-100"
            style={{ left: `${((i + 1) / weekCount) * 100}%` }}
          />
        ))}
        {/* Bars positioned by day percent */}
        {bars.map(({ item, startCol, spanCols, lane }) => {
          const leftPct = (startCol / totalDays) * 100;
          const widthPct = (spanCols / totalDays) * 100;
          const palette = item.status ? statusPalette.get(item.status) : null;
          const color = palette?.color ?? accent;
          return (
            <Link
              key={item.id}
              href={`/boards/${item.board.slug}?item=${item.id}`}
              title={`${item.title} — ${item.startDate.toLocaleDateString()}${
                item.startDate.getTime() !== item.endDate.getTime() ? ` → ${item.endDate.toLocaleDateString()}` : ""
              }`}
              className="absolute px-2 py-1 rounded text-[10.5px] font-medium text-white truncate hover:opacity-90 leading-tight"
              style={{
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                top: 6 + lane * 22,
                backgroundColor: color,
              }}
            >
              {item.title}
            </Link>
          );
        })}
      </div>
    </>
  );
}

function SpaceCalendarSection({
  items,
  monthStart,
  spaceSlug,
  statusPalette,
  accent,
}: {
  items: Array<{
    id: string;
    title: string;
    status: string | null;
    date: Date;
    board: { slug: string; name: string };
  }>;
  monthStart: Date;
  spaceSlug: string;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  accent: string;
}) {
  const monthLabel = monthStart.toLocaleString("default", { month: "long", year: "numeric" });
  const prevMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
  const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const now = new Date();
  const isCurrentMonth =
    monthStart.getFullYear() === now.getFullYear() &&
    monthStart.getMonth() === now.getMonth();
  const buildHref = (m: Date) =>
    `/spaces/${spaceSlug}?view=calendar&month=${formatMonthParam(m)}`;

  // Bucket items by YYYY-MM-DD.
  const buckets = new Map<string, typeof items>();
  for (const it of items) {
    const d = it.date;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const arr = buckets.get(key) ?? [];
    arr.push(it);
    buckets.set(key, arr);
  }

  // Build a 6-row × 7-col grid covering the month. Start on Sunday.
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ key: string; day: number | null; inMonth: boolean }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ key: `lead-${i}`, day: null, inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      key: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      day: d,
      inMonth: true,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, day: null, inMonth: false });
  }

  const todayKey = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex items-center rounded-md border border-zinc-200 bg-white">
          <Link
            href={buildHref(prevMonth)}
            className="inline-flex items-center justify-center h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-l-md"
            aria-label={`Previous month, ${prevMonth.toLocaleString("default", { month: "long", year: "numeric" })}`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={buildHref(nextMonth)}
            className="inline-flex items-center justify-center h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border-l border-zinc-200"
            aria-label={`Next month, ${nextMonth.toLocaleString("default", { month: "long", year: "numeric" })}`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={buildHref(new Date(now.getFullYear(), now.getMonth(), 1))}
            aria-disabled={isCurrentMonth}
            className={`h-7 px-2.5 text-[11px] font-medium border-l border-zinc-200 inline-flex items-center rounded-r-md ${
              isCurrentMonth
                ? "text-zinc-400 cursor-default"
                : "text-zinc-700 hover:bg-zinc-50"
            }`}
            tabIndex={isCurrentMonth ? -1 : undefined}
          >
            Today
          </Link>
        </div>
        <h2 className="text-[13px] font-semibold text-zinc-900">{monthLabel}</h2>
        <div className="flex-1" />
        <span className="text-[10.5px] text-zinc-400 hidden sm:inline">
          Items with a DATE field value · add one in the Field Shelf to surface
        </span>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
        <div className="grid grid-cols-7 bg-zinc-50 border-b border-zinc-200">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const dayItems = cell.day !== null ? buckets.get(cell.key) ?? [] : [];
            const isToday = cell.key === todayKey;
            return (
              <div
                key={cell.key}
                className={`min-h-[96px] border-r border-b border-zinc-100 p-1.5 ${
                  cell.inMonth ? "bg-white" : "bg-zinc-50/40"
                } last:border-r-0`}
              >
                {cell.day !== null ? (
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[11px] tabular-nums ${
                        isToday
                          ? "inline-flex h-5 w-5 items-center justify-center rounded-full text-white font-semibold"
                          : "text-zinc-700"
                      }`}
                      style={isToday ? { backgroundColor: accent } : undefined}
                    >
                      {cell.day}
                    </span>
                    {dayItems.length > 0 ? (
                      <span className="text-[10px] text-zinc-400 tabular-nums">{dayItems.length}</span>
                    ) : null}
                  </div>
                ) : null}
                <ul className="space-y-0.5">
                  {dayItems.slice(0, 3).map((it) => {
                    const palette = it.status ? statusPalette.get(it.status) : null;
                    const dot = palette?.color ?? "#A1A1AA";
                    return (
                      <li key={it.id}>
                        <Link
                          href={`/boards/${it.board.slug}?item=${it.id}`}
                          className="flex items-center gap-1.5 px-1 py-0.5 rounded text-[10.5px] text-zinc-700 hover:bg-zinc-50 truncate"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: dot }}
                            aria-hidden
                          />
                          <span className="truncate">{it.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {dayItems.length > 3 ? (
                    <li className="px-1 text-[10px] text-zinc-400">+{dayItems.length - 3} more</li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SpaceTeamSection({
  items,
  ownerFacets,
  statusPalette,
  accent,
  spaceSlug,
}: {
  items: Array<{
    id: string;
    title: string;
    status: string | null;
    ownerId: string | null;
    updatedAt: Date;
    board: { slug: string; name: string };
  }>;
  ownerFacets: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  accent: string;
  spaceSlug: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
        <div className="text-sm font-medium text-zinc-900 mb-1">No items assigned yet</div>
        <p className="text-xs text-zinc-500">
          Items show up here once an owner has been assigned on a Board in this Space.
        </p>
      </div>
    );
  }

  // Columns = ownerFacets order (count desc), plus an "Unowned" column
  // at the end if any items lack an owner. Owners with no items in the
  // filtered set are skipped — keeps focus on who's actually loaded up.
  const grouped = new Map<string, typeof items>();
  for (const o of ownerFacets) grouped.set(o.id, []);
  let hasUnowned = false;
  for (const it of items) {
    if (!it.ownerId) {
      const arr = grouped.get("__unowned__") ?? [];
      if (arr.length === 0) hasUnowned = true;
      arr.push(it);
      grouped.set("__unowned__", arr);
    } else {
      const arr = grouped.get(it.ownerId) ?? grouped.set(it.ownerId, []).get(it.ownerId)!;
      arr.push(it);
    }
  }
  const orderedKeys: string[] = [
    ...ownerFacets.map((o) => o.id).filter((id) => (grouped.get(id)?.length ?? 0) > 0),
    ...(hasUnowned ? ["__unowned__"] : []),
  ];
  const facetById = new Map(ownerFacets.map((o) => [o.id, o]));

  // Per-person status breakdown for the mini-bar in each column header.
  // Mirrors the Space-wide Workload card from Phase 42e but scoped to
  // a single owner's items.
  function statusSegmentsFor(ownerItems: typeof items) {
    const counts = new Map<string, number>();
    for (const it of ownerItems) {
      const key = it.status && statusPalette.has(it.status) ? it.status : "__unset__";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = ownerItems.length;
    return Array.from(counts.entries())
      .map(([key, count]) => {
        const palette = key === "__unset__" ? null : statusPalette.get(key);
        return {
          key,
          label: palette?.label ?? "Unset",
          color: palette?.color ?? "#A1A1AA",
          count,
          pct: total > 0 ? (count / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
        {items.length} item{items.length === 1 ? "" : "s"} · per-person workload
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {orderedKeys.map((key) => {
          const facet = key === "__unowned__" ? null : facetById.get(key);
          const cards = grouped.get(key) ?? [];
          const name = facet?.name ?? "Unowned";
          const segments = statusSegmentsFor(cards);
          return (
            <div
              key={key}
              className="w-[280px] shrink-0 rounded-lg bg-zinc-50/80 border border-zinc-200 flex flex-col max-h-[640px]"
            >
              <div className="px-3 py-2.5 border-b border-zinc-200">
                <div className="flex items-center gap-2">
                  <OwnerBadge name={name} avatar={facet?.avatar ?? null} size="md" />
                  <span className="text-[12.5px] font-semibold text-zinc-800 flex-1 truncate">{name}</span>
                  <span className="text-[10.5px] text-zinc-500 tabular-nums">{cards.length}</span>
                </div>
                {segments.length > 0 ? (
                  <div
                    role="img"
                    aria-label={`Status breakdown: ${segments.map((s) => `${s.label} ${s.count}`).join(", ")}`}
                    className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
                  >
                    {segments.map((s) => {
                      const drillable = key !== "__unowned__" && s.key !== "__unset__";
                      const segStyle = { width: `${s.pct}%`, backgroundColor: s.color };
                      const segClass = "h-full first:rounded-l-full last:rounded-r-full block transition-opacity";
                      const tip = `${s.label} · ${s.count} (${s.pct.toFixed(0)}%)`;
                      if (!drillable) {
                        return (
                          <span key={s.key} title={tip} className={segClass} style={segStyle} />
                        );
                      }
                      const href = buildListHref(spaceSlug, {
                        sort: "updated",
                        statuses: new Set([s.key]),
                        owners: new Set([key]),
                        groupBy: "none",
                        due: "any",
                      });
                      return (
                        <Link
                          key={s.key}
                          href={href}
                          title={`${tip} — open in List`}
                          className={`${segClass} hover:opacity-80`}
                          style={segStyle}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <ul className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                {cards.length === 0 ? (
                  <li className="text-[10.5px] text-zinc-400 px-1.5 py-1">No items</li>
                ) : (
                  cards.map((it) => {
                    const palette = it.status ? statusPalette.get(it.status) : null;
                    const dot = palette?.color ?? "#A1A1AA";
                    return (
                      <li key={it.id}>
                        <Link
                          href={`/boards/${it.board.slug}?item=${it.id}`}
                          className="block rounded-md bg-white border border-zinc-200 hover:border-zinc-300 hover:shadow-sm p-2.5 transition-colors"
                          style={{ borderLeft: `3px solid ${accent}` }}
                        >
                          <div className="text-[12.5px] font-medium text-zinc-900 line-clamp-2 mb-1">
                            {it.title}
                          </div>
                          <div className="flex items-center justify-between text-[10.5px] text-zinc-500">
                            <span className="inline-flex items-center gap-1.5 truncate max-w-[160px]">
                              <span
                                className="h-1.5 w-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: dot }}
                                aria-hidden
                              />
                              <span className="truncate">{palette?.label ?? (it.status ?? "—")}</span>
                            </span>
                            <span className="tabular-nums">{timeAgo(it.updatedAt)}</span>
                          </div>
                        </Link>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          );
        })}
      </div>
      {items.length === 200 ? (
        <div className="mt-2 text-[10.5px] text-zinc-400">
          Showing 200 most-recently-updated items.
        </div>
      ) : null}
    </section>
  );
}

function SpaceBoardSection({
  items,
  workflowStatuses,
  statusPalette,
  accent,
}: {
  items: Array<{
    id: string;
    title: string;
    status: string | null;
    ownerId: string | null;
    updatedAt: Date;
    board: { slug: string; name: string };
  }>;
  workflowStatuses: Array<{ key: string; label: string; color: string; group: string }>;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  accent: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
        <div className="text-sm font-medium text-zinc-900 mb-1">No items to board yet</div>
        <p className="text-xs text-zinc-500">
          Items show up as cards once a Board in this Space has rows.
        </p>
      </div>
    );
  }

  // Column order = workflow palette order, plus any unknown statuses
  // (including null) bucketed into an "Unset" column at the end.
  const columnKeys: string[] = workflowStatuses.length > 0
    ? workflowStatuses.map((s) => s.key)
    : Array.from(new Set(items.map((i) => i.status ?? "__unset__")));
  const hasUnsetBucket = items.some((i) => !i.status || !statusPalette.has(i.status));
  if (hasUnsetBucket && !columnKeys.includes("__unset__")) columnKeys.push("__unset__");

  const grouped = new Map<string, typeof items>();
  for (const k of columnKeys) grouped.set(k, []);
  for (const it of items) {
    const bucket = it.status && statusPalette.has(it.status) ? it.status : "__unset__";
    const arr = grouped.get(bucket) ?? grouped.set(bucket, []).get(bucket)!;
    arr.push(it);
  }

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
        {items.length} item{items.length === 1 ? "" : "s"} across this Space · read-only
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columnKeys.map((key) => {
          const palette = key === "__unset__"
            ? { label: "Unset", color: "#A1A1AA" }
            : statusPalette.get(key) ?? { label: key, color: "#A1A1AA" };
          const cards = grouped.get(key) ?? [];
          return (
            <div
              key={key}
              className="w-[260px] shrink-0 rounded-lg bg-zinc-50/80 border border-zinc-200 flex flex-col max-h-[640px]"
            >
              <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-200">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: palette.color }}
                  aria-hidden
                />
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-zinc-700 flex-1 truncate">
                  {palette.label}
                </span>
                <span className="text-[10.5px] text-zinc-500 tabular-nums">{cards.length}</span>
              </div>
              <ul className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                {cards.length === 0 ? (
                  <li className="text-[10.5px] text-zinc-400 px-1.5 py-1">No items</li>
                ) : (
                  cards.map((it) => (
                    <li key={it.id}>
                      <Link
                        href={`/boards/${it.board.slug}?item=${it.id}`}
                        className="block rounded-md bg-white border border-zinc-200 hover:border-zinc-300 hover:shadow-sm p-2.5 transition-colors"
                        style={{ borderLeft: `3px solid ${accent}` }}
                      >
                        <div className="text-[12.5px] font-medium text-zinc-900 line-clamp-2 mb-1">
                          {it.title}
                        </div>
                        <div className="flex items-center justify-between text-[10.5px] text-zinc-500">
                          <span className="truncate max-w-[140px]">{it.board.name}</span>
                          <span className="tabular-nums">{timeAgo(it.updatedAt)}</span>
                        </div>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>
      {items.length === 200 ? (
        <div className="mt-2 text-[10.5px] text-zinc-400">
          Showing 200 most-recently-updated items. Open a Board for the full set + drag-to-rebucket.
        </div>
      ) : null}
    </section>
  );
}

function hueFromString(s: string): number {
  // djb2 hash → hue in [0, 360). Stable per-name so the same person
  // always lands on the same tint across the app.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function OwnerBadge({
  name,
  avatar,
  size = "sm",
}: {
  name: string;
  avatar: string | null;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-4 w-4 text-[8px]" : "h-5 w-5 text-[9px]";
  const initials = name
    .split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt={name}
        className={`${dim} rounded-full object-cover shrink-0`}
      />
    );
  }
  const hue = hueFromString(name);
  return (
    <span
      className={`inline-flex items-center justify-center ${dim} rounded-full font-semibold shrink-0`}
      style={{
        backgroundColor: `hsl(${hue}, 60%, 88%)`,
        color: `hsl(${hue}, 65%, 30%)`,
      }}
      aria-label={name}
    >
      {initials}
    </span>
  );
}

function FilterChipStrip({
  opts,
  statusPalette,
  ownerFacets,
  spaceSlug,
}: {
  opts: ListUrlOpts;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  ownerFacets: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  spaceSlug: string;
}) {
  const statusChips: Array<{ key: string; label: string; color: string }> = [];
  if (opts.statuses) {
    for (const key of opts.statuses) {
      const palette = statusPalette.get(key);
      statusChips.push({
        key,
        label: palette?.label ?? key,
        color: palette?.color ?? "#A1A1AA",
      });
    }
  }
  const ownerById = new Map(ownerFacets.map((o) => [o.id, o]));
  const ownerChips: Array<{ id: string; name: string; avatar: string | null }> = [];
  if (opts.owners) {
    for (const id of opts.owners) {
      const o = ownerById.get(id);
      ownerChips.push({ id, name: o?.name ?? "Unknown", avatar: o?.avatar ?? null });
    }
  }
  const clearAllHref = buildListHref(spaceSlug, { ...opts, statuses: null, owners: null });

  return (
    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
      {statusChips.map((c) => {
        const next = new Set(opts.statuses ?? []);
        next.delete(c.key);
        const href = buildListHref(spaceSlug, { ...opts, statuses: next.size > 0 ? next : null });
        return (
          <Link
            key={`s-${c.key}`}
            href={href}
            className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-1 rounded-full text-[11px] font-medium border border-zinc-200 bg-white hover:bg-zinc-50"
          >
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} aria-hidden />
            <span className="text-zinc-700">{c.label}</span>
            <X className="w-2.5 h-2.5 text-zinc-400" />
          </Link>
        );
      })}
      {ownerChips.map((c) => {
        const next = new Set(opts.owners ?? []);
        next.delete(c.id);
        const href = buildListHref(spaceSlug, { ...opts, owners: next.size > 0 ? next : null });
        return (
          <Link
            key={`o-${c.id}`}
            href={href}
            className="inline-flex items-center gap-1.5 h-6 pl-1 pr-1 rounded-full text-[11px] font-medium border border-zinc-200 bg-white hover:bg-zinc-50"
          >
            <OwnerBadge name={c.name} avatar={c.avatar} />
            <span className="text-zinc-700">{c.name}</span>
            <X className="w-2.5 h-2.5 text-zinc-400" />
          </Link>
        );
      })}
      {statusChips.length + ownerChips.length > 1 ? (
        <Link
          href={clearAllHref}
          className="inline-flex items-center h-6 px-2 rounded-full text-[11px] text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
        >
          Clear all
        </Link>
      ) : null}
    </div>
  );
}

function buildListHref(spaceSlug: string, opts: ListUrlOpts): string {
  const params = new URLSearchParams();
  params.set("view", "list");
  if (opts.sort !== "updated") params.set("sort", opts.sort);
  if (opts.statuses && opts.statuses.size > 0) {
    params.set("status", Array.from(opts.statuses).join(","));
  }
  if (opts.owners && opts.owners.size > 0) {
    params.set("owner", Array.from(opts.owners).join(","));
  }
  if (opts.groupBy !== "none") params.set("groupBy", opts.groupBy);
  if (opts.due !== "any") params.set("due", opts.due);
  return `/spaces/${spaceSlug}?${params.toString()}`;
}

function ListDueMenu({
  opts,
  spaceSlug,
}: {
  opts: ListUrlOpts;
  spaceSlug: string;
}) {
  const activeLabel = LIST_DUE_OPTIONS.find((d) => d.key === opts.due)?.label ?? "Any due date";
  const summaryText = opts.due === "any"
    ? "Any"
    : opts.due === "overdue"
    ? "Overdue"
    : opts.due === "today"
    ? "Today"
    : opts.due === "week"
    ? "This week"
    : "This month";
  return (
    <details className="relative">
      <summary
        className={`list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] hover:bg-zinc-50 select-none border ${
          opts.due === "any"
            ? "border-zinc-200 bg-white text-zinc-700"
            : "border-zinc-900 bg-zinc-900 text-white"
        }`}
        title={activeLabel}
      >
        <CalendarIcon className="w-3 h-3" />
        <span>{summaryText}</span>
        <ChevronRight className={`w-3 h-3 rotate-90 ${opts.due === "any" ? "text-zinc-400" : "text-white/70"}`} />
      </summary>
      <div className="absolute right-0 top-full mt-1 z-50 w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
        {LIST_DUE_OPTIONS.map((d) => {
          const active = d.key === opts.due;
          return (
            <Link
              key={d.key}
              href={buildListHref(spaceSlug, { ...opts, due: d.key })}
              className={`flex items-center justify-between px-3 py-1.5 text-[12.5px] ${
                active ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span>{d.label}</span>
              {active ? <span className="text-zinc-400 text-[10px]">✓</span> : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function ListGroupByMenu({
  opts,
  spaceSlug,
}: {
  opts: ListUrlOpts;
  spaceSlug: string;
}) {
  const activeLabel = LIST_GROUPS.find((g) => g.key === opts.groupBy)?.label ?? "No grouping";
  return (
    <details className="relative">
      <summary
        className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 bg-white text-[11.5px] text-zinc-700 hover:bg-zinc-50 select-none"
      >
        <span className="text-zinc-400">Group:</span>
        <span className="font-medium">{activeLabel.replace(/^Group by /, "") || "None"}</span>
        <ChevronRight className="w-3 h-3 text-zinc-400 rotate-90" />
      </summary>
      <div className="absolute right-0 top-full mt-1 z-50 w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
        {LIST_GROUPS.map((g) => {
          const active = g.key === opts.groupBy;
          return (
            <Link
              key={g.key}
              href={buildListHref(spaceSlug, { ...opts, groupBy: g.key })}
              className={`flex items-center justify-between px-3 py-1.5 text-[12.5px] ${
                active ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span>{g.label}</span>
              {active ? <span className="text-zinc-400 text-[10px]">✓</span> : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function ListSortMenu({
  opts,
  spaceSlug,
}: {
  opts: ListUrlOpts;
  spaceSlug: string;
}) {
  const activeLabel = LIST_SORTS.find((s) => s.key === opts.sort)?.label ?? "Recently updated";
  return (
    <details className="relative">
      <summary
        className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 bg-white text-[11.5px] text-zinc-700 hover:bg-zinc-50 select-none"
      >
        <span className="text-zinc-400">Sort:</span>
        <span className="font-medium">{activeLabel}</span>
        <ChevronRight className="w-3 h-3 text-zinc-400 rotate-90" />
      </summary>
      <div className="absolute right-0 top-full mt-1 z-50 w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
        {LIST_SORTS.map((s) => {
          const active = s.key === opts.sort;
          return (
            <Link
              key={s.key}
              href={buildListHref(spaceSlug, { ...opts, sort: s.key })}
              className={`flex items-center justify-between px-3 py-1.5 text-[12.5px] ${
                active ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span>{s.label}</span>
              {active ? <span className="text-zinc-400 text-[10px]">✓</span> : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function ListStatusFilter({
  statuses,
  opts,
  spaceSlug,
}: {
  statuses: Array<{ key: string; label: string; color: string; group: string }>;
  opts: ListUrlOpts;
  spaceSlug: string;
}) {
  if (statuses.length === 0) return null;
  const activeCount = opts.statuses?.size ?? 0;

  return (
    <details className="relative">
      <summary
        className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 bg-white text-[11.5px] text-zinc-700 hover:bg-zinc-50 select-none"
      >
        <span className="text-zinc-400">Status:</span>
        <span className="font-medium">
          {activeCount === 0 ? "All" : `${activeCount} selected`}
        </span>
        <ChevronRight className="w-3 h-3 text-zinc-400 rotate-90" />
      </summary>
      <div className="absolute right-0 top-full mt-1 z-50 w-[220px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
        {activeCount > 0 ? (
          <Link
            href={buildListHref(spaceSlug, { ...opts, statuses: null })}
            className="block px-3 py-1.5 text-[12px] text-zinc-500 hover:bg-zinc-50 border-b border-zinc-100"
          >
            Clear filter
          </Link>
        ) : null}
        {statuses.map((s) => {
          const active = opts.statuses?.has(s.key) ?? false;
          const next = new Set(opts.statuses ?? []);
          if (active) next.delete(s.key); else next.add(s.key);
          return (
            <Link
              key={s.key}
              href={buildListHref(spaceSlug, { ...opts, statuses: next.size > 0 ? next : null })}
              className={`flex items-center gap-2 px-3 py-1.5 text-[12.5px] ${
                active ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="flex-1 truncate">{s.label}</span>
              {active ? <span className="text-zinc-400 text-[10px]">✓</span> : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function ListOwnerFilter({
  owners,
  opts,
  spaceSlug,
}: {
  owners: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  opts: ListUrlOpts;
  spaceSlug: string;
}) {
  if (owners.length === 0) return null;
  const activeCount = opts.owners?.size ?? 0;

  return (
    <details className="relative">
      <summary
        className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 bg-white text-[11.5px] text-zinc-700 hover:bg-zinc-50 select-none"
      >
        <span className="text-zinc-400">Owner:</span>
        <span className="font-medium">
          {activeCount === 0 ? "Anyone" : `${activeCount} selected`}
        </span>
        <ChevronRight className="w-3 h-3 text-zinc-400 rotate-90" />
      </summary>
      <div className="absolute right-0 top-full mt-1 z-50 w-[240px] max-h-[320px] overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg py-1">
        {activeCount > 0 ? (
          <Link
            href={buildListHref(spaceSlug, { ...opts, owners: null })}
            className="block px-3 py-1.5 text-[12px] text-zinc-500 hover:bg-zinc-50 border-b border-zinc-100"
          >
            Clear filter
          </Link>
        ) : null}
        {owners.map((o) => {
          const active = opts.owners?.has(o.id) ?? false;
          const next = new Set(opts.owners ?? []);
          if (active) next.delete(o.id); else next.add(o.id);
          return (
            <Link
              key={o.id}
              href={buildListHref(spaceSlug, { ...opts, owners: next.size > 0 ? next : null })}
              className={`flex items-center gap-2 px-3 py-1.5 text-[12.5px] ${
                active ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <OwnerBadge name={o.name} avatar={o.avatar} size="md" />
              <span className="flex-1 truncate">{o.name}</span>
              <span className="text-[10px] text-zinc-400 tabular-nums">{o.count}</span>
              {active ? <span className="text-zinc-400 text-[10px]">✓</span> : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function SpaceListSection({
  items,
  accent,
  statusPalette,
  workflowStatuses,
  ownerFacets,
  opts,
  viewerId,
  spaceSlug,
}: {
  items: Array<{
    id: string;
    title: string;
    status: string | null;
    ownerId: string | null;
    updatedAt: Date;
    board: { slug: string; name: string };
  }>;
  accent: string;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  workflowStatuses: Array<{ key: string; label: string; color: string; group: string }>;
  ownerFacets: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  opts: ListUrlOpts;
  viewerId: string;
  spaceSlug: string;
}) {
  const statusFilterActive = opts.statuses !== null && opts.statuses.size > 0;
  const ownerFilterActive = opts.owners !== null && opts.owners.size > 0;
  const filterActive = statusFilterActive || ownerFilterActive;

  // "Mine" is a single-click affordance for the most common filter
  // pattern. It's just owner=<viewerId> under the hood — toggling
  // the viewer's ID in/out of the owner set.
  const mineActive = opts.owners?.has(viewerId) ?? false;
  const mineToggleSet = new Set(opts.owners ?? []);
  if (mineActive) mineToggleSet.delete(viewerId);
  else mineToggleSet.add(viewerId);
  const mineHref = buildListHref(spaceSlug, {
    ...opts,
    owners: mineToggleSet.size > 0 ? mineToggleSet : null,
  });

  if (items.length === 0 && !filterActive) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
        <div className="text-sm font-medium text-zinc-900 mb-1">No items in this Space yet</div>
        <p className="text-xs text-zinc-500">
          Items show up here once a Board in this Space has rows. Switch to{" "}
          <span className="text-zinc-700 font-medium">Overview</span> to add primitives.
        </p>
      </div>
    );
  }
  return (
    <section>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 flex-1">
          {items.length} item{items.length === 1 ? "" : "s"}
          {filterActive ? " · filtered" : " across this Space"}
        </h2>
        <Link
          href={mineHref}
          aria-pressed={mineActive}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] border transition-colors ${
            mineActive
              ? "border-zinc-900 bg-zinc-900 text-white font-medium"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
          }`}
          title={mineActive ? "Showing your items" : "Show only items you own"}
        >
          <UserIconSmall className="w-3 h-3" />
          Mine
        </Link>
        <ListStatusFilter statuses={workflowStatuses} opts={opts} spaceSlug={spaceSlug} />
        <ListOwnerFilter owners={ownerFacets} opts={opts} spaceSlug={spaceSlug} />
        <ListDueMenu opts={opts} spaceSlug={spaceSlug} />
        <ListGroupByMenu opts={opts} spaceSlug={spaceSlug} />
        <ListSortMenu opts={opts} spaceSlug={spaceSlug} />
        <ListCsvExport
          filename={`${spaceSlug}-items-${new Date().toISOString().slice(0, 10)}.csv`}
          rows={items.map((it) => ({
            title: it.title,
            status: it.status ? statusPalette.get(it.status)?.label ?? it.status : "",
            boardName: it.board.name,
            ownerName: it.ownerId ? (ownerFacets.find((o) => o.id === it.ownerId)?.name ?? "") : "",
            updatedAt: it.updatedAt instanceof Date ? it.updatedAt.toISOString() : String(it.updatedAt),
          }))}
        />
      </div>
      {filterActive ? (
        <FilterChipStrip
          opts={opts}
          statusPalette={statusPalette}
          ownerFacets={ownerFacets}
          spaceSlug={spaceSlug}
        />
      ) : null}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-8 text-center">
          <div className="text-sm font-medium text-zinc-900 mb-1">No items match this filter</div>
          <p className="text-xs text-zinc-500">
            Clear the status filter or pick different statuses to see results.
          </p>
        </div>
      ) : (
        <ListBody
          items={items}
          accent={accent}
          statusPalette={statusPalette}
          ownerFacets={ownerFacets}
          groupBy={opts.groupBy}
          workflowStatuses={workflowStatuses}
        />
      )}
    </section>
  );
}

function ListBody({
  items,
  accent,
  statusPalette,
  ownerFacets,
  groupBy,
  workflowStatuses,
}: {
  items: Array<{
    id: string;
    title: string;
    status: string | null;
    ownerId: string | null;
    updatedAt: Date;
    board: { slug: string; name: string };
  }>;
  accent: string;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
  ownerFacets: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  groupBy: ListGroupBy;
  workflowStatuses: Array<{ key: string; label: string; color: string; group: string }>;
}) {
  if (groupBy === "none") {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
        <ListItemsTable items={items} accent={accent} statusPalette={statusPalette} />
        {items.length === 200 ? (
          <div className="px-3 py-2 text-[10.5px] text-zinc-400 bg-zinc-50 border-t border-zinc-100">
            Showing 200 most-recently-updated items. Open a Board for the full set.
          </div>
        ) : null}
      </div>
    );
  }

  // Build group buckets in the right order per groupBy kind.
  type Group = {
    key: string;
    label: string;
    dot: string | null;
    avatarInitials: string | null;
    avatarUrl: string | null;
    items: typeof items;
  };
  const groups: Group[] = [];
  if (groupBy === "status") {
    const ordered = workflowStatuses.length > 0
      ? workflowStatuses.map((s) => ({ key: s.key, label: s.label, dot: s.color }))
      : Array.from(new Set(items.map((i) => i.status ?? "__unset__")))
          .map((k) => ({ key: k, label: k === "__unset__" ? "Unset" : k, dot: "#A1A1AA" }));
    for (const g of ordered) groups.push({ ...g, avatarInitials: null, avatarUrl: null, items: [] });
    if (items.some((i) => !i.status || !statusPalette.has(i.status))) {
      if (!groups.find((g) => g.key === "__unset__")) {
        groups.push({ key: "__unset__", label: "Unset", dot: "#A1A1AA", avatarInitials: null, avatarUrl: null, items: [] });
      }
    }
    for (const it of items) {
      const bucket = it.status && statusPalette.has(it.status) ? it.status : "__unset__";
      const g = groups.find((g) => g.key === bucket);
      if (g) g.items.push(it);
    }
  } else if (groupBy === "board") {
    const byBoard = new Map<string, Group>();
    for (const it of items) {
      const existing = byBoard.get(it.board.slug);
      if (existing) existing.items.push(it);
      else byBoard.set(it.board.slug, {
        key: it.board.slug, label: it.board.name, dot: null, avatarInitials: null, avatarUrl: null, items: [it],
      });
    }
    Array.from(byBoard.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((g) => groups.push(g));
  } else if (groupBy === "owner") {
    const facetById = new Map(ownerFacets.map((o, idx) => [o.id, { idx, ...o }]));
    const byOwner = new Map<string, Group>();
    for (const it of items) {
      const key = it.ownerId ?? "__unowned__";
      const facet = key === "__unowned__" ? null : facetById.get(key);
      const label = facet?.name ?? (key === "__unowned__" ? "Unowned" : "Unknown");
      const initials = key === "__unowned__"
        ? "?"
        : label.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
      const existing = byOwner.get(key);
      if (existing) existing.items.push(it);
      else byOwner.set(key, {
        key, label, dot: null, avatarInitials: initials, avatarUrl: facet?.avatar ?? null, items: [it],
      });
    }
    Array.from(byOwner.values())
      .sort((a, b) => {
        if (a.key === "__unowned__") return 1;
        if (b.key === "__unowned__") return -1;
        return (facetById.get(a.key)?.idx ?? 0) - (facetById.get(b.key)?.idx ?? 0);
      })
      .forEach((g) => groups.push(g));
  }

  return (
    <div className="space-y-3">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <details key={g.key} open className="rounded-xl border border-zinc-200 bg-white overflow-hidden group/list-grp">
            <summary className="list-none cursor-pointer px-3 py-2 flex items-center gap-2 bg-zinc-50/60 border-b border-zinc-100 select-none">
              <ChevronRight className="w-3 h-3 text-zinc-400 transition-transform group-open/list-grp:rotate-90" />
              {g.dot ? (
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: g.dot }} aria-hidden />
              ) : null}
              {g.avatarInitials ? (
                <OwnerBadge name={g.label} avatar={g.avatarUrl} />
              ) : null}
              <span className="text-[12px] font-semibold text-zinc-800 flex-1 truncate">{g.label}</span>
              <span className="text-[11px] text-zinc-500 tabular-nums">{g.items.length}</span>
            </summary>
            <ListItemsTable items={g.items} accent={accent} statusPalette={statusPalette} />
          </details>
        ))}
      {items.length === 200 ? (
        <div className="px-3 py-2 text-[10.5px] text-zinc-400 rounded-md bg-zinc-50 border border-zinc-200">
          Showing 200 most-recently-updated items. Open a Board for the full set.
        </div>
      ) : null}
    </div>
  );
}

function ListItemsTable({
  items,
  accent,
  statusPalette,
}: {
  items: Array<{
    id: string;
    title: string;
    status: string | null;
    ownerId: string | null;
    updatedAt: Date;
    board: { slug: string; name: string };
  }>;
  accent: string;
  statusPalette: Map<string, { label: string; color: string; group: string }>;
}) {
  return (
    <table className="w-full">
      <thead className="bg-zinc-50 border-b border-zinc-200">
        <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
          <th className="px-3 py-2 font-medium">Title</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium hidden sm:table-cell">Board</th>
          <th className="px-3 py-2 font-medium text-right tabular-nums">Updated</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {items.map((it) => {
          const status = it.status ? statusPalette.get(it.status) : null;
          const statusColor = status?.color ?? "#A1A1AA";
          const statusLabel = status?.label ?? (it.status ?? "—");
          return (
            <tr key={it.id} className="hover:bg-zinc-50">
              <td className="px-3 py-2">
                <Link
                  href={`/boards/${it.board.slug}?item=${it.id}`}
                  className="flex items-center gap-2 min-w-0"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  />
                  <span className="text-[13px] text-zinc-900 truncate hover:text-zinc-700">{it.title}</span>
                </Link>
              </td>
              <td className="px-3 py-2">
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                  style={{ backgroundColor: `${statusColor}1a`, color: statusColor }}
                >
                  {statusLabel}
                </span>
              </td>
              <td className="px-3 py-2 hidden sm:table-cell">
                <Link
                  href={`/boards/${it.board.slug}`}
                  className="text-[12px] text-zinc-600 hover:text-zinc-900 truncate inline-block max-w-[200px]"
                >
                  {it.board.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-right text-[11px] text-zinc-500 tabular-nums">
                {timeAgo(it.updatedAt)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OverviewCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 min-h-[180px] flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function buildConicGradient(segs: Array<{ color: string; pct: number }>): string {
  if (segs.length === 0) return "#e4e4e7";
  const parts: string[] = [];
  let acc = 0;
  for (const s of segs) {
    const start = acc;
    const end = acc + s.pct;
    parts.push(`${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    acc = end;
  }
  return `conic-gradient(${parts.join(", ")})`;
}
