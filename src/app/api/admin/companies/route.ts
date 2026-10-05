/* eslint-disable no-restricted-syntax --
   The Staff console reads OTHER people's stored org role in a customer
   company (who holds Owner access, who may be promoted). The access engine
   answers what one viewer may do; it has no "who holds this role in company
   X" query, so this reads AccessLevel and maps it with the same rule as
   lib/access/org-role.ts (ownerIdsOf). No permission decision is made here:
   every route is gated on requirePlatformAdminApi. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getSessionOrFail, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import {
  COMPANY_VIEWS,
  CSV_MAX_ROWS,
  LIVE_PERSON,
  companyFilterWhere,
  companyOrderBy,
  companyViewWhere,
  modulesFromSlugs,
  ownerIdsOf,
  parseCompanyListParams,
  seatsLabel,
  subscriptionSource,
  toCsv,
  type CompanyListParams,
  type CompanyView,
  type OwnerCandidate,
} from "@/lib/admin/companies-list";
import { planLabel, statusLabel } from "@/lib/staff-audit-helpers";
import { MODULES } from "@/lib/modules";
import { consoleTrialEnd } from "@/lib/admin/trial-end";

/**
 * GET /api/admin/companies: the Companies list (spec-admin-backoffice 2.2).
 * Platform staff only.
 *
 *   ?view=all|paying|trials|lifetime|suspended
 *   &search=   name, slug or sign-in domain (the same match Search uses)
 *   &plan=STARTER,GROWTH  &status=ACTIVE,TRIAL
 *   &subscription=stripe,lifetime,none,past_due
 *   &modules=chat,tables  &owners=has|none  &trial_ends=7d (the trial ends in the next 7 days)
 *   &people_min=&people_max=  &signed_from=&signed_to= (YYYY-MM-DD)
 *   &sort=newest|oldest|people|name  &page=&limit= (at most 100)
 *   &format=csv   the same rows as a download (at most 5,000)
 *
 * Returns counts for every view under the same filters, so the pills tell
 * the truth about what each view holds. Counts, plan, seats and modules
 * only: never a company's settings or any of its content.
 *
 * There is no list-level PATCH: PATCH /api/admin/companies/[id] is the one
 * writer, with its confirms and its audit rows.
 */

/** Company ids whose live-or-not (non-deleted) people count is in range. */
async function companiesWithPeopleIn(min: number | null, max: number | null): Promise<string[]> {
  const lo = min ?? 0;
  const hi = max ?? 10_000_000;
  const rows = await prisma.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "User"
    WHERE "deletedAt" IS NULL
    GROUP BY "organizationId"
    HAVING COUNT(*) BETWEEN ${lo} AND ${hi}`;
  return rows.map((r) => r.organizationId);
}

const ROW_SELECT = {
  id: true,
  name: true,
  slug: true,
  domain: true,
  plan: true,
  status: true,
  createdAt: true,
  trialEndsAt: true,
  subscription: {
    select: { stripeSubscriptionId: true, billingMode: true, status: true, seats: true, trialEndsAt: true },
  },
  productInstallations: { where: { status: "ACTIVE" }, select: { product: { select: { slug: true } } } },
  // `tasks`, `sops`, `reviewCycles` and `kras` are read by today's Overview
  // and Analytics pages (their rebuild onto /api/admin/overview and
  // /api/admin/analytics is spec step 6); the Companies list shows none of
  // them. Remove them in the change that rebuilds those two pages.
  _count: { select: { users: { where: { deletedAt: null } }, tasks: true, sops: true, reviewCycles: true, kras: true } },
} satisfies Prisma.OrganizationSelect;

type Row = Prisma.OrganizationGetPayload<{ select: typeof ROW_SELECT }>;

/** Owner counts for a page of companies: anchored people plus memberships, live only. */
async function ownerCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const [anchored, members] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: { in: ids }, ...LIVE_PERSON, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
      select: { id: true, organizationId: true, accessLevel: true, createdAt: true },
    }),
    prisma.organizationMembership.findMany({
      where: { organizationId: { in: ids }, role: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] }, user: LIVE_PERSON },
      select: { organizationId: true, role: true, user: { select: { id: true, organizationId: true, createdAt: true } } },
    }),
  ]);
  const byOrg = new Map<string, Map<string, OwnerCandidate>>();
  const put = (org: string, c: OwnerCandidate) => {
    const m = byOrg.get(org) ?? new Map<string, OwnerCandidate>();
    if (!m.has(c.id)) m.set(c.id, c);
    byOrg.set(org, m);
  };
  // The anchored row is the live one (User.accessLevel is the role in the
  // company a person is working in), so it is put first and wins.
  for (const u of anchored) put(u.organizationId, { id: u.id, level: u.accessLevel, createdAt: u.createdAt });
  for (const m of members) {
    if (m.user.organizationId === m.organizationId) continue;
    put(m.organizationId, { id: m.user.id, level: m.role, createdAt: m.user.createdAt });
  }
  for (const [org, m] of byOrg) out.set(org, ownerIdsOf([...m.values()]).length);
  return out;
}

function shape(r: Row, owners: Map<string, number>) {
  const sub = r.subscription;
  const source = subscriptionSource(sub);
  const people = r._count.users;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    domain: r.domain,
    plan: r.plan,
    status: r.status,
    createdAt: r.createdAt,
    people,
    ownerCount: owners.get(r.id) ?? 0,
    modules: modulesFromSlugs(r.productInstallations.map((i) => i.product.slug)),
    subscription: sub ? { source, status: sub.status, seats: sub.seats, trialEndsAt: sub.trialEndsAt } : null,
    // The trial end staff read, by the console's one rule (Stripe's date, or
    // the company's own self-serve date: src/lib/admin/trial-end.ts).
    trialEndsAt:
      consoleTrialEnd({
        status: r.status,
        trialEndsAt: r.trialEndsAt,
        subscription: sub ? { stripeSubscriptionId: sub.stripeSubscriptionId, billingMode: sub.billingMode, trialEndsAt: sub.trialEndsAt } : null,
      })?.at ?? null,
    seatsLabel: seatsLabel(sub, people),
    /** Legacy lifetime counts for Overview and Analytics until spec step 6. */
    _count: { users: people, tasks: r._count.tasks, sops: r._count.sops, reviewCycles: r._count.reviewCycles, kras: r._count.kras },
  };
}

export type CompanyListRow = ReturnType<typeof shape>;

function csvFor(rows: CompanyListRow[], truncated: boolean): NextResponse {
  const moduleLabel = (k: string) => MODULES.find((m) => m.appKey === k)?.label ?? k;
  const body = toCsv([
    // "Trial ends" goes last, so a sheet built on the earlier columns keeps them.
    ["Company", "Company ID", "Slug", "Sign-in domain", "Plan", "Status", "People", "Seats", "Subscription", "Modules", "Owners", "Signed up", "Trial ends"],
    ...rows.map((r) => [
      r.name,
      r.id,
      r.slug,
      r.domain ?? "",
      planLabel(r.plan),
      statusLabel(r.status),
      r.people,
      r.seatsLabel,
      r.subscription ? (r.subscription.source === "stripe" ? "Stripe" : r.subscription.source === "lifetime" ? "Lifetime deal" : "None") : "None",
      r.modules.map(moduleLabel).join(" and "),
      r.ownerCount,
      new Date(r.createdAt).toISOString().slice(0, 10),
      r.trialEndsAt ? new Date(r.trialEndsAt).toISOString().slice(0, 10) : "",
    ]),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="companies-${stamp}${truncated ? "-first-5000" : ""}.csv"`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const url = new URL(req.url);
  const p: CompanyListParams = parseCompanyListParams(url.searchParams);
  const csv = url.searchParams.get("format") === "csv";

  const peopleIds = p.peopleMin !== null || p.peopleMax !== null ? await companiesWithPeopleIn(p.peopleMin, p.peopleMax) : null;
  const filters = companyFilterWhere(p, { peopleIds });
  const where: Prisma.OrganizationWhereInput = { AND: [filters, companyViewWhere(p.view)] };

  if (csv) {
    const rows = await prisma.organization.findMany({
      where,
      select: ROW_SELECT,
      orderBy: companyOrderBy(p.sort),
      take: CSV_MAX_ROWS + 1,
    });
    const page = rows.slice(0, CSV_MAX_ROWS);
    const owners = await ownerCounts(page.map((r) => r.id));
    return csvFor(page.map((r) => shape(r, owners)), rows.length > CSV_MAX_ROWS);
  }

  const skip = (p.page - 1) * p.limit;
  const [rows, total, ...viewCounts] = await Promise.all([
    prisma.organization.findMany({ where, select: ROW_SELECT, orderBy: companyOrderBy(p.sort), take: p.limit, skip }),
    prisma.organization.count({ where }),
    ...COMPANY_VIEWS.map((v) => prisma.organization.count({ where: { AND: [filters, companyViewWhere(v)] } })),
  ]);
  const owners = await ownerCounts(rows.map((r) => r.id));
  const counts = Object.fromEntries(COMPANY_VIEWS.map((v, i) => [v, viewCounts[i]])) as Record<CompanyView, number>;

  return jsonSuccess({
    companies: rows.map((r) => shape(r, owners)),
    total,
    page: p.page,
    limit: p.limit,
    totalPages: Math.max(1, Math.ceil(total / p.limit)),
    counts,
  });
}
