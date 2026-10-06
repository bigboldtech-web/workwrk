// Ask AI's session routes never list or open an AI teammate's chat, and never
// start an Ask AI chat with another person's private teammate
// (docs/plans/ai-teammates.md 3.15): GET /api/sidekick/sessions lists kind
// null only, GET, PATCH and DELETE /api/sidekick/sessions/[id] answer a
// teammate's chat as a missing one, and POST with agentSlug resolves only an
// agent the person may use. The database is a small table behind the calls
// the routes make.

import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  wheres: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as string[],
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false, adminScopes: [] } }),
}));
vi.mock("next-auth/next", () => ({ getServerSession: async () => ({ user: { id: "u-max", organizationId: "org1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", async () => {
  const { db, matches } = await import("@/lib/agents/teammate-route-fixtures");
  // A session where as these routes write it: its message filter is about
  // emptiness, which every row here passes.
  const sessionMatches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) => {
    const rest = { ...where };
    delete rest.messages;
    s.wheres.push(where);
    return matches(row, rest);
  };
  return {
    prisma: {
      chatSession: {
        count: async (a: { where: Record<string, unknown> }) => s.sessions.filter((r) => sessionMatches(r, a.where)).length,
        findMany: async (a: { where: Record<string, unknown> }) => s.sessions.filter((r) => sessionMatches(r, a.where)).map((r) => ({ ...r })),
        findFirst: async (a: { where: Record<string, unknown> }) => s.sessions.find((r) => sessionMatches(r, a.where)) ?? null,
        create: async (a: { data: Record<string, unknown> }) => {
          s.created.push(a.data);
          return { id: "s-new", createdAt: new Date(), ...a.data };
        },
        update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
          s.updated.push(a.where.id);
          return { id: a.where.id, title: "x", pinned: false, archivedAt: null, ...a.data };
        },
      },
      chatMessage: { findMany: async () => [] },
      agent: { findFirst: async (a: { where: Record<string, unknown> }) => db.agents.find((r) => matches(r, a.where)) ?? null },
    },
  };
});

import { GET as listSessions, POST as startSession } from "./route";
import { DELETE as archiveSession, GET as openSession, PATCH as patchSession } from "./[id]/route";
import { jsonRequest, paramsOf, resetRouteDb, seedAgent } from "@/lib/agents/teammate-route-fixtures";

function chatRow(o: Record<string, unknown>) {
  return {
    organizationId: "org1",
    userId: "u-max",
    kind: null,
    title: "A chat",
    pinned: false,
    lastModel: null,
    archivedAt: null,
    totalTokensIn: 0,
    totalTokensOut: 0,
    productContext: null,
    boardContext: null,
    createdAt: new Date("2026-10-06T09:00:00Z"),
    updatedAt: new Date("2026-10-06T09:00:00Z"),
    _count: { messages: 2 },
    ...o,
  };
}

// The handlers' types allow undefined (an unhandled method); every call here answers.
async function call(res: Promise<Response | undefined>) {
  const r = (await res) as Response;
  return { status: r.status, body: await r.json() };
}

beforeEach(() => {
  resetRouteDb();
  s.sessions = [chatRow({ id: "s-ask", title: "Plan the launch" }), chatRow({ id: "s-team", kind: "TEAMMATE", title: "Planner", agentId: "a-planner" })];
  s.wheres = [];
  s.created = [];
  s.updated = [];
});

describe("Ask AI's chat list", () => {
  it("lists only Ask AI's own chats, never a chat with an AI teammate", async () => {
    const out = await call(listSessions(new Request("http://x/api/sidekick/sessions")));
    expect(out.status).toBe(200);
    expect(out.body.sessions.map((c: { id: string }) => c.id)).toEqual(["s-ask"]);
    expect(out.body.total).toBe(1);
    expect(s.wheres.every((w) => w.kind === null)).toBe(true);
  });
});

describe("one Ask AI chat", () => {
  it("answers a teammate's chat as a missing one on GET, PATCH and DELETE, and changes nothing", async () => {
    const id = paramsOf({ id: "s-team" });
    const missing = paramsOf({ id: "s-none" });
    for (const [mine, none] of [
      [openSession(new Request("http://x"), id), openSession(new Request("http://x"), missing)],
      [patchSession(jsonRequest("PATCH", { title: "Renamed" }), id), patchSession(jsonRequest("PATCH", { title: "Renamed" }), missing)],
      [archiveSession(jsonRequest("DELETE"), id), archiveSession(jsonRequest("DELETE"), missing)],
    ] as const) {
      const theirs = await call(mine);
      expect(theirs.status).toBe(404);
      expect(theirs).toEqual(await call(none));
    }
    expect(s.updated).toEqual([]);
  });

  it("still opens, renames and archives an Ask AI chat", async () => {
    const id = paramsOf({ id: "s-ask" });
    expect((await call(openSession(new Request("http://x"), id))).status).toBe(200);
    expect((await call(patchSession(jsonRequest("PATCH", { title: "Renamed" }), id))).status).toBe(200);
    expect((await call(archiveSession(jsonRequest("DELETE"), id))).status).toBe(200);
    expect(s.updated).toEqual(["s-ask", "s-ask"]);
  });
});

describe("starting an Ask AI chat with an agent", () => {
  it("never binds another person's private teammate: the same 404 as a slug that does not exist", async () => {
    seedAgent({ slug: "t-planner-aaaaaa", name: "Planner", visibility: "PRIVATE", ownerId: "u-lea" });
    const theirs = await call(startSession(jsonRequest("POST", { agentSlug: "t-planner-aaaaaa" })));
    expect(theirs).toEqual(await call(startSession(jsonRequest("POST", { agentSlug: "no-such-agent" }))));
    expect(theirs.status).toBe(404);
    expect(s.created).toEqual([]);
  });

  it("binds a workspace agent, and the person's own private teammate, as before", async () => {
    seedAgent({ slug: "status-reporter", name: "Status Reporter" });
    seedAgent({ slug: "t-mine-bbbbbb", name: "Mine", visibility: "PRIVATE", ownerId: "u-max" });
    expect((await call(startSession(jsonRequest("POST", { agentSlug: "status-reporter" })))).status).toBe(200);
    expect((await call(startSession(jsonRequest("POST", { agentSlug: "t-mine-bbbbbb" })))).status).toBe(200);
    expect(s.created.map((c) => [c.agentId, c.title])).toEqual([
      ["a-status-reporter", "Chat with Status Reporter"],
      ["a-t-mine-bbbbbb", "Chat with Mine"],
    ]);
  });
});
