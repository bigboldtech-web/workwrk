// Shared asset types + display maps for the register page, form dialog,
// assign dialog and row menu. Mirrors the Asset model enums in
// prisma/schema.prisma (AssetType / AssetCondition / AssetStatus) and the
// fields POST /api/assets + PATCH /api/assets/[id] accept.

export type AssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";
export type AssetStatus = "AVAILABLE" | "ASSIGNED" | "IN_REPAIR" | "RETIRED" | "LOST";
export type AssetType =
  | "LAPTOP" | "DESKTOP" | "MONITOR" | "PHONE" | "TABLET"
  | "KEYBOARD" | "MOUSE" | "HEADSET" | "WEBCAM"
  | "CHAIR" | "DESK" | "ID_CARD" | "ACCESS_CARD" | "VEHICLE" | "OTHER";

export type ApiAsset = {
  id: string;
  name: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  imeiNumber?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyExpiry?: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  notes?: string | null;
  assignedTo?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

export const ASSET_TYPES: AssetType[] = [
  "LAPTOP", "DESKTOP", "MONITOR", "PHONE", "TABLET",
  "KEYBOARD", "MOUSE", "HEADSET", "WEBCAM",
  "CHAIR", "DESK", "ID_CARD", "ACCESS_CARD", "VEHICLE", "OTHER",
];

export const ASSET_CONDITIONS: AssetCondition[] = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];
export const ASSET_STATUSES: AssetStatus[] = ["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"];

export const STATUS_HUE: Record<AssetStatus, string> = {
  AVAILABLE: "var(--os-c-green)", ASSIGNED: "var(--os-c-blue)",
  IN_REPAIR: "var(--os-c-orange)", RETIRED: "var(--os-c-darkgray)", LOST: "var(--os-c-red)",
};
export const STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: "Available", ASSIGNED: "Assigned", IN_REPAIR: "In repair", RETIRED: "Retired", LOST: "Lost",
};
export const CONDITION_HUE: Record<AssetCondition, string> = {
  NEW: "var(--os-c-green)", GOOD: "var(--os-c-teal)",
  FAIR: "var(--os-c-orange)", POOR: "var(--os-c-red)", DAMAGED: "var(--os-c-red)",
};
export const CONDITION_LABEL: Record<AssetCondition, string> = {
  NEW: "New", GOOD: "Good", FAIR: "Fair", POOR: "Poor", DAMAGED: "Damaged",
};

export function typeLabel(t: string): string {
  return t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function personName(p?: { firstName?: string | null; lastName?: string | null } | null): string {
  if (!p) return "";
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
}
