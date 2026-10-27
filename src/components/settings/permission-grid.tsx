"use client";

// The old permission grid on Workspace settings > Access, as a TableCard
// (settings-cleanup Phase 5, B4: a card whose whole body is a table is a
// TableCard). Ten level columns do not fit the 760 form column, so the card
// scrolls sideways INSIDE itself (TableCard's own scroller), never the page,
// and the "What" column is pinned to its start edge, so every row keeps its
// name while the Member and Agent columns are scrolled into view. Tabbing
// onto a cell's checkbox scrolls it into view too.
//
// What each cell shows is unchanged: a lock for the two levels that always
// can (PROTECTED_ADMIN_ROLES), a checkbox for an Admin to change, "Yes" or
// "No" for anyone who cannot change it and for the retired grid. The checkbox
// is the 18px check TableCard draws for row selection (design-system 5.11),
// without its hide-until-hover class, so an unticked cell is always seen.
//
// Whether a level holds a rule (`allows`) is the page's to answer: the Access
// page is the one file on the access allow-list that still reads the legacy
// matrix through checkPermission (eslint-access-allowlist.mjs: shrink it,
// never grow it), so this grid only draws the answer it is given.

import { useRef } from "react";
import { Lock } from "lucide-react";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { useElementWidth } from "@/hooks/use-element-width";
import { ACCESS_LEVELS, PROTECTED_ADMIN_ROLES, type AccessLevel, type PermissionModule } from "@/lib/permissions";

/** The column words (no raw enum is ever shown). */
export const LEVEL_WORD: Record<AccessLevel, string> = {
  SUPER_ADMIN: "Owner", COMPANY_ADMIN: "Admin", C_LEVEL: "Executive", VP: "VP",
  DIRECTOR: "Director", HR: "People team", MANAGER: "Manager", TEAM_LEAD: "Team lead", EMPLOYEE: "Member", AGENT: "Agent",
};

/** Each level column's width: its header word at 13/500 plus the 12px cell padding each side. */
const LEVEL_WIDTH: Record<AccessLevel, number> = {
  SUPER_ADMIN: 72, COMPANY_ADMIN: 72, C_LEVEL: 92, VP: 56, DIRECTOR: 84, HR: 108, MANAGER: 88, TEAM_LEAD: 92, EMPLOYEE: 84, AGENT: 72,
};

/**
 * The pinned "What" column (header and cells): opaque, so the level cells
 * scroll under it. A body cell paints the row's hover tint over the card
 * surface, as TableCard's pinned "..." cell does.
 */
export const PINNED_COLUMN = "sticky start-0 z-[1] bg-[var(--os-table-head-bg)]";
export const PINNED_CELL = "bg-raised [background-image:linear-gradient(var(--tc-tint,transparent),var(--tc-tint,transparent))]";

/**
 * The pinned "What" column's width for a card this wide (pure; tested): 220
 * on a form page, 150 on a phone, where 220 of a 292px card would leave the
 * Member column nowhere to scroll out from under it. Unmeasured (0, the first
 * paint) is the wide one. A long name wraps onto a second line, never cut.
 */
export const WHAT_WIDE = 220;
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
  [WHAT_WIDE]: "[&>div:first-child]:[scroll-padding-inline-start:220px]",
  [WHAT_NARROW]: "[&>div:first-child]:[scroll-padding-inline-start:150px]",
};

export interface PermissionGridRow {
  mod: PermissionModule;
  action: string;
  label: string;
}

/** The grid's columns (pure; tested): "What", then one per level in ACCESS_LEVELS order. */
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
      width: `${whatWidth}px`,
      className: PINNED_COLUMN,
      cellClassName: PINNED_CELL,
      render: (r) => <span className="line-clamp-2 min-w-0 leading-[18px]" title={r.label}>{r.label}</span>,
    },
    ...ACCESS_LEVELS.map((l): TableColumn<PermissionGridRow> => ({
      key: l.value,
      label: LEVEL_WORD[l.value],
      width: `${LEVEL_WIDTH[l.value]}px`,
      align: "center",
      render: (r) => {
        const on = allows(l.value, r);
        if (PROTECTED_ADMIN_ROLES.includes(l.value)) {
          return <Lock className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.5} aria-label={`${LEVEL_WORD[l.value]} always can`} />;
        }
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
}: {
  rows: PermissionGridRow[] | null;
  skeletonRows?: number;
  ariaLabel: string;
  /** Whether a level holds a rule: the page answers it (checkPermission over its matrix). */
  allows: (level: AccessLevel, row: PermissionGridRow) => boolean;
  canEdit: boolean;
  readOnly?: boolean;
  onToggle: (level: AccessLevel, mod: PermissionModule, action: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const whatWidth = whatColumnWidth(useElementWidth(ref));
  return (
    <div ref={ref}>
      <TableCard<PermissionGridRow>
        ariaLabel={ariaLabel}
        className={SCROLL_CLEAR[whatWidth]}
        columns={permissionGridColumns({ allows, canEdit, readOnly, onToggle, whatWidth })}
        rows={rows}
        skeletonRows={skeletonRows ?? rows?.length ?? 8}
        rowKey={(r) => `${r.mod}.${r.action}`}
      />
    </div>
  );
}
