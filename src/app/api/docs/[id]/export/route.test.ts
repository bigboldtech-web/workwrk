// GET /api/docs/[id]/export?format=md. Docs-found fixes batch 2: the doc's
// "Export as Markdown" row is shown only to a viewer who is neither an Agent
// nor a Guest, but the route refused neither, so a direct call exported what
// the menu withheld. It holds the menu's rule now, after the read checks.
//
// Batch 3: each person is modelled as the database holds them, through the
// engine's real viewer (viewer.ts hydrate). A Guest is accessLevel EMPLOYEE
// with the stored orgRole GUEST, read with ACCESS_V2_TABLES on; there is no
// GUEST level. Batch 2's test set a "GUEST" level no row can hold, so it
// passed while a real Guest downloaded the Markdown.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOfRow, legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

type Row = { organizationId: string; accessLevel: string; orgRole: string | null; adminScopes: string[]; status: string; deletedAt: Date | null };
const st = vi.hoisted(() => ({ readable: true, row: null as Row | null }));

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({
  getServerSession: async () => (st.row ? legacyTestSession("u1", legacyLevelOfRow(st.row)) : null),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/reporting-line", () => ({ getEffectiveReportTree: async () => [] }));
vi.mock("@/lib/admin/company-detail", () => ({ ownerIdsFor: async () => [] }));
vi.mock("@/lib/suites/auth", () => ({
  resolveSuiteContext: async () => ({ userId: "u1", orgId: "org", ...legacyLevelRow(st.row ? legacyLevelOfRow(st.row) : "EMPLOYEE"), sessionOrgId: "org" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doc: { findFirst: async () => ({ id: "d1", title: "Runbook", content: null, entityType: null, entityId: null, updatedAt: new Date(), createdById: "u2" }) },
    user: {
      findUnique: async () => (st.row ? { ...st.row, departmentId: null, officeId: null, roleId: null } : null),
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
    },
    organizationMembership: { findUnique: async () => null, findMany: async () => [] },
    tagAssignment: { findMany: async () => [] },
    organization: { findUnique: async () => null },
  },
}));
vi.mock("@/lib/doc-access", () => ({ docAccessible: async () => st.readable }));
vi.mock("@/lib/doc-sharing", () => ({ requireDocRole: async () => (st.readable ? "VIEW" : null) }));
vi.mock("@/lib/docs/content-markdown", () => ({ docToMarkdown: (title: string) => `# ${title}\n` }));
vi.mock("@/lib/app-url", () => ({ absoluteUrl: (p: string) => `https://app.test${p}` }));

import { GET } from "./route";

const get = async (): Promise<Response> => (await GET(new Request("https://app.test/api/docs/d1/export?format=md") as never, { params: Promise.resolve({ id: "d1" }) }))!;
const person = (level: string, orgRole: string | null): Row => ({ organizationId: "org", ...legacyLevelRow(level), orgRole, adminScopes: [], status: "ACTIVE", deletedAt: null });

beforeEach(() => {
  st.readable = true;
  st.row = person("EMPLOYEE", "MEMBER");
  vi.stubEnv("ACCESS_V2_TABLES", "true");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("doc export", () => {
  it("hands a Member the Markdown", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Runbook\n");
  });

  it("refuses a Guest as the database holds one: level EMPLOYEE, stored orgRole GUEST", async () => {
    st.row = person("EMPLOYEE", "GUEST");
    const guest = await get();
    expect(guest.status).toBe(403);
    expect(await guest.json()).toEqual({ error: "Guests can't export docs." });
  });

  it("refuses an Agent", async () => {
    st.row = person("AGENT", "MEMBER");
    const agent = await get();
    expect(agent.status).toBe(403);
    expect(await agent.json()).toEqual({ error: "Agents can't export docs." });
  });

  it("with ACCESS_V2_TABLES off the stored column is not read, as everywhere else, so the same row is a Member", async () => {
    vi.stubEnv("ACCESS_V2_TABLES", "false");
    st.row = person("EMPLOYEE", "GUEST");
    expect((await get()).status).toBe(200);
  });

  it("still answers 404 for a doc the person cannot open, whoever they are", async () => {
    st.row = person("EMPLOYEE", "GUEST");
    st.readable = false;
    expect((await get()).status).toBe(404);
  });
});
