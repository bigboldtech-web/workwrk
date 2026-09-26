import { describe, expect, it } from "vitest";
import { callFromLog, contextFromPath, messageFromApi, settleDone, splitSse, titleFromFirstMessage, withToolResult, withToolUse, type AiMessage } from "./thread";

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
