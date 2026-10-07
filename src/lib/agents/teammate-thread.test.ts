import { describe, expect, it } from "vitest";
import type { DecisionInput, DecisionResult } from "./actions";
import { ACTION_ERRORS, TEAMMATE_CHAT } from "./teammate-copy";
import {
  actionViewFromRow,
  activityActionView,
  applyDecisionResults,
  applyTeammateEvent,
  canRetrySend,
  clipCardBody,
  decidedLine,
  draftAfterFailure,
  editStartText,
  failedTurnMessages,
  filterTeammates,
  groupApprovals,
  hubViewFor,
  lastAnswerId,
  lastLineFor,
  mergeNewestPage,
  messageViewFromRow,
  prependOlder,
  reportLines,
  sendErrorSentence,
  settingsTabFor,
  sortTeammates,
  startersFor,
  teammateSendFailure,
  withTeammateToolResult,
  type AgentActionRow,
  type TeammateDecision,
  type TeammateDecisionResult,
  type TeammateMessageRow,
  type TeammateMessageView,
  type TeammateSendError,
  type TeammateStreamEvent,
  type TurnIds,
  type TurnView,
} from "./teammate-thread";

// The client's decision shapes are the route's (actions.ts), held by the
// compiler: a field the route adds or renames fails the type check here.
const fromRoute = (r: DecisionResult): TeammateDecisionResult => r;
const toRoute = (d: TeammateDecision): DecisionInput => d;
void fromRoute;
void toRoute;

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

describe("filterTeammates", () => {
  const rows = [
    { name: "Chief of Staff", job: "Keeps your week on track", waiting: 0 },
    { name: "Status Reporter", job: "Writes your weekly status", waiting: 2 },
    { name: "Triage", job: "Reads Talk and your Inbox", waiting: 0 },
  ];
  it("matches the name or the job, in any case", () => {
    expect(filterTeammates(rows, "  STATUS ").map((r) => r.name)).toEqual(["Status Reporter"]);
    expect(filterTeammates(rows, "inbox").map((r) => r.name)).toEqual(["Triage"]);
    expect(filterTeammates(rows, "")).toHaveLength(3);
  });
  it("keeps only what waits on Waiting for you", () => {
    expect(filterTeammates(rows, "", { waitingOnly: true }).map((r) => r.name)).toEqual(["Status Reporter"]);
    expect(filterTeammates(rows, "triage", { waitingOnly: true })).toEqual([]);
  });
});

describe("startersFor", () => {
  const templates = [
    { key: "chief-of-staff", starters: ["What should I focus on today?", "", 7, "Draft my update", "Overdue?", "Every weekday at 8:30"] },
    { key: "status-reporter" },
  ];
  it("reads up to four starters of the teammate's template", () => {
    expect(startersFor(templates, "chief-of-staff")).toEqual(["What should I focus on today?", "Draft my update", "Overdue?", "Every weekday at 8:30"]);
  });
  it("offers none for no template, an unknown one, or one without starters", () => {
    expect(startersFor(templates, null)).toEqual([]);
    expect(startersFor(templates, "meeting-prep")).toEqual([]);
    expect(startersFor(templates, "status-reporter")).toEqual([]);
    expect(startersFor(undefined, "chief-of-staff")).toEqual([]);
    expect(startersFor([null, "x"], "chief-of-staff")).toEqual([]);
  });
});

describe("hubViewFor", () => {
  const view = (q: string) => hubViewFor(new URLSearchParams(q));
  it("opens the view the tab names, Chats by default", () => {
    expect(view("")).toBe("chats");
    expect(view("tab=chats")).toBe("chats");
    expect(view("chat=planner&action=a1")).toBe("chats");
    expect(view("tab=waiting&chat=planner")).toBe("waiting");
    expect(view("tab=workspace")).toBe("workspace");
    expect(view("tab=runs")).toBe("runs");
    expect(view("tab=nope")).toBe("chats");
    expect(hubViewFor(null)).toBe("chats");
  });
  it("keeps every link from before: an agent drawer with no tab is Workspace agents", () => {
    expect(view("agent=hr-helper")).toBe("workspace");
    expect(view("agent=hr-helper&run=r1")).toBe("workspace");
    // A run opened from Run history keeps Run history under the drawer.
    expect(view("tab=runs&agent=hr-helper&run=r1")).toBe("runs");
  });
  it("reads the settings tab only when it is one", () => {
    expect(settingsTabFor("routines")).toBe("routines");
    expect(settingsTabFor("memory")).toBe("memory");
    expect(settingsTabFor("billing")).toBeNull();
    expect(settingsTabFor(null)).toBeNull();
  });
});

type UserMsg = Extract<TeammateMessageView, { kind: "user" }>;
type AgentMsg = Extract<TeammateMessageView, { kind: "agent" }>;

const T0 = "2026-10-06T09:00:00.000Z";
const IDS: TurnIds = { userId: "tmp:user-1", liveId: "tmp:live-1" };
const userMsg = (over: Partial<UserMsg> = {}): UserMsg => ({ id: "tmp:user-1", kind: "user", text: "Post hello in #team", practice: false, createdAt: T0, ...over });
const liveMsg = (over: Partial<AgentMsg> = {}): AgentMsg => ({ id: "tmp:live-1", kind: "agent", text: "", practice: false, toolCalls: [], createdAt: T0, streaming: true, ...over });
const line = (id: string): TeammateMessageView => ({ id, kind: "event", text: "Memory updated: Mondays", event: "memory_updated", routineId: null, actionId: null, createdAt: T0 });

function run(start: TurnView, events: TeammateStreamEvent[], ids: TurnIds = IDS): { view: TurnView; ids: TurnIds } {
  let s = { view: start, ids };
  for (const e of events) s = applyTeammateEvent(s.view, s.ids, e);
  return s;
}

describe("withTeammateToolResult", () => {
  const pending = (name: string) => ({ name, input: null, outcome: null, failed: false, pending: true, durationMs: null });
  it("settles the newest pending row of that tool", () => {
    const calls = [pending("search_tasks"), pending("search_tasks")];
    const next = withTeammateToolResult(calls, { name: "search_tasks", isError: false, state: "ran" });
    expect(next.map((c) => c.pending)).toEqual([true, false]);
    expect(calls[1].pending).toBe(true);
  });
  it("never reads a call that waits or practised as done", () => {
    const waiting = withTeammateToolResult([pending("post_in_talk")], { name: "post_in_talk", isError: false, state: "waiting", title: "Post in #team" })[0];
    expect(waiting).toMatchObject({ pending: false, failed: false, outcome: { failed: false, state: "waiting", title: "Post in #team", href: null } });
    const practice = withTeammateToolResult([pending("create_task")], { name: "create_task", isError: false, state: "practice", title: 'Create task "Call Acme"' })[0];
    expect(practice.outcome).toMatchObject({ state: "practice", title: 'Create task "Call Acme"' });
  });
  it("marks a failed call failed", () => {
    expect(withTeammateToolResult([pending("update_task")], { name: "update_task", isError: true, state: "failed" })[0]).toMatchObject({ pending: false, failed: true, outcome: null });
  });
});

describe("applyTeammateEvent", () => {
  it("swaps the optimistic bubble for the saved message and follows its id", () => {
    const saved = userMsg({ id: "m1", practice: true });
    const out = run({ messages: [userMsg(), liveMsg()], actions: {} }, [{ type: "user_message", message: saved }]);
    expect(out.view.messages[0]).toEqual(saved);
    expect(out.ids).toEqual({ userId: "m1", liveId: "tmp:live-1" });
  });

  it("builds the answer from text and tool rows, and keeps each card's action", () => {
    const card = actionViewFromRow(action({ id: "a9" }));
    const out = run({ messages: [userMsg(), liveMsg()], actions: {} }, [
      { type: "text_delta", text: "Looking. " },
      { type: "tool_use", name: "search_tasks", input: { query: "acme" } },
      { type: "tool_result", name: "search_tasks", isError: false, state: "ran" },
      { type: "tool_use", name: "post_in_talk", input: { channel: "#team" } },
      { type: "approval", action: card },
      { type: "tool_result", name: "post_in_talk", isError: false, state: "waiting", title: "Post in #team" },
      { type: "text_delta", text: "Asked first." },
    ]);
    const answer = out.view.messages[1] as AgentMsg;
    expect(answer.text).toBe("Looking. Asked first.");
    expect(answer.toolCalls.map((c) => [c.name, c.pending, c.outcome?.state ?? null])).toEqual([
      ["search_tasks", false, null],
      ["post_in_talk", false, "waiting"],
    ]);
    expect(out.view.actions.a9).toEqual(card);
  });

  it("puts a line above the answer, once", () => {
    const out = run({ messages: [userMsg(), liveMsg()], actions: {} }, [
      { type: "event", message: line("e1") },
      { type: "event", message: line("e1") },
    ]);
    expect(out.view.messages.map((m) => m.id)).toEqual(["tmp:user-1", "e1", "tmp:live-1"]);
  });

  it("puts the saved answer and its card where the live answer was", () => {
    const answer = liveMsg({ id: "m2", text: "Asked first.", streaming: undefined });
    const card: TeammateMessageView = { id: "m3", kind: "approval", text: "Waiting for your approval: Post in #team", actionIds: ["a9"], createdAt: T0 };
    const out = run({ messages: [userMsg({ id: "m1" }), line("e1"), liveMsg({ text: "Asked" })], actions: {} }, [
      { type: "done", messages: [answer, card], error: null },
    ], { userId: "m1", liveId: "tmp:live-1" });
    expect(out.view.messages.map((m) => m.id)).toEqual(["m1", "e1", "m2", "m3"]);
    expect(out.view.messages[2]).toEqual(answer);
  });

  it("keeps what streamed, settled, when nothing was saved; drops an answer that never started", () => {
    const pendingCall = { name: "search_tasks", input: null, outcome: null, failed: false, pending: true, durationMs: null };
    const kept = run({ messages: [userMsg(), liveMsg({ text: "Half", toolCalls: [pendingCall] })], actions: {} }, [{ type: "done", messages: [], error: "The answer couldn't be saved." }]);
    expect(kept.view.messages[1]).toMatchObject({ id: "tmp:live-1", text: "Half", streaming: false });
    expect((kept.view.messages[1] as AgentMsg).toolCalls[0].pending).toBe(false);
    const empty = run({ messages: [userMsg(), liveMsg()], actions: {} }, [{ type: "done", messages: [], error: "The AI service didn't answer. Try again." }]);
    expect(empty.view.messages.map((m) => m.id)).toEqual(["tmp:user-1"]);
  });

  it("leaves the chat alone for an error event, and for an event it cannot read", () => {
    const start = { messages: [userMsg(), liveMsg()], actions: {} };
    expect(run(start, [{ type: "error", message: "The AI service didn't answer. Try again." }]).view).toEqual(start);
    expect(run(start, [{ type: "event", message: null as unknown as TeammateMessageView }]).view).toEqual(start);
  });
});

describe("failedTurnMessages", () => {
  it("takes the message back when the server never had it", () => {
    expect(failedTurnMessages([line("e0"), userMsg(), liveMsg()], IDS, false).map((m) => m.id)).toEqual(["e0"]);
  });
  it("keeps the message when the server has it, and drops an answer that never started", () => {
    expect(failedTurnMessages([userMsg(), liveMsg()], IDS, true).map((m) => m.id)).toEqual(["tmp:user-1"]);
  });
  it("keeps an answer that started, with its rows settled", () => {
    const pendingCall = { name: "create_task", input: null, outcome: null, failed: false, pending: true, durationMs: null };
    const out = failedTurnMessages([userMsg(), liveMsg({ text: "Making it", toolCalls: [pendingCall] })], IDS, true);
    expect(out[1]).toMatchObject({ text: "Making it", streaming: false });
    expect((out[1] as AgentMsg).toolCalls[0].pending).toBe(false);
  });
  it("takes only the live answer of a continue that never reached the server", () => {
    expect(failedTurnMessages([userMsg({ id: "m1" }), liveMsg()], { userId: null, liveId: "tmp:live-1" }, false).map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("draftAfterFailure", () => {
  it("keeps both when the person typed more while a message the server never had was out", () => {
    // Its bubble leaves the thread, so this is the only place the words are.
    expect(draftAfterFailure("and invite Lea", "Book a room for Friday", false)).toBe("Book a room for Friday\n\nand invite Lea");
  });
  it("puts the words back in an empty composer, once", () => {
    expect(draftAfterFailure("", "Book a room for Friday", false)).toBe("Book a room for Friday");
    expect(draftAfterFailure("  \n", "Book a room for Friday", false)).toBe("Book a room for Friday");
    expect(draftAfterFailure("Book a room for Friday", "Book a room for Friday", false)).toBe("Book a room for Friday");
  });
  it("leaves newer text alone when the server has the message, whose bubble stays", () => {
    expect(draftAfterFailure("and invite Lea", "Book a room for Friday", true)).toBe("and invite Lea");
    expect(draftAfterFailure("", "Book a room for Friday", true)).toBe("Book a room for Friday");
  });
  it("changes nothing for a continue, which has no words", () => {
    expect(draftAfterFailure("and invite Lea", null, false)).toBe("and invite Lea");
    expect(draftAfterFailure("", null, true)).toBe("");
  });
});

describe("teammateSendFailure", () => {
  const cases: Array<[number, unknown, { error: TeammateSendError | null; text: string | null }]> = [
    [403, { error: "This workspace has used all its AI questions.", code: "ai_limit" }, { error: "ai_limit", text: "This workspace has used all its AI questions." }],
    [403, { error: "Priya has used its 40 AI questions for October.", code: "agent_cap" }, { error: "agent_cap", text: "Priya has used its 40 AI questions for October." }],
    [429, { error: "Too many AI requests. Try again in 20 seconds.", code: "rate_limited" }, { error: "rate_limited", text: "Too many AI requests. Try again in 20 seconds." }],
    [409, { error: "Priya is paused, so your message wasn't sent.", code: "agent_paused" }, { error: "paused", text: "Priya is paused, so your message wasn't sent." }],
    [409, { error: "Priya was removed. Its chat is kept.", code: "agent_removed" }, { error: "removed", text: "Priya was removed. Its chat is kept." }],
    [409, { error: "There's nothing new to continue from.", code: "nothing_to_continue" }, { error: null, text: null }],
    [503, { error: "AI isn't set up for this workspace yet.", code: "not_configured" }, { error: "not_configured", text: "AI isn't set up for this workspace yet." }],
    // The app gate's refusals carry a code in `error`, never a sentence.
    [403, { error: "app_off", app: "ai" }, { error: "ai_off", text: null }],
    [403, { error: "no_access" }, { error: "refused", text: null }],
    [404, { error: "That teammate can't be found.", code: "not_found" }, { error: "gone", text: null }],
    [500, { error: "Your message couldn't be saved. Try again.", code: "not_saved" }, { error: "not_sent", text: "Your message couldn't be saved. Try again." }],
    [502, null, { error: "not_sent", text: null }],
    [401, "Unauthorized", { error: "not_sent", text: null }],
  ];
  it.each(cases)("%i %j", (status, body, want) => {
    expect(teammateSendFailure(status, body)).toEqual(want);
  });
});

describe("the error row", () => {
  it("says the server's sentence, else its own", () => {
    expect(sendErrorSentence("ai_limit", "Used up.", "Priya")).toBe("Used up.");
    expect(sendErrorSentence("not_sent", null, "Priya")).toBe(TEAMMATE_CHAT.notSent);
    expect(sendErrorSentence("stopped", null, "Priya")).toBe("The answer stopped.");
    expect(sendErrorSentence("paused", null, "Priya")).toBe("Priya is paused, so your message wasn't sent.");
    expect(sendErrorSentence("removed", null, "Priya")).toBe("Priya was removed. Its chat is kept.");
    expect(sendErrorSentence("ai_off", null, "Priya")).toBe("AI is turned off for this workspace.");
    expect(sendErrorSentence("refused", null, "Priya")).toBe(ACTION_ERRORS.personCannot);
  });
  it("offers Try again only where sending again can work", () => {
    const all: TeammateSendError[] = ["not_sent", "stopped", "ended", "ai_limit", "agent_cap", "rate_limited", "paused", "removed", "gone", "not_configured", "ai_off", "refused"];
    expect(all.filter(canRetrySend)).toEqual(["not_sent", "stopped", "rate_limited"]);
  });
});

describe("reading the chat again", () => {
  const msg = (id: string, at: string): TeammateMessageView => ({ id, kind: "user", text: id, practice: false, createdAt: at });
  it("keeps older messages already shown above a fresh newest page", () => {
    const held = { messages: [msg("o1", "2026-10-01T09:00:00.000Z"), msg("n1", "2026-10-06T09:00:00.000Z"), msg("tmp:user-3", "2026-10-06T09:05:00.000Z")], hasMore: true };
    const page = { messages: [msg("n1", "2026-10-06T09:00:00.000Z"), msg("n2", "2026-10-06T09:05:00.000Z")], hasMore: true };
    expect(mergeNewestPage(held, page)).toEqual({ messages: [held.messages[0], ...page.messages], hasMore: true });
  });
  it("takes the page's word on what is older when nothing older is held", () => {
    const page = { messages: [msg("n1", "2026-10-06T09:00:00.000Z")], hasMore: false };
    expect(mergeNewestPage({ messages: [msg("tmp:user-1", T0)], hasMore: true }, page)).toEqual({ messages: page.messages, hasMore: false });
    expect(mergeNewestPage({ messages: [msg("x", T0)], hasMore: true }, { messages: [], hasMore: false })).toEqual({ messages: [], hasMore: false });
  });
  it("puts an older page above, each message once", () => {
    const held = [msg("b", "2026-10-02T09:00:00.000Z"), msg("c", "2026-10-03T09:00:00.000Z")];
    expect(prependOlder(held, [msg("a", "2026-10-01T09:00:00.000Z"), msg("b", "2026-10-02T09:00:00.000Z")]).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
  it("reads up to the newest saved answer or report", () => {
    const report: TeammateMessageView = { id: "r1", kind: "report", text: "Done", practice: false, toolCalls: [], createdAt: T0, routine: { id: null, name: "Daily", runId: null, dueAt: null } };
    expect(lastAnswerId([liveMsg({ id: "a1", streaming: undefined }), report, line("e1"), liveMsg()])).toBe("r1");
    expect(lastAnswerId([userMsg()])).toBeNull();
  });
});

describe("a decision on the cards", () => {
  const views = {
    a1: actionViewFromRow(action({ id: "a1" })),
    a2: actionViewFromRow(action({ id: "a2" })),
    a3: actionViewFromRow(action({ id: "a3" })),
  };
  const AT = "2026-10-06T10:00:00.000Z";
  it("shows each outcome at once, and keeps a request that still waits as it was", () => {
    const out = applyDecisionResults(views, [
      { id: "a1", status: "EXECUTED", result: { text: "Posted in #general", href: "/tlk/c1" } },
      { id: "a2", status: "PENDING", code: "agent_paused", error: "Priya is paused." },
      { id: "a3", status: "FAILED", code: "failed", error: "The channel is archived." },
      { id: "gone", status: "not_found" },
    ], AT);
    expect(out.a1).toMatchObject({ status: "EXECUTED", result: { text: "Posted in #general", href: "/tlk/c1" }, decidedAt: AT, executedAt: AT, always: { allowed: false, label: null } });
    expect(out.a2).toEqual(views.a2);
    expect(out.a3).toMatchObject({ status: "FAILED", error: "The channel is archived.", decidedAt: AT, executedAt: null });
    expect(Object.keys(out)).toEqual(["a1", "a2", "a3"]);
    expect(views.a1.status).toBe("PENDING");
  });
  it("never keeps a link that leaves the app", () => {
    const out = applyDecisionResults(views, [{ id: "a1", status: "EXECUTED", result: { text: "Posted", href: "https://example.com" } }], AT);
    expect(out.a1.result).toEqual({ text: "Posted", href: null });
  });
});

describe("the card's parts", () => {
  it("cuts a long text by lines and characters, never hiding it without Show all", () => {
    expect(clipCardBody("one\ntwo")).toEqual({ text: "one\ntwo", clipped: false });
    const many = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
    const cut = clipCardBody(many);
    expect(cut.clipped).toBe(true);
    expect(cut.text.split("\n")).toHaveLength(12);
    expect(cut.text.endsWith("line 12…")).toBe(true);
    expect(clipCardBody("x".repeat(2000))).toEqual({ text: `${"x".repeat(1500)}…`, clipped: true });
  });
  it("starts an edit from the exact text, or the title's quoted subject", () => {
    expect(editStartText(actionViewFromRow(action()))).toBe("Proof hello");
    const task = actionViewFromRow(action({ toolName: "create_task", preview: { title: 'Create task "Call Acme" for Max Chen', editable: { field: "title", label: "Title", maxLength: 280 } } }));
    expect(editStartText(task)).toBe("Call Acme");
    expect(editStartText(actionViewFromRow(action({ preview: { title: "Invite lea@x.com" } })))).toBe("");
  });
  it("starts an edit from the field's own value in the input that runs, never the card's words", () => {
    // A long title: the card's title shortens it at 80 characters; the edit starts whole.
    const long = `Call Acme about the renewal and ${"the pricing ".repeat(10)}`.trim();
    const task = actionViewFromRow(action({
      toolName: "create_task",
      input: { title: long, assigneeEmail: "max@x.com" },
      preview: { title: `Create task "${long.slice(0, 79)}…" for Max Chen`, editable: { field: "title", label: "Title", maxLength: 280 } },
    }));
    expect(task.editableValue).toBe(long);
    expect(editStartText(task)).toBe(long);
    // A doc section: the card's body shows the heading above the text; only the text is the field.
    const doc = actionViewFromRow(action({
      toolName: "update_doc",
      input: { docId: "d1", heading: "Weekly status", text: "All green." },
      preview: { title: 'Add to "Plan"', body: "Weekly status\n\nAll green.", editable: { field: "text", label: "Text", maxLength: 8000 } },
    }));
    expect(doc.editableValue).toBe("All green.");
    expect(editStartText(doc)).toBe("All green.");
  });
  it("reads the person's edit once there is one, a string only, cut to the field's length", () => {
    expect(actionViewFromRow(action({ input: { conversationId: "c1", text: "First" }, editedInput: { conversationId: "c1", text: "Edited" } })).editableValue).toBe("Edited");
    expect(actionViewFromRow(action({ input: { conversationId: "c1", text: "y".repeat(5000) } })).editableValue).toBe("y".repeat(3000));
    // Never half a character: an emoji across the limit is left out whole.
    expect(actionViewFromRow(action({ input: { text: `${"y".repeat(2999)}\u{1F600}` } })).editableValue).toBe("y".repeat(2999));
    expect(actionViewFromRow(action({ input: { text: 42 } })).editableValue).toBeNull();
    expect(actionViewFromRow(action({ input: "text" })).editableValue).toBeNull();
    expect(actionViewFromRow(action()).editableValue).toBeNull();
    // A tool with no editable field, and a tool this code does not know.
    expect(actionViewFromRow(action({ toolName: "invite_person_with_role", input: { email: "lea@x.com", text: "x" } })).editableValue).toBeNull();
    expect(actionViewFromRow(action({ toolName: "not_a_tool", input: { text: "x" } })).editableValue).toBeNull();
  });
  it("words each decided card's line", () => {
    const words = { time: "10:42", date: "13 Oct", agentName: "Priya" };
    const with_ = (over: Partial<AgentActionRow>) => decidedLine(actionViewFromRow(action(over)), words);
    expect(with_({ status: "EXECUTED" })).toBe("Approved · 10:42");
    expect(with_({ status: "DENIED" })).toBe("Denied · 10:42");
    expect(with_({ status: "EXPIRED" })).toBe("Expired · 13 Oct. Ask Priya again if you still want this.");
    expect(with_({ status: "FAILED", error: ACTION_ERRORS.unconfirmed })).toBe("Couldn't confirm it finished. Check #general before asking again.");
    expect(with_({ status: "FAILED", error: "The channel is archived." })).toBe("Didn't work: The channel is archived.");
    expect(with_({ status: "FAILED" })).toBe("Didn't work: Post in #general.");
    expect(with_({ status: "CANCELLED", error: "Cancelled: Priya can no longer use this tool." })).toBe("Cancelled: Priya can no longer use this tool.");
    expect(with_({ status: "CANCELLED" })).toBe("Cancelled: Priya was removed.");
    expect(with_({ status: "PENDING" })).toBeNull();
    expect(with_({ status: "RUNNING" })).toBeNull();
  });
});

describe("a request on the Activity tab", () => {
  const view = (over: Partial<AgentActionRow>) => activityActionView(actionViewFromRow(action(over)), "status-reporter");
  it("opens a request's card in the chat, with the card's own chip", () => {
    expect(view({ status: "EXECUTED", decidedVia: "person" })).toEqual({ chip: null, href: "/agents?chat=status-reporter&action=a1" });
    expect(view({ status: "PENDING" })).toEqual({ chip: null, href: "/agents?chat=status-reporter&action=a1" });
  });
  it("never calls a call the person's Don't ask let run Approved, nor sends it to a card it never had", () => {
    expect(view({ status: "EXECUTED", decidedVia: "rule", groupKey: "run7:post_in_talk" })).toEqual({
      chip: { label: "Ran without asking", tone: "success" },
      href: "/agents?tab=runs&agent=status-reporter&run=run7",
    });
    expect(view({ status: "RUNNING", decidedVia: "rule", groupKey: "run7:post_in_talk" }).chip).toEqual({ label: "Running", tone: "info" });
    // One that failed keeps the card's "Didn't work", and still opens its run.
    expect(view({ status: "FAILED", decidedVia: "rule", groupKey: "run7:post_in_talk" })).toEqual({ chip: null, href: "/agents?tab=runs&agent=status-reporter&run=run7" });
  });
  it("opens the chat when the run can't be read from the groupKey", () => {
    for (const groupKey of [null, "", "post_in_talk", ":post_in_talk"]) {
      expect(view({ status: "EXECUTED", decidedVia: "rule", groupKey }).href).toBe("/agents?chat=status-reporter");
    }
  });
});

describe("replies across pages (orderReplies in mergeNewestPage and prependOlder)", () => {
  const at = "2026-10-07T10:00:00.000Z";
  const u = (id: string) => ({ id, kind: "user" as const, text: id, practice: false, createdAt: at });
  const a = (id: string, replyTo: string) => ({ id, kind: "agent" as const, text: id, practice: false, toolCalls: [], replyTo, createdAt: at });
  it("puts a late answer under its message when that message is on an older page", () => {
    // Server order: q1, q2, a2, a1 (a1 saved last). The newest page starts at q2.
    const out = prependOlder([u("q2"), a("a2", "q2"), a("a1", "q1")], [u("q1")]);
    expect(out.map((m) => m.id)).toEqual(["q1", "a1", "q2", "a2"]);
  });
  it("keeps a reply under a message held from an older read when the newest page no longer holds it", () => {
    const held = { messages: [u("q1"), a("a1", "q1"), u("q2")], hasMore: false };
    const page = { messages: [u("q2"), a("a2", "q2"), a("a1", "q1")], hasMore: true };
    expect(mergeNewestPage(held, page).messages.map((m) => m.id)).toEqual(["q1", "a1", "q2", "a2"]);
  });
});
