// What a Talk turn reads of the conversation (src/lib/agents/talk-turn.ts
// talkContext): what the person may read, plain, oldest first, capped.

import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/prisma", () => ({ prisma: { conversationMessage: { findMany: async () => rows.list } } }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));

import { AI_UPDATE_HIDDEN_KIND } from "@/lib/talk-updates";
import { talkContext } from "./talk-turn";
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
    const out = await talkContext({ conversationId: "c1", parentId: null, before: at, beforeId: "m9", person: { userId: "u-max" } });
    expect(out.map((l) => l.text)).not.toContain("Hidden words");
    expect(out[0]).toEqual({ from: "Olivia Owner", text: "First" });
    expect(out.at(-1)?.text).toBe("Third with a link");
    expect(AI_UPDATE_HIDDEN_KIND).toBe("ai_update_hidden");
  });

  it("caps each message and the whole, keeping the newest", async () => {
    rows.list = Array.from({ length: 30 }, (_, i) => msg(`m${30 - i}`, `${30 - i} ${"x".repeat(1000)}`));
    const out = await talkContext({ conversationId: "c1", parentId: null, before: at, beforeId: "m99", person: { userId: "u-max" } });
    expect(out.every((l) => l.text.length <= TALK_TEAMMATE_LIMITS.messageChars)).toBe(true);
    expect(out.reduce((n, l) => n + l.text.length + l.from.length, 0)).toBeLessThanOrEqual(TALK_TEAMMATE_LIMITS.contextChars);
    expect(out.at(-1)?.text.startsWith("30 ")).toBe(true);
  });
});
