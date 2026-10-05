import { describe, expect, it } from "vitest";
import {
  actionViewFromRow,
  groupApprovals,
  lastLineFor,
  messageViewFromRow,
  reportLines,
  sortTeammates,
  type AgentActionRow,
  type TeammateMessageRow,
} from "./teammate-thread";

const AT = new Date("2026-10-06T09:00:00Z");

const row = (over: Partial<TeammateMessageRow> = {}): TeammateMessageRow => ({ id: "m1", role: "USER", content: "Hi", createdAt: AT, ...over });

const action = (over: Partial<AgentActionRow> = {}): AgentActionRow => ({
  id: "a1",
  toolName: "post_in_talk",
  risk: "OUTWARD",
  status: "PENDING",
  preview: {
    title: "Post in #general",
    body: "Proof hello",
    lines: ["34 people can read it.", 7],
    target: { label: "#general", href: "/chat/c1" },
    audience: 34,
    editable: { field: "text", label: "Message", maxLength: 3000 },
    alwaysKey: "post_in_talk:conv:c1",
    alwaysLabel: "Approve and don't ask again in #general",
  },
  groupKey: "run1:post_in_talk",
  sessionId: "s1",
  createdAt: AT,
  expiresAt: new Date("2026-10-13T09:00:00Z"),
  ...over,
});

describe("messageViewFromRow", () => {
  it("reads the person's message, practice included", () => {
    expect(messageViewFromRow(row())).toEqual({ id: "m1", createdAt: "2026-10-06T09:00:00.000Z", text: "Hi", kind: "user", practice: false });
    expect(messageViewFromRow(row({ meta: { practice: true } }))).toMatchObject({ kind: "user", practice: true });
    expect(messageViewFromRow(row({ content: null }))?.text).toBe("");
  });
  it("reads an answer with its call log", () => {
    const v = messageViewFromRow(row({
      role: "ASSISTANT",
      content: "Done.",
      meta: { practice: true },
      toolCalls: [{ name: "create_task", input: { title: "Call Acme" }, result: { ok: true, task: { id: "t1" } }, errorText: null, durationMs: 40 }, { nope: 1 }],
    }));
    expect(v).toMatchObject({ kind: "agent", text: "Done.", practice: true });
    if (v?.kind !== "agent") throw new Error("not an answer");
    expect(v.toolCalls).toHaveLength(1);
    expect(v.toolCalls[0]).toMatchObject({ name: "create_task", failed: false, pending: false, durationMs: 40 });
    expect(v.toolCalls[0].outcome?.href).toBe("/item/t1");
  });
  it("reads a routine report", () => {
    const meta = { routineId: "r1", routineName: "Daily brief", runId: "run1", dueAt: "2026-10-06T03:30:00Z" };
    expect(messageViewFromRow(row({ role: "ASSISTANT", kind: "REPORT", content: "Three things", meta }))).toMatchObject({
      kind: "report",
      text: "Three things",
      routine: { id: "r1", name: "Daily brief", runId: "run1", dueAt: "2026-10-06T03:30:00.000Z" },
    });
    expect(messageViewFromRow(row({ role: "ASSISTANT", kind: "REPORT", meta: null }))).toMatchObject({
      routine: { id: null, name: "Routine", runId: null, dueAt: null },
    });
  });
  it("reads an event line, and keeps its words when the event is one it does not know", () => {
    expect(messageViewFromRow(row({ role: "SYSTEM", kind: "EVENT", content: "Forgot: report day", meta: { event: "memory_forgotten" } }))).toEqual({
      id: "m1", createdAt: "2026-10-06T09:00:00.000Z", text: "Forgot: report day", kind: "event", event: "memory_forgotten", routineId: null, actionId: null,
    });
    expect(messageViewFromRow(row({ role: "SYSTEM", kind: "EVENT", content: "Something new", meta: { event: "from_the_future", routineId: "r1" } }))).toMatchObject({
      kind: "event", text: "Something new", event: null, routineId: "r1",
    });
  });
  it("reads an approval card's ids once each, strings only, at most 50", () => {
    const v = messageViewFromRow(row({ role: "SYSTEM", kind: "APPROVAL", content: "Waiting for your approval: Post in #general", meta: { actionIds: ["a1", "a2", "a1", 3, "", null] } }));
    expect(v).toMatchObject({ kind: "approval", text: "Waiting for your approval: Post in #general", actionIds: ["a1", "a2"] });
    const many = messageViewFromRow(row({ role: "SYSTEM", kind: "APPROVAL", meta: { actionIds: Array.from({ length: 80 }, (_, i) => `a${i}`) } }));
    expect(many?.kind === "approval" ? many.actionIds.length : 0).toBe(50);
    expect(messageViewFromRow(row({ role: "SYSTEM", kind: "APPROVAL", meta: { actionIds: "a1" } }))).toMatchObject({ actionIds: [] });
  });
  it("renders nothing for a tool row, a system row with no kind, or a kind it does not know", () => {
    expect(messageViewFromRow(row({ role: "TOOL" }))).toBeNull();
    expect(messageViewFromRow(row({ role: "SYSTEM" }))).toBeNull();
    expect(messageViewFromRow(row({ role: "ASSISTANT", kind: "POLL" }))).toBeNull();
  });
});

describe("actionViewFromRow", () => {
  it("reads a waiting action and offers don't ask again where its preview names a rule", () => {
    const v = actionViewFromRow(action());
    expect(v).toMatchObject({ id: "a1", toolName: "post_in_talk", status: "PENDING", risk: "OUTWARD", groupKey: "run1:post_in_talk", sessionId: "s1", edited: false, decidedAt: null, result: null, error: null });
    expect(v.preview).toEqual({
      title: "Post in #general",
      body: "Proof hello",
      lines: ["34 people can read it."],
      target: { label: "#general", href: "/chat/c1" },
      audience: 34,
      editable: { field: "text", label: "Message", maxLength: 3000 },
      alwaysKey: "post_in_talk:conv:c1",
      alwaysLabel: "Approve and don't ask again in #general",
    });
    expect(v.always).toEqual({ allowed: true, label: "Approve and don't ask again in #general" });
    expect(v.createdAt).toBe("2026-10-06T09:00:00.000Z");
    expect(v.expiresAt).toBe("2026-10-13T09:00:00.000Z");
  });
  it("never offers don't ask again once decided, on an irreversible action, or with no rule to store", () => {
    expect(actionViewFromRow(action({ status: "EXECUTED" })).always).toEqual({ allowed: false, label: null });
    expect(actionViewFromRow(action({ risk: "IRREVERSIBLE", toolName: "invite_person_with_role" })).always.allowed).toBe(false);
    expect(actionViewFromRow(action({ preview: { title: "Send kudos to Max" } })).always.allowed).toBe(false);
    expect(actionViewFromRow(action({ preview: { title: "Send kudos to Max", alwaysKey: "send_kudos" } })).always).toEqual({
      allowed: true,
      label: "Approve and don't ask again",
    });
  });
  it("reads what it did, and links only inside the app", () => {
    const done = actionViewFromRow(action({
      status: "EXECUTED",
      editedInput: { text: "Edited" },
      decidedVia: "person",
      decidedAt: AT,
      executedAt: AT,
      result: { text: "Posted in #general", href: "/chat/c1", data: { ok: true } },
    }));
    expect(done).toMatchObject({ status: "EXECUTED", edited: true, decidedVia: "person", decidedAt: "2026-10-06T09:00:00.000Z", result: { text: "Posted in #general", href: "/chat/c1" } });
    expect(done.result).not.toHaveProperty("data");
    expect(actionViewFromRow(action({ result: { text: "Posted", href: "https://example.com" } })).result).toEqual({ text: "Posted", href: null });
    expect(actionViewFromRow(action({ result: { text: "Posted", href: "//example.com" } })).result).toEqual({ text: "Posted", href: null });
    expect(actionViewFromRow(action({ preview: { title: "X", target: { label: "#general", href: "javascript:alert(1)" } } })).preview.target).toEqual({ label: "#general" });
    expect(actionViewFromRow(action({ result: { ok: true } })).result).toBeNull();
  });
  it("reads a status or risk it does not know as the safe one", () => {
    const v = actionViewFromRow(action({ status: "WEIRD", risk: "READ" }));
    expect(v.status).toBe("CANCELLED");
    expect(v.risk).toBe("IRREVERSIBLE");
    expect(actionViewFromRow(action({ preview: null })).preview).toEqual({ title: "An action" });
  });
});

describe("groupApprovals", () => {
  const views = {
    a1: actionViewFromRow(action({ id: "a1" })),
    a2: actionViewFromRow(action({ id: "a2", toolName: "comment_on_task", groupKey: "run1:comment_on_task" })),
    a3: actionViewFromRow(action({ id: "a3" })),
    a4: actionViewFromRow(action({ id: "a4", status: "DENIED" })),
    a5: actionViewFromRow(action({ id: "a5", groupKey: null })),
  };
  it("groups by run and tool, in the order the turn asked", () => {
    const { groups, pendingIds } = groupApprovals(["a1", "a2", "a3", "a4", "a5"], views);
    expect(groups.map((g) => [g.key, g.toolName, g.actions.map((a) => a.id)])).toEqual([
      ["run1:post_in_talk", "post_in_talk", ["a1", "a3", "a4"]],
      ["run1:comment_on_task", "comment_on_task", ["a2"]],
      ["a5", "post_in_talk", ["a5"]],
    ]);
    expect(pendingIds).toEqual(["a1", "a2", "a3", "a5"]);
  });
  it("leaves out an id with no row and counts each id once", () => {
    const { groups, pendingIds } = groupApprovals(["a1", "gone", "a1", "toString"], views);
    expect(groups).toHaveLength(1);
    expect(groups[0].actions.map((a) => a.id)).toEqual(["a1"]);
    expect(pendingIds).toEqual(["a1"]);
  });
});

describe("reportLines", () => {
  it("shows a short report whole", () => {
    expect(reportLines("Done\n- one\n- two\n")).toEqual({ lines: ["Done", "- one", "- two"], more: 0 });
  });
  it("stops after the lines with words in them, keeping the blank lines between", () => {
    const text = ["# Week", "", "- a", "- b", "", "- c", "- d", "- e"].join("\n");
    expect(reportLines(text, 3)).toEqual({ lines: ["# Week", "", "- a", "- b"], more: 3 });
  });
  it("trims blank lines at either end", () => {
    expect(reportLines("\n\n  \nHello\n\n\n")).toEqual({ lines: ["Hello"], more: 0 });
  });
});

describe("lastLineFor", () => {
  const v = (over: Partial<TeammateMessageRow>) => messageViewFromRow(row(over));
  it("says what was said last, on one line", () => {
    expect(lastLineFor(v({ content: "What is **due** today?\nAnd tomorrow?" }))).toBe("You: What is due today?");
    expect(lastLineFor(v({ role: "ASSISTANT", content: "## Today\n- Call Acme" }))).toBe("Today");
    expect(lastLineFor(v({ role: "ASSISTANT", kind: "REPORT", content: "Three things", meta: { routineName: "Daily brief" } }))).toBe("Daily brief: Three things");
    expect(lastLineFor(v({ role: "SYSTEM", kind: "EVENT", content: "Forgot: report day" }))).toBe("Forgot: report day");
    expect(lastLineFor(v({ role: "SYSTEM", kind: "APPROVAL", content: "Waiting for your approval: Post in #general", meta: { actionIds: ["a1"] } }))).toBe(
      "Waiting for your approval: Post in #general",
    );
  });
  it("reads an answer of tools only as what the last tool did", () => {
    expect(lastLineFor(v({ role: "ASSISTANT", content: "", toolCalls: [{ name: "search_tasks", input: {}, result: { count: 3 } }] }))).toBe("Searched 3 tasks");
  });
  it("is null for a chat with nothing in it", () => {
    expect(lastLineFor(null)).toBeNull();
    expect(lastLineFor(v({ role: "ASSISTANT", content: "" }))).toBeNull();
  });
});

describe("sortTeammates", () => {
  it("puts the most recent first and the never-used after, by name", () => {
    const rows = [
      { name: "zed", lastAt: null },
      { name: "Old", lastAt: "2026-10-01T09:00:00Z" },
      { name: "alpha", lastAt: null },
      { name: "New", lastAt: new Date("2026-10-06T09:00:00Z") },
      { name: "Beta", lastAt: null },
    ];
    expect(sortTeammates(rows).map((r) => r.name)).toEqual(["New", "Old", "alpha", "Beta", "zed"]);
    expect(rows[0].name).toBe("zed");
  });
});
