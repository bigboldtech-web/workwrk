// Run in chat and Practice run (teammate-store.ts sendSkillRun,
// docs/plans/ai-teammates-phase5.md step 4): the person's run message for one
// of their skills, with its id for the route to check; a practice run only
// when asked, whatever the composer's switch says; refused, so the tab says
// so, while an answer still arrives or the chat is not open.

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

import { sendSkillRun, teammateStoreForTests as store } from "./teammate-store";

let n = 0;
let slug = "";
beforeEach(() => {
  slug = `clerk-run-${++n}`;
  net.streams = [];
  net.hold = null;
});

describe("sendSkillRun (Phase 5 step 4)", () => {
  it("sends the run message with the skill's id, as a practice run only when asked", async () => {
    await store.open(slug);
    // The composer's practice switch on: Run in chat is never a practice run.
    (store as unknown as { stateOf: (s: string) => { practice: boolean } }).stateOf(slug).practice = true;
    expect(sendSkillRun(slug, "sk1", "Weekly expenses")).toBe(true);
    await vi.waitFor(() => expect(net.streams).toHaveLength(1));
    // Before: no way to run a skill from the Skills tab.
    expect(net.streams[0]).toEqual({ url: `/api/agents/teammates/${slug}/messages`, body: { message: 'Run my skill "Weekly expenses".', skillId: "sk1" } });
    const state = (store as unknown as { stateOf: (s: string) => { streaming: boolean } }).stateOf;
    await vi.waitFor(() => expect(state(slug).streaming).toBe(false));
    expect(sendSkillRun(slug, "sk1", "Weekly expenses", { practice: true })).toBe(true);
    await vi.waitFor(() => expect(net.streams).toHaveLength(2));
    expect(net.streams[1].body).toEqual({ message: 'Run my skill "Weekly expenses".', practice: true, skillId: "sk1" });
  });

  it("refuses while the chat is not open, or an answer still arrives, so the tab says so", async () => {
    expect(sendSkillRun(slug, "sk1", "Weekly expenses")).toBe(false);
    await store.open(slug);
    net.hold = () => undefined;
    void store.send(slug, "Hello");
    await vi.waitFor(() => expect(net.streams).toHaveLength(1));
    expect(sendSkillRun(slug, "sk1", "Weekly expenses")).toBe(false);
    expect(sendSkillRun(slug, "", "Weekly expenses")).toBe(false);
    net.hold?.();
    expect(net.streams).toHaveLength(1);
  });
});
