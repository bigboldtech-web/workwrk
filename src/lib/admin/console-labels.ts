// The words and chip colours the Staff console uses for a company's plan and
// status and a code's status (spec-admin-backoffice 2.2 and 2.6). Pure and
// client-safe. Colours are the product's pale StatusChip tones
// (lib/automation/run-status.ts), so a Suspended company reads like every
// other danger state in WorkwrK.

import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import type { CodeStatus } from "@/lib/admin/search";

export { planLabel, statusLabel } from "@/lib/staff-audit-helpers";

export const PLAN_OPTIONS = [
  { value: "STARTER", label: "Starter" },
  { value: "GROWTH", label: "Growth" },
  { value: "SCALE", label: "Scale" },
  { value: "ENTERPRISE", label: "Enterprise" },
] as const;

export const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "TRIAL", label: "Trial" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

/** Active success, Trial warning, Suspended danger, Cancelled neutral. */
export function companyStatusColor(status: string): string {
  switch (status) {
    case "ACTIVE":
      return RUN_TONE_COLOR.success;
    case "TRIAL":
      return RUN_TONE_COLOR.warning;
    case "SUSPENDED":
      return RUN_TONE_COLOR.danger;
    default:
      return RUN_TONE_COLOR.neutral;
  }
}

/** Unused neutral, Redeemed success, Refunded warning. */
export function codeStatusColor(status: CodeStatus): string {
  if (status === "redeemed") return RUN_TONE_COLOR.success;
  if (status === "refunded") return RUN_TONE_COLOR.warning;
  return RUN_TONE_COLOR.neutral;
}

export function codeStatusLabel(status: CodeStatus): string {
  if (status === "redeemed") return "Redeemed";
  if (status === "refunded") return "Refunded";
  return "Unused";
}

/** "1 person", "12 people". */
export function peopleCount(n: number): string {
  return `${new Intl.NumberFormat().format(n)} ${n === 1 ? "person" : "people"}`;
}
