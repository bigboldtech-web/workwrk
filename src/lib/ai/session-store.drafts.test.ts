// Ask AI's composer never loses words (src/lib/ai/session-store.ts drafts):
// each chat keeps its unsent words while another chat is open, the landing
// keeps its own, and a caller's prompt (?q=) goes above what was kept rather
// than in place of it. Before 2026-10-07 opening another chat or a new chat
// emptied the composer.

import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
  failing: new Set<string>(),
  creating: null as null | Promise<void>,
  /** What the server holds of chat-x's newest question, when it took one. */
  savedQuestion: null as null | string,
  /** The stream request hangs until the client gives it up (aborts). */
  hangStream: false,
  /** A question chat-x held before the send, with the same words. */
  earlierQuestion: null as null | string,
  /** Reading chat-y waits on this, so a test can act while it loads. */
  loadingY: null as null | Promise<void>,
  /** How many stream requests left. */
  streams: 0,
  /** The events a stream sends before its connection breaks (no done). */
  breakAfter: null as null | string[],
  /** chat-s holds the saved answer and its card. */
  savedAnswer: false,
  /** chat-t holds the answer (with its card) to its first and its second question. */
  savedT1: false,
  savedT2: false,
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: { method?: string }) => {
    // Making a chat (the first send from the landing) can be held open.
    if (url === "/api/sidekick/sessions" && init?.method === "POST") {
      if (net.creating) await net.creating;
      return { ok: true, status: 200, data: { session: { id: "made-1", title: null } } };
    }
    const id = decodeURIComponent(url.split("/").pop() ?? "");
    if (id === "chat-y" && net.loadingY) await net.loadingY;
    if (net.failing.has(id)) return { ok: false, status: 500, error: "Something went wrong" };
    // Each chat has one saved message, as every chat a list shows does, and
    // chat-x the question the server took, when it took one.
    if (id === "chat-s") {
      // The question the stream acked; the answer and its card only once the route's loop ended.
      const rows: Array<Record<string, unknown>> = [{ id: "chat-s-q", role: "USER", content: "Call Acme and thank Max", createdAt: "2026-10-07T10:00:00.000Z" }];
      if (net.savedAnswer) {
        rows.push({ id: "chat-s-a", role: "ASSISTANT", content: "Done, and I asked about the kudos.", toolCalls: [{ name: "create_task", input: {}, result: { ok: true }, errorText: null, durationMs: 5 }], createdAt: "2026-10-07T10:00:05.000Z" });
        rows.push({ id: "chat-s-card", role: "SYSTEM", kind: "APPROVAL", content: "Waiting for your approval: Send kudos to Max", meta: { actionIds: ["act1"] }, createdAt: "2026-10-07T10:00:06.000Z" });
      }
      return { ok: true, status: 200, data: { session: { id, title: id, pinned: false, archived: false }, messages: rows, actions: net.savedAnswer ? { act1: { id: "act1", status: "PENDING", preview: { title: "Send kudos to Max" } } } : {} } };
    }
    if (id === "chat-t") {
      // Two questions; each answer is saved for its own question (replyTo),
      // whenever the route's loop for it ends, so the first can land after the second question.
      const rows: Array<Record<string, unknown>> = [
        { id: "t-u1", role: "USER", content: "Call Acme and thank Max", createdAt: "2026-10-07T10:00:00.000Z" },
        { id: "t-u2", role: "USER", content: "Call Acme and thank Max", createdAt: "2026-10-07T10:00:10.000Z" },
      ];
      const answer = (n: number, at: string) => [
        { id: `t-a${n}`, role: "ASSISTANT", content: `Answer ${n}`, meta: { replyTo: `t-u${n}` }, createdAt: at },
        { id: `t-card${n}`, role: "SYSTEM", kind: "APPROVAL", content: "Waiting", meta: { actionIds: [`act${n}`], replyTo: `t-u${n}` }, createdAt: at },
      ];
      if (net.savedT1) rows.push(...answer(1, "2026-10-07T10:00:20.000Z"));
      if (net.savedT2) rows.push(...answer(2, "2026-10-07T10:00:30.000Z"));
      const actions: Record<string, unknown> = {};
      if (net.savedT1) actions.act1 = { id: "act1", status: "PENDING", preview: { title: "Send kudos to Max" } };
      if (net.savedT2) actions.act2 = { id: "act2", status: "PENDING", preview: { title: "Send kudos to Max" } };
      return { ok: true, status: 200, data: { session: { id, title: id, pinned: false, archived: false }, messages: rows, actions } };
    }
    const messages = [{ id: `${id}-m1`, role: "USER", content: "hi", createdAt: "2026-10-07T10:00:00.000Z" }];
    if (id === "chat-x" && net.earlierQuestion) messages.push({ id: "chat-x-m0", role: "USER", content: net.earlierQuestion, createdAt: "2026-10-07T09:00:00.000Z" });
    // Written by the server's clock, which need not agree with the browser's: hours "earlier" here.
    if (id === "chat-x" && net.savedQuestion) messages.push({ id: "chat-x-m2", role: "USER", content: net.savedQuestion, createdAt: "2026-01-01T00:00:00.000Z" });
    return { ok: true, status: 200, data: { session: { id, title: id, pinned: false, archived: false }, messages } };
  },
}));
// The stream itself never answers here: a send that reaches it is refused as
// not sent, or hangs until the client gives it up.
vi.stubGlobal("fetch", async (_url: string, init?: { signal?: AbortSignal }) => {
  net.streams += 1;
  if (net.breakAfter) {
    const chunks = net.breakAfter.map((e) => new TextEncoder().encode(`data: ${e}\n\n`));
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) c.enqueue(chunks[i++]);
        else c.error(new TypeError("the connection broke"));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (net.hangStream) {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }
  throw new TypeError("no network in tests");
});
vi.mock("@/lib/ai/events", () => ({ notifyAiChatsChanged: () => {} }));

import { aiSession } from "./session-store";

const draft = () => aiSession.getState().draft;

beforeEach(async () => {
  // Leave every chat with an empty composer, so no test sees another's words.
  for (const id of ["chat-a", "chat-b", "chat-c"]) {
    await aiSession.open(id);
    aiSession.setDraft("");
  }
  aiSession.reset();
  aiSession.setDraft("");
  await aiSession.open("chat-z");
  aiSession.reset();
});

describe("Ask AI drafts", () => {
  it("keeps each chat's unsent words while another is open, and brings them back", async () => {
    aiSession.setDraft("landing words");
    await aiSession.open("chat-a");
    expect(draft()).toBe("");
    aiSession.setDraft("words for A");
    await aiSession.open("chat-b");
    expect(draft()).toBe("");
    aiSession.setDraft("words for B");
    await aiSession.open("chat-a");
    expect(draft()).toBe("words for A");
    aiSession.reset();
    expect(draft()).toBe("landing words");
    await aiSession.open("chat-b");
    expect(draft()).toBe("words for B");
  });

  it("forgets a chat's words once they were sent or cleared", async () => {
    await aiSession.open("chat-a");
    aiSession.setDraft("half a thought");
    await aiSession.open("chat-b");
    await aiSession.open("chat-a");
    aiSession.setDraft("");
    await aiSession.open("chat-b");
    await aiSession.open("chat-a");
    expect(draft()).toBe("");
  });

  it("puts a caller's prompt above the landing's words, never in place of them", async () => {
    aiSession.setDraft("my own words");
    await aiSession.start({ q: "Summarise this doc" });
    expect(draft()).toBe("Summarise this doc\n\nmy own words");
    // The same link again adds nothing twice.
    await aiSession.start({ q: "Summarise this doc" });
    expect(draft()).toBe("Summarise this doc\n\nmy own words");
  });

  it("moves the words to the new chat with Start a new chat with it, and keeps what the landing held", async () => {
    aiSession.setDraft("landing words");
    await aiSession.open("chat-c");
    aiSession.setDraft("words for C");
    aiSession.reset({ keepDraft: true });
    expect(draft()).toBe("words for C");
    await aiSession.open("chat-a");
    aiSession.reset();
    expect(draft()).toBe("words for C\n\nlanding words");
  });

  it("keeps what is in the composer when a chat that failed to load is opened again", async () => {
    net.failing.add("chat-a");
    await aiSession.open("chat-a");
    expect(aiSession.getState().loadError).toBe(true);
    aiSession.setDraft("still here");
    net.failing.delete("chat-a");
    await aiSession.open("chat-a");
    expect(aiSession.getState().loadError).toBe(false);
    expect(draft()).toBe("still here");
  });

  it("keeps a first message given up while its chat was being made, for the landing", async () => {
    let release = () => {};
    net.creating = new Promise<void>((r) => (release = r));
    aiSession.setDraft("Plan the offsite");
    const sending = aiSession.send("Plan the offsite");
    await aiSession.open("chat-b");
    release();
    await sending;
    net.creating = null;
    expect(draft()).toBe("");
    aiSession.reset();
    expect(draft()).toBe("Plan the offsite");
  });

  it("leaves words waiting in the composer when a starter is sent", async () => {
    aiSession.setDraft("my own notes");
    await aiSession.send("What is due this week?");
    // The starter never reached the model (no network here) and came back above them.
    expect(draft()).toBe("What is due this week?\n\nmy own notes");
  });

  it("gives a question back after moving on mid-send only when the server does not hold it", async () => {
    vi.useFakeTimers();
    try {
      net.hangStream = true;
      // The server took it: nothing comes back, so it is never asked twice.
      await aiSession.open("chat-x");
      net.savedQuestion = "Add a task for me: call Acme";
      aiSession.setDraft("Add a task for me: call Acme");
      const first = aiSession.send("Add a task for me: call Acme");
      await vi.advanceTimersByTimeAsync(0);
      await aiSession.open("chat-b");
      await first;
      await vi.advanceTimersByTimeAsync(3000);
      await aiSession.open("chat-x");
      expect(draft()).toBe("");

      // The server never got it: it comes back to chat-x's composer.
      net.savedQuestion = null;
      aiSession.setDraft("Book the room");
      const second = aiSession.send("Book the room");
      await vi.advanceTimersByTimeAsync(0);
      await aiSession.open("chat-b");
      await second;
      await vi.advanceTimersByTimeAsync(3000);
      await aiSession.open("chat-x");
      expect(draft()).toBe("Book the room");
    } finally {
      net.hangStream = false;
      net.savedQuestion = null;
      vi.useRealTimers();
    }
  });

  it("gives a question back when the chat only holds an earlier one with the same words", async () => {
    vi.useFakeTimers();
    try {
      net.hangStream = true;
      net.earlierQuestion = "yes";
      await aiSession.open("chat-x");
      aiSession.setDraft("yes");
      const sending = aiSession.send("yes");
      await vi.advanceTimersByTimeAsync(0);
      await aiSession.open("chat-b");
      await sending;
      await vi.advanceTimersByTimeAsync(3000);
      await aiSession.open("chat-x");
      expect(draft()).toBe("yes");
    } finally {
      net.hangStream = false;
      net.earlierQuestion = null;
      vi.useRealTimers();
    }
  });

  it("keeps words typed while a first message is in flight for the landing, never for a chat no list shows", async () => {
    vi.useFakeTimers();
    try {
      net.hangStream = true;
      aiSession.setDraft("Draft the Q3 plan");
      const sending = aiSession.send("What is due this week?");
      await vi.advanceTimersByTimeAsync(0);
      aiSession.reset();
      await sending;
      // At once: the landing keeps the words that waited in the composer.
      expect(draft()).toBe("Draft the Q3 plan");
      // A moment later the server shows it never took the starter: it comes back above them.
      await vi.advanceTimersByTimeAsync(3000);
      expect(draft()).toBe("What is due this week?\n\nDraft the Q3 plan");
    } finally {
      net.hangStream = false;
      vi.useRealTimers();
    }
  });

  it("sends nothing while a chat is still loading, so the load never wipes a question the server took", async () => {
    let loaded = () => {};
    net.loadingY = new Promise<void>((r) => (loaded = r));
    net.streams = 0;
    const opening = aiSession.open("chat-y");
    aiSession.setDraft("Plan the launch");
    await aiSession.send("Plan the launch");
    // Refused while it loads: nothing left, and the words wait in the composer.
    expect(net.streams).toBe(0);
    expect(draft()).toBe("Plan the launch");
    loaded();
    await opening;
    net.loadingY = null;
    expect(aiSession.getState().loading).toBe(false);
    expect(draft()).toBe("Plan the launch");
  });

  it("sends nothing from a chat that could not load, and sends once it loads", async () => {
    net.failing.add("chat-a");
    net.streams = 0;
    await aiSession.open("chat-a");
    expect(aiSession.getState().loadError).toBe(true);
    aiSession.setDraft("Book the room");
    await aiSession.send("Book the room");
    expect(net.streams).toBe(0);
    expect(draft()).toBe("Book the room");
    // Try again loads it, and the words are still there to send.
    net.failing.delete("chat-a");
    await aiSession.open("chat-a");
    expect(aiSession.getState().loadError).toBe(false);
    expect(draft()).toBe("Book the room");
  });

  it("keeps what an answer that broke off already drew until the server saves it, and then shows the saved turn", async () => {
    vi.useFakeTimers();
    try {
      await aiSession.open("chat-s");
      net.breakAfter = [
        JSON.stringify({ type: "user_message", message: { id: "chat-s-q", content: "Call Acme and thank Max" } }),
        JSON.stringify({ type: "tool_use", name: "create_task", input: { title: "Call Acme" } }),
        JSON.stringify({ type: "tool_result", name: "create_task", isError: false, state: "ran" }),
        JSON.stringify({ type: "approval", action: { id: "act1", status: "PENDING", preview: { title: "Send kudos to Max" } } }),
      ];
      aiSession.setDraft("Call Acme and thank Max");
      await aiSession.send("Call Acme and thank Max");
      expect(aiSession.getState().error).toBe("stopped");
      // The first read again: the server has only the question so far.
      await vi.advanceTimersByTimeAsync(3000);
      const kept = aiSession.getState();
      expect(kept.messages.some((m) => m.id.startsWith("streaming-") && m.toolCalls.some((c) => c.name === "create_task"))).toBe(true);
      expect(kept.messages.some((m) => m.kind === "APPROVAL" && m.actionIds?.includes("act1"))).toBe(true);
      expect(kept.actions.act1).toBeDefined();
      expect(kept.error).toBe("stopped");
      // The server finishes: the next read shows the saved turn in place of the drawn one.
      net.savedAnswer = true;
      await vi.advanceTimersByTimeAsync(10_000);
      const saved = aiSession.getState();
      expect(saved.messages.map((m) => m.id)).toEqual(["chat-s-q", "chat-s-a", "chat-s-card"]);
      expect(saved.error).toBeNull();
      expect(saved.draft).toBe("");
    } finally {
      net.breakAfter = null;
      net.savedAnswer = false;
      vi.useRealTimers();
    }
  });

  it("keeps each broken-off turn under its own question, and clears the stop only when that question's answer is saved", async () => {
    vi.useFakeTimers();
    try {
      await aiSession.open("chat-t");
      const turn = (n: number) => [
        JSON.stringify({ type: "user_message", message: { id: `t-u${n}`, content: "Call Acme and thank Max" } }),
        JSON.stringify({ type: "tool_use", name: "create_task", input: { title: "Call Acme" } }),
        JSON.stringify({ type: "tool_result", name: "create_task", isError: false, state: "ran" }),
        JSON.stringify({ type: "approval", action: { id: `act${n}`, status: "PENDING", preview: { title: "Send kudos to Max" } } }),
      ];
      net.breakAfter = turn(1);
      aiSession.setDraft("Call Acme and thank Max");
      await aiSession.send("Call Acme and thank Max");
      // Try again sends the same words, and that answer breaks off too.
      net.breakAfter = turn(2);
      await aiSession.send(aiSession.getState().draft);
      expect(aiSession.getState().error).toBe("stopped");

      const shape = () => aiSession.getState().messages.map((m) => (m.id.startsWith("streaming-") ? "live" : m.id.startsWith("card-") ? `card:${m.actionIds?.join()}` : m.id));
      await vi.advanceTimersByTimeAsync(3000);
      expect(shape()).toEqual(["t-u1", "live", "card:act1", "t-u2", "live", "card:act2"]);

      // The first answer is saved after the second question: it reads under its own question,
      // and the second question still waits, so the stop stays.
      net.savedT1 = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(shape()).toEqual(["t-u1", "t-a1", "t-card1", "t-u2", "live", "card:act2"]);
      expect(aiSession.getState().error).toBe("stopped");

      net.savedT2 = true;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(shape()).toEqual(["t-u1", "t-a1", "t-card1", "t-u2", "t-a2", "t-card2"]);
      expect(aiSession.getState().error).toBeNull();
    } finally {
      net.breakAfter = null;
      net.savedT1 = false;
      net.savedT2 = false;
      vi.useRealTimers();
    }
  });

  it("keeps reading a broken-off answer the server saves minutes later, and clears the stop when it lands", async () => {
    vi.useFakeTimers();
    try {
      await aiSession.open("chat-s");
      net.breakAfter = [JSON.stringify({ type: "user_message", message: { id: "chat-s-q", content: "Call Acme and thank Max" } })];
      aiSession.setDraft("Call Acme and thank Max");
      await aiSession.send("Call Acme and thank Max");
      expect(aiSession.getState().error).toBe("stopped");
      // Past the first four reads (about 100 s): still waiting, still reading.
      await vi.advanceTimersByTimeAsync(2_500 + 10_000 + 30_000 + 60_000 + 60_000);
      expect(aiSession.getState().error).toBe("stopped");
      net.savedAnswer = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(aiSession.getState().error).toBeNull();
      expect(aiSession.getState().messages.map((m) => m.id)).toEqual(["chat-s-q", "chat-s-a", "chat-s-card"]);
    } finally {
      net.breakAfter = null;
      net.savedAnswer = false;
      vi.useRealTimers();
    }
  });
});
