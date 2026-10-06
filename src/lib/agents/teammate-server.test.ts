// The AI sidebar's unread dot (teammate-server.ts anyTeammateUnread): a
// teammate the person may use, and that was not removed, answered or
// reported after they last read its chat. The database is the teammate
// routes' in-memory double.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./teammate-route-fixtures")).routeDb }));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: async () => true }));

import { anyTeammateUnread } from "./teammate-server";
import { PEOPLE, db, resetRouteDb, seedAgent, type Row } from "./teammate-route-fixtures";

const viewer = PEOPLE.max as never;

/** The person's live chat with a teammate, its agent embedded as the relation filter reads it. */
function chatWith(agent: Row, o: Row = {}): Row {
  const row: Row = { id: `s-${String(agent.slug)}`, organizationId: "org1", userId: "u-max", kind: "TEAMMATE", archivedAt: null, agentId: agent.id, agent, ...o };
  db.sessions.push(row);
  return row;
}

function say(sessionId: unknown, role: "USER" | "ASSISTANT", at: string): void {
  db.messages.push({ id: `m${db.messages.length + 1}`, sessionId, role, kind: null, createdAt: new Date(at) });
}

function readAt(agentId: unknown, at: string | null): void {
  db.settings.push({ id: `ps${db.settings.length + 1}`, agentId, userId: "u-max", approvalRules: {}, lastReadAt: at ? new Date(at) : null });
}

beforeEach(() => {
  resetRouteDb();
});

describe("anyTeammateUnread", () => {
  it("is false with no teammate chats", async () => {
    expect(await anyTeammateUnread(viewer)).toBe(false);
  });

  it("is true when a teammate answered and the person never read the chat", async () => {
    const chat = chatWith(seedAgent({ slug: "status-reporter" }));
    say(chat.id, "USER", "2026-10-06T09:00:00Z");
    say(chat.id, "ASSISTANT", "2026-10-06T09:00:05Z");
    expect(await anyTeammateUnread(viewer)).toBe(true);
  });

  it("is false once read after the last answer, and true again after a newer report", async () => {
    const agent = seedAgent({ slug: "t-planner-aaaaaa", visibility: "PRIVATE", ownerId: "u-max" });
    const chat = chatWith(agent);
    say(chat.id, "ASSISTANT", "2026-10-06T09:00:05Z");
    readAt(agent.id, "2026-10-06T09:01:00Z");
    expect(await anyTeammateUnread(viewer)).toBe(false);
    say(chat.id, "ASSISTANT", "2026-10-07T09:00:00Z");
    expect(await anyTeammateUnread(viewer)).toBe(true);
  });

  it("never counts the person's own words, a removed teammate, someone else's private one, or anyone else's chat", async () => {
    const mine = chatWith(seedAgent({ slug: "status-reporter" }));
    say(mine.id, "USER", "2026-10-06T09:00:00Z");
    const removed = chatWith(seedAgent({ slug: "old-one", status: "ARCHIVED" }));
    say(removed.id, "ASSISTANT", "2026-10-06T09:00:05Z");
    const hers = chatWith(seedAgent({ slug: "t-hers-bbbbbb", visibility: "PRIVATE", ownerId: "u-lea" }));
    say(hers.id, "ASSISTANT", "2026-10-06T09:00:05Z");
    const leas = chatWith(seedAgent({ slug: "planner" }), { id: "s-lea", userId: "u-lea" });
    say(leas.id, "ASSISTANT", "2026-10-06T09:00:05Z");
    expect(await anyTeammateUnread(viewer)).toBe(false);
  });
});
