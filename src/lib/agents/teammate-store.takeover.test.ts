// After the person hands their browser back (teammate-store.ts
// continueAfterTakeOver, docs/plans/ai-teammates-phase4.md step 4): the
// teammate's own chat is read again and continues once, as a decision's
// answer does, only when the take over card moved and only while that chat
// is open in this tab. Never a group chat (a browser never runs in one).

import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ reads: [] as string[], streams: [] as Array<{ url: string; body: unknown }> }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    net.reads.push(url);
    return { ok: true, status: 200, data: { session: { id: "s1" }, messages: [], actions: {}, hasMore: false } };
  },
}));
vi.mock("@/lib/ai/events", () => ({ AI_CHATS_CHANGED_EVENT: "ai-chats-changed", notifyAiChatsChanged: () => {} }));
vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
  net.streams.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  const done = new TextEncoder().encode(`data: ${JSON.stringify({ type: "done", messages: [], error: null })}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(done);
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
});

import { teammateStoreForTests as store } from "./teammate-store";

let n = 0;
let slug = "";
beforeEach(() => {
  slug = `shopper-${++n}`;
  net.reads = [];
  net.streams = [];
});

describe("continueAfterTakeOver (Phase 4 step 4)", () => {
  it("reads the chat again and continues it once when the take over card moved and the chat is open", async () => {
    await store.open(slug);
    store.show(slug);
    net.reads = [];
    await store.continueAfterTakeOver({ resume: true, chat: { kind: "teammate", slug } });
    await vi.waitFor(() => expect(net.streams).toHaveLength(1));
    expect(net.reads.some((u) => u.startsWith(`/api/agents/teammates/${slug}/messages`))).toBe(true);
    expect(net.streams[0]).toMatchObject({ url: `/api/agents/teammates/${slug}/messages`, body: { resume: true } });
  });

  it("never continues a chat that is not open in this tab, nor one whose card did not move", async () => {
    await store.open(slug);
    // Not shown here: nothing is read or continued.
    await store.continueAfterTakeOver({ resume: true, chat: { kind: "teammate", slug } });
    expect(net.streams).toEqual([]);
    store.show(slug);
    // Handed back from the browser card with no card asking: no continue.
    await store.continueAfterTakeOver({ resume: false, chat: null });
    expect(net.streams).toEqual([]);
    // A group chat is never continued from here.
    await store.continueAfterTakeOver({ resume: true, chat: { kind: "group", id: "g1", agentSlug: slug } });
    expect(net.streams).toEqual([]);
  });
});
