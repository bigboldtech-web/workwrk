// Staff activity (/admin/audit, spec-admin-backoffice 2.7): the views, the
// filters, the plain words for each action key and for the stored before and
// after values. Pure (Prisma types only), so GET /api/admin/staff-actions, its
// CSV export and the page read one definition, and vitest proves it.

import type { Prisma } from "@/generated/prisma";
import { STAFF_ACTIONS, planLabel, statusLabel, type StaffActionKey } from "@/lib/staff-audit-helpers";
import { boundedInt } from "@/lib/admin/search";
import { parseDay } from "@/lib/admin/companies-list";

export const ACTIVITY_VIEWS = ["all", "companies", "staff", "codes"] as const;
export type ActivityView = (typeof ACTIVITY_VIEWS)[number];
export const ACTIVITY_VIEW_LABEL: Record<ActivityView, string> = {
  all: "All",
  companies: "Companies",
  staff: "Staff",
  codes: "Codes",
};

/** Which view each action key belongs to. A denied probe is about the staff list. */
export const ACTION_VIEW: Record<StaffActionKey, Exclude<ActivityView, "all">> = {
  "admin.org.plan_changed": "companies",
  "admin.org.status_changed": "companies",
  "admin.org.seats_changed": "companies",
  "admin.org.module_changed": "companies",
  "admin.org.feature_changed": "companies",
  "admin.org.owner_set": "companies",
  "admin.staff.added": "staff",
  "admin.staff.removed": "staff",
  "admin.access.denied": "staff",
  "admin.codes.imported": "codes",
  "admin.code.refunded": "codes",
};

/** The Action filter's words for each key. */
export const ACTION_LABEL: Record<StaffActionKey, string> = {
  "admin.org.plan_changed": "Plan changed",
  "admin.org.status_changed": "Status changed",
  "admin.org.seats_changed": "Seats changed",
  "admin.org.module_changed": "Module turned on or off",
  "admin.org.feature_changed": "Enterprise add-on turned on or off",
  "admin.org.owner_set": "Workspace Owner set",
  "admin.staff.added": "Staff added",
  "admin.staff.removed": "Staff removed",
  "admin.access.denied": "Console access refused",
  "admin.codes.imported": "Codes imported",
  "admin.code.refunded": "Code marked refunded",
};

export function isStaffActionKey(v: string | null | undefined): v is StaffActionKey {
  return (STAFF_ACTIONS as readonly string[]).includes(v ?? "");
}

export interface ActivityParams {
  view: ActivityView;
  who: string | null;
  company: string | null;
  action: StaffActionKey | null;
  from: string | null;
  to: string | null;
  sort: "newest" | "oldest";
  cursor: string | null;
  limit: number;
}

const COMPANY_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const CURSOR_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function parseActivityParams(sp: URLSearchParams): ActivityParams {
  const view = sp.get("view");
  const who = (sp.get("who") ?? "").trim().toLowerCase().slice(0, 254);
  const company = (sp.get("company") ?? "").trim();
  const action = sp.get("action");
  const cursor = (sp.get("cursor") ?? "").trim();
  return {
    view: (ACTIVITY_VIEWS as readonly string[]).includes(view ?? "") ? (view as ActivityView) : "all",
    who: who || null,
    company: COMPANY_ID_RE.test(company) ? company : null,
    action: isStaffActionKey(action) ? action : null,
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
    sort: sp.get("sort") === "oldest" ? "oldest" : "newest",
    cursor: CURSOR_RE.test(cursor) ? cursor : null,
    limit: boundedInt(sp.get("limit"), 40, 1, 100),
  };
}

export function activeActivityFilterCount(p: ActivityParams): number {
  return [p.who, p.company, p.action, p.from || p.to].filter(Boolean).length;
}

/** Every filter plus the view as one where clause (the cursor is separate). */
export function activityWhere(p: ActivityParams): Prisma.StaffActionWhereInput {
  const and: Prisma.StaffActionWhereInput[] = [];
  if (p.view !== "all") {
    const keys = (Object.keys(ACTION_VIEW) as StaffActionKey[]).filter((k) => ACTION_VIEW[k] === p.view);
    and.push({ action: { in: keys } });
  }
  if (p.who) and.push({ actorEmail: p.who });
  if (p.company) and.push({ targetCompanyId: p.company });
  if (p.action) and.push({ action: p.action });
  if (p.from || p.to) {
    and.push({
      createdAt: {
        ...(p.from ? { gte: new Date(`${p.from}T00:00:00.000Z`) } : {}),
        ...(p.to ? { lte: new Date(`${p.to}T23:59:59.999Z`) } : {}),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

export function activityOrderBy(sort: "newest" | "oldest"): Prisma.StaffActionOrderByWithRelationInput[] {
  const dir = sort === "oldest" ? "asc" : "desc";
  return [{ createdAt: dir }, { id: dir }];
}

/**
 * The "What" sentence for the list: the stored summary, which already reads
 * as a sentence that starts with the verb ("Changed Acme's plan from Growth
 * to Scale"). A denial's summary starts with the email; it is shown as is.
 */
export function whatOf(summary: string): string {
  return summary.trim();
}

/** The Before and After values as plain words: plan names, status words, On and Off. */
export function plainValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    if (key === "seats") return "Unlimited";
    return "None";
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (key === "plan") return planLabel(String(value));
  if (key === "status") return statusLabel(String(value));
  if (key === "role") return roleWord(String(value));
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  if (typeof value === "object") {
    try {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${humanKey(k)}: ${plainValue(k, v)}`)
        .join(", ");
    } catch {
      return "";
    }
  }
  return String(value);
}

function roleWord(level: string): string {
  if (level === "SUPER_ADMIN" || level === "OWNER") return "Owner";
  if (level === "COMPANY_ADMIN" || level === "ADMIN") return "Admin";
  return "Member";
}

const KEY_WORDS: Record<string, string> = {
  plan: "Plan",
  status: "Status",
  seats: "Seats",
  enabled: "Switch",
  label: "Name",
  feature: "Add-on",
  module: "Module",
  role: "Role",
  name: "Name",
  email: "Email",
  owners: "Owners",
  signedOut: "Signed out",
  movedToOtherWorkspace: "Moved to another workspace",
  inserted: "Imported",
  attempted: "In the file",
  tiers: "By tier",
  refundedAt: "Refunded",
  redeemedAt: "Redeemed",
  companyName: "Company",
  companyId: "Company ID",
  userId: "Person ID",
  deletionSchedule: "Deletion schedule",
  scheduledHardDeleteAt: "Deletion date",
  cancelledAt: "Cancelled",
  cancelledById: "Cancelled by",
};

export function humanKey(k: string): string {
  if (KEY_WORDS[k]) return KEY_WORDS[k];
  const m = /^tier(\d)$/.exec(k);
  if (m) return `Tier ${m[1]}`;
  return k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/**
 * The See details rows: every key either side holds, in a stable order,
 * with the plain Before and After words. A key present only after (a new
 * fact such as "signed out 12") shows None before.
 */
export function detailRows(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { key: string; label: string; before: string; after: string }[] {
  const b = before && typeof before === "object" ? before : {};
  const a = after && typeof after === "object" ? after : {};
  const keys: string[] = [];
  for (const k of [...Object.keys(b), ...Object.keys(a)]) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => ({
    key: k,
    label: humanKey(k),
    before: k in b ? plainValue(k, (b as Record<string, unknown>)[k]) : "None",
    after: k in a ? plainValue(k, (a as Record<string, unknown>)[k]) : "None",
  }));
}
