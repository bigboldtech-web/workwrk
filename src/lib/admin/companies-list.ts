/* eslint-disable no-restricted-syntax --
   The Staff console reads OTHER people's stored org role in a customer
   company (who holds Owner access, who may be promoted). The access engine
   answers what one viewer may do; it has no "who holds this role in company
   X" query, so this reads AccessLevel and maps it with the same rule as
   lib/access/org-role.ts (ownerIdsOf). No permission decision is made here:
   every route is gated on requirePlatformAdminApi. */
// The Companies list in the Staff console (spec-admin-backoffice section 2.2):
// the views row, the Filter panel's fields, the sort, and the facts each row
// shows about a company's subscription, seats and Owners. Pure (Prisma
// types only), so GET /api/admin/companies, its CSV export and the page all
// read one definition and vitest proves it in the node environment.
//
// Vocabulary: a row is a COMPANY; what it uses is THEIR WORKSPACE.

import type { Prisma } from "@/generated/prisma";
import { MODULES } from "@/lib/modules";
import { companySearchWhere, boundedInt } from "@/lib/admin/search";
import { VALID_PLANS, VALID_STATUSES, type CompanyPlan, type CompanyStatus } from "@/lib/admin/company-patch-rules";

/* ───────────────────────── views ───────────────────────── */

export const COMPANY_VIEWS = ["all", "paying", "trials", "lifetime", "suspended"] as const;
export type CompanyView = (typeof COMPANY_VIEWS)[number];

export const COMPANY_VIEW_LABEL: Record<CompanyView, string> = {
  all: "All",
  paying: "Paying",
  trials: "Trials",
  lifetime: "Lifetime",
  suspended: "Suspended",
};

export function parseCompanyView(raw: string | null | undefined): CompanyView {
  return (COMPANY_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as CompanyView) : "all";
}

/**
 * A Stripe subscription is "stripe"; a flat-tier row with no Stripe id is the
 * AppSumo lifetime deal (the only writer of that shape is
 * /api/appsumo/redeem); anything else, including no row, is "none".
 */
const STRIPE_SUB: Prisma.SubscriptionWhereInput = { stripeSubscriptionId: { not: null } };
const LIFETIME_SUB: Prisma.SubscriptionWhereInput = { billingMode: "FLAT_TIER", stripeSubscriptionId: null };

/** Each view as a where clause. Paying = a Stripe subscription that is active or past due. */
export function companyViewWhere(view: CompanyView): Prisma.OrganizationWhereInput {
  switch (view) {
    case "paying":
      return { subscription: { is: { ...STRIPE_SUB, status: { in: ["ACTIVE", "PAST_DUE"] } } } };
    case "trials":
      return { OR: [{ status: "TRIAL" }, { subscription: { is: { status: "TRIALING" } } }] };
    case "lifetime":
      return { subscription: { is: LIFETIME_SUB } };
    case "suspended":
      return { status: "SUSPENDED" };
    default:
      return {};
  }
}

/* ───────────────────────── filters ───────────────────────── */

export const SUBSCRIPTION_FILTERS = ["stripe", "lifetime", "none", "past_due"] as const;
export type SubscriptionFilter = (typeof SUBSCRIPTION_FILTERS)[number];
export const SUBSCRIPTION_FILTER_LABEL: Record<SubscriptionFilter, string> = {
  stripe: "Stripe",
  lifetime: "Lifetime deal",
  none: "None",
  past_due: "Past due",
};

export const COMPANY_SORTS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "people", label: "Most people" },
  { key: "name", label: "Name A to Z" },
] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number]["key"];

export interface CompanyListParams {
  view: CompanyView;
  search: string;
  plans: CompanyPlan[];
  statuses: CompanyStatus[];
  subscriptions: SubscriptionFilter[];
  /** Module app keys (MODULES[].appKey): "chat", "tables". Every one named must be on. */
  modules: string[];
  owners: "has" | "none" | null;
  peopleMin: number | null;
  peopleMax: number | null;
  /** YYYY-MM-DD, inclusive. */
  signedFrom: string | null;
  signedTo: string | null;
  sort: CompanySort;
  page: number;
  limit: number;
}

/** A comma list, kept only where every word is allowed, order preserved, no repeats. */
export function parseList<T extends string>(raw: string | null | undefined, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const out: T[] = [];
  for (const w of raw.split(",")) {
    const v = w.trim();
    if ((allowed as readonly string[]).includes(v) && !out.includes(v as T)) out.push(v as T);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseDay(raw: string | null | undefined): string | null {
  if (!raw || !DATE_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : raw;
}

function parseCount(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 10_000_000);
}

export const COMPANY_PAGE_SIZES = [40, 100] as const;

export function parseCompanyListParams(sp: URLSearchParams): CompanyListParams {
  const owners = sp.get("owners");
  const sort = sp.get("sort");
  return {
    view: parseCompanyView(sp.get("view")),
    search: (sp.get("search") ?? "").trim().slice(0, 100),
    plans: parseList(sp.get("plan"), VALID_PLANS),
    statuses: parseList(sp.get("status"), VALID_STATUSES),
    subscriptions: parseList(sp.get("subscription"), SUBSCRIPTION_FILTERS),
    modules: parseList(sp.get("modules"), MODULES.map((m) => m.appKey)),
    owners: owners === "has" || owners === "none" ? owners : null,
    peopleMin: parseCount(sp.get("people_min")),
    peopleMax: parseCount(sp.get("people_max")),
    signedFrom: parseDay(sp.get("signed_from")),
    signedTo: parseDay(sp.get("signed_to")),
    sort: COMPANY_SORTS.some((s) => s.key === sort) ? (sort as CompanySort) : "newest",
    page: boundedInt(sp.get("page"), 1, 1, 100_000),
    limit: boundedInt(sp.get("limit"), 40, 1, 100),
  };
}

/** How many Filter panel fields are in use (the "Filter · n" count). View and sort are not filters. */
export function activeCompanyFilterCount(p: CompanyListParams): number {
  return [
    p.search.length > 0,
    p.plans.length > 0,
    p.statuses.length > 0,
    p.subscriptions.length > 0,
    p.modules.length > 0,
    p.owners !== null,
    p.peopleMin !== null || p.peopleMax !== null,
    p.signedFrom !== null || p.signedTo !== null,
  ].filter(Boolean).length;
}

const OWNER_LEVELS = ["SUPER_ADMIN", "COMPANY_ADMIN"] as const;
/** A person who can sign in: not deleted, not deactivated. */
export const LIVE_PERSON: Prisma.UserWhereInput = { deletedAt: null, status: { not: "INACTIVE" } };

/** A live person holding Owner (or the Owner-by-earliest Admin) access, anchored here or by membership. */
export function hasOwnerWhere(): Prisma.OrganizationWhereInput {
  return {
    OR: [
      { users: { some: { ...LIVE_PERSON, accessLevel: { in: [...OWNER_LEVELS] } } } },
      { memberships: { some: { role: { in: [...OWNER_LEVELS] }, user: LIVE_PERSON } } },
    ],
  };
}

function subscriptionFilterWhere(f: SubscriptionFilter): Prisma.OrganizationWhereInput {
  switch (f) {
    case "stripe":
      return { subscription: { is: STRIPE_SUB } };
    case "lifetime":
      return { subscription: { is: LIFETIME_SUB } };
    case "past_due":
      return { subscription: { is: { status: "PAST_DUE" } } };
    case "none":
      return {
        OR: [
          { subscription: { is: null } },
          { subscription: { is: { stripeSubscriptionId: null, billingMode: "PER_USER" } } },
        ],
      };
  }
}

/**
 * Every filter except the view, as one where clause. `peopleIds` is the
 * answer of the people-count pre-query (Prisma cannot filter on a relation
 * count); null when no people range is set.
 */
export function companyFilterWhere(
  p: CompanyListParams,
  opts: { peopleIds?: string[] | null } = {},
): Prisma.OrganizationWhereInput {
  const and: Prisma.OrganizationWhereInput[] = [];
  if (p.search) and.push(companySearchWhere(p.search));
  if (p.plans.length) and.push({ plan: { in: p.plans } });
  if (p.statuses.length) and.push({ status: { in: p.statuses } });
  if (p.subscriptions.length) and.push({ OR: p.subscriptions.map(subscriptionFilterWhere) });
  for (const key of p.modules) {
    const slug = MODULES.find((m) => m.appKey === key)?.productSlug;
    if (slug) and.push({ productInstallations: { some: { status: "ACTIVE", product: { slug } } } });
  }
  if (p.owners === "has") and.push(hasOwnerWhere());
  if (p.owners === "none") and.push({ NOT: hasOwnerWhere() });
  if (opts.peopleIds) {
    const zeroAllowed = (p.peopleMin ?? 0) <= 0;
    and.push({
      OR: [
        { id: { in: opts.peopleIds } },
        ...(zeroAllowed ? [{ users: { none: { deletedAt: null } } }] : []),
      ],
    });
  }
  if (p.signedFrom || p.signedTo) {
    and.push({
      createdAt: {
        ...(p.signedFrom ? { gte: new Date(`${p.signedFrom}T00:00:00.000Z`) } : {}),
        ...(p.signedTo ? { lte: new Date(`${p.signedTo}T23:59:59.999Z`) } : {}),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

export function companyOrderBy(sort: CompanySort): Prisma.OrganizationOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "people":
      return [{ users: { _count: "desc" } }, { createdAt: "desc" }, { id: "desc" }];
    case "name":
      return [{ name: "asc" }, { id: "asc" }];
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

/** The query string for a list state: defaults are left out, so the URL stays short. */
export function companyListQuery(p: Partial<CompanyListParams>): string {
  const q = new URLSearchParams();
  if (p.view && p.view !== "all") q.set("view", p.view);
  if (p.search) q.set("search", p.search);
  if (p.plans?.length) q.set("plan", p.plans.join(","));
  if (p.statuses?.length) q.set("status", p.statuses.join(","));
  if (p.subscriptions?.length) q.set("subscription", p.subscriptions.join(","));
  if (p.modules?.length) q.set("modules", p.modules.join(","));
  if (p.owners) q.set("owners", p.owners);
  if (p.peopleMin != null) q.set("people_min", String(p.peopleMin));
  if (p.peopleMax != null) q.set("people_max", String(p.peopleMax));
  if (p.signedFrom) q.set("signed_from", p.signedFrom);
  if (p.signedTo) q.set("signed_to", p.signedTo);
  if (p.sort && p.sort !== "newest") q.set("sort", p.sort);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  if (p.limit && p.limit !== 40) q.set("limit", String(p.limit));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/* ───────────────────────── row facts ───────────────────────── */

export type SubscriptionSource = "stripe" | "lifetime" | "none";

export interface SubscriptionFacts {
  stripeSubscriptionId: string | null;
  billingMode: "PER_USER" | "FLAT_TIER" | string;
  status: string;
  seats: number;
}

export function subscriptionSource(sub: SubscriptionFacts | null | undefined): SubscriptionSource {
  if (!sub) return "none";
  if (sub.stripeSubscriptionId) return "stripe";
  if (sub.billingMode === "FLAT_TIER") return "lifetime";
  return "none";
}

/**
 * At or above this a seat count means "no limit": AppSumo Tier 3 stores
 * 999,999, and 0 is what a checkout that never finished leaves behind.
 */
export const UNLIMITED_SEATS = 99_999;

export function seatsAreUnlimited(seats: number | null | undefined): boolean {
  return seats == null || seats <= 0 || seats >= UNLIMITED_SEATS;
}

/** "12 of 25", "Unlimited", or "None" with no subscription. */
export function seatsLabel(sub: SubscriptionFacts | null | undefined, people: number): string {
  if (!sub || subscriptionSource(sub) === "none") return "None";
  if (seatsAreUnlimited(sub.seats)) return "Unlimited";
  return `${people} of ${sub.seats}`;
}

export interface OwnerCandidate {
  id: string;
  level: string;
  createdAt: Date | string;
}

/**
 * Who holds Owner access (access-model-spec 2.1 via lib/access/org-role.ts):
 * every SUPER_ADMIN, plus a COMPANY_ADMIN when they are the earliest-created
 * admin. Pass only LIVE people (not deleted, not deactivated): an Owner who
 * cannot sign in does not run the workspace.
 */
export function ownerIdsOf(people: readonly OwnerCandidate[]): string[] {
  const admins = people
    .filter((p) => p.level === "SUPER_ADMIN" || p.level === "COMPANY_ADMIN")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
  const out = admins.filter((p) => p.level === "SUPER_ADMIN").map((p) => p.id);
  const earliest = admins[0];
  if (earliest && earliest.level === "COMPANY_ADMIN") out.unshift(earliest.id);
  return out;
}

/** Module app keys in MODULES order, from the installed product slugs. */
export function modulesFromSlugs(slugs: readonly string[]): string[] {
  const on = new Set(slugs);
  return MODULES.filter((m) => on.has(m.productSlug)).map((m) => m.appKey);
}

/* ───────────────────────── CSV ───────────────────────── */

/**
 * One CSV cell. A value that a spreadsheet would run as a formula (it
 * starts with = + - @, a tab or a carriage return) is prefixed with a
 * quote, so a company named "=HYPERLINK(...)" is text in Excel, not a link.
 */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A CSV export never runs away: past this many rows it stops and says so in the file name. */
export const CSV_MAX_ROWS = 5000;
