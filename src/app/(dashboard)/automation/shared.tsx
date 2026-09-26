"use client";

// Shared chrome for the Automation Hub pages (/automation/*).
//
// Look-and-feel references (Mobbin, 2026-08-07):
//   - ClickUp Automations "Manage" tab — dark add pill, dense rows:
//     https://mobbin.com/screens/c7c6bac2-ff3d-407b-8bd6-6c2596af0a8f
//   - ClickUp Automations "Usage" tab — actions-used progress cards:
//     https://mobbin.com/screens/8cc27717-56c7-405c-a9a6-10d0afa3a99b
//   - Monday board automations row + "..." menu:
//     https://mobbin.com/screens/c5427402-e691-4cf8-9a7d-1ea6872a8bca
//
// Kept intentionally small: color maps for the Automation* enums, the
// compact status pill (StatusChip's 30px silhouette doesn't fit h-7
// table rows, so this is the same tint recipe at cell height), the
// page header, and the relative-time helper every page needs.

import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { OsPageHeader } from "@/components/layout/os/page-header";

export const BRAND_BLUE = "#0073EA";

/** AutomationWorkflowStatus → label + semantic color (YBRG palette). */
export const WORKFLOW_STATUS_META: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Draft", color: "#71717A" },
  ACTIVE: { label: "Active", color: "#00C875" },
  INACTIVE: { label: "Inactive", color: "#F59E0B" },
  ERROR: { label: "Error", color: "#E2445C" },
  ARCHIVED: { label: "Archived", color: "#A1A1AA" },
};

/** AutomationRunStatus → semantic color. */
export const RUN_STATUS_COLORS: Record<string, string> = {
  RUNNING: BRAND_BLUE,
  SUCCESS: "#00C875",
  FAILED: "#E2445C",
  PARTIAL: "#F59E0B",
  SKIPPED: "#A1A1AA",
};

/** AutomationSeverity → label + color for the Health cards. */
export const SEVERITY_META: Array<{ key: string; label: string; color: string }> = [
  { key: "CRITICAL", label: "Critical", color: "#E2445C" },
  { key: "MAJOR", label: "Major", color: "#F59E0B" },
  { key: "MINOR", label: "Minor", color: "#A1A1AA" },
];

/** The page's one blue primary (design-system: one primary button per page). */
export const PRIMARY_PILL =
  "inline-flex h-7 items-center gap-1 rounded-md bg-brand px-3 text-base font-semibold text-white hover:bg-brand-hover disabled:opacity-50";

/** A neutral bordered button for every other action on the page. */
export const SECONDARY_PILL =
  "inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-base font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50";

export interface AutomationRights {
  /** Create, edit, publish, activate, deactivate, retry. */
  canManage: boolean;
  /** Owner or Admin: delete a workflow, connections. */
  isAdmin: boolean;
}

const NO_RIGHTS: AutomationRights = { canManage: false, isAdmin: false };

/**
 * What this viewer may change (GET /api/automation/me, the same facts every
 * write route checks). Until it answers, and when it fails, the viewer is
 * treated as read-only, so a control that could only fail with a 403 is
 * never on screen.
 */
export function useAutomationRights(): AutomationRights {
  const [rights, setRights] = useState<AutomationRights>(NO_RIGHTS);
  useEffect(() => {
    let alive = true;
    fetch("/api/automation/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<AutomationRights> | null) => {
        if (!alive || !d) return;
        setRights({ canManage: d.canManage === true, isAdmin: d.isAdmin === true });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return rights;
}

/** Flat white card — the hub's only container chrome. */
export const CARD = "rounded-xl border border-zinc-200 bg-white";

export function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Compact status pill sized for h-7 rows (same tint recipe as StatusChip). */
export function StatusPill({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex h-[18px] items-center gap-1 rounded-md px-1.5 text-micro font-semibold uppercase tracking-wide"
      style={{ backgroundColor: `${color}14`, color, border: `1px solid ${color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  );
}

/** Board-page style header: icon + title left, meta beside, actions right. */
export function AutomationHeader({
  Icon: _Icon,
  title,
  meta,
  actions,
}: {
  /** Retired: the page pattern carries no title icon (design-system 4.4). */
  Icon?: LucideIcon;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  void _Icon;
  return (
    <OsPageHeader
      title={title}
      actions={
        meta || actions ? (
          <>
            {meta ? <span className="me-1 text-sm text-ink-2">{meta}</span> : null}
            {actions}
          </>
        ) : undefined
      }
    />
  );
}
