// What a Talk turn reads of the conversation (src/lib/agents/talk-turn.ts
// talkContext): what the person may read, plain, oldest first, capped.

import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
  members: [] as Array<{ id: string; userId: string }>,
  guests: new Set<string>(),
  pages: 0,
  users: [] as Array<{ id: string; status: string; deletedAt: Date | null }>,
  /** Each conversationMessage.findMany's where, in order. */
  queries: [] as Array<Record<string, unknown>>,
  /** A thread's parent, read on its own. */
  parent: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMessage: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        rows.queries.push(a.where);
        return a.where.id ? rows.parent : rows.list;
      },
    },
    user: { findMany: async (a: { where: { id: { in: string[] } } }) => rows.users.filter((u) => a.where.id.in.includes(u.id)) },
    conversationMember: {
      findMany: async (a: { where: { id?: { gt: string } }; take: number }) => {
        rows.pages += 1;
        const after = a.where.id?.gt;
        return rows.members.filter((m) => !after || m.id > after).slice(0, a.take);
      },
    },
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/access/guests", () => ({ anyGuestHere: async (_org: string, ids: string[]) => ids.some((i) => rows.guests.has(i)) }));

import { AI_UPDATE_HIDDEN_KIND } from "@/lib/talk-updates";
import { conversationAudience, talkContext } from "./talk-turn";
import { TALK_TEAMMATE_LIMITS } from "./talk-address";

const at = new Date("2026-10-07T10:00:00Z");
const msg = (id: string, body: string, metadata: unknown = null) => ({ id, body, metadata, createdAt: at, author: { firstName: "Olivia", lastName: "Owner", email: "o@x.test" } });

describe("talkContext", () => {
  it("leaves out an AI update the person may not read, and reads the rest plain, oldest first", async () => {
    // The query answers newest first.
    rows.list = [
      msg("m3", "**Third** with [a link](https://x.test)"),
      msg("m2", "Hidden words", { kind: "ai_update", update: { id: "u1" }, readers: ["someone-else"] }),
      msg("m1", "First"),
    ];
    const out = await talkContext({ conversationId: "c1", parentId: null, before: at, beforeId: "m9", person: { userId: "u-max" }, readers: ["u-max"] });
    expect(out.map((l) => l.text)).not.toContain("Hidden words");
    expect(out[0]).toEqual({ from: "Olivia Owner", text: "First" });
    expect(out.at(-1)?.text).toBe("Third with a link");
    expect(AI_UPDATE_HIDDEN_KIND).toBe("ai_update_hidden");
  });

  it("caps each message and the whole, keeping the newest", async () => {
    rows.list = Array.from({ length: 30 }, (_, i) => msg(`m${30 - i}`, `${30 - i} ${"x".repeat(1000)}`));
    const out = await talkContext({ conversationId: "c1", parentId: null, before: at, beforeId: "m99", person: { userId: "u-max" }, readers: ["u-max"] });
    expect(out.every((l) => l.text.length <= TALK_TEAMMATE_LIMITS.messageChars)).toBe(true);
    expect(out.reduce((n, l) => n + l.text.length + l.from.length, 0)).toBeLessThanOrEqual(TALK_TEAMMATE_LIMITS.contextChars);
    expect(out.at(-1)?.text.startsWith("30 ")).toBe(true);
  });
});

describe("talkContext and messages kept for who was there (review round 2)", () => {
  it("leaves out a message only some of today's readers may read, even one the asker may", async () => {
    rows.list = [
      msg("m3", "Open words"),
      msg("m2", "Max's review is 3/5", { kind: "agent_post", via: "talk", agent: { id: "a1", name: "CoS" }, readers: ["u-max", "u-olivia"] }),
      msg("m1", "Earlier"),
    ];
    const withEve = await talkContext({ conversationId: "c1", parentId: null, before: at, beforeId: "m9", person: { userId: "u-olivia" }, readers: ["u-olivia", "u-max", "u-eve"] });
    expect(withEve.map((l) => l.text)).toEqual(["Earlier", "Open words"]);
    const sameRoom = await talkContext({ conversationId: "c1", parentId: null, before: at, beforeId: "m9", person: { userId: "u-olivia" }, readers: ["u-olivia", "u-max"] });
    expect(sameRoom.map((l) => l.text)).toContain("Max's review is 3/5");
  });
});

describe("conversationAudience (review rounds 5 and 8)", () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `cm${String(i).padStart(6, "0")}`, userId: `u${i}` }));
  const active = (ids: string[]) => ids.map((id) => ({ id, status: "ACTIVE", deletedAt: null as Date | null }));

  it("reads at most one more than the limit, and refuses a bigger conversation without reading who is in it", async () => {
    rows.members = people(TALK_TEAMMATE_LIMITS.maxReaders + 1000);
    rows.guests = new Set(["u5"]);
    rows.pages = 0;
    expect(await conversationAudience("c1", "org1")).toEqual({ ids: [], tooMany: true, hasGuests: false });
    expect(rows.pages).toBe(1);
  });

  it("finds a Guest anywhere among the members it read, in one read", async () => {
    rows.members = people(TALK_TEAMMATE_LIMITS.maxReaders);
    rows.users = active(rows.members.map((m) => m.userId));
    rows.guests = new Set([`u${TALK_TEAMMATE_LIMITS.maxReaders - 1}`]);
    rows.pages = 0;
    expect((await conversationAudience("c1", "org1")).hasGuests).toBe(true);
    expect(rows.pages).toBe(1);
    rows.guests = new Set();
    expect((await conversationAudience("c1", "org1")).hasGuests).toBe(false);
  });

  it("leaves out a member who can't sign in now, so nobody let back in later reads an answer they were never checked for", async () => {
    rows.guests = new Set();
    rows.members = [
      { id: "1", userId: "u-olivia" },
      { id: "2", userId: "u-eve" },
      { id: "3", userId: "u-gone" },
      { id: "4", userId: "u-max" },
      { id: "5", userId: "u-nobody" },
    ];
    rows.users = [
      { id: "u-olivia", status: "ACTIVE", deletedAt: null },
      { id: "u-eve", status: "INACTIVE", deletedAt: null },
      { id: "u-gone", status: "ACTIVE", deletedAt: new Date("2026-10-01T00:00:00Z") },
      { id: "u-max", status: "ACTIVE", deletedAt: null },
    ];
    expect(await conversationAudience("c1", "org1")).toEqual({ ids: ["u-olivia", "u-max"], tooMany: false, hasGuests: false });
  });
});

describe("talkContext's reads (review round 6)", () => {
  it("reads only this conversation's live top-level messages before the request", async () => {
    rows.queries = [];
    rows.list = [msg("m1", "First")];
    await talkContext({ conversationId: "c1", parentId: null, before: at, beforeId: "m9", person: { userId: "u-max" }, readers: ["u-max"] });
    expect(rows.queries).toEqual([
      { conversationId: "c1", parentId: null, deletedAt: null, AND: [{ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "m9" } }] }] },
    ]);
  });

  it("in a thread, reads its live parent and the live replies before the request", async () => {
    rows.queries = [];
    rows.parent = [msg("p1", "The plan")];
    rows.list = [msg("r1", "A reply")];
    const out = await talkContext({ conversationId: "c1", parentId: "p1", before: at, beforeId: "m9", person: { userId: "u-max" }, readers: ["u-max"] });
    expect(rows.queries).toEqual([
      { id: "p1", conversationId: "c1", deletedAt: null },
      { conversationId: "c1", parentId: "p1", deletedAt: null, AND: [{ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "m9" } }] }] },
    ]);
    expect(out.map((l) => l.text)).toEqual(["The plan", "A reply"]);
  });
});
