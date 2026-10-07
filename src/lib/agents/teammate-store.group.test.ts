// A group chat in the chat store (src/lib/agents/teammate-store.ts;
// docs/plans/ai-teammates-phase2.md step 4): its key reads and posts to the
// group's routes; a decision continues the group only when the decide answer
// names that group (with its own teammate), and a teammate's chat never
// continues a group; a two-teammate turn that broke off after the first
// answer stays "stopped" until a read holds the second.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-10-07T10:00:00.000Z";
type Row = Record<string, unknown>;
const net = vi.hoisted(() => ({
  rows: [] as Row[],
  gets: [] as string[],
  posts: [] as Array<{ url: string; body: Row }>,
  events: [] as string[],
  decide: null as Row | null,
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    net.gets.push(url);
    return { ok: true, status: 200, data: { session: { id: "g1" }, messages: net.rows, actions: {}, hasMore: false, members: [] } };
  },
}));
vi.mock("@/lib/ai/events", () => ({ AI_CHATS_CHANGED_EVENT: "ai-chats-changed", notifyAiChatsChanged: () => {} }));
vi.mock("./decide-client", () => ({ sendDecisions: async () => net.decide }));
vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
  net.posts.push({ url, body: JSON.parse(init.body) as Row });
  const chunks = net.events.map((e) => new TextEncoder().encode(`data: ${e}\n\n`));
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]);
      // A stream that said it was done closes; any other breaks off.
      else if (net.events.at(-1)?.includes('"type":"done"')) c.close();
      else c.error(new TypeError("the connection broke"));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
});

import { groupChatKey, teammateStoreForTests as store } from "./teammate-store";

const user = (id: string, answerers: string[]): Row => ({ id, kind: "user", text: "@Triage @PM what is late?", practice: false, createdAt: AT, answerers });
const answer = (id: string, agentId: string, replyTo: string): Row => ({ id, kind: "agent", text: `From ${agentId}`, practice: false, toolCalls: [], agentId, replyTo, createdAt: AT });

let n = 0;
let key = "";
beforeEach(() => {
  key = groupChatKey(`g${++n}`);
  net.rows = [];
  net.gets = [];
  net.posts = [];
  net.events = [];
  net.decide = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a group chat in the store", () => {
  it("reads and posts to the group's own routes", async () => {
    await store.open(key);
    expect(net.gets[0]).toMatch(new RegExp(`^/api/teammate-groups/g${n}/messages\\?`));
    net.events = [JSON.stringify({ type: "done", messages: [], error: null })];
    await store.send(key, "Status?");
    expect(net.posts[0]).toEqual({ url: `/api/teammate-groups/g${n}/messages`, body: { message: "Status?" } });
  });

  it("keeps a two-teammate turn stopped after the first answer, until a read holds the second", async () => {
    vi.useFakeTimers();
    await store.open(key);
    net.events = [
      JSON.stringify({ type: "user_message", message: user("q1", ["a2", "a1"]), answerers: [{ agentId: "a2" }, { agentId: "a1" }] }),
      JSON.stringify({ type: "answer_start", agentId: "a2" }),
      JSON.stringify({ type: "answer_done", agentId: "a2", messages: [answer("m1", "a2", "q1")], error: null }),
      JSON.stringify({ type: "answer_start", agentId: "a1" }),
      JSON.stringify({ type: "text_delta", text: "Half an ans" }),
    ];
    await store.send(key, "@Triage @PM what is late?");
    expect(store.stateOf(key).error).toBe("stopped");
    net.rows = [user("q1", ["a2", "a1"]), answer("m1", "a2", "q1")];
    await store.refresh(key);
    expect(store.stateOf(key).error).toBe("stopped");
    net.rows = [...net.rows, answer("m2", "a1", "q1")];
    await store.refresh(key);
    expect(store.stateOf(key).error).toBeNull();
    expect(store.stateOf(key).messages.map((m) => m.id)).toEqual(["q1", "m1", "m2"]);
  });

  it("continues the group, with its own teammate, when the decision names it", async () => {
    await store.open(key);
    store.show(key);
    const id = key.slice("group:".length);
    net.decide = { ok: true, results: [{ id: "x1", status: "EXECUTED" }], resume: true, agentSlug: "pm", chat: { kind: "group", id, agentSlug: "pm" } };
    net.events = [JSON.stringify({ type: "done", messages: [], error: null })];
    await store.decide(key, [{ id: "x1", decision: "approve" }]);
    await vi.waitFor(() => expect(net.posts).toHaveLength(1));
    expect(net.posts[0]).toEqual({ url: `/api/teammate-groups/${id}/messages`, body: { resume: true, agentSlug: "pm" } });
  });

  it("never continues a group for a decision on a teammate's own chat", async () => {
    await store.open(key);
    store.show(key);
    net.decide = { ok: true, results: [{ id: "x1", status: "EXECUTED" }], resume: true, agentSlug: "pm", chat: { kind: "teammate", slug: "pm" } };
    await store.decide(key, [{ id: "x1", decision: "approve" }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(net.posts).toEqual([]);
  });

  it("never ends a stop at once when the stream broke before naming its answerers (review of step 4)", async () => {
    await store.open(key);
    // The stream opens, then breaks before the saved message arrives.
    net.events = [];
    await store.send(key, "@Triage @PM what is late?");
    expect(store.stateOf(key).error).toBe("stopped");
    net.rows = [user("q1", ["a2", "a1"])];
    await store.refresh(key);
    expect(store.stateOf(key).error).toBe("stopped");
    expect(store.stateOf(key).draft).toBe("@Triage @PM what is late?");
  });

  it("drops a teammate's drawn half answer once its own answer is saved, while another still answers (review of step 4)", async () => {
    vi.useFakeTimers();
    await store.open(key);
    net.events = [
      JSON.stringify({ type: "user_message", message: user("q1", ["a2", "a1"]), answerers: [{ agentId: "a2" }, { agentId: "a1" }] }),
      JSON.stringify({ type: "answer_start", agentId: "a2" }),
      JSON.stringify({ type: "text_delta", text: "Half" }),
    ];
    await store.send(key, "@Triage @PM what is late?");
    expect(store.stateOf(key).error).toBe("stopped");
    net.rows = [user("q1", ["a2", "a1"]), answer("m1", "a2", "q1")];
    await store.refresh(key);
    expect(store.stateOf(key).messages.map((m) => m.id)).toEqual(["q1", "m1"]);
    expect(store.stateOf(key).error).toBe("stopped");
  });

  it("says why when an answer ended early", async () => {
    await store.open(key);
    net.events = [
      JSON.stringify({ type: "user_message", message: user("q1", ["a1"]), answerers: [{ agentId: "a1" }] }),
      JSON.stringify({ type: "answer_start", agentId: "a1" }),
      JSON.stringify({ type: "text_delta", text: "Partly" }),
      JSON.stringify({ type: "answer_done", agentId: "a1", messages: [answer("m1", "a1", "q1")], error: "The answer was cut short." }),
      JSON.stringify({ type: "done", messages: [], error: null }),
    ];
    await store.send(key, "@PM go");
    expect(store.stateOf(key)).toMatchObject({ error: "ended", errorText: "The answer was cut short." });
  });

  it("runs both continues decided during one answer, one after the other (review of step 4)", async () => {
    await store.open(key);
    store.show(key);
    const id = key.slice("group:".length);
    // A message is still streaming: it never ends until the test says so.
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((r) => (release = r));
    const realFetch = globalThis.fetch;
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls += 1;
      net.posts.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      if (calls === 1) {
        await blocked;
      }
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "done", messages: [], error: null })}\n\n`));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    try {
      const sending = store.send(key, "Status?");
      net.decide = { ok: true, results: [{ id: "x1", status: "EXECUTED" }], resume: true, agentSlug: "pm", chat: { kind: "group", id, agentSlug: "pm" } };
      await store.decide(key, [{ id: "x1", decision: "approve" }]);
      net.decide = { ok: true, results: [{ id: "x2", status: "EXECUTED" }], resume: true, agentSlug: "triage", chat: { kind: "group", id, agentSlug: "triage" } };
      await store.decide(key, [{ id: "x2", decision: "approve" }]);
      release();
      await sending;
      await vi.waitFor(() => expect(net.posts.map((p) => p.body.agentSlug ?? "message")).toEqual(["message", "pm", "triage"]));
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }
  });
});
