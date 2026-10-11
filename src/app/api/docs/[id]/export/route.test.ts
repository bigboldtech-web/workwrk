// GET /api/docs/[id]/export?format=md. Docs-found fixes batch 2: the doc's
// "Export as Markdown" row is shown only to a viewer who is neither an Agent
// nor a Guest, but the route refused neither, so a direct call exported what
// the menu withheld. It holds the menu's rule now, after the read checks.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ level: "EMPLOYEE", readable: true }));

vi.mock("@/lib/suites/auth", () => ({ resolveSuiteContext: async () => ({ userId: "u1", orgId: "org", ...legacyLevelRow(st.level), sessionOrgId: "org" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { doc: { findFirst: async () => ({ id: "d1", title: "Runbook", content: null, entityType: null, entityId: null, updatedAt: new Date(), createdById: "u2" }) } },
}));
vi.mock("@/lib/doc-access", () => ({ docAccessible: async () => st.readable }));
vi.mock("@/lib/doc-sharing", () => ({ requireDocRole: async () => (st.readable ? "VIEW" : null) }));
vi.mock("@/lib/docs/content-markdown", () => ({ docToMarkdown: (title: string) => `# ${title}\n` }));
vi.mock("@/lib/app-url", () => ({ absoluteUrl: (p: string) => `https://app.test${p}` }));

import { GET } from "./route";

const get = async (): Promise<Response> => (await GET(new Request("https://app.test/api/docs/d1/export?format=md") as never, { params: Promise.resolve({ id: "d1" }) }))!;

beforeEach(() => { st.level = "EMPLOYEE"; st.readable = true; });

describe("doc export", () => {
  it("hands a Member the Markdown", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Runbook\n");
  });

  it("refuses an Agent and a Guest, as the menu does", async () => {
    st.level = "AGENT";
    const agent = await get();
    expect(agent.status).toBe(403);
    expect(await agent.json()).toEqual({ error: "Agents can't export docs." });
    st.level = "GUEST";
    const guest = await get();
    expect(guest.status).toBe(403);
    expect(await guest.json()).toEqual({ error: "Guests can't export docs." });
  });

  it("still answers 404 for a doc the person cannot open, whoever they are", async () => {
    st.level = "AGENT";
    st.readable = false;
    expect((await get()).status).toBe(404);
  });
});
