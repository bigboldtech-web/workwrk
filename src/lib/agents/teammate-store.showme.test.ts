// Teach a skill's message (teammate-store.ts sendShowMe,
// docs/plans/ai-teammates-phase5.md step 3): the person's own message asking
// the teammate to open the site's home address, sent with `showMe` (their
// words and the site) for the route to check; never a practice run, even
// with the composer's practice switch on; and refused, so the tab says so,
// while an answer still arrives or the chat is not open.

import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ streams: [] as Array<{ url: string; body: unknown }>, hold: null as null | (() => void) }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async () => ({ ok: true, status: 200, data: { session: { id: "s1" }, messages: [], actions: {}, hasMore: false } }),
}));
vi.mock("@/lib/ai/events", () => ({ AI_CHATS_CHANGED_EVENT: "ai-chats-changed", notifyAiChatsChanged: () => {} }));
vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
  net.streams.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  const done = new TextEncoder().encode(`data: ${JSON.stringify({ type: "done", messages: [], error: null })}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const finish = () => {
          c.enqueue(done);
          c.close();
        };
        if (net.hold) net.hold = finish;
        else finish();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
});

import { sendShowMe, teammateStoreForTests as store } from "./teammate-store";

let n = 0;
let slug = "";
beforeEach(() => {
  slug = `clerk-${++n}`;
  net.streams = [];
  net.hold = null;
});

describe("sendShowMe (Phase 5 step 3)", () => {
  it("sends the Teach message with the person's words and the site, never as a practice run", async () => {
    await store.open(slug);
    // The composer's practice switch on: a Teach message is never one.
    (store as unknown as { stateOf: (s: string) => { practice: boolean } }).stateOf(slug).practice = true;
    expect(sendShowMe(slug, "  Submit my   weekly expenses ", "expenses.proof.test", "http://expenses.proof.test/")).toBe(true);
    await vi.waitFor(() => expect(net.streams).toHaveLength(1));
    expect(net.streams[0]).toEqual({
      url: `/api/agents/teammates/${slug}/messages`,
      body: { message: "Open http://expenses.proof.test/ so I can show you how to Submit my weekly expenses.", showMe: { name: "Submit my weekly expenses", site: "expenses.proof.test" } },
    });
  });

  it("refuses while the chat is not open, or an answer still arrives, so the tab says so", async () => {
    expect(sendShowMe(slug, "File it", "expenses.proof.test", "http://expenses.proof.test/")).toBe(false);
    await store.open(slug);
    net.hold = () => undefined;
    void store.send(slug, "Hello");
    await vi.waitFor(() => expect(net.streams).toHaveLength(1));
    expect(sendShowMe(slug, "File it", "expenses.proof.test", "http://expenses.proof.test/")).toBe(false);
    expect(sendShowMe(slug, "   ", "expenses.proof.test", "http://expenses.proof.test/")).toBe(false);
    net.hold?.();
    expect(net.streams).toHaveLength(1);
  });
});
