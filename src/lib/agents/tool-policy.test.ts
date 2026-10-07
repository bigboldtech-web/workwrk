// The approval policy (src/lib/agents/tool-policy.ts): every tool has a
// class, reads never ask, what cannot be taken back always asks, managers
// only tighten, and "Don't ask" is the acting person's own choice, for Talk
// only per conversation.

import { describe, expect, it } from "vitest";
import {
  ACTION_TTL_MS,
  MAX_DELEGATIONS_PER_TURN,
  honoursDontAsk,
  toolsForTrigger,
  ALWAYS_ASK,
  BASE_RISK,
  EDITABLE_FIELD,
  MAX_PENDING_PER_PERSON,
  MAX_PROPOSALS_PER_TURN,
  MAX_TOOL_CALLS_PER_TURN,
  TARGET_SCOPED_ALWAYS,
  TEAMMATE_EXCLUDED,
  alwaysKeyFor,
  canAlwaysAllow,
  effectiveRisk,
  gateFor,
  isToolRisk,
  sanitizeRules,
  type ApprovalRules,
  type ToolRisk,
} from "./tool-policy";
import { PPMS_TOOL_NAMES, TEAMMATE_TOOL_NAMES, type ToolName } from "./tool-names";

const ALL: ToolName[] = [...PPMS_TOOL_NAMES, ...TEAMMATE_TOOL_NAMES];

const gate = (tool: ToolName, risk: ToolRisk, o: { targetKey?: string | null; agentRules?: ApprovalRules; personRules?: ApprovalRules } = {}) =>
  gateFor({ tool, risk, targetKey: o.targetKey ?? null, agentRules: o.agentRules ?? {}, personRules: o.personRules ?? {} });

describe("every tool has a class", () => {
  it("the record names every tool and nothing else, each with a real class", () => {
    expect(Object.keys(BASE_RISK).sort()).toEqual([...ALL].sort());
    for (const t of ALL) expect(isToolRisk(BASE_RISK[t]), t).toBe(true);
  });

  it("matches the 3.3 table", () => {
    const by = (risk: ToolRisk) => ALL.filter((t) => BASE_RISK[t] === risk).sort();
    expect(by("IRREVERSIBLE")).toEqual(["invite_person_with_role"]);
    // A new doc, form or table is open to every member: making one is outward (review round 1).
    expect(by("OUTWARD")).toEqual(["create_data_table", "create_doc", "create_form", "create_kpi", "create_kra", "move_task", "post_in_talk", "send_kudos", "update_contract"]);
    expect(by("READ")).toEqual([
      // ask_teammate never asks itself: what the teammate it asks would do asks for itself (Phase 2).
      "ask_teammate", "get_team_alignment_rollup", "list_data_tables", "list_forms", "list_my_inbox", "list_my_kpi_status", "list_my_kras",
      "list_my_sops", "list_my_weekly_reviews", "read_talk", "search_contracts", "search_employees", "search_meetings",
      "search_okrs", "search_sops", "search_tasks",
    ]);
    expect(by("INTERNAL")).toHaveLength(ALL.length - 16 - 9 - 1);
  });

  it("an escalation never lowers a class, and an unknown tool is the strictest", () => {
    expect(effectiveRisk("send_kudos", "READ")).toBe("OUTWARD");
    expect(effectiveRisk("create_task", "OUTWARD")).toBe("OUTWARD");
    expect(effectiveRisk("not_a_tool", "READ")).toBe("IRREVERSIBLE");
  });
});

describe("gateFor", () => {
  it("reads run whatever is stored", () => {
    expect(gate("search_tasks", "READ")).toBe("run");
    expect(gate("read_talk", "READ", { agentRules: { read_talk: "ask" }, personRules: { read_talk: "ask" } })).toBe("run");
  });

  it("INTERNAL runs unless someone asked to be asked", () => {
    expect(gate("create_sop", "INTERNAL")).toBe("run");
    expect(gate("create_sop", "INTERNAL", { personRules: { create_sop: "ask" } })).toBe("ask");
    expect(gate("create_sop", "INTERNAL", { agentRules: { create_sop: "ask" } })).toBe("ask");
    expect(gate("create_sop", "INTERNAL", { personRules: { create_sop: "always" } })).toBe("run");
  });

  it("OUTWARD asks unless the person chose Don't ask", () => {
    expect(gate("send_kudos", "OUTWARD")).toBe("ask");
    expect(gate("send_kudos", "OUTWARD", { personRules: { send_kudos: "always" } })).toBe("run");
    expect(gate("send_kudos", "OUTWARD", { personRules: { send_kudos: "ask" } })).toBe("ask");
  });

  it("an escalated call asks by default; only the person's choice for such calls answers it", () => {
    expect(gate("create_task", "OUTWARD")).toBe("ask");
    expect(gate("update_task", "OUTWARD", { personRules: { update_task: "always" } })).toBe("ask");
    expect(gate("update_task", "OUTWARD", { personRules: { "update_task:outward": "always" } })).toBe("run");
  });

  it("a class passed below the tool's own is never honoured", () => {
    expect(gate("send_kudos", "READ")).toBe("ask");
    expect(gate("post_in_talk", "INTERNAL")).toBe("ask");
  });

  it("IRREVERSIBLE and invite_person_with_role ask even with always stored", () => {
    expect(gate("invite_person_with_role", "IRREVERSIBLE")).toBe("ask");
    expect(gate("invite_person_with_role", "IRREVERSIBLE", { personRules: { invite_person_with_role: "always" } })).toBe("ask");
    expect(gate("invite_person_with_role", "OUTWARD", { personRules: { invite_person_with_role: "always" } })).toBe("ask");
    expect(ALWAYS_ASK.has("invite_person_with_role")).toBe(true);
  });

  it("agent rules only tighten: a manager's ask beats the person's always, and the agent level cannot loosen", () => {
    expect(gate("send_kudos", "OUTWARD", { agentRules: { send_kudos: "ask" }, personRules: { send_kudos: "always" } })).toBe("ask");
    expect(gate("send_kudos", "OUTWARD", { agentRules: { send_kudos: "always" } })).toBe("ask");
    expect(gate("create_sop", "INTERNAL", { agentRules: { create_sop: "always" }, personRules: { create_sop: "ask" } })).toBe("ask");
  });

  it("post_in_talk: a tool-wide always is ignored, a conversation's is honoured for that conversation only", () => {
    expect(TARGET_SCOPED_ALWAYS.has("post_in_talk")).toBe(true);
    expect(gate("post_in_talk", "OUTWARD", { targetKey: "conv:c1", personRules: { post_in_talk: "always" } })).toBe("ask");
    expect(gate("post_in_talk", "OUTWARD", { targetKey: "conv:c1", personRules: { "post_in_talk:conv:c1": "always" } })).toBe("run");
    expect(gate("post_in_talk", "OUTWARD", { targetKey: "conv:c2", personRules: { "post_in_talk:conv:c1": "always" } })).toBe("ask");
    expect(gate("post_in_talk", "OUTWARD", { targetKey: null, personRules: { "post_in_talk:conv:c1": "always" } })).toBe("ask");
    expect(gate("post_in_talk", "OUTWARD", { targetKey: "conv:c1", agentRules: { post_in_talk: "ask" }, personRules: { "post_in_talk:conv:c1": "always" } })).toBe("ask");
  });

  it("a rule counts only as the object's own key", () => {
    const inherited = Object.create({ send_kudos: "always" }) as ApprovalRules;
    expect(gate("send_kudos", "OUTWARD", { personRules: inherited })).toBe("ask");
    expect(gate("send_kudos", "OUTWARD", { personRules: { send_kudos: "maybe" as never } })).toBe("ask");
  });
});

describe("canAlwaysAllow and alwaysKeyFor", () => {
  it("never for what cannot be taken back; Talk only with its conversation", () => {
    expect(canAlwaysAllow("invite_person_with_role", "IRREVERSIBLE", null)).toBe(false);
    expect(canAlwaysAllow("send_kudos", "IRREVERSIBLE", null)).toBe(false);
    expect(canAlwaysAllow("post_in_talk", "OUTWARD", null)).toBe(false);
    expect(canAlwaysAllow("post_in_talk", "OUTWARD", "conv:c1")).toBe(true);
    expect(canAlwaysAllow("send_kudos", "OUTWARD", null)).toBe(true);
    expect(canAlwaysAllow("create_task", "OUTWARD", null)).toBe(true);
  });

  it("keeps a tool's own-class Don't ask from covering its calls for other people", () => {
    // Before: "Don't ask" for making your own tasks also made tasks on
    // someone else's Personal list without asking.
    expect(gate("create_task", "OUTWARD", { personRules: { create_task: "always" } })).toBe("ask");
    expect(gate("comment_on_task", "OUTWARD", { personRules: { comment_on_task: "always" } })).toBe("ask");
    // Its own class still follows the tool-wide choice.
    expect(gate("create_task", "INTERNAL", { personRules: { create_task: "always" } })).toBe("run");
    expect(gate("create_task", "INTERNAL", { personRules: { create_task: "ask" } })).toBe("ask");
    // The escalated calls have their own choice, made from an escalated call's card.
    expect(gate("create_task", "OUTWARD", { personRules: { "create_task:outward": "always" } })).toBe("run");
    expect(gate("create_task", "INTERNAL", { personRules: { "create_task:outward": "always" } })).toBe("run");
    // A manager's ask still wins, and an invitation never runs unasked.
    expect(gate("create_task", "OUTWARD", { agentRules: { create_task: "ask" }, personRules: { "create_task:outward": "always" } })).toBe("ask");
    expect(gate("create_task", "IRREVERSIBLE", { personRules: { "create_task:outward": "always" } })).toBe("ask");
  });

  it("stores an escalated call's choice under its own key", () => {
    expect(alwaysKeyFor("create_task", "OUTWARD", null)).toBe("create_task:outward");
    expect(alwaysKeyFor("update_task", "OUTWARD", null)).toBe("update_task:outward");
    expect(alwaysKeyFor("create_task", "INTERNAL", null)).toBe("create_task");
    expect(sanitizeRules({ "create_task:outward": "always", "update_task:outward": "ask" }, { level: "person", allowedTools: ALL })).toEqual({ "create_task:outward": "always", "update_task:outward": "ask" });
    // Never a manager's, never for a tool that is OUTWARD to begin with.
    expect(sanitizeRules({ "create_task:outward": "ask" }, { level: "agent", allowedTools: ALL })).toEqual({});
    expect(sanitizeRules({ "send_kudos:outward": "always", "invite_person_with_role:outward": "always" }, { level: "person", allowedTools: ALL })).toEqual({});
  });

  it("names the rule the card would store", () => {
    expect(alwaysKeyFor("post_in_talk", "OUTWARD", "conv:c1")).toBe("post_in_talk:conv:c1");
    expect(alwaysKeyFor("send_kudos", "OUTWARD", null)).toBe("send_kudos");
    expect(alwaysKeyFor("invite_person_with_role", "IRREVERSIBLE", null)).toBeNull();
    expect(alwaysKeyFor("post_in_talk", "OUTWARD", null)).toBeNull();
  });
});

describe("sanitizeRules", () => {
  const allowed = ALL;

  it("drops unknown tools, tools the teammate does not have, and any value but ask or always", () => {
    expect(sanitizeRules({ not_a_tool: "ask", send_kudos: "never", create_sop: true, update_task: "always" }, { level: "person", allowedTools: allowed })).toEqual({ update_task: "always" });
    expect(sanitizeRules({ send_kudos: "always" }, { level: "person", allowedTools: ["create_sop"] })).toEqual({});
  });

  it("keeps only tool-wide ask at the agent level", () => {
    expect(sanitizeRules({ send_kudos: "always", create_sop: "ask", "post_in_talk:conv:c1": "ask" }, { level: "agent", allowedTools: allowed })).toEqual({ create_sop: "ask" });
  });

  it("drops an always the policy would never honour, and Talk's tool-wide keys, at the person level", () => {
    const r = sanitizeRules(
      {
        invite_person_with_role: "always",
        post_in_talk: "always",
        "post_in_talk:conv:c1": "always",
        "post_in_talk:conv:": "always",
        "post_in_talk:conv:bad id": "always",
        "send_kudos:conv:c1": "always",
        send_kudos: "always",
      },
      { level: "person", allowedTools: allowed },
    );
    expect(r).toEqual({ "post_in_talk:conv:c1": "always", send_kudos: "always" });
    expect(sanitizeRules({ invite_person_with_role: "ask" }, { level: "person", allowedTools: allowed })).toEqual({ invite_person_with_role: "ask" });
  });

  it("reads anything that is not an object as no rules, and keeps at most 200", () => {
    expect(sanitizeRules(null, { level: "person", allowedTools: allowed })).toEqual({});
    expect(sanitizeRules(["ask"], { level: "person", allowedTools: allowed })).toEqual({});
    expect(sanitizeRules("always", { level: "person", allowedTools: allowed })).toEqual({});
    const many: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) many[`post_in_talk:conv:c${i}`] = "always";
    expect(Object.keys(sanitizeRules(many, { level: "person", allowedTools: allowed }))).toHaveLength(200);
  });
});

describe("the limits and the lists", () => {
  it("are the spec's numbers", () => {
    expect(ACTION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(MAX_PROPOSALS_PER_TURN).toBe(50);
    expect(MAX_PENDING_PER_PERSON).toBe(100);
    expect(MAX_TOOL_CALLS_PER_TURN).toBe(30);
  });

  it("keeps the routeless Contract and Sprint tools from every teammate", () => {
    expect([...TEAMMATE_EXCLUDED].sort()).toEqual(["create_contract", "create_sprint", "update_contract"]);
  });

  it("gives an edit field exactly to the tools the 3.3 table names, each with a label and a length", () => {
    expect(Object.keys(EDITABLE_FIELD).sort()).toEqual(["comment_on_task", "create_meeting", "create_okr", "create_task", "post_in_talk", "send_kudos", "update_doc"]);
    for (const f of Object.values(EDITABLE_FIELD)) {
      expect(f?.label.trim()).not.toBe("");
      expect(f?.maxLength).toBeGreaterThan(0);
    }
    expect(EDITABLE_FIELD.post_in_talk?.field).toBe("text");
    expect(EDITABLE_FIELD.send_kudos?.field).toBe("message");
  });
});

describe("what a turn is offered, by what started it (Phase 2)", () => {
  const ALL_TEAMMATE: ToolName[] = ["search_tasks", "post_in_talk", "remember", "forget", "create_routine", "ask_teammate", "read_talk", "list_my_inbox"];
  it("keeps everything in the person's own chats", () => {
    expect(toolsForTrigger(ALL_TEAMMATE, "CHAT")).toEqual(ALL_TEAMMATE);
    expect(toolsForTrigger(ALL_TEAMMATE, "RESUME")).toEqual(ALL_TEAMMATE);
  });
  it("never lets a routine ask another teammate", () => {
    expect(toolsForTrigger(ALL_TEAMMATE, "ROUTINE")).toEqual(ALL_TEAMMATE.filter((t) => t !== "ask_teammate"));
  });
  it("gives a delegated turn none of the watched-only tools, and nobody else's words (review of step 5)", () => {
    expect(toolsForTrigger(ALL_TEAMMATE, "DELEGATED")).toEqual(["search_tasks", "post_in_talk"]);
  });
  it("gives a Talk or automation turn nobody else's words either", () => {
    expect(toolsForTrigger(ALL_TEAMMATE, "TALK")).toEqual(["search_tasks", "post_in_talk"]);
    expect(toolsForTrigger(ALL_TEAMMATE, "AUTOMATION")).toEqual(["search_tasks", "post_in_talk"]);
  });
  it("reads none of the person's private records where the answer goes out with no card (review round 1)", () => {
    const withRecords: ToolName[] = ["search_tasks", "list_my_kras", "list_my_kpi_status", "list_my_weekly_reviews", "get_team_alignment_rollup", "search_contracts", "search_employees"];
    expect(toolsForTrigger(withRecords, "TALK")).toEqual(["search_tasks", "search_employees"]);
    expect(toolsForTrigger(withRecords, "AUTOMATION")).toEqual(["search_tasks", "search_employees"]);
    // A delegated answer comes back to the person's own chat first.
    expect(toolsForTrigger(withRecords, "DELEGATED")).toEqual(withRecords);
    expect(toolsForTrigger(withRecords, "CHAT")).toEqual(withRecords);
  });
  it("honours the person's Don't ask only where they watch, and in their routines", () => {
    expect(["CHAT", "RESUME", "ROUTINE", "DELEGATED", "TALK", "AUTOMATION"].map((t) => honoursDontAsk(t as never))).toEqual([true, true, true, false, false, false]);
    expect(BASE_RISK.ask_teammate).toBe("READ");
    expect(MAX_DELEGATIONS_PER_TURN).toBe(3);
  });
});
