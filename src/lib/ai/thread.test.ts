import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { actionIdsOf, callFromLog, contextFromPath, draftAfterFailure, lastTurn, messageFromApi, settleDone, splitSse, titleFromFirstMessage, unansweredQuestion, withToolResult, withToolUse, type AiMessage } from "./thread";

describe("splitSse", () => {
  it("returns whole events and keeps the unfinished tail", () => {
    const a = `data: {"type":"text_delta","text":"Hel"}\n\ndata: {"type":"text_delta","text":"lo"}\n\ndata: {"type":"do`;
    const { events, rest } = splitSse(a);
    expect(events).toEqual([{ type: "text_delta", text: "Hel" }, { type: "text_delta", text: "lo" }]);
    expect(rest).toBe(`data: {"type":"do`);
    const b = splitSse(`${rest}ne","message":{"id":"m","content":"Hello"}}\n\n`);
    expect(b.events[0]).toMatchObject({ type: "done" });
    expect(b.rest).toBe("");
  });
  it("skips malformed or empty events", () => {
    const { events } = splitSse(`data: not json\n\n: comment\n\ndata: {"type":"error","message":"x"}\n\n`);
    expect(events).toEqual([{ type: "error", message: "x" }]);
  });
  it("accepts CRLF separators", () => {
    expect(splitSse(`data: {"type":"text_delta","text":"a"}\r\n\r\n`).events).toHaveLength(1);
  });
});

describe("tool rows", () => {
  it("goes pending on tool_use and settles on tool_result", () => {
    let calls = withToolUse([], "create_task", { title: "A" });
    calls = withToolUse(calls, "create_task", { title: "B" });
    expect(calls.every((c) => c.pending)).toBe(true);
    calls = withToolResult(calls, "create_task", true);
    expect(calls[1]).toMatchObject({ pending: false, failed: true });
    expect(calls[0].pending).toBe(true);
    calls = withToolResult(calls, "create_task", false);
    expect(calls[0]).toMatchObject({ pending: false, failed: false });
    // a result with no pending row changes nothing
    expect(withToolResult(calls, "send_kudos", true)).toEqual(calls);
  });
  it("reads a saved log entry with its outcome", () => {
    const c = callFromLog({ name: "create_task", input: { title: "A" }, result: { ok: true, task: { id: "t9" } }, errorText: null, durationMs: 800 })!;
    expect(c.outcome?.href).toBe("/item/t9");
    expect(c.durationMs).toBe(800);
    expect(callFromLog({ name: "create_task", result: { error: "nope" } })!.failed).toBe(true);
    expect(callFromLog({ nope: 1 })).toBeNull();
  });
});

describe("messageFromApi", () => {
  it("keeps user and assistant turns only", () => {
    expect(messageFromApi({ id: "1", role: "TOOL", content: "", createdAt: "x" })).toBeNull();
    const m = messageFromApi({ id: "2", role: "ASSISTANT", content: "Hi", toolCalls: [{ name: "search_tasks", result: { count: 3 } }], createdAt: "x" })!;
    expect(m.toolCalls[0].outcome?.count).toBe(3);
  });
});

describe("settleDone", () => {
  const live: AiMessage = {
    id: "streaming-1", role: "ASSISTANT", content: "streamed text", createdAt: "t", streaming: true,
    toolCalls: [{ name: "create_task", input: { title: "A" }, outcome: null, failed: true, pending: false, durationMs: null }],
  };
  it("takes the saved id and text and keeps the failure the stream saw", () => {
    const m = settleDone(live, { id: "m1", content: "final text", toolCalls: [{ name: "create_task", input: { title: "A" } }] });
    expect(m).toMatchObject({ id: "m1", content: "final text", streaming: false });
    expect(m.toolCalls[0].failed).toBe(true);
  });
  it("keeps the streamed text when the saved one is empty", () => {
    expect(settleDone(live, { id: "m1", content: "" }).content).toBe("streamed text");
  });
});

describe("titles and context", () => {
  it("titles like the server", () => {
    expect(titleFromFirstMessage("  short ")).toBe("short");
    expect(titleFromFirstMessage("x".repeat(70))).toHaveLength(58);
  });
  it("reads the page a chat started on, never /sidekick", () => {
    expect(contextFromPath("/spaces/marketing/list")).toEqual({ productContext: "spaces", boardContext: "marketing" });
    expect(contextFromPath("/home")).toEqual({ productContext: "home" });
    expect(contextFromPath("/sidekick")).toEqual({});
    expect(contextFromPath("/")).toEqual({});
  });
});

describe("isStoppedAnswer", () => {
  it("spots both spellings of the stream route's apology", async () => {
    const { isStoppedAnswer } = await import("./thread");
    expect(isStoppedAnswer("Sorry, I hit an error reaching the model.\n\n`401`")).toBe(true);
    expect(isStoppedAnswer("Sorry \u2014 I hit an error reaching the model.\n\n`x`")).toBe(true);
    expect(isStoppedAnswer("Sorry, I can't find that task.")).toBe(false);
  });
});

describe("unansweredQuestion", () => {
  const q = (createdAt: string) => ({ id: "u", role: "USER" as const, content: "What is due?", toolCalls: [], createdAt });
  const a = { id: "a", role: "ASSISTANT" as const, content: "Two tasks.", toolCalls: [], createdAt: "2026-09-26T10:00:05Z" };
  const now = new Date("2026-09-26T10:10:00Z").getTime();
  it("finds a question with no answer after it", () => {
    expect(unansweredQuestion([q("2026-09-26T10:00:00Z")], { streaming: false, now })).toEqual({ text: "What is due?", recent: false });
  });
  it("calls a question under two minutes old recent", () => {
    expect(unansweredQuestion([q("2026-09-26T10:09:00Z")], { streaming: false, now })?.recent).toBe(true);
  });
  it("is null when the chat ends in an answer, or while one arrives", () => {
    expect(unansweredQuestion([q("2026-09-26T10:00:00Z"), a], { streaming: false, now })).toBeNull();
    expect(unansweredQuestion([q("2026-09-26T10:00:00Z")], { streaming: true, now })).toBeNull();
    expect(unansweredQuestion([], { streaming: false, now })).toBeNull();
  });
});

describe("draftAfterFailure: what Ask AI's composer holds after a send failed", () => {
  it("brings a message the server never had back above what was typed since, never in place of it", () => {
    expect(draftAfterFailure("and invite Lea", "Book a room for Friday", false)).toBe("Book a room for Friday\n\nand invite Lea");
    expect(draftAfterFailure("", "Book a room for Friday", false)).toBe("Book a room for Friday");
  });
  it("keeps what was typed since when the server has the message (it stays in the thread)", () => {
    expect(draftAfterFailure("and invite Lea", "Book a room for Friday", true)).toBe("and invite Lea");
    expect(draftAfterFailure("", "Book a room for Friday", true)).toBe("Book a room for Friday");
  });
  it("is the rule every failed send in the store uses", () => {
    // Before 2026-10-07 two of these were `s.draft || text` and `text`: a
    // message that never sent was dropped when anything had been typed since,
    // and words typed while the chat was being made were overwritten.
    const store = readFileSync(fileURLToPath(new URL("./session-store.ts", import.meta.url)), "utf8");
    expect(store).not.toContain("s.draft || text");
    expect(store).not.toMatch(/draft: text,/);
    expect(store.match(/draft: draftAfterFailure\(s\.draft, text, (true|false)\)/g)).toHaveLength(3);
  });
});

describe("Ask AI's approval cards in the thread (follow-up 1.5c)", () => {
  const at = "2026-10-07T10:00:00.000Z";
  it("reads an APPROVAL row as a card naming its requests, and an EVENT row as a line", () => {
    expect(messageFromApi({ id: "c1", role: "SYSTEM", kind: "APPROVAL", content: "Waiting for your approval: Send kudos to Max", meta: { actionIds: ["a1", 2, "", "a2"] }, createdAt: at })).toEqual({
      id: "c1",
      role: "SYSTEM",
      kind: "APPROVAL",
      content: "Waiting for your approval: Send kudos to Max",
      toolCalls: [],
      createdAt: at,
      actionIds: ["a1", "a2"],
    });
    expect(messageFromApi({ id: "e1", role: "SYSTEM", kind: "EVENT", content: "You approved: Send kudos to Max", createdAt: at })).toMatchObject({ role: "SYSTEM", kind: "EVENT" });
  });
  it("leaves out a card with no requests and any other system row", () => {
    expect(messageFromApi({ id: "c2", role: "SYSTEM", kind: "APPROVAL", content: "x", meta: { actionIds: [] }, createdAt: at })).toBeNull();
    expect(messageFromApi({ id: "r1", role: "SYSTEM", kind: "REPORT", content: "x", createdAt: at })).toBeNull();
    expect(messageFromApi({ id: "s1", role: "SYSTEM", content: "x", createdAt: at })).toBeNull();
    expect(actionIdsOf(null)).toEqual([]);
    expect(actionIdsOf({ actionIds: "a1" })).toEqual([]);
  });
  it("counts a question as answered when a card or a line follows the answer", () => {
    const q: AiMessage = { id: "u", role: "USER", content: "Thank Max", toolCalls: [], createdAt: at };
    const a: AiMessage = { id: "a", role: "ASSISTANT", content: "I asked for your approval.", toolCalls: [], createdAt: at };
    const card: AiMessage = { id: "c", role: "SYSTEM", kind: "APPROVAL", content: "", toolCalls: [], createdAt: at, actionIds: ["x"] };
    const line: AiMessage = { id: "e", role: "SYSTEM", kind: "EVENT", content: "You approved: Send kudos to Max", toolCalls: [], createdAt: at };
    expect(lastTurn([q, a, card, line])?.id).toBe("a");
    expect(unansweredQuestion([q, a, card, line], { streaming: false })).toBeNull();
    expect(unansweredQuestion([q], { streaming: false, now: Date.parse(at) })).toEqual({ text: "Thank Max", recent: true });
  });
  it("shows a call that waits for the person as waiting the moment it ends, never as done", () => {
    const calls = withToolUse([], "send_kudos", { email: "max@x.com" });
    const [waiting] = withToolResult(calls, "send_kudos", false, { title: "Send kudos to Max" });
    expect(waiting).toMatchObject({ pending: false, failed: false, outcome: { state: "waiting", title: "Send kudos to Max" } });
    const [ran] = withToolResult(withToolUse([], "create_task", { title: "x" }), "create_task", false);
    expect(ran.outcome).toBeNull();
  });
});
