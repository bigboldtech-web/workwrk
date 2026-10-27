"use client";

// Workspace settings > Audit log's shared pieces (settings-cleanup Phase 7):
// the severity chip, the Sort chip's orders and the header row the tab's
// toolbar is drawn into. They hold no state of their own, so each is tested
// over what it draws; the page keeps every read, filter and export.

import type { OsToolbarProps } from "@/components/layout/os/page-header/page-header";

/**
 * The header row every Audit log tab holds for its own toolbar (search,
 * Filter, the Sort chip and "..."), drawn into the header stack under the
 * tabs (SettingsToolbar), at the heights it really takes: one 44px line
 * from 594px, two lines (88) from 550px and three (132) below, measured at
 * 1px steps (settings-cleanup Phase 4's way; after-p7/probe/measure-toolbar-
 * audit-280), so nothing below it moves when it arrives. The same heights as
 * Members > People's toolbar without Invite: the same chips, a 280 search
 * and "...".
 */
export const AUDIT_TOOLBAR_ROW = "min-h-11 max-[594px]:min-h-[88px] max-[550px]:min-h-[132px]";

/** The two orders the Sort chip offers, newest first (the default) first. */
export const AUDIT_SORTS = [
  { value: "desc", label: "Newest first" },
  { value: "asc", label: "Oldest first" },
] as const;
export type AuditOrder = (typeof AUDIT_SORTS)[number]["value"];

/**
 * The Sort chip (B8): a toolbar chip at the left that opens its two orders
 * under itself, as Members' does. It reads "Sort" at the default order and
 * names the order otherwise, pressed while it is not the default.
 */
export function auditSort(order: AuditOrder, onChange: (o: AuditOrder) => void): NonNullable<OsToolbarProps["sort"]> {
  return {
    label: order === AUDIT_SORTS[0].value ? "Sort" : AUDIT_SORTS.find((s) => s.value === order)?.label,
    active: order !== AUDIT_SORTS[0].value,
    options: AUDIT_SORTS,
    value: order,
    onChange: (v) => onChange(v === "asc" ? "asc" : "desc"),
    menuLabel: "Sort events",
  };
}

export const SEVERITY_LABEL: Record<string, string> = { info: "Info", warning: "Warning", critical: "Critical" };

/**
 * The pale StatusChip on the semantic tokens (design-system 5.9): 24px tall,
 * radius 6, 12/500, padding-inline 8, a 6px dot at the left, sentence case.
 */
export function SeverityChip({ severity }: { severity: string }) {
  const cls =
    severity === "critical"
      ? "bg-[var(--os-danger-bg)] text-danger-text"
      : severity === "warning"
        ? "bg-[var(--os-warning-bg)] text-warning-text"
        : "bg-hover text-ink-2";
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium ${cls}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}
