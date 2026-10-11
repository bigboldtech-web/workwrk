// GET /api/audit (Settings > Audit log, Owners and Admins), review round 1 of
// Phase 4: a teammate's browser session's end row names every site the
// session used, with its reads and actions, which the privacy page promises
// ("Owners and Admins see in the audit log which sites a teammate opened for
// you"); its metadata still never leaves the server whole, and the CSV says
// the same as the page.

import { describe, expect, it, vi } from "vitest";
import { ROWS, findRows, matches } from "@/lib/access/personal-activity.testkit";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: {
      findMany: async (args: Parameters<typeof findRows>[0] & { cursor?: unknown }) => findRows(args),
      count: async (args: { where?: Record<string, unknown> }) => ROWS.filter((r) => matches(r, args.where)).length,
    },
    user: { findMany: async () => [{ id: "max", firstName: "Max", lastName: "Smith", email: "max@acme.test" }] },
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "ada", organizationId: "org" } } }),
  getOrgId: () => "org",
  getUserId: () => "ada",
  jsonError: (error: string, status = 400) => ({ status, error }),
  jsonSuccess: (data: unknown) => ({ status: 200, ...(data as object) }),
}));

vi.mock("@/lib/access/workspace-admin", () => ({ sessionIsWorkspaceAdmin: () => true }));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true }) }));
vi.mock("@/lib/access/node-access", () => ({ nodeCtxFromLevel: () => ({}), nodeRoles: async () => new Map() }));
vi.mock("@/lib/activity", () => ({ logActivity: () => undefined }));

import { GET } from "./route";
import type { NextRequest } from "next/server";

const req = (path: string) => new Request(`http://app.test${path}`) as unknown as NextRequest;

describe("a browser session's end in the audit log", () => {
  it("names each site the session used, with its reads and actions, for Owners and Admins", async () => {
    const out = (await GET(req("/api/audit?type=teammate_browser.session_ended"))) as unknown as { items: Array<{ id: string; summary: string | null; actingForName: string | null; metadata?: unknown }> };
    const ended = out.items.find((r) => r.id === "ended-max");
    expect(ended?.summary).toBe("Chief of Staff (for Max Smith): Closed a browser after 4 minutes. Sites: bank.example.com, 3 reads and 1 action; clinic.example.org, 2 reads and no actions.");
    expect(ended?.actingForName).toBe("Max Smith");
    expect(out.items.find((r) => r.id === "ended-max-by-mia")?.summary).toContain("jobs.competitor.example, 1 read and no actions");
    // The row's metadata itself stays on the server.
    for (const r of out.items) expect("metadata" in r).toBe(false);
  });

  it("gives no other row a site summary", async () => {
    const out = (await GET(req("/api/audit"))) as unknown as { items: Array<{ id: string; summary: string | null }> };
    for (const r of out.items.filter((x) => !x.id.startsWith("ended-"))) expect(r.summary, r.id).toBeNull();
  });

  it("says the same in the CSV's Event column", async () => {
    const csv = await ((await GET(req("/api/audit?format=csv&type=teammate_browser.session_ended"))) as Response).text();
    expect(csv).toContain("Sites: bank.example.com, 3 reads and 1 action; clinic.example.org, 2 reads and no actions.");
  });
});
