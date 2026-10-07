import { describe, expect, it } from "vitest";
import { CROSS_TOOL_NAMES, PPMS_TOOL_NAMES, PRODUCT_TOOL_NAMES, TEAMMATE_TOOL_NAMES, isTeammateToolName, isToolName } from "./tool-names";
import { TOOL_VERBS, toolOutcome, toolOutcomeSentence, toolSentence, toolSubject } from "./tool-verbs";

const RETIRED = [
  "create_lead", "create_opportunity", "create_ticket", "create_support_ticket", "create_campaign",
  "search_leads", "search_opportunities", "search_tickets", "update_lead_status", "update_ticket_status",
  "move_opportunity_stage", "apply_macro", "search_kb", "assign_ticket",
];

describe("the Ask AI tool set", () => {
  it("is the 28 PPMS tools and none of the 14 retired verbs", () => {
    expect(PPMS_TOOL_NAMES).toHaveLength(28);
    expect(new Set(PPMS_TOOL_NAMES).size).toBe(28);
    for (const gone of RETIRED) expect(isToolName(gone)).toBe(false);
  });

  it("has a sentence for every tool and nothing else", () => {
    expect(Object.keys(TOOL_VERBS).sort()).toEqual([...PPMS_TOOL_NAMES, ...TEAMMATE_TOOL_NAMES].sort());
    for (const v of Object.values(TOOL_VERBS)) {
      expect(v.done).not.toMatch(/[_\u2014]|--/);
      expect(v.failed).toMatch(/^Couldn't /);
    }
  });
});

describe("the AI teammate tools", () => {
  it("are eleven (ask_teammate came with Phase 2), apart from the Ask AI names, and in no Ask AI set", () => {
    expect(TEAMMATE_TOOL_NAMES).toHaveLength(11);
    for (const t of TEAMMATE_TOOL_NAMES) {
      expect(isToolName(t)).toBe(true);
      expect(isTeammateToolName(t)).toBe(true);
      expect(PPMS_TOOL_NAMES as readonly string[]).not.toContain(t);
      expect(CROSS_TOOL_NAMES as string[]).not.toContain(t);
      for (const set of Object.values(PRODUCT_TOOL_NAMES)) expect(set as string[]).not.toContain(t);
    }
    expect(isTeammateToolName("create_task")).toBe(false);
  });

  it("read as the spec's sentences", () => {
    expect(toolSentence("update_task", { taskId: "t1" })).toEqual({ concept: "task", text: "Updated task" });
    expect(toolSentence("comment_on_task", { taskId: "t1", text: "On it" })).toEqual({ concept: "comment", text: "Commented on task" });
    expect(toolSentence("post_in_talk", { channel: "#general", text: "Hi" })).toEqual({ concept: "talk", text: "Posted in Talk" });
    expect(toolSentence("post_in_talk", {}, true).text).toBe("Couldn't post in Talk");
    expect(toolSentence("remember", { key: "report day", value: "Monday" })).toEqual({ concept: "memory", text: 'Remembered "report day"' });
    expect(toolSentence("forget", { key: "report day" }).text).toBe('Forgot "report day"');
    expect(toolSentence("create_routine", { name: "Daily brief" })).toEqual({ concept: "routine", text: 'Created routine "Daily brief"' });
    expect(toolSentence("list_my_inbox", {})).toEqual({ concept: "inbox", text: "Checked your Inbox" });
    expect(toolSentence("update_doc", { docId: "d1", text: "x" }, true).text).toBe("Couldn't add to the doc");
    expect(toolSentence("move_task", { taskId: "t1" }).text).toBe("Moved task");
  });

  it("count what they read", () => {
    expect(toolOutcomeSentence("read_talk", {}, toolOutcome("read_talk", { count: 12, conversations: [] })).text).toBe("Read 12 messages");
    expect(toolOutcomeSentence("read_talk", {}, toolOutcome("read_talk", { count: 1, conversations: [] })).text).toBe("Read 1 message");
    expect(toolOutcomeSentence("list_my_inbox", {}, toolOutcome("list_my_inbox", { count: 3, notifications: [] })).text).toBe("Checked 3 of your notifications");
  });

  it("link the task or doc they changed", () => {
    expect(toolOutcome("update_task", { ok: true, task: { id: "t1" } }).href).toBe("/item/t1");
    expect(toolOutcome("comment_on_task", { ok: true, task: { id: "t2" }, comment: { id: "c1" } }).href).toBe("/item/t2");
    expect(toolOutcome("move_task", { ok: true, task: { id: "t3" }, moved: { toListName: "Backlog" } }).href).toBe("/item/t3");
    expect(toolOutcome("update_doc", { ok: true, doc: { id: "d1" }, version: 4 }).href).toBe("/work/docs/d1");
  });
});

describe("a call that did not run never reads as done", () => {
  it("waiting for approval", () => {
    const o = toolOutcome("post_in_talk", { status: "waiting_for_approval", actionId: "a1", title: "Post in #general" });
    expect(o).toMatchObject({ failed: false, state: "waiting", title: "Post in #general", href: null, count: null });
    const s = toolOutcomeSentence("post_in_talk", { channel: "#general" }, o);
    expect(s).toEqual({ concept: "talk", text: "Waiting for your approval: Post in #general" });
    expect(s.text).not.toContain(TOOL_VERBS.post_in_talk.done);
  });

  it("a practice run", () => {
    const o = toolOutcome("post_in_talk", { practice: true, wouldDo: "Post in #proof" });
    expect(o).toMatchObject({ failed: false, state: "practice", title: "Post in #proof", href: null });
    expect(toolOutcomeSentence("post_in_talk", {}, o).text).toBe("Would post in #proof");
    // A practice create links nowhere, even with an id-shaped answer.
    const created = toolOutcome("create_task", { practice: true, wouldDo: 'Create task "Call Acme"', task: { id: "t1" } });
    expect(created.href).toBeNull();
    expect(toolOutcomeSentence("create_task", { title: "Call Acme" }, created).text).toBe('Would create task "Call Acme"');
  });

  it("without the server's title, says the tool's imperative, never its past tense", () => {
    expect(toolOutcomeSentence("post_in_talk", {}, toolOutcome("post_in_talk", { status: "waiting_for_approval" })).text).toBe("Waiting for your approval: Post in Talk");
    expect(toolOutcomeSentence("send_kudos", {}, toolOutcome("send_kudos", { practice: true })).text).toBe("Would send kudos");
  });

  it("a failure still wins over either state", () => {
    expect(toolOutcome("post_in_talk", { status: "waiting_for_approval", title: "x" }, "timeout")).toMatchObject({ failed: true, message: "timeout" });
    expect(toolOutcome("post_in_talk", { practice: true, error: "Talk is off in this workspace." })).toMatchObject({ failed: true });
  });

  it("a call that ran has no state", () => {
    expect(toolOutcome("create_task", { ok: true, task: { id: "t1" } }).state).toBeUndefined();
  });
});

describe("toolSentence", () => {
  it("names the subject from the call's input", () => {
    expect(toolSentence("create_task", { title: "Fix invoice PDF" })).toEqual({ concept: "task", text: 'Created task "Fix invoice PDF"' });
    expect(toolSentence("search_tasks", {}).text).toBe("Searched tasks");
  });

  it("reads a failure as a Couldn't sentence", () => {
    expect(toolSentence("create_task", { title: "x" }, true).text).toBe("Couldn't create the task");
  });

  it("never prints a retired tool's code name", () => {
    expect(toolSentence("create_lead", { name: "Acme" }).text).toBe("Used an older action");
  });

  it("takes the first string subject key", () => {
    expect(toolSubject({ query: "  q3 plan " })).toBe("q3 plan");
    expect(toolSubject({ limit: 3 })).toBeNull();
    expect(toolSubject(null)).toBeNull();
  });
});

describe("toolOutcome", () => {
  it("links a created task and a created doc", () => {
    expect(toolOutcome("create_task", { ok: true, task: { id: "t1", title: "x" } }).href).toBe("/item/t1");
    // Opened from the AI hub, a doc takes its Work door (main's open-in-place:
    // every hub but the Docs and Tables browsers), placed for whoever opens it.
    expect(toolOutcome("create_doc", { ok: true, doc: { id: "d1" } }).href).toBe("/work/docs/d1");
    expect(toolOutcome("send_kudos", { ok: true }).href).toBeNull();
  });
  it("reads a failure from the error text or the tool's own { error }", () => {
    expect(toolOutcome("create_task", { error: "No user with that email" })).toMatchObject({ failed: true, message: "No user with that email" });
    expect(toolOutcome("create_task", null, "timeout")).toMatchObject({ failed: true, message: "timeout" });
  });
  it("counts a search", () => {
    const o = toolOutcome("search_tasks", { count: 42, tasks: [] });
    expect(o.count).toBe(42);
    expect(toolOutcomeSentence("search_tasks", {}, o).text).toBe("Searched 42 tasks");
    expect(toolOutcomeSentence("list_forms", {}, toolOutcome("list_forms", { forms: [{}] })).text).toBe("Looked up 1 form");
    expect(toolOutcomeSentence("list_my_sops", {}, toolOutcome("list_my_sops", { sops: [{}, {}, {}] })).text).toBe("Looked up 3 of your SOPs");
    expect(toolOutcomeSentence("search_employees", {}, toolOutcome("search_employees", { count: 1 })).text).toBe("Searched 1 person");
  });

  it("a search cut short at its cap says how far it read, so a 0 never reads as none", () => {
    const cut = toolOutcome("search_tasks", { count: 0, tasks: [], partial: true, searched: 1000, note: "Only the 1,000 most recently updated tasks were searched." });
    expect(cut.searched).toBe(1000);
    expect(toolOutcomeSentence("search_tasks", {}, cut).text).toBe("Searched the 1,000 most recently updated tasks, found 0");
    const forms = toolOutcome("list_forms", { forms: [{}, {}], partial: true, searched: 2000 });
    expect(toolOutcomeSentence("list_forms", {}, forms).text).toBe("Looked up the 2,000 most recently updated forms, found 2");
    expect(toolOutcome("search_tasks", { count: 3, tasks: [] }).searched).toBeNull();
  });
  it("keeps the plain sentence when nothing is known", () => {
    expect(toolOutcomeSentence("create_task", { title: "A" }, toolOutcome("create_task", undefined)).text).toBe('Created task "A"');
    expect(toolOutcomeSentence("create_task", { title: "A" }, toolOutcome("create_task", { error: "x" })).text).toBe("Couldn't create the task");
  });
});

describe("the subject a sentence names", () => {
  it("never ends on half an emoji, which a JSON column refuses (review round 1)", () => {
    const title = `${"a".repeat(79)}\u{1F389} launch`;
    const subject = toolSubject({ title }) ?? "";
    expect(subject).toBe("a".repeat(79));
    expect(/[\uD800-\uDBFF]$/.test(subject)).toBe(false);
    const sentence = toolOutcomeSentence("create_task", { title }, toolOutcome("create_task", { ok: true, task: { id: "t1", title } })).text;
    expect(() => JSON.parse(JSON.stringify({ sentence }))).not.toThrow();
    expect(JSON.stringify({ sentence })).not.toMatch(/\\ud83c(?!\\udf89)/i);
  });
});


describe("ask_teammate's sentence (Phase 2)", () => {
  it("names the teammate it asked", () => {
    expect(toolSentence("ask_teammate", { teammate: "Project Manager", request: "Which tasks are stuck?" })).toEqual({ concept: "teammate", text: 'Asked "Project Manager"' });
  });
});
