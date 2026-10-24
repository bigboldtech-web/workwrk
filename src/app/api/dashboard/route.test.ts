// GET /api/dashboard's recent activity (review round 1 of Phase 4): the home
// feed every signed-in account reads never shows a row about one person's
// own AI teammate work, their browser or their Google, to anyone, the person
// included; the workspace's own settings rows and everyone's work stay.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ROWS, findRows, type Row } from "@/lib/access/personal-activity.testkit";

const h = vi.hoisted(() => ({ userId: "max" }));

vi.mock("@/lib/prisma", () => {
  const none = async () => [];
  return {
    prisma: {
      user: { count: async () => 5, findUnique: async () => ({ id: h.userId, officeId: null, departmentId: null }), findMany: none },
      department: { findMany: none },
      sOP: { count: async () => 0 },
      sOPCompliance: { aggregate: async () => ({ _sum: { stepsTotal: 0, stepsCompleted: 0 } }) },
      activityLog: { findMany: async (args: Parameters<typeof findRows>[0]) => findRows(args) },
      kudos: { findMany: none },
      kPIRecord: { findMany: none },
      pulseSurvey: { findMany: none },
      performanceScore: { groupBy: none },
    },
  };
});

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: h.userId, organizationId: "org" } } }),
  getOrgId: () => "org",
  getUserId: () => h.userId,
}));

vi.mock("@/services/performanceScoreService", () => ({ getTopPerformers: async () => [] }));
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromSession: async () => ({}),
  activityTargetsReadable: async (_ctx: unknown, rows: unknown[]) => rows.map(() => true),
}));

import { GET } from "./route";

async function recent(userId: string): Promise<Array<{ id: string; description: string }>> {
  h.userId = userId;
  const res = await GET();
  const body = (await res.json()) as { recentActivity: Array<{ id: string; description: string }> };
  return body.recentActivity;
}

describe("the home feed's recent activity", () => {
  it("never shows a teammate's browser steps, a take over, a browser session, a Google send or a Google connection, to any member", async () => {
    for (const who of ["mia", "pia", "ann", "max", "ada"]) {
      const rows = await recent(who);
      expect(rows.map((r) => r.id), who).toEqual(["task-max", "switch-ada", "task-mia"]);
      const json = JSON.stringify(rows);
      for (const leak of ["bank.example.com", "clinic.example.org", "shop.example.com", "Sent email", "Google"]) expect(json, `${who} ${leak}`).not.toContain(leak);
    }
  });

  it("answers each row's id, type, sentence, actor and time only", async () => {
    const rows = await recent("mia");
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["actor", "createdAt", "description", "id", "type"]);
    expect(ROWS.length).toBeGreaterThan(rows.length);
  });
});

// Final review of the MCP server (privacy H1): the home feed showed a
// person's AI app rows (an app connected, a doc it made as them) to every
// member. Fails on fcca4075.
describe("the home feed and AI apps (MCP)", () => {
  const at = new Date(Date.parse("2026-10-11T09:00:00Z") - 30_000);
  const base: Row = {
    id: "x", organizationId: "org", type: "mcp.app.connected", description: "Connected an AI app (MCP)", actorId: "max", actingForId: "max", actorType: "user", actorLabel: null,
    targetType: "oauth_grant", targetId: "gr-1", metadata: null, ipAddress: null, userAgent: null, severity: "warning", oldValue: null, newValue: null, createdAt: at,
  };
  const MCP_ROWS: Row[] = [
    { ...base, id: "mcp-connected-max" },
    { ...base, id: "mcp-doc-max", type: "mcp.tool.create_doc", description: "Created a doc through an AI app (MCP)", actorType: "mcp", actorLabel: "Claude (MCP)", targetType: "doc", targetId: "d-1" },
  ];
  beforeAll(() => {
    ROWS.push(...MCP_ROWS);
  });
  afterAll(() => {
    ROWS.splice(ROWS.length - MCP_ROWS.length, MCP_ROWS.length);
  });

  it("never shows an AI app row, to any member, the person included", async () => {
    for (const who of ["mia", "pia", "ann", "max", "ada"]) {
      const rows = await recent(who);
      expect(rows.map((r) => r.id).filter((id) => id.startsWith("mcp-")), who).toEqual([]);
      expect(JSON.stringify(rows), who).not.toContain("AI app");
    }
  });
});
