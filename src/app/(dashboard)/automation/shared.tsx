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
import type { ReactNode } from "react";

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

/** Dark primary pill — same recipe as the Dashboards "New Dashboard" CTA. */
export const DARK_PILL =
  "inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-3 text-[12.5px] font-semibold text-white hover:bg-zinc-800";

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
      className="inline-flex h-[18px] items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: `${color}14`, color, border: `1px solid ${color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  );
}

/** Board-page style header: icon + title left, meta beside, actions right. */
export function AutomationHeader({
  Icon,
  title,
  meta,
  actions,
}: {
  Icon: LucideIcon;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2">
      <h1 className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900">
        <Icon className="h-4 w-4 text-zinc-500" />
        <span>{title}</span>
      </h1>
      {meta ? <span className="text-[12px] text-zinc-500">{meta}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
