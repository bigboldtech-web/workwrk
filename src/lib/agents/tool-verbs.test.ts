import { describe, expect, it } from "vitest";
import { PPMS_TOOL_NAMES, isToolName } from "./tool-names";
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
    expect(Object.keys(TOOL_VERBS).sort()).toEqual([...PPMS_TOOL_NAMES].sort());
    for (const v of Object.values(TOOL_VERBS)) {
      expect(v.done).not.toMatch(/[_\u2014]|--/);
      expect(v.failed).toMatch(/^Couldn't /);
    }
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
    expect(toolOutcome("create_doc", { ok: true, doc: { id: "d1" } }).href).toBe("/docs/d1");
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
  it("keeps the plain sentence when nothing is known", () => {
    expect(toolOutcomeSentence("create_task", { title: "A" }, toolOutcome("create_task", undefined)).text).toBe('Created task "A"');
    expect(toolOutcomeSentence("create_task", { title: "A" }, toolOutcome("create_task", { error: "x" })).text).toBe("Couldn't create the task");
  });
});
