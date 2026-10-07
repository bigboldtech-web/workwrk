// What a Talk turn reads of the conversation (src/lib/agents/talk-turn.ts
// talkContext): what the person may read, plain, oldest first, capped.

import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>>, members: [] as Array<{ id: string; userId: string }>, guests: new Set<string>(), pages: 0 }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMessage: { findMany: async () => rows.list },
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
import { GUEST_CHECK_MAX_PAGES, GUEST_CHECK_PAGE, conversationHasGuests, talkContext } from "./talk-turn";
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

describe("conversationHasGuests (review of step 6)", () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `cm${String(i).padStart(6, "0")}`, userId: `u${i}` }));

  it("finds a Guest past the first page of members", async () => {
    rows.members = people(GUEST_CHECK_PAGE + 10);
    rows.guests = new Set([`u${GUEST_CHECK_PAGE + 5}`]);
    rows.pages = 0;
    expect(await conversationHasGuests("c1", "org1")).toBe(true);
    expect(rows.pages).toBe(2);
  });

  it("reads every page and finds none", async () => {
    rows.members = people(GUEST_CHECK_PAGE * 2);
    rows.guests = new Set();
    expect(await conversationHasGuests("c1", "org1")).toBe(false);
  });

  it("counts a conversation larger than it reads as having one", async () => {
    rows.members = people(GUEST_CHECK_PAGE * GUEST_CHECK_MAX_PAGES + 1);
    rows.guests = new Set();
    expect(await conversationHasGuests("c1", "org1")).toBe(true);
  });
});
