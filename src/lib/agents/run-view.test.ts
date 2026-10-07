import { describe, expect, it } from "vitest";
import { canReadRunDetail, plainLine, resultError, runChatHref, runDurationMs, runStatus, runSummary, runSummaryWithheld, runToolCalls, runTrigger, withheldToolCalls } from "./run-view";

const start = "2026-09-25T09:00:00.000Z";
const end = "2026-09-25T09:00:04.500Z";

describe("run-view", () => {
  it("reads the trigger from either row shape", () => {
    expect(runTrigger({ trigger: "SCHEDULED", prompt: "x" })).toBe("SCHEDULED");
    expect(runTrigger({ trigger: "MANUAL" })).toBe("MANUAL");
    expect(runTrigger({ toolName: "create_task", input: {} })).toBe("CHAT");
    expect(runTrigger(null)).toBe("CHAT");
  });

  it("reads an AI teammate's turn: a routine as its own trigger, a chat and a continue as the chat", () => {
    expect(runTrigger({ trigger: "ROUTINE", practice: false, routineId: "r1" })).toBe("ROUTINE");
    expect(runTrigger({ trigger: "CHAT", practice: true, routineId: null })).toBe("CHAT");
    expect(runTrigger({ trigger: "RESUME", practice: false, routineId: null })).toBe("CHAT");
  });

  it("passes on how a teammate's call ended, and nothing for an older row", () => {
    const calls = runToolCalls({
      input: { trigger: "CHAT" },
      output: {
        text: "Asked first.",
        toolCalls: [
          { name: "post_in_talk", input: { text: "Hi" }, result: { status: "waiting_for_approval" }, errorText: null, durationMs: 9, state: "waiting", actionId: "act1" },
          { name: "create_task", input: { title: "A" }, result: { practice: true }, errorText: null, durationMs: 3, state: "practice", actionId: null },
          { name: "search_tasks", input: {}, result: { count: 0 }, errorText: null, durationMs: 5, state: "bogus" },
        ],
      },
      error: null,
      startedAt: start,
      endedAt: end,
    });
    expect(calls.map((c) => c.state)).toEqual(["waiting", "practice", undefined]);
    expect("state" in calls[2]).toBe(false);
  });

  it("opens a teammate's run in its chat by slug, an Ask AI run by its chat id, and nothing without a chat", () => {
    expect(runChatHref("s1", "TEAMMATE", "t-planner-abc123")).toBe("/agents?chat=t-planner-abc123");
    expect(runChatHref("s1", null, "priya-hr")).toBe("/sidekick?session=s1");
    expect(runChatHref(null, "TEAMMATE", "t-planner-abc123")).toBeNull();
  });

  it("maps the stored statuses to three", () => {
    expect(runStatus("SUCCEEDED")).toBe("SUCCEEDED");
    expect(runStatus("FAILED")).toBe("FAILED");
    expect(runStatus("PENDING")).toBe("RUNNING");
  });

  it("measures a finished run only", () => {
    expect(runDurationMs(start, end)).toBe(4500);
    expect(runDurationMs(start, null)).toBeNull();
  });

  it("lists an autonomous run's tool calls with their errors", () => {
    const calls = runToolCalls({
      input: { trigger: "SCHEDULED" },
      output: {
        text: "Done",
        toolCalls: [
          { name: "create_task", input: { title: "A" }, result: { ok: true, task: { id: "t1" } }, errorText: null, durationMs: 120 },
          { name: "search_tasks", input: {}, result: { error: "No access" }, errorText: null, durationMs: 40 },
          { bogus: true },
        ],
      },
      error: null,
      startedAt: start,
      endedAt: end,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ name: "create_task", error: null, durationMs: 120 });
    expect(calls[1].error).toBe("No access");
  });

  it("turns a chat-originated row into one call", () => {
    const calls = runToolCalls({ input: { toolName: "send_kudos", input: { receiverEmail: "a@b.c" } }, output: { ok: true }, error: null, startedAt: start, endedAt: end });
    expect(calls).toEqual([{ name: "send_kudos", input: { receiverEmail: "a@b.c" }, result: { ok: true }, error: null, durationMs: 4500 }]);
  });

  it("summarises with the agent's own first line, or the tool sentence", () => {
    expect(runSummary({ status: "SUCCEEDED", startedAt: start, endedAt: end, input: { trigger: "MANUAL" }, output: { text: "## Weekly check\n\n- **3** tasks are late" }, error: null })).toBe("Weekly check");
    expect(runSummary({ status: "SUCCEEDED", startedAt: start, endedAt: end, input: { toolName: "create_task", input: { title: "Fix PDF" } }, output: { ok: true }, error: null })).toBe('Created task "Fix PDF"');
    // A call that only asked the person never reads as done (Ask AI's waiting requests, follow-up 1.5c).
    expect(
      runSummary({ status: "SUCCEEDED", startedAt: start, endedAt: end, input: { toolName: "send_kudos", input: { receiverEmail: "max@acme.com" } }, output: { status: "waiting_for_approval", actionId: "a1", title: "Send kudos to Max" }, error: null }),
    ).toBe("Waiting for your approval: Send kudos to Max");
    expect(runSummary({ status: "FAILED", startedAt: start, endedAt: end, input: { trigger: "MANUAL" }, output: null, error: "boom" })).toBe("The run didn't finish.");
    expect(runSummary({ status: "PENDING", startedAt: start, endedAt: null, input: { trigger: "SCHEDULED" }, output: null, error: null })).toBe("Running now.");
  });

  it("strips markdown to one line and caps it", () => {
    expect(plainLine("> **Hello** `there` [link](http://x)")).toBe("Hello there link");
    expect(plainLine("x".repeat(200), 10)).toBe("xxxxxxxxx…");
    expect(resultError({ error: "  nope " })).toBe("nope");
    expect(resultError({ ok: true })).toBeNull();
  });
});

describe("withholding a run from a Member", () => {
  const row = {
    status: "SUCCEEDED",
    startedAt: "2026-09-25T10:00:00Z",
    endedAt: "2026-09-25T10:00:02Z",
    input: { trigger: "MANUAL", prompt: "Check payroll" },
    output: { text: "Found 3 people on leave in the private HR Space", toolCalls: [{ name: "search_employees", input: { q: "leave" }, result: { rows: [{ name: "A" }] }, durationMs: 12 }] },
    error: null,
  };
  it("lets the Owner, Admins and the person who ran it read it", () => {
    expect(canReadRunDetail({ triggeredBy: "u1" }, { userId: "u9", admin: true })).toBe(true);
    expect(canReadRunDetail({ triggeredBy: "u2" }, { userId: "u2", admin: false })).toBe(true);
    expect(canReadRunDetail({ triggeredBy: "u1" }, { userId: "u2", admin: false })).toBe(false);
    expect(canReadRunDetail({ triggeredBy: null }, { userId: "u2", admin: false })).toBe(false);
  });
  it("keeps the words and results out of the summary and tool rows", () => {
    expect(runSummaryWithheld(row)).toBe("Finished \u00b7 1 action");
    expect(runSummaryWithheld(row)).not.toContain("leave");
    const calls = withheldToolCalls(row);
    expect(calls).toEqual([{ name: "search_employees", input: null, result: null, error: null, durationMs: 12 }]);
  });
});
