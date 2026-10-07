// A teammate turn that broke off (src/lib/agents/teammate-store.ts): the route
// saves the turn only when it ends, so the chat keeps the row it drew under
// its own message until a read holds that message's answer (replyTo), reads
// again on a widening schedule, and clears "The answer stopped" only when the
// answer to the turn that owns it lands: never for a routine's report or an
// earlier turn's answer, and still after the ten-minute window.

import { beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-10-07T10:00:00.000Z";
type Row = Record<string, unknown>;
const net = vi.hoisted(() => ({ rows: [] as Row[], breakAfter: [] as string[] }));

const user = (id: string, text: string): Row => ({ id, kind: "user", text, practice: false, createdAt: AT });
const answer = (id: string, replyTo: string): Row => ({ id, kind: "agent", text: `Answer to ${replyTo}`, practice: false, toolCalls: [], replyTo, createdAt: AT });
const report = (id: string): Row => ({ id, kind: "report", text: "Daily brief", practice: false, toolCalls: [], routine: { id: "r1", name: "Daily brief", runId: "run9", dueAt: AT }, createdAt: AT });

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async () => ({ ok: true, status: 200, data: { session: { id: "s1" }, messages: net.rows, actions: {}, hasMore: false } }),
}));
vi.mock("@/lib/ai/events", () => ({ AI_CHATS_CHANGED_EVENT: "ai-chats-changed", notifyAiChatsChanged: () => {} }));
vi.stubGlobal("fetch", async () => {
  const chunks = net.breakAfter.map((e) => new TextEncoder().encode(`data: ${e}\n\n`));
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]);
      else c.error(new TypeError("the connection broke"));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
});

import { teammateStoreForTests as store } from "./teammate-store";

/** One turn that acks its message as `id`, runs create_task, then breaks off. */
function breaksAfterTask(id: string, text: string) {
  net.breakAfter = [
    JSON.stringify({ type: "user_message", message: user(id, text) }),
    JSON.stringify({ type: "tool_use", name: "create_task", input: { title: "Call Acme" } }),
    JSON.stringify({ type: "tool_result", name: "create_task", isError: false, state: "ran" }),
  ];
}

const shape = (slug: string) => store.stateOf(slug).messages.map((m) => (m.id.startsWith("tmp:") ? `drawn:${m.kind}` : m.id));

let slugN = 0;
let slug = "";
beforeEach(() => {
  slug = `t-${++slugN}`;
  net.rows = [];
  vi.useFakeTimers();
});

describe("a teammate turn that broke off", () => {
  it("keeps what it drew, reads again for minutes, and clears the stop when its own answer lands", async () => {
    try {
      await store.open(slug);
      net.rows = [user("q1", "Make a task to call Acme")];
      breaksAfterTask("q1", "Make a task to call Acme");
      await store.send(slug, "Make a task to call Acme");
      expect(store.stateOf(slug).error).toBe("stopped");
      await vi.advanceTimersByTimeAsync(2_500 + 10_000 + 30_000 + 60_000 + 10_000);
      expect(store.stateOf(slug).error).toBe("stopped");
      expect(shape(slug)).toEqual(["q1", "drawn:agent"]);
      net.rows = [user("q1", "Make a task to call Acme"), answer("a1", "q1")];
      await vi.advanceTimersByTimeAsync(60_000);
      expect(store.stateOf(slug).error).toBeNull();
      expect(shape(slug)).toEqual(["q1", "a1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never takes a routine's report for the answer", async () => {
    try {
      await store.open(slug);
      net.rows = [user("q1", "Make a task to call Acme")];
      breaksAfterTask("q1", "Make a task to call Acme");
      await store.send(slug, "Make a task to call Acme");
      net.rows = [user("q1", "Make a task to call Acme"), report("rep1")];
      await store.refresh(slug);
      expect(store.stateOf(slug).error).toBe("stopped");
      expect(store.stateOf(slug).draft).toBe("Make a task to call Acme");
      expect(shape(slug)).toEqual(["q1", "drawn:agent", "rep1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps each stopped turn under its own message, and an earlier answer never clears a later stop", async () => {
    try {
      await store.open(slug);
      net.rows = [user("q1", "Make a task to call Acme")];
      breaksAfterTask("q1", "Make a task to call Acme");
      await store.send(slug, "Make a task to call Acme");
      net.rows = [user("q1", "Make a task to call Acme"), user("q2", "And one to email Max")];
      breaksAfterTask("q2", "And one to email Max");
      await store.send(slug, "And one to email Max");
      expect(store.stateOf(slug).error).toBe("stopped");
      await store.refresh(slug);
      expect(shape(slug)).toEqual(["q1", "drawn:agent", "q2", "drawn:agent"]);
      // q1's answer lands late: it reads under q1, and q2's stop stays.
      net.rows = [user("q1", "Make a task to call Acme"), user("q2", "And one to email Max"), answer("a1", "q1")];
      await store.refresh(slug);
      expect(shape(slug)).toEqual(["q1", "a1", "q2", "drawn:agent"]);
      expect(store.stateOf(slug).error).toBe("stopped");
      net.rows = [...net.rows, answer("a2", "q2")];
      await store.refresh(slug);
      expect(store.stateOf(slug).error).toBeNull();
      expect(shape(slug)).toEqual(["q1", "a1", "q2", "a2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still clears the stop when its answer is read after the ten-minute window", async () => {
    try {
      await store.open(slug);
      net.rows = [user("q1", "Make a task to call Acme")];
      breaksAfterTask("q1", "Make a task to call Acme");
      await store.send(slug, "Make a task to call Acme");
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(store.stateOf(slug).error).toBe("stopped");
      net.rows = [user("q1", "Make a task to call Acme"), answer("a1", "q1")];
      await store.refresh(slug);
      expect(store.stateOf(slug).error).toBeNull();
      expect(store.stateOf(slug).draft).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never takes a continue's answer (it names no message) for a stopped chat turn's answer", async () => {
    try {
      await store.open(slug);
      net.rows = [user("q1", "Draft the Q3 plan")];
      breaksAfterTask("q1", "Draft the Q3 plan");
      await store.send(slug, "Draft the Q3 plan");
      // A continue after the person approved an older card: its answer names no message.
      net.rows = [user("q1", "Draft the Q3 plan"), { id: "r1", kind: "agent", text: "Posted it.", practice: false, toolCalls: [], createdAt: AT }];
      await store.refresh(slug);
      expect(store.stateOf(slug).error).toBe("stopped");
      expect(store.stateOf(slug).draft).toBe("Draft the Q3 plan");
      expect(shape(slug)).toEqual(["q1", "drawn:agent", "r1"]);
      net.rows = [...net.rows, answer("a1", "q1")];
      await store.refresh(slug);
      expect(store.stateOf(slug).error).toBeNull();
      expect(shape(slug)).toEqual(["q1", "a1", "r1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
