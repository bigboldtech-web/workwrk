// GET /api/ai/sidebar for AI teammates (docs/plans/ai-teammates.md 3.15): the
// chats are Ask AI's own only (never a chat with a teammate), agentsEnabled
// counts only the agents the viewer may use (never another person's private
// teammate), and the row's count and dot come from what waits for the
// viewer's approval and what they have not read.

import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  viewer: { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false, adminScopes: [] },
  sessions: [] as Array<Record<string, unknown>>,
  waitingCount: vi.fn(),
  anyTeammateUnread: vi.fn(),
  aiAllowed: true,
}));

const VIEWER = s.viewer;

vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => s.viewer }));
vi.mock("@/lib/access/index", () => ({
  can: async (_v: unknown, _a: string, ref: { key: string }) => ({ allowed: ref.key === "ai" ? s.aiAllowed : true }),
}));
vi.mock("@/lib/build/gate", () => ({ countUsableBuildApps: async () => 0 }));
vi.mock("@/lib/agents/actions", () => ({ waitingCount: s.waitingCount }));
vi.mock("@/lib/agents/teammate-server", () => ({ anyTeammateUnread: s.anyTeammateUnread }));
vi.mock("@/lib/prisma", async () => {
  const { db, matches } = await import("@/lib/agents/teammate-route-fixtures");
  const sessionMatches = (row: Record<string, unknown>, where: Record<string, unknown>) => {
    const rest = { ...where };
    delete rest.messages;
    return matches(row, rest);
  };
  return {
    prisma: {
      chatSession: {
        findMany: async (a: { where: Record<string, unknown> }) => s.sessions.filter((r) => sessionMatches(r, a.where)),
        count: async (a: { where: Record<string, unknown> }) => s.sessions.filter((r) => sessionMatches(r, a.where)).length,
      },
      agent: { count: async (a: { where: Record<string, unknown> }) => db.agents.filter((r) => matches(r, a.where)).length },
      automationWorkflow: { count: async () => 0 },
      automationRun: { count: async () => 0 },
    },
  };
});

import { GET } from "./route";
import { resetRouteDb, seedAgent } from "@/lib/agents/teammate-route-fixtures";

const at = new Date("2026-10-06T09:00:00Z");

beforeEach(() => {
  resetRouteDb();
  vi.clearAllMocks();
  s.aiAllowed = true;
  s.sessions = [
    { id: "s-ask", organizationId: "org1", userId: "u-max", kind: null, archivedAt: null, title: "Plan the launch", pinned: false, updatedAt: at },
    { id: "s-team", organizationId: "org1", userId: "u-max", kind: "TEAMMATE", archivedAt: null, title: "Planner", pinned: false, updatedAt: at },
  ];
  s.waitingCount.mockResolvedValue(3);
  s.anyTeammateUnread.mockResolvedValue(true);
});

describe("the AI sidebar's data", () => {
  it("lists Ask AI's chats only, counts only agents the viewer may use, and adds what waits and what is unread", async () => {
    seedAgent({ slug: "status-reporter" });
    seedAgent({ slug: "t-mine-aaaaaa", visibility: "PRIVATE", ownerId: "u-max" });
    seedAgent({ slug: "t-hers-bbbbbb", visibility: "PRIVATE", ownerId: "u-lea" });
    seedAgent({ slug: "paused-one", status: "DISABLED" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chats.map((c: { id: string }) => c.id)).toEqual(["s-ask"]);
    expect(body.chatsTotal).toBe(1);
    expect(body.agentsEnabled).toBe(2);
    expect(body).toMatchObject({ teammatesWaiting: 3, teammatesUnread: true });
    // Teammates' requests only: Ask AI's own wait on cards in their chats.
    expect(s.waitingCount).toHaveBeenCalledWith("org1", "u-max", expect.any(Date), { teammatesOnly: true });
    expect(s.anyTeammateUnread).toHaveBeenCalledWith(VIEWER);
  });

  it("reads nothing about teammates for a viewer without the AI app", async () => {
    s.aiAllowed = false;
    const body = await (await GET()).json();
    expect(body).toMatchObject({ chats: [], chatsTotal: 0, agentsEnabled: 0, teammatesWaiting: 0, teammatesUnread: false });
    expect(s.waitingCount).not.toHaveBeenCalled();
    expect(s.anyTeammateUnread).not.toHaveBeenCalled();
  });
});
