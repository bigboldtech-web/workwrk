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
});
