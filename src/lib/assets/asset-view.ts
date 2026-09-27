// The Assets page's vocabulary (spec-tools-misc 2.2), pure so the page, the
// drawer, the profile tab and the API agree on one set of words.
//
//   Status is a semantic StatusChip tone (Available neutral, Assigned info,
//   In repair warning, Retired neutral, Lost danger), never a hue map.
//   Condition is a plain word.
//   Warranty: a fixed product rule. Inside 60 days is a warning, past is
//   "Expired". The 30 / 60 / 90 choice in the filter panel is a filter
//   value, not a setting.

import { RUN_TONE_COLOR, type RunTone } from "@/lib/automation/run-status";

export type AssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";
export type AssetStatus = "AVAILABLE" | "ASSIGNED" | "IN_REPAIR" | "RETIRED" | "LOST";
export type AssetType =
  | "LAPTOP" | "DESKTOP" | "MONITOR" | "PHONE" | "TABLET"
  | "KEYBOARD" | "MOUSE" | "HEADSET" | "WEBCAM"
  | "CHAIR" | "DESK" | "ID_CARD" | "ACCESS_CARD" | "VEHICLE" | "OTHER";

export const ASSET_TYPES: readonly AssetType[] = [
  "LAPTOP", "DESKTOP", "MONITOR", "PHONE", "TABLET",
  "KEYBOARD", "MOUSE", "HEADSET", "WEBCAM",
  "CHAIR", "DESK", "ID_CARD", "ACCESS_CARD", "VEHICLE", "OTHER",
];
export const ASSET_CONDITIONS: readonly AssetCondition[] = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];
export const ASSET_STATUSES: readonly AssetStatus[] = ["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"];

export const STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: "Available", ASSIGNED: "Assigned", IN_REPAIR: "In repair", RETIRED: "Retired", LOST: "Lost",
};
export const STATUS_TONE: Record<AssetStatus, RunTone> = {
  AVAILABLE: "neutral", ASSIGNED: "info", IN_REPAIR: "warning", RETIRED: "neutral", LOST: "danger",
};
export function statusColor(s: AssetStatus): string {
  return RUN_TONE_COLOR[STATUS_TONE[s] ?? "neutral"];
}
export const CONDITION_LABEL: Record<AssetCondition, string> = {
  NEW: "New", GOOD: "Good", FAIR: "Fair", POOR: "Poor", DAMAGED: "Damaged",
};

/** "ACCESS_CARD" reads "Access card". */
export function typeLabel(t: string): string {
  return t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function personName(p?: { firstName?: string | null; lastName?: string | null } | null): string {
  if (!p) return "";
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
}

/** The fixed product rule for the row warning. */
export const WARRANTY_WARN_DAYS = 60;
/** The filter panel's choices. */
export const WARRANTY_WINDOWS = [30, 60, 90] as const;
export type WarrantyWindow = (typeof WARRANTY_WINDOWS)[number];

export function parseWarrantyWindow(raw: string | null | undefined): WarrantyWindow | null {
  const n = Number(raw);
  return (WARRANTY_WINDOWS as readonly number[]).includes(n) ? (n as WarrantyWindow) : null;
}

export type WarrantyState =
  | { kind: "none" }
  | { kind: "expired"; days: number }
  | { kind: "soon"; days: number }
  | { kind: "ok"; days: number };

const MS_DAY = 86_400_000;

/** Days until the warranty ends, from `now`; ceil so "today" reads as 0. */
export function warrantyState(iso: string | null | undefined, now: number = Date.now()): WarrantyState {
  if (!iso) return { kind: "none" };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { kind: "none" };
  const days = Math.ceil((t - now) / MS_DAY);
  if (days < 0) return { kind: "expired", days: -days };
  if (days <= WARRANTY_WARN_DAYS) return { kind: "soon", days };
  return { kind: "ok", days };
}

/** True when the warranty ends within `window` days from now (not already past). */
export function warrantyWithin(iso: string | null | undefined, window: number, now: number = Date.now()): boolean {
  const s = warrantyState(iso, now);
  return (s.kind === "soon" || s.kind === "ok") && s.days <= window;
}

export type AssetSort = "name" | "purchase" | "warranty" | "value" | "recent";
export const ASSET_SORTS: ReadonlyArray<{ value: AssetSort; label: string }> = [
  { value: "recent", label: "Recently added" },
  { value: "name", label: "Name" },
  { value: "purchase", label: "Purchase date" },
  { value: "warranty", label: "Warranty expiry" },
  { value: "value", label: "Value" },
];
export function parseAssetSort(raw: string | null | undefined): AssetSort {
  return ASSET_SORTS.some((s) => s.value === raw) ? (raw as AssetSort) : "recent";
}

export type AssetGroup = "none" | "status" | "type" | "assignee";
export const ASSET_GROUPS: ReadonlyArray<{ value: AssetGroup; label: string }> = [
  { value: "none", label: "None" },
  { value: "status", label: "Status" },
  { value: "type", label: "Type" },
  { value: "assignee", label: "Assigned to" },
];
export function parseAssetGroup(raw: string | null | undefined): AssetGroup {
  return ASSET_GROUPS.some((g) => g.value === raw) ? (raw as AssetGroup) : "none";
}

/** The list page sizes: 100 by default, never more than 500 in one request. */
export const ASSET_PAGE_SIZES = [40, 100, 250, 500] as const;
export const ASSET_PAGE_DEFAULT = 100;

/** The `?scope=` a viewer may ask for; "all" is the People team and Admin. */
export type AssetScope = "team" | "all";
export function resolveAssetScope(requested: string | null | undefined, canSeeAll: boolean): { scope: AssetScope; stripped: boolean } {
  if (requested === "all") return canSeeAll ? { scope: "all", stripped: false } : { scope: "team", stripped: true };
  if (requested === "team" || !requested) return { scope: canSeeAll && !requested ? "all" : "team", stripped: false };
  return { scope: canSeeAll ? "all" : "team", stripped: true };
}
