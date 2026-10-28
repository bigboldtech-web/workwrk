"use client";

// The old permission grid on Workspace settings > Access, as a TableCard
// (settings-cleanup Phase 5, B4: a card whose whole body is a table is a
// TableCard). Where its eight level columns do not fit (a phone, a narrow
// window) the card scrolls sideways INSIDE itself (TableCard's own
// scroller), never the page, and the "What" column is pinned to its start
// edge, so every row keeps its name while the Member and Agent columns are
// scrolled into view. Tabbing onto a cell's checkbox scrolls it into view too.
//
// What each cell shows: a checkbox for an Admin to change, "Yes" or "No" for
// anyone who cannot change it and for the retired grid. The checkbox is the
// 18px check TableCard draws for row selection (design-system 5.11), without
// its hide-until-hover class, so an unticked cell is always seen. The two
// levels that always can (PROTECTED_ADMIN_ROLES, Owner and Admin) have no
// column: theirs was a lock in every row, 114px that cut the Member column in
// half at 1440, so the page says "Owners and Admins always can" in words
// instead (final Settings review, M2). Without them the grid is 736 wide and
// fits the 760 column, and the What column takes whatever room is left. The
// card's footer carries what belongs to the grid (`footer`: the Access
// page's "Show the rest of the old grid").
//
// Phase 5 review (L1, L2, L6): the columns are tighter (What 180, a level
// its header word plus 16), so more of them are seen at once; while the grid
// can scroll further toward its end a fade sits on that edge, so a cut-off
// column reads as "more this way"; a rule name that wraps to two lines grows
// its row (TableCard rowsGrow) instead of spilling out of a 32px Compact
// row. (Its "always can" lock went with the Owner and Admin columns.)
//
// Whether a level holds a rule (`allows`) is the page's to answer: the Access
// page is the one file on the access allow-list that still reads the legacy
// matrix through checkPermission (eslint-access-allowlist.mjs: shrink it,
// never grow it), so this grid only draws the answer it is given.

import { useEffect, useRef, useState, type RefObject } from "react";
import { TableCard, type TableColumn, type TableFooter } from "@/components/ui/table-card";
import { useElementWidth } from "@/hooks/use-element-width";
import { ACCESS_LEVELS, PROTECTED_ADMIN_ROLES, type AccessLevel, type PermissionModule } from "@/lib/permissions";

/** The column words (no raw enum is ever shown). */
export const LEVEL_WORD: Record<AccessLevel, string> = {
  SUPER_ADMIN: "Owner", COMPANY_ADMIN: "Admin", C_LEVEL: "Executive", VP: "VP",
  DIRECTOR: "Director", HR: "People team", MANAGER: "Manager", TEAM_LEAD: "Team lead", EMPLOYEE: "Member", AGENT: "Agent",
};

/**
 * Each level column's width: its header word at 13/500, measured in Inter in
 * the browser and rounded up to a whole even pixel, plus 16, the 8px cell
 * padding each side (LEVEL_CELL). VP's word (18px) is narrower than a cell's
 * "Yes" at 15/400 (26px), so VP is that plus 16. The 18px checkbox and the
 * 14px lock fit inside every one.
 */
export const LEVEL_WIDTH: Record<AccessLevel, number> = {
  SUPER_ADMIN: 58, COMPANY_ADMIN: 56, C_LEVEL: 78, VP: 42, DIRECTOR: 66, HR: 94, MANAGER: 72, TEAM_LEAD: 82, EMPLOYEE: 68, AGENT: 54,
};
/** A level column's cells pad 8px each side, not TableCard's 12, so the width above is the word plus 16. */
export const LEVEL_CELL = "px-2";

/**
 * The pinned "What" column (header and cells): opaque, so the level cells
 * scroll under it. A body cell paints the row's hover tint over the card
 * surface, as TableCard's pinned "..." cell does.
 */
export const PINNED_COLUMN = "sticky start-0 z-[1] bg-[var(--os-table-head-bg)]";
export const PINNED_CELL = "bg-raised [background-image:linear-gradient(var(--tc-tint,transparent),var(--tc-tint,transparent))]";

/**
 * The pinned "What" column's width for a card this wide (pure; tested): 180
 * on a form page, 150 on a phone, where more of a 292px card would leave the
 * Member column nowhere to scroll out from under it. Unmeasured (0, the first
 * paint) is the wide one. A long name wraps onto a second line, never cut,
 * and its row grows to hold it.
 */
export const WHAT_WIDE = 180;
export const WHAT_NARROW = 150;
export const WHAT_NARROW_BELOW = 520;
export function whatColumnWidth(cardWidth: number): number {
  return cardWidth > 0 && cardWidth < WHAT_NARROW_BELOW ? WHAT_NARROW : WHAT_WIDE;
}

/**
 * The card's scroller keeps a focused cell clear of the pinned column
 * (scroll-padding), so Tab and Shift+Tab never land a checkbox under it.
 * Written out whole for each width: Tailwind only makes the classes it finds.
 */
const SCROLL_CLEAR: Record<number, string> = {
  [WHAT_WIDE]: "[&>div:first-child]:[scroll-padding-inline-start:180px]",
  [WHAT_NARROW]: "[&>div:first-child]:[scroll-padding-inline-start:150px]",
};

export interface PermissionGridRow {
  mod: PermissionModule;
  action: string;
  label: string;
}

/** The levels the grid has a column for: every level but the two that always can (PROTECTED_ADMIN_ROLES). */
export const GRID_LEVELS = ACCESS_LEVELS.filter((l) => !PROTECTED_ADMIN_ROLES.includes(l.value));

/** The grid's columns (pure; tested): "What", then one per level in ACCESS_LEVELS order, Owner and Admin left out. */
export function permissionGridColumns({
  allows,
  canEdit,
  readOnly,
  onToggle,
  whatWidth = WHAT_WIDE,
}: {
  allows: (level: AccessLevel, row: PermissionGridRow) => boolean;
  /** The pinned column's width in px (whatColumnWidth). */
  whatWidth?: number;
  canEdit: boolean;
  readOnly: boolean;
  onToggle: (level: AccessLevel, mod: PermissionModule, action: string) => void;
}): TableColumn<PermissionGridRow>[] {
  return [
    {
      key: "what",
      label: "What",
      // At least the pinned width, and any room the levels leave (a 760
      // column holds the whole grid with 22px to spare).
      width: `minmax(${whatWidth}px,1fr)`,
      className: PINNED_COLUMN,
      // 2px above and below, so a two-line name (36px) sits clear of the
      // row lines in the row it grows at Cozy and Compact (rowsGrow), and
      // still fits a 44px Comfortable row, so no row there grows.
      cellClassName: `${PINNED_CELL} py-0.5`,
      render: (r) => <span className="line-clamp-2 min-w-0 leading-[18px]" title={r.label}>{r.label}</span>,
    },
    ...GRID_LEVELS.map((l): TableColumn<PermissionGridRow> => ({
      key: l.value,
      label: LEVEL_WORD[l.value],
      width: `${LEVEL_WIDTH[l.value]}px`,
      align: "center",
      className: LEVEL_CELL,
      render: (r) => {
        const on = allows(l.value, r);
        if (canEdit && !readOnly) {
          return (
            <input
              type="checkbox"
              checked={on}
              onChange={() => onToggle(l.value, r.mod, r.action)}
              className="h-[18px] w-[18px] rounded border-line-strong accent-[var(--os-brand)]"
              aria-label={`${LEVEL_WORD[l.value]}: ${r.label}`}
            />
          );
        }
        return <span className="text-ink-2">{on ? "Yes" : "No"}</span>;
      },
    })),
  ];
}

/**
 * Whether a sideways scroller has more to show past its end edge (pure;
 * tested). Right to left, scrollLeft runs from 0 down to negative, so its
 * size is what has been scrolled either way. A pixel of rounding is not more.
 */
export function canScrollFurther(m: { scrollLeft: number; scrollWidth: number; clientWidth: number }): boolean {
  return m.scrollWidth - m.clientWidth - Math.abs(m.scrollLeft) > 1;
}

/** The fade on the grid's end edge while it can scroll further (L1): the card surface into nothing. */
export const SCROLL_FADE =
  "pointer-events-none absolute inset-y-px end-px w-8 rounded-e-lg bg-[linear-gradient(to_left,var(--os-surface),transparent)] rtl:bg-[linear-gradient(to_right,var(--os-surface),transparent)]";

/** Whether the TableCard inside `ref` can scroll further toward its end, kept current as it scrolls and resizes. */
function useScrollsFurther(ref: RefObject<HTMLDivElement | null>): boolean {
  const [further, setFurther] = useState(false);
  useEffect(() => {
    // TableCard's own scroller: the card's first child.
    const el = ref.current?.querySelector<HTMLElement>('[role="table"] > div');
    if (!el) return;
    const check = () => setFurther(canScrollFurther(el));
    el.addEventListener("scroll", check, { passive: true });
    // Reports once as it starts observing, and again when the card or its
    // rows change size (the matrix arriving, the window narrowing).
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", check);
      ro?.disconnect();
    };
  }, [ref]);
  return further;
}

/**
 * One grid. `rows` null draws TableCard's skeleton at the grid's own row
 * count, so the page does not jump when the matrix arrives.
 */
export function PermissionGrid({
  rows,
  skeletonRows,
  ariaLabel,
  allows,
  canEdit,
  readOnly = false,
  onToggle,
  footer,
}: {
  rows: PermissionGridRow[] | null;
  skeletonRows?: number;
  ariaLabel: string;
  /** Whether a level holds a rule: the page answers it (checkPermission over its matrix). */
  allows: (level: AccessLevel, row: PermissionGridRow) => boolean;
  canEdit: boolean;
  readOnly?: boolean;
  onToggle: (level: AccessLevel, mod: PermissionModule, action: string) => void;
  /** The card's footer: a line that belongs to this grid, inside its border. */
  footer?: TableFooter;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const whatWidth = whatColumnWidth(useElementWidth(ref));
  const further = useScrollsFurther(ref);
  return (
    <div ref={ref} className="relative">
      <TableCard<PermissionGridRow>
        ariaLabel={ariaLabel}
        className={SCROLL_CLEAR[whatWidth]}
        columns={permissionGridColumns({ allows, canEdit, readOnly, onToggle, whatWidth })}
        rows={rows}
        rowsGrow
        skeletonRows={skeletonRows ?? rows?.length ?? 8}
        rowKey={(r) => `${r.mod}.${r.action}`}
        footer={footer}
      />
      {further ? <div aria-hidden data-scroll-fade="" className={SCROLL_FADE} /> : null}
    </div>
  );
}
