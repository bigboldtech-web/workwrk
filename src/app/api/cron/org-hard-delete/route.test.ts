// /api/cron/org-hard-delete and AI teammates Phase 3 (docs/plans/ai-teammates-phase3.md
// step 2, Decision 20): before the company row goes, inside the same
// transaction, a revoke is queued for every Google connection of its people,
// so the cascade that takes the connections can never take them before Google
// is told. Before step 2 the cascade deleted the sealed tokens and WorkwrK
// stayed listed in each person's Google account for good.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  order: [] as string[],
  tx: null as unknown,
  queue: vi.fn(),
}));

vi.mock("@/lib/email", () => ({ queueEmail: async () => {} }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));
vi.mock("@/lib/admin/company-milestones", () => ({ CREATED_SOMETHING: {}, SETUP_DONE: {} }));
vi.mock("@/lib/admin/staff-activity", () => ({ ACTION_LABEL: {} }));
vi.mock("@/lib/admin/workspace-orphans", () => ({ WORKSPACE_ORPHAN_TABLES: [], isWorkspaceOrphanTable: () => false }));
vi.mock("@/lib/company-files", () => ({ freeCompanyFiles: async () => undefined }));
vi.mock("@/lib/access/workspace-anchor", () => ({ moveHomesOutOf: async () => { st.order.push("moveHomesOutOf"); } }));
vi.mock("@/lib/admin/company-notifications", () => ({ companyOwnedTables: async () => [], deleteNotificationsAbout: async () => undefined }));
vi.mock("@/lib/admin/hard-delete-order", () => ({ HARD_DELETE_FIRST: [], isHardDeleteFirst: () => false }));
vi.mock("@/lib/connectors/connections", () => ({ queueWorkspaceRevocations: st.queue }));

vi.mock("@/lib/prisma", () => {
  const sqlOf = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ");
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => (sqlOf(strings).includes("FOR UPDATE") ? [{ id: "org-gone" }] : []),
    $executeRaw: async (strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      if (sql.includes('DELETE FROM "Organization"')) {
        st.order.push("deleteOrganization");
        return 1;
      }
      return 0;
    },
    $executeRawUnsafe: async () => 0,
    user: { findMany: async () => [{ id: "u-1" }] },
  };
  st.tx = tx;
  return {
    prisma: {
      emailLog: { findFirst: async () => null },
      organization: { count: async () => 0 },
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = sqlOf(strings);
        if (sql.includes('FROM "Organization"')) {
          return [{ id: "org-gone", plan: "STARTER", createdAt: new Date("2026-01-01T00:00:00Z"), scheduled: "2026-09-01T00:00:00.000Z", cancelledAt: "2026-08-02T00:00:00.000Z" }];
        }
        return [];
      },
      $transaction: async (fn: (t: unknown) => unknown) => {
        st.order.push("begin");
        const out = await fn(tx);
        st.order.push("commit");
        return out;
      },
    },
  };
});

import { POST } from "./route";

beforeEach(() => {
  st.order = [];
  st.queue.mockReset().mockImplementation(async (tx: unknown, org: string) => {
    st.order.push(`queue:${org}:${tx === st.tx ? "in-tx" : "outside"}`);
    return 2;
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("org-hard-delete and Google connections for AI teammates", () => {
  it("queues the revokes inside the transaction, after the homes move and before the company is deleted", async () => {
    const res = await POST(new Request("https://app.test/api/cron/org-hard-delete", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    expect(st.queue).toHaveBeenCalledTimes(1);
    expect(st.order).toEqual(["begin", "moveHomesOutOf", "queue:org-gone:in-tx", "deleteOrganization", "commit"]);
  });
});
