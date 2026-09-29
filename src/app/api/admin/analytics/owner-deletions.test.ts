// Contract test for the Owner deletions in GET /api/admin/analytics.
//
// An Owner deleting their workspace used to be read only from the company's
// live settings.cancelledAt, which every restore wipes. So a deletion that
// was later restored vanished from Cancellations instead of reading
// "restored since", and the churn record lost the commonest cancellation.
// The deletion's durable record is its audit row
// ('organization_scheduled_deletion'); the route must read that and join it
// to the company as it is now. The database is mocked: the test decides
// which audit rows and companies exist and reads what the route answers.

import { legacyTestSession } from "@/lib/access/test-fixtures";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Org = { id: string; name: string; plan: string; status: string; settings: Record<string, unknown> | null };
type Log = { targetId: string | null; organizationId: string; description: string; createdAt: Date };

let logs: Log[];
let orgs: Org[];

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
    activityLog: {
      findMany: async (args: { where: { type: string; createdAt: { gte: Date; lte: Date } } }) =>
        logs
          .filter((l) => l.createdAt >= args.where.createdAt.gte && l.createdAt <= args.where.createdAt.lte)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
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

async function cancellations(): Promise<Row[]> {
  const res = await GET(new NextRequest("http://x/api/admin/analytics?range=30d"));
  const body = (await res.json()) as { cancellations: Row[] };
  return body.cancellations;
}

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000);
const deletionLog = (id: string, name: string, at: Date): Log => ({
  targetId: id,
  organizationId: id,
  description: `Scheduled organization "${name}" for deletion on 2026-10-29 (30-day grace).`,
  createdAt: at,
});

beforeEach(() => {
  logs = [];
  orgs = [];
});

describe("GET /api/admin/analytics, Owner deletions", () => {
  it("keeps an Owner deletion that was restored since, marked restored", async () => {
    // Deleted by its Owner, then restored: the restore wiped settings.cancelledAt.
    logs = [deletionLog("org-a", "Alpha", ago(5))];
    orgs = [{ id: "org-a", name: "Alpha", plan: "STARTER", status: "TRIAL", settings: {} }];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-a", name: "Alpha", plan: "STARTER", what: "deleted", restored: true })]);
  });

  it("reads a deletion that still stands as not restored, once", async () => {
    const at = ago(3);
    logs = [deletionLog("org-b", "Beta", at)];
    // The live schedule is a few milliseconds older than the audit row.
    orgs = [{ id: "org-b", name: "Beta", plan: "PRO", status: "CANCELLED", settings: { cancelledAt: new Date(at.getTime() - 3).toISOString() } }];
    const rows = await cancellations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "org-b", what: "deleted", restored: false });
  });

  it("marks a deletion restored when staff later cancelled the restored company", async () => {
    // Deleted, restored by staff (schedule wiped), then cancelled by staff:
    // CANCELLED again but the Owner's deletion no longer stands.
    logs = [deletionLog("org-c", "Gamma", ago(10))];
    orgs = [{ id: "org-c", name: "Gamma", plan: "STARTER", status: "CANCELLED", settings: {} }];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-c", what: "deleted", restored: true })]);
  });

  it("keeps one row per company, the newest deletion", async () => {
    const newer = ago(1);
    logs = [deletionLog("org-d", "Delta", ago(20)), deletionLog("org-d", "Delta", newer)];
    orgs = [{ id: "org-d", name: "Delta", plan: "STARTER", status: "CANCELLED", settings: { cancelledAt: newer.toISOString() } }];
    const rows = await cancellations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "org-d", restored: false, canceledAt: newer.toISOString() });
  });

  it("keeps a company deleted for good under its recorded name, with no plan", async () => {
    logs = [deletionLog("org-e", "Epsilon Ltd", ago(2))];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-e", name: "Epsilon Ltd", plan: null, what: "deleted", restored: false, gone: true })]);
  });

  it("still counts a deletion whose audit row was never written", async () => {
    orgs = [{ id: "org-f", name: "Zeta", plan: "STARTER", status: "CANCELLED", settings: { cancelledAt: ago(4).toISOString() } }];
    const rows = await cancellations();
    expect(rows).toEqual([expect.objectContaining({ id: "org-f", what: "deleted", restored: false })]);
  });
});
