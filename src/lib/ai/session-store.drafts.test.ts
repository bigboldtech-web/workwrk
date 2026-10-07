// Ask AI's composer never loses words (src/lib/ai/session-store.ts drafts):
// each chat keeps its unsent words while another chat is open, the landing
// keeps its own, and a caller's prompt (?q=) goes above what was kept rather
// than in place of it. Before 2026-10-07 opening another chat or a new chat
// emptied the composer.

import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ failing: new Set<string>() }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    const id = decodeURIComponent(url.split("/").pop() ?? "");
    if (net.failing.has(id)) return { ok: false, status: 500, error: "Something went wrong" };
    return { ok: true, status: 200, data: { session: { id, title: id, pinned: false, archived: false }, messages: [] } };
  },
}));
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
});
