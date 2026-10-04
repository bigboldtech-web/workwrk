// Contract test for the Owner deletions in GET /api/admin/analytics.
//
// An Owner deleting their workspace used to be read only from the company's
// live settings.cancelledAt, which every restore wipes. So a deletion that
// was later restored vanished from Cancellations instead of reading
// "restored since", and the churn record lost the commonest cancellation.
// Then it was read from its audit row, which the hard delete cascades away a
// month later. The durable record is now WorkspaceDeletion (no foreign key,
// no name); the route must read that and join it to the company as it is
// now, and count a company deleted for good in growth, the funnel and the
// cohorts. The database is mocked: the test decides which records and
// companies exist and reads what the route answers.

import { legacyTestSession } from "@/lib/access/test-fixtures";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Org = { id: string; name: string; plan: string; status: string; settings: Record<string, unknown> | null };
type Rec = { organizationId: string; plan: string | null; requestedAt: Date };
type Gone = { organizationId: string; signedUpAt: Date | null; finishedSetup: boolean | null; createdSomething: boolean | null };

let records: Rec[];
let orgs: Org[];
let gone: Gone[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      count: async () => orgs.length,
      findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args.where?.id?.in;
        // Only the join of the audit rows filters by id; every other read
        // (window companies, paying cohort) gets nothing, which is enough here.
        return ids ? orgs.filter((o) => ids.includes(o.id)) : [];
      },
      groupBy: async () => [],
    },
    user: { count: async () => 0, groupBy: async () => [] },
    subscription: { findMany: async () => [] },
    staffAction: { findMany: async () => [] },
    workspaceDeletion: {
      // Two reads: the deletions in the range, and the companies deleted for
      // good that signed up in it (the only read that filters hardDeletedAt).
      findMany: async (args: { where: { requestedAt?: { gte: Date; lte: Date }; hardDeletedAt?: unknown } }) => {
        if (args.where.hardDeletedAt !== undefined) return gone;
        const r = args.where.requestedAt!;
        return records
          .filter((l) => l.requestedAt >= r.gte && l.requestedAt <= r.lte)
          .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
      },
    },
    // The live-schedule read: companies CANCELLED with settings.cancelledAt.
    $queryRaw: async () =>
      orgs
        .filter((o) => o.status === "CANCELLED" && typeof o.settings?.cancelledAt === "string")
        .map((o) => ({ id: o.id, name: o.name, plan: o.plan, cancelledAt: o.settings?.cancelledAt as string })),
  },
}));

vi.mock("@/lib/api-helpers", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getSessionOrFail: async () => ({ error: null, session: legacyTestSession("staff-1", "COMPANY_ADMIN", "org-staff") }),
    jsonError: (message: string, status = 400) => NextResponse.json({ error: message }, { status }),
    jsonSuccess: (data: unknown, status = 200, headers?: Record<string, string>) => NextResponse.json(data, { status, headers }),
  };
});
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdminApi: async () => null }));
vi.mock("@/lib/admin/stripe-revenue", () => ({
  withStripeDeadline: async <T,>(p: Promise<T>) => p,
  readMonthlyRevenue: async () => ({ source: "unavailable" }),
  readChargedSeries: async () => ({ source: "unavailable" }),
}));
vi.mock("@/lib/admin/workspace-use", () => ({ busiestByUse: async () => [], usedCompanyIds: async () => [] }));

import { GET } from "./route";

type Row = { id: string; name: string; plan: string | null; what: string; restored: boolean; gone?: boolean; canceledAt: string | null };
type Body = {
  cancellations: Row[];
  growth: { newCompanies: number; byBucket: number[] };
  funnel: { signedUp: number; finishedSetup: number; createdSomething: number; paying: number };
  retention: { cohorts: { month: string; size: number; stillActive: number; paying: number; cancelled: number }[] };
};

async function analytics(): Promise<Body> {
  const res = await GET(new NextRequest("http://x/api/admin/analytics?range=30d"));
  return (await res.json()) as Body;
}
async function cancellations(): Promise<Row[]> {
  return (await analytics()).cancellations;
}

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000);
const deletion = (id: string, at: Date, plan: string | null = "STARTER"): Rec => ({ organizationId: id, plan, requestedAt: at });

beforeEach(() => {
  records = [];
  orgs = [];
  gone = [];
});

describe("GET /api/admin/analytics, Owner deletions", () => {
  it("keeps an Owner deletion that was restored since, marked restored", async () => {
    // Deleted by its Owner, then restored: the restore wiped settings.cancelledAt.
    records = [deletion("org-a", ago(5))];
    orgs = [{ id: "org-a", name: "Alpha", plan: "STARTER", status: "TRIAL", settings: {} }];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-a", name: "Alpha", plan: "STARTER", what: "deleted", restored: true })]);
  });

  it("reads a deletion that still stands as not restored, once", async () => {
    const at = ago(3);
    records = [deletion("org-b", at)];
    // The live schedule is a few milliseconds older than the record.
    orgs = [{ id: "org-b", name: "Beta", plan: "PRO", status: "CANCELLED", settings: { cancelledAt: new Date(at.getTime() - 3).toISOString() } }];
    const rows = await cancellations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "org-b", what: "deleted", restored: false });
  });

  it("marks a deletion restored when staff later cancelled the restored company", async () => {
    // Deleted, restored by staff (schedule wiped), then cancelled by staff:
    // CANCELLED again but the Owner's deletion no longer stands.
    records = [deletion("org-c", ago(10))];
    orgs = [{ id: "org-c", name: "Gamma", plan: "STARTER", status: "CANCELLED", settings: {} }];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-c", what: "deleted", restored: true })]);
  });

  it("keeps one row per company, the newest deletion", async () => {
    const newer = ago(1);
    records = [deletion("org-d", ago(20)), deletion("org-d", newer)];
    orgs = [{ id: "org-d", name: "Delta", plan: "STARTER", status: "CANCELLED", settings: { cancelledAt: newer.toISOString() } }];
    const rows = await cancellations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "org-d", restored: false, canceledAt: newer.toISOString() });
  });

  it("keeps a company deleted for good, with its plan and no name", async () => {
    records = [deletion("org-e", ago(2), "GROWTH")];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-e", name: "A deleted company", plan: "GROWTH", what: "deleted", restored: false, gone: true })]);
  });

  it("still counts a deletion whose record was never written", async () => {
    orgs = [{ id: "org-f", name: "Zeta", plan: "STARTER", status: "CANCELLED", settings: { cancelledAt: ago(4).toISOString() } }];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-f", what: "deleted", restored: false })]);
  });
});

describe("GET /api/admin/analytics, companies deleted for good", () => {
  it("counts them where they signed up: growth, the funnel as far as they got, and the cohorts as cancelled", async () => {
    gone = [
      { organizationId: "gone-1", signedUpAt: ago(24 * 5), finishedSetup: true, createdSomething: true },
      { organizationId: "gone-2", signedUpAt: ago(24 * 4), finishedSetup: true, createdSomething: false },
      { organizationId: "gone-3", signedUpAt: ago(24 * 3), finishedSetup: false, createdSomething: true },
      // A second record for one company (backfill and cron) counts it once.
      { organizationId: "gone-3", signedUpAt: ago(24 * 3), finishedSetup: false, createdSomething: true },
      // Gone before its signup date was recorded: nowhere to place it.
      { organizationId: "gone-4", signedUpAt: null, finishedSetup: null, createdSomething: null },
    ];
    const body = await analytics();
    expect(body.growth.newCompanies).toBe(3);
    expect(body.growth.byBucket.reduce((a, b) => a + b, 0)).toBe(3);
    // Created something counts only after finished setup: the steps nest.
    expect(body.funnel).toMatchObject({ signedUp: 3, finishedSetup: 2, createdSomething: 1, paying: 0 });
    const cohort = body.retention.cohorts.reduce(
      (t, c) => ({ size: t.size + c.size, stillActive: t.stillActive + c.stillActive, paying: t.paying + c.paying, cancelled: t.cancelled + c.cancelled }),
      { size: 0, stillActive: 0, paying: 0, cancelled: 0 },
    );
    expect(cohort).toEqual({ size: 3, stillActive: 0, paying: 0, cancelled: 3 });
  });
});
