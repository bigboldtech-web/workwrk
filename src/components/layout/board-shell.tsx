"use client";

// BoardShell — monday-style chrome wrapped around any board page
// inside an app. Renders:
//
//   ┌─ Header ──────────────────────────────────────────────────┐
//   │ Board name ▾   small tagline           [BoardHeaderActions]│
//   ├─ Views tab strip (Table · Kanban · Gantt · …) ────────────┤
//   ├─ Toolbar row: [New +] · Search · Person · Filter · Sort · Hide · Group by · … │
//   ├─ Body ────────────────────────────────────────────────────┤
//   │ <children>                                                 │
//   └────────────────────────────────────────────────────────────┘
//
// Boards opt-in by wrapping their content:
//
//   <BoardShell
//     productSlug="workwrk-crm"
//     boardKey="pipeline"
//     viewMode="kanban"
//     onChangeView={setViewMode}
//     primaryAction={{ label: "New deal", onClick: () => setShowNew(true) }}
//   >
//     {/* kanban here */}
//   </BoardShell>
//
// Search / Filter / Sort / Hide / Group-by are currently visual stubs
// — pages can override by passing their own toolbar via `toolbarRight`,
// or we wire each one in a follow-up pass as the boards mature.

import { ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown, Plus, Search, User, Filter, ArrowUpDown,
  Eye, LayoutList, MoreHorizontal, Sparkles, Table as TableIcon,
  Kanban, GanttChart, Calendar as CalendarIcon, BarChart3,
  type LucideIcon,
} from "lucide-react";
import { BoardHeaderActions } from "@/components/layout/board-header-actions";
import { getBoard, type BoardView } from "@/lib/products/boards";
import { PRODUCT_CATALOG } from "@/lib/products/catalog";

const VIEW_ICON: Record<BoardView, LucideIcon> = {
  table: TableIcon,
  kanban: Kanban,
  gantt: GanttChart,
  calendar: CalendarIcon,
  chart: BarChart3,
};

const VIEW_LABEL: Record<BoardView, string> = {
  table: "Table",
  kanban: "Kanban",
  gantt: "Gantt",
  calendar: "Calendar",
  chart: "Chart",
};

interface PrimaryAction {
  label: string;
  onClick: () => void;
  Icon?: LucideIcon;
}

interface Props {
  productSlug: string;
  boardKey: string;
  /** Current view mode. If the board declares multiple views, the
   *  tab strip lets the user flip between them. */
  viewMode?: BoardView;
  onChangeView?: (view: BoardView) => void;
  /** Primary CTA in the toolbar (e.g., "New deal"). */
  primaryAction?: PrimaryAction;
  /** Override the right side of the toolbar — for boards that need
   *  bespoke controls beyond the default Filter/Sort/Hide row. */
  toolbarRight?: ReactNode;
  /** Optional content rendered after the title (e.g. a count chip). */
  titleAccessory?: ReactNode;
  /** Optional inline KPI strip rendered below the toolbar. */
  kpis?: ReactNode;
  children: ReactNode;
}

export function BoardShell({
  productSlug,
  boardKey,
  viewMode,
  onChangeView,
  primaryAction,
  toolbarRight,
  titleAccessory,
  kpis,
  children,
}: Props) {
  const board = getBoard(productSlug, boardKey);
  const product = PRODUCT_CATALOG.find((p) => p.slug === productSlug);
  if (!board || !product) {
    // If misconfigured, just render the children — better than throwing.
    return <div className="board-shell-body">{children}</div>;
  }

  const PrimaryIcon = primaryAction?.Icon ?? Plus;
  const views = board.views ?? [];
  const activeView = viewMode ?? views[0];

  const copyLink = () => {
    if (typeof window === "undefined") return;
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
  };

  return (
    <div className="board-shell">
      <header className="board-shell-header">
        <div className="board-shell-title-block">
          <h1 className="board-shell-title">
            {board.name}
            <ChevronDown size={14} className="board-shell-title-caret" aria-hidden />
          </h1>
          {board.tagline && (
            <span className="board-shell-tagline">{board.tagline}</span>
          )}
          {titleAccessory}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/sidekick?context=${productSlug}&board=${boardKey}`}
            className="board-shell-toolbar-btn"
            title={`Ask Sidekick about ${board.name}`}
          >
            <Sparkles size={13} />
            <span className="hidden sm:inline">AI</span>
          </Link>
          <BoardHeaderActions
            inviteCount={1}
            onInvite={() => {}}
            onCopyLink={copyLink}
            onActivityLog={() => {}}
            onSettings={() => {}}
          />
        </div>
      </header>

      {views.length > 1 && (
        <div className="board-shell-views">
          {views.map((v) => {
            const Icon = VIEW_ICON[v];
            const active = v === activeView;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChangeView?.(v)}
                className={"board-shell-view-tab" + (active ? " is-active" : "")}
                data-board-tab={active ? "active" : undefined}
                aria-pressed={active}
              >
                <Icon size={12} />
                {VIEW_LABEL[v]}
              </button>
            );
          })}
          <button
            type="button"
            className="board-shell-view-tab"
            aria-label="Add view"
            title="Add view"
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      <div className="board-shell-toolbar">
        {primaryAction && (
          <button
            type="button"
            onClick={primaryAction.onClick}
            className="board-shell-toolbar-btn is-primary"
          >
            <PrimaryIcon size={12} />
            {primaryAction.label}
          </button>
        )}
        {toolbarRight ?? (
          <>
            <button type="button" className="board-shell-toolbar-btn" title="Search">
              <Search size={13} />
              <span className="hidden sm:inline">Search</span>
            </button>
            <button type="button" className="board-shell-toolbar-btn" title="Person">
              <User size={13} />
              <span className="hidden sm:inline">Person</span>
            </button>
            <button type="button" className="board-shell-toolbar-btn" title="Filter">
              <Filter size={13} />
              <span className="hidden sm:inline">Filter</span>
            </button>
            <button type="button" className="board-shell-toolbar-btn" title="Sort">
              <ArrowUpDown size={13} />
              <span className="hidden sm:inline">Sort</span>
            </button>
            <button type="button" className="board-shell-toolbar-btn" title="Hide">
              <Eye size={13} />
              <span className="hidden sm:inline">Hide</span>
            </button>
            <button type="button" className="board-shell-toolbar-btn" title="Group by">
              <LayoutList size={13} />
              <span className="hidden sm:inline">Group by</span>
            </button>
            <button type="button" className="board-shell-toolbar-btn" title="More">
              <MoreHorizontal size={13} />
            </button>
          </>
        )}
      </div>

      {kpis && <div className="px-5 pt-4">{kpis}</div>}

      <div className="board-shell-body">{children}</div>
    </div>
  );
}
