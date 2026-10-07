// A teammate turn that broke off (src/lib/agents/teammate-store.ts): the route
// saves the turn only when it ends, so the chat keeps the rows it drew until a
// read holds the answer, reads again on a widening schedule (not once), and
// clears "The answer stopped" when the answer lands, even minutes later.

import { describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ saved: false, breakAfter: [] as string[] }));
const AT = "2026-10-07T10:00:00.000Z";
const question = { id: "q1", kind: "user", text: "Make a task to call Acme", practice: false, createdAt: AT };

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async () => ({
    ok: true,
    status: 200,
    data: {
      session: { id: "s1" },
      messages: net.saved ? [question, { id: "a1", kind: "agent", text: "Done.", practice: false, toolCalls: [], createdAt: "2026-10-07T10:03:00.000Z" }] : [question],
      actions: {},
      hasMore: false,
    },
  }),
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

describe("a teammate turn that broke off", () => {
  it("keeps what it drew, reads again for minutes, and clears the stop when the saved answer lands", async () => {
    vi.useFakeTimers();
    try {
      await store.open("t-pm");
      net.breakAfter = [
        JSON.stringify({ type: "user_message", message: question }),
        JSON.stringify({ type: "tool_use", name: "create_task", input: { title: "Call Acme" } }),
        JSON.stringify({ type: "tool_result", name: "create_task", isError: false, state: "ran" }),
      ];
      await store.send("t-pm", "Make a task to call Acme");
      expect(store.stateOf("t-pm").error).toBe("stopped");

      // Past the first reads: the server still holds only the question, so the drawn answer stays.
      await vi.advanceTimersByTimeAsync(2_500 + 10_000 + 30_000 + 60_000 + 10_000);
      const waiting = store.stateOf("t-pm");
      expect(waiting.error).toBe("stopped");
      expect(waiting.messages.some((m) => m.kind === "agent" && m.id.startsWith("tmp:") && m.toolCalls.some((c) => c.name === "create_task"))).toBe(true);

      // Saved three minutes in: the next read shows it and the stop goes.
      net.saved = true;
      await vi.advanceTimersByTimeAsync(60_000);
      const done = store.stateOf("t-pm");
      expect(done.error).toBeNull();
      expect(done.messages.map((m) => m.id)).toEqual(["q1", "a1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
