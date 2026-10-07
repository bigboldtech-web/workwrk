// A teammate send whose request failed before any answer came back
// (src/lib/agents/teammate-store.ts sentAnyway; review round 5): the route
// claims the question and saves the message before it answers, and carries
// on when the connection drops before its headers. A moment later the chat
// is read: words it holds are a turn that broke off, never "Not sent" (a
// resend would ask, and pay, twice); words it does not hold come back.

import { beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-10-08T10:00:00.000Z";
type Row = Record<string, unknown>;
const net = vi.hoisted(() => ({ rows: [] as Row[] }));

const user = (id: string, text: string): Row => ({ id, kind: "user", text, practice: false, createdAt: AT });

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async () => ({ ok: true, status: 200, data: { session: { id: "s1" }, messages: net.rows, actions: {}, hasMore: false } }),
}));
vi.mock("@/lib/ai/events", () => ({ AI_CHATS_CHANGED_EVENT: "ai-chats-changed", notifyAiChatsChanged: () => {} }));
// The request never gets its headers back.
vi.stubGlobal("fetch", async () => {
  throw new TypeError("Failed to fetch");
});

import { teammateStoreForTests as store } from "./teammate-store";

let slugN = 0;
let slug = "";
beforeEach(() => {
  slug = `t-unsent-${++slugN}`;
  net.rows = [user("q0", "Earlier")];
  vi.useFakeTimers();
});

describe("a send that failed before the answer began", () => {
  it("waits for the answer when the server saved it, so it is never sent twice", async () => {
    try {
      await store.open(slug);
      const sending = store.send(slug, "Make a task to call Acme");
      // The server took it: the next read holds it.
      net.rows = [user("q0", "Earlier"), user("q1", "Make a task to call Acme")];
      await vi.advanceTimersByTimeAsync(2_600);
      await sending;
      expect(store.stateOf(slug).error).toBe("stopped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says Not sent and gives the words back when the server never took them", async () => {
    try {
      await store.open(slug);
      const sending = store.send(slug, "Make a task to call Acme");
      await vi.advanceTimersByTimeAsync(2_600);
      await sending;
      expect(store.stateOf(slug).error).toBe("not_sent");
      expect(store.stateOf(slug).draft).toBe("Make a task to call Acme");
      expect(store.stateOf(slug).messages.map((m) => m.id)).toEqual(["q0"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never takes an earlier message with the same words for this one", async () => {
    try {
      net.rows = [user("q0", "Make a task to call Acme")];
      await store.open(slug);
      const sending = store.send(slug, "Make a task to call Acme");
      await vi.advanceTimersByTimeAsync(2_600);
      await sending;
      expect(store.stateOf(slug).error).toBe("not_sent");
    } finally {
      vi.useRealTimers();
    }
  });
});
