// GET /api/activity, its CSV and its Type list (review round 1 of Phase 4):
// a person's own teammate rows (what a teammate did in their browser or their
// Google, their browser sessions and take overs, their Google connection) are
// theirs, and Owners' and Admins'; a manager's My team and the People team's
// Everyone never carry them; and a row answers only what the page draws,
// never its metadata, its IP address or its user agent.
//
// The database is mocked over a few rows (personal-activity.testkit.ts),
// filtered by the very where clause each route builds.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ROWS, findRows, matches, type Row } from "@/lib/access/personal-activity.testkit";

type V = { userId: string; organizationId: string; orgRole: "OWNER" | "ADMIN" | "MEMBER" | "GUEST"; isAgent: boolean; adminScopes: never[]; reportTree?: Set<string> };

const h = vi.hoisted(() => ({ viewer: null as unknown as V }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: {
      findMany: async (args: Parameters<typeof findRows>[0]) => findRows(args),
      count: async (args: { where?: Record<string, unknown> }) => ROWS.filter((r) => matches(r, args.where)).length,
      groupBy: async (args: { where?: Record<string, unknown> }) => {
        const by = new Map<string | null, number>();
        for (const r of ROWS.filter((x) => matches(x, args.where))) by.set(r.targetType, (by.get(r.targetType) ?? 0) + 1);
        return [...by.entries()].map(([targetType, n]) => ({ targetType, _count: { _all: n } }));
      },
    },
  },
}));

vi.mock("@/lib/access/gate", () => {
  class AccessError extends Error {
    status = 403;
    body = { error: "no_access" };
  }
  return { AccessError, requireCan: async () => ({ viewer: h.viewer }) };
});

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (error: string, status = 400) => ({ status, error }),
  jsonSuccess: (data: unknown) => ({ status: 200, ...(data as object) }),
}));

vi.mock("@/lib/access/facts", () => ({ loadOrgFacts: async () => ({ peopleTeamIds: ["pia"] }) }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async (_org: string, userId: string) => (userId === "mia" ? ["max", "ann"] : []) }));
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromViewer: () => ({}),
  activityTargets: async (_ctx: unknown, rows: unknown[]) => rows.map(() => ({ readable: null, name: null, href: null })),
}));

import { GET } from "./route";
import { GET as exportCsv } from "./export.csv/route";
import { GET as typesOf } from "./types/route";
import type { NextRequest } from "next/server";

const viewerOf = (userId: string, orgRole: V["orgRole"] = "MEMBER", reports: string[] = []): V => ({ userId, organizationId: "org", orgRole, isAgent: false, adminScopes: [], reportTree: new Set(reports) });
const MIA = viewerOf("mia", "MEMBER", ["max", "ann"]);
const PIA = viewerOf("pia");
const MAX = viewerOf("max");
const ADA = viewerOf("ada", "ADMIN");

const req = (path: string) => new Request(`http://app.test${path}`) as unknown as NextRequest;

async function feed(viewer: V, scope: string): Promise<{ ids: string[]; rows: Array<Record<string, unknown>> }> {
  h.viewer = viewer;
  const out = (await GET(req(`/api/activity?scope=${scope}&limit=100`))) as unknown as { status: number; data: Array<Record<string, unknown>> };
  expect(out.status).toBe(200);
  return { ids: out.data.map((r) => String(r.id)), rows: out.data };
}

const PERSONAL_OF_MAX = ["click-max", "takeover-max", "ended-max", "ended-max-by-mia", "mail-max", "google-off-max", "google-on-max"];

beforeEach(() => {
  h.viewer = MAX;
});

describe("a person's own teammate rows", () => {
  it("never reach their manager's My team: not the sites, the take over, the sessions, the mail or the Google connection", async () => {
    const { ids, rows } = await feed(MIA, "team");
    expect(ids).toEqual(["task-max", "task-mia"]);
    const json = JSON.stringify(rows);
    for (const leak of ["bank.example.com", "clinic.example.org", "jobs.competitor.example", "Sent email", "g-123", "Google"]) expect(json, leak).not.toContain(leak);
  });

  it("never reach the People team's Everyone", async () => {
    const { ids } = await feed(PIA, "all");
    expect(ids).toEqual(["task-max", "switch-ada", "task-mia"]);
  });

  it("never reach a manager's Just me through a row they wrote about a report (ending Max's browser)", async () => {
    expect((await feed(MIA, "my")).ids).toEqual(["task-mia"]);
  });

  it("reach the person in Just me, whoever wrote them: the system, their manager, an Admin", async () => {
    expect((await feed(MAX, "my")).ids).toEqual(["task-max", ...PERSONAL_OF_MAX]);
  });

  it("reach Owners and Admins in My team and Everyone", async () => {
    expect((await feed(ADA, "all")).ids).toEqual(ROWS.filter((r) => r.organizationId === "org").map((r) => r.id));
    expect((await feed({ ...ADA, orgRole: "OWNER" }, "all")).ids).toContain("click-ann");
  });

  it("stay out when a manager narrows My team to one report with ?actorIds=", async () => {
    h.viewer = MIA;
    const out = (await GET(req("/api/activity?scope=team&actorIds=max"))) as unknown as { data: Array<{ id: string }> };
    expect(out.data.map((r) => r.id)).toEqual(["task-max"]);
  });
});

describe("only what the page draws", () => {
  it("answers no IP address, user agent, actor label or metadata past the names a chip reads", async () => {
    const { rows } = await feed(ADA, "all");
    for (const r of rows) {
      expect(Object.keys(r).sort(), String(r.id)).toEqual(["actor", "createdAt", "description", "id", "metadata", "targetHref", "targetId", "targetName", "targetReadable", "targetType", "type"]);
    }
    const json = JSON.stringify(rows);
    for (const leak of ["10.1.2.3", "secret agent", "kept out", "googleId", '"sites"', '"site"', '"reason"', '"agentId"']) expect(json, leak).not.toContain(leak);
    // The chip's name fallback still reads a writer's title.
    expect(rows.find((r) => r.id === "task-max")?.metadata).toEqual({ title: "Call Acme" });
    expect(rows.find((r) => r.id === "click-max")?.metadata).toBeNull();
  });
});

describe("the CSV and the Type list hold the feed's own rows", () => {
  it("leave a report's teammate rows out of a manager's export", async () => {
    h.viewer = MIA;
    const csv = await (await exportCsv(req("/api/activity/export.csv?scope=team"))).text();
    expect(csv).toContain("Call Acme");
    for (const leak of ["bank.example.com", "clinic.example.org", "Sent email", "Google"]) expect(csv, leak).not.toContain(leak);
  });

  it("count no family a viewer may not read", async () => {
    h.viewer = PIA;
    const out = (await typesOf(req("/api/activity/types?scope=all"))) as unknown as { families: Array<{ key: string; count: number }> };
    // Pia reads two task rows and the switch, nothing of Max's teammate, his browser or his Google.
    const total = out.families.reduce((n, f) => n + f.count, 0);
    expect(total).toBe(3);
  });
});

// Final review of the MCP server (privacy H1): Max's AI app rows (connected,
// a change it made as him, an Admin's turning AI apps off) reached his
// manager's My team and the People team's Everyone. Fails on fcca4075.
describe("a person's AI app (MCP) rows", () => {
  const at = new Date(Date.parse("2026-10-11T09:00:00Z") - 30_000);
  const base: Row = {
    id: "x", organizationId: "org", type: "mcp.app.connected", description: "Connected an AI app (MCP)", actorId: "max", actingForId: "max", actorType: "user", actorLabel: null,
    targetType: "oauth_grant", targetId: "gr-1", metadata: { appName: "Claude", redirectHost: "claude.ai" }, ipAddress: "10.9.9.9", userAgent: "Claude-User", severity: "warning", oldValue: null, newValue: null, createdAt: at,
  };
  const MCP_ROWS: Row[] = [
    { ...base, id: "mcp-connected-max" },
    { ...base, id: "mcp-doc-max", type: "mcp.tool.create_doc", description: "Created a doc through an AI app (MCP)", actorType: "mcp", actorLabel: "Claude (MCP)", targetType: "doc", targetId: "d-1" },
    { ...base, id: "mcp-off-max-by-ada", type: "mcp.app.revoked", description: "An AI app (MCP) was disconnected", actorId: "ada", metadata: { reason: "admin_off" } },
  ];
  beforeAll(() => {
    ROWS.push(...MCP_ROWS);
  });
  afterAll(() => {
    ROWS.splice(ROWS.length - MCP_ROWS.length, MCP_ROWS.length);
  });
  const mcpIds = (ids: string[]) => ids.filter((id) => id.startsWith("mcp-"));

  it("never reach a manager's My team, nor the People team's Everyone, nor the CSV", async () => {
    expect(mcpIds((await feed(MIA, "team")).ids)).toEqual([]);
    expect(mcpIds((await feed(PIA, "all")).ids)).toEqual([]);
    h.viewer = MIA;
    const csv = await (await exportCsv(req("/api/activity/export.csv?scope=team"))).text();
    for (const leak of ["AI app", "Claude"]) expect(csv, leak).not.toContain(leak);
  });

  it("reach the person in Just me, and Owners and Admins in Everyone", async () => {
    expect(mcpIds((await feed(MAX, "my")).ids)).toEqual(["mcp-connected-max", "mcp-doc-max", "mcp-off-max-by-ada"]);
    expect(mcpIds((await feed(ADA, "all")).ids)).toEqual(["mcp-connected-max", "mcp-doc-max", "mcp-off-max-by-ada"]);
    // An Admin's own Just me holds no row about Max's app, though she wrote one.
    expect(mcpIds((await feed(ADA, "my")).ids)).toEqual([]);
  });
});
