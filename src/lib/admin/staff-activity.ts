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
  "admin.org.trial_end_changed": "companies",
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
  "admin.org.trial_end_changed": "Trial end changed",
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

/**
 * How a stored timestamp reads. The page passes the viewer's own date format
 * (the one the When column uses); with none, the day alone (YYYY-MM-DD).
 */
export type DetailDateFormat = (iso: string) => string;

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/;

/** The Before and After values as plain words: plan names, status words, On and Off. */
export function plainValue(key: string, value: unknown, date?: DetailDateFormat): string {
  if (value === null || value === undefined || value === "") {
    if (key === "seats" || key === "codeSeats") return "Unlimited";
    return "None";
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (key === "plan" || key === "codePlan") return planLabel(String(value));
  if (key === "status") return statusLabel(String(value));
  if (key === "role") return roleWord(String(value));
  if (typeof value === "string" && ISO_TIMESTAMP_RE.test(value)) return date ? date(value) : value.slice(0, 10);
  if (typeof value === "object") {
    try {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${humanKey(k)}: ${plainValue(k, v, date)}`)
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
  // The distinct codes the import sent: a line repeated within the paste is
  // dropped in the browser and counted apart (repeatedInPaste).
  attempted: "Different codes",
  repeatedInPaste: "Repeated in the paste",
  tiers: "By tier",
  refundedAt: "Refunded",
  redeemedAt: "Redeemed",
  // A refund row describes the CODE (what it gave when it was redeemed), never
  // the company's current plan, so its words say so.
  codeTier: "Code tier",
  codePlan: "Code plan",
  codeSeats: "Code seats",
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
 * A refund changes one thing, the code's refundedAt. Rows written before the
 * refund row became symmetric stored the code's plan and seats and the
 * redemption date only BEFORE and the company only AFTER, so See details read
 * "Plan: Growth to None" under a title that says the plan was not changed.
 * Here the code's facts get the code's words (Code plan, Code seats), and a
 * key held on one side only is the same fact on both: context, not a change.
 */
function normaliseRefund(b: Record<string, unknown>, a: Record<string, unknown>): [Record<string, unknown>, Record<string, unknown>] {
  const rename: Record<string, string> = { tier: "codeTier", plan: "codePlan", seats: "codeSeats" };
  const renamed = (r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [rename[k] ?? k, v]));
  const nb = renamed(b);
  const na = renamed(a);
  for (const k of Object.keys(nb)) if (k !== "refundedAt" && !(k in na)) na[k] = nb[k];
  for (const k of Object.keys(na)) if (k !== "refundedAt" && !(k in nb)) nb[k] = na[k];
  return [nb, na];
}

const DETAIL_NORMALISERS: Partial<
  Record<StaffActionKey, (b: Record<string, unknown>, a: Record<string, unknown>) => [Record<string, unknown>, Record<string, unknown>]>
> = {
  "admin.code.refunded": normaliseRefund,
};

/**
 * The See details rows: every key either side holds, in a stable order,
 * with the plain Before and After words. A key present only after (a new
 * fact such as "signed out 12") shows None before, except where the action's
 * normaliser knows better (a refund: see normaliseRefund).
 */
export function detailRows(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts: { action?: string; date?: DetailDateFormat } = {},
): { key: string; label: string; before: string; after: string; changed: boolean }[] {
  let b: Record<string, unknown> = before && typeof before === "object" ? before : {};
  let a: Record<string, unknown> = after && typeof after === "object" ? after : {};
  const normalise = isStaffActionKey(opts.action) ? DETAIL_NORMALISERS[opts.action] : undefined;
  if (normalise) [b, a] = normalise(b, a);
  const keys: string[] = [];
  for (const k of [...Object.keys(b), ...Object.keys(a)]) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => {
    const before = k in b ? plainValue(k, b[k], opts.date) : "None";
    const after = k in a ? plainValue(k, a[k], opts.date) : "None";
    // Context (the person's name and email on an Owner grant) is the same on
    // both sides; the details dialog lists it apart so the change stands out.
    return { key: k, label: humanKey(k), before, after, changed: before !== after };
  });
}

/**
 * The sentence for an import, in the toast and in the Staff activity row
 * alike, so the two never give different totals for one paste. `attempted`
 * is the distinct codes sent; `repeated` the lines the browser dropped
 * because the same code was already higher up in the paste. The total is
 * every code line pasted.
 */
export function importWords(inserted: number, attempted: number, repeated: number): {
  total: number;
  already: number;
  repeated: number;
  toast: string;
  summary: string;
} {
  const rep = Number.isInteger(repeated) && repeated > 0 ? repeated : 0;
  const already = Math.max(0, attempted - inserted);
  const total = attempted + rep;
  const was = (n: number) => (n === 1 ? "was" : "were");
  const toast = [
    `Imported ${inserted} of ${total} ${total === 1 ? "code" : "codes"}.`,
    already > 0 ? `${already} ${was(already)} already here.` : null,
    rep > 0 ? `${rep} ${was(rep)} repeated in the paste.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const why = [
    already > 0 ? `${already} already existed` : null,
    rep > 0 ? `${rep} repeated in the paste` : null,
  ].filter(Boolean);
  const summary = `Imported ${inserted} of ${total} AppSumo codes${why.length ? ` (${why.join(", ")})` : ""}`;
  return { total, already, repeated: rep, toast, summary };
}
