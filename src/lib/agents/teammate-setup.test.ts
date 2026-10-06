// Making a teammate and setting one up (teammate-setup.ts, docs/plans/ai-
// teammates.md 5.5): the picker's four groups and what each row offers; the
// tab's rows read the policy as the route's table does, managers alone tick
// tools and ask everyone first, and a "Don't ask" for one conversation or for
// calls other people will see is listed with a Remove and never offered; the
// edits each control sends; and the new teammate form's start, checks and
// request.

import { describe, expect, it } from "vitest";
import {
  TOOL_GROUPS,
  agentRulesWith,
  choiceEdit,
  defaultChoice,
  draftChanged,
  draftFromTemplate,
  draftProblems,
  draftToolGroups,
  instructionsFormOf,
  instructionsPatch,
  monthlyLimitFrom,
  moduleNote,
  newTeammateBody,
  ruleRemoval,
  settingsToolGroups,
  toolGroupOf,
  toolNamesWith,
  type TeammateDraft,
  type ToolPickerGroup,
  type ToolPickerRow,
} from "./teammate-setup";
import { GIVABLE_TOOLS, toolSettings } from "./teammate-views";
import { templateCards } from "./templates";
import { BASE_RISK } from "./tool-policy";
import type { ToolName } from "./tool-names";

const ALL_ON = { talkOn: true, tablesOn: true };

function rowOf(groups: readonly ToolPickerGroup[], name: string): ToolPickerRow | undefined {
  for (const g of groups) for (const r of g.rows) if (r.name === name) return r;
  return undefined;
}

function groupOf(groups: readonly ToolPickerGroup[], name: string): string | undefined {
  return groups.find((g) => g.rows.some((r) => r.name === name))?.key;
}

describe("the picker's groups", () => {
  it("are the four the spec names, by each tool's own class, in order", () => {
    expect(TOOL_GROUPS.map((g) => g.label)).toEqual(["Look things up", "Make and change your own work", "Things other people will see", "Always asks first"]);
    expect(["READ", "INTERNAL", "OUTWARD", "IRREVERSIBLE"].map((r) => toolGroupOf(r as never))).toEqual(["look_up", "own_work", "others_see", "always_asks"]);
  });

  it("hold every tool a teammate may be given, each once", () => {
    const groups = draftToolGroups({ tools: [], choices: {} }, ALL_ON);
    const names = groups.flatMap((g) => g.rows.map((r) => r.name));
    expect([...names].sort()).toEqual([...GIVABLE_TOOLS].sort());
    expect(groups.map((g) => g.key)).toEqual(["look_up", "own_work", "others_see", "always_asks"]);
    expect(groupOf(groups, "search_tasks")).toBe("look_up");
    expect(groupOf(groups, "create_task")).toBe("own_work");
    expect(groupOf(groups, "post_in_talk")).toBe("others_see");
    expect(groupOf(groups, "invite_person_with_role")).toBe("always_asks");
    expect(rowOf(groups, "create_contract")).toBeUndefined();
  });
});

describe("a row in the new teammate form", () => {
  const groups = draftToolGroups({ tools: ["search_tasks", "create_task", "send_kudos", "post_in_talk", "read_talk"], choices: { send_kudos: "always", create_task: "ask" } }, { talkOn: false, tablesOn: true });

  it("offers reads nothing, and the choice to the rest by the person's own pick or the class default", () => {
    expect(rowOf(groups, "search_tasks")).toMatchObject({ on: true, approval: { kind: "never_asks" } });
    expect(rowOf(groups, "create_task")).toMatchObject({ on: true, approval: { kind: "choice", value: "ask", held: false }, description: "Asks first when it is for someone else." });
    expect(rowOf(groups, "update_task")).toMatchObject({ on: false, approval: { kind: "choice", value: "always" } });
    expect(rowOf(groups, "send_kudos")).toMatchObject({ approval: { kind: "choice", value: "always" } });
    expect(rowOf(groups, "move_task")).toMatchObject({ approval: { kind: "choice", value: "ask" } });
  });

  it("fixes Post in Talk at Ask me first and invitations at Always asks first", () => {
    expect(rowOf(groups, "post_in_talk")?.approval).toEqual({ kind: "per_conversation" });
    expect(rowOf(groups, "invite_person_with_role")?.approval).toEqual({ kind: "always_asks" });
  });

  it("never ticks a tool whose module is off, and says why", () => {
    expect(rowOf(groups, "post_in_talk")).toMatchObject({ on: false, unavailable: "talk_off" });
    expect(rowOf(groups, "read_talk")).toMatchObject({ on: false, unavailable: "talk_off" });
    expect(moduleNote("talk_off")).toBe("Talk is off in this workspace, so it can't read or post in Talk.");
    expect(moduleNote("tables_off")).toBe("Tables is off in this workspace.");
  });

  it("never offers Ask everyone first, and lists no choices for one target", () => {
    for (const g of groups) for (const r of g.rows) expect(r.askEveryone.offered || r.rules.length > 0, r.name).toBe(false);
  });
});

describe("the Tools and approvals tab", () => {
  const table = toolSettings({
    enabled: ["search_tasks", "create_task", "update_doc", "post_in_talk", "invite_person_with_role", "send_kudos", "move_task"],
    agentRules: { update_doc: "ask", move_task: "ask" },
    personRules: {
      send_kudos: "always",
      "post_in_talk:conv:c1": "always",
      "post_in_talk:conv:c2": "always",
      "create_task:outward": "always",
      "comment_on_task:outward": "always",
      create_task: "ask",
    },
    talkOn: true,
    tablesOn: false,
    targetLabels: { "conv:c1": "#general" },
  });

  it("reads each choice as what an ordinary call does now, held at Ask me first by the managers", () => {
    const groups = settingsToolGroups(table, { canManage: false, workspace: true });
    expect(rowOf(groups, "create_task")?.approval).toEqual({ kind: "choice", value: "ask", held: false });
    expect(rowOf(groups, "send_kudos")?.approval).toEqual({ kind: "choice", value: "always", held: false });
    expect(rowOf(groups, "update_doc")?.approval).toEqual({ kind: "choice", value: "ask", held: true });
    expect(rowOf(groups, "post_in_talk")?.approval).toEqual({ kind: "per_conversation" });
    expect(rowOf(groups, "invite_person_with_role")?.approval).toEqual({ kind: "always_asks" });
  });

  it("lists each Don't ask for one conversation and for calls other people will see, and offers no way to set one", () => {
    const groups = settingsToolGroups(table, { canManage: true, workspace: true });
    expect(rowOf(groups, "post_in_talk")?.rules).toEqual([
      { key: "post_in_talk:conv:c1", choice: "always", line: "Doesn't ask in #general" },
      { key: "post_in_talk:conv:c2", choice: "always", line: "Doesn't ask in a conversation you're no longer in" },
    ]);
    expect(rowOf(groups, "create_task")?.rules).toEqual([{ key: "create_task:outward", choice: "always", line: "Doesn't ask, even when other people will see it" }]);
    // A choice stays listed, with its Remove, on a tool that is off.
    expect(rowOf(groups, "comment_on_task")).toMatchObject({ on: false, rules: [{ key: "comment_on_task:outward" }] });
    // Every edit for such a choice is a removal; the controls only ever send a tool-wide key.
    expect(ruleRemoval("post_in_talk:conv:c1")).toEqual({ "post_in_talk:conv:c1": null });
    for (const r of GIVABLE_TOOLS) for (const v of ["ask", "always"] as const) expect(Object.keys(choiceEdit(r, v))).toEqual([r]);
  });

  it("lets its managers tick every tool and ask everyone first on a workspace teammate's own-work rows", () => {
    const groups = settingsToolGroups(table, { canManage: true, workspace: true });
    expect(groups.flatMap((g) => g.rows).length).toBe(GIVABLE_TOOLS.length);
    expect(rowOf(groups, "create_task")?.askEveryone).toEqual({ offered: true, on: false });
    expect(rowOf(groups, "update_doc")?.askEveryone).toEqual({ offered: true, on: true });
    expect(rowOf(groups, "search_tasks")?.askEveryone.offered).toBe(false);
    expect(rowOf(groups, "send_kudos")?.askEveryone.offered).toBe(false);
    // Already on for a tool of another class: offered so it can come off.
    expect(rowOf(groups, "move_task")?.askEveryone).toEqual({ offered: true, on: true });
    expect(rowOf(groups, "create_data_table")).toMatchObject({ on: false, unavailable: "tables_off" });
  });

  it("asks nobody first on a private teammate, its owner's choices being their own", () => {
    const groups = settingsToolGroups(table, { canManage: true, workspace: false });
    for (const g of groups) for (const r of g.rows) expect(r.askEveryone.offered, r.name).toBe(false);
  });

  it("shows whoever does not manage it the tools it has, and every choice of their own", () => {
    const groups = settingsToolGroups(table, { canManage: false, workspace: true });
    expect(groups.flatMap((g) => g.rows.map((r) => r.name)).sort()).toEqual(
      ["comment_on_task", "create_task", "invite_person_with_role", "move_task", "post_in_talk", "search_tasks", "send_kudos", "update_doc"].sort(),
    );
    for (const g of groups) for (const r of g.rows) expect(r.askEveryone.offered).toBe(false);
  });
});

describe("what the controls send", () => {
  const table = toolSettings({
    enabled: ["search_tasks", "create_task", "update_doc"],
    agentRules: { update_doc: "ask" },
    personRules: {},
    talkOn: true,
    tablesOn: true,
  });

  it("a choice equal to its class's default is no rule at all", () => {
    expect(defaultChoice("INTERNAL")).toBe("always");
    expect(defaultChoice("OUTWARD")).toBe("ask");
    expect(choiceEdit("create_task", "always")).toEqual({ create_task: null });
    expect(choiceEdit("create_task", "ask")).toEqual({ create_task: "ask" });
    expect(choiceEdit("send_kudos", "ask")).toEqual({ send_kudos: null });
    expect(choiceEdit("send_kudos", "always")).toEqual({ send_kudos: "always" });
  });

  it("ticking or unticking a tool sends the whole set, sorted", () => {
    expect(toolNamesWith(table, "send_kudos", true)).toEqual(["create_task", "search_tasks", "send_kudos", "update_doc"]);
    expect(toolNamesWith(table, "create_task", false)).toEqual(["search_tasks", "update_doc"]);
  });

  it("Ask everyone first keeps every other tightening", () => {
    expect(agentRulesWith(table, "create_task", true)).toEqual({ update_doc: "ask", create_task: "ask" });
    expect(agentRulesWith(table, "update_doc", false)).toEqual({});
  });
});

describe("the new teammate form", () => {
  const cards = templateCards(ALL_ON);
  const triage = cards.find((c) => c.key === "talk-inbox-triage") ?? null;

  it("starts from a template's words with its teammate named by its persona and no choice made", () => {
    const d = draftFromTemplate(triage, ALL_ON);
    expect(d).toMatchObject({ template: "talk-inbox-triage", name: "Triage", hue: "moss", avatar: "Inbox", visibility: "PRIVATE", choices: {} });
    expect(d.tools).toEqual(triage?.tools);
    expect(draftFromTemplate(triage, { talkOn: false, tablesOn: true }).tools).not.toContain("read_talk");
  });

  it("starts from scratch with what it can look up and its own notes, nothing that writes for others", () => {
    const d = draftFromTemplate(null, { talkOn: true, tablesOn: false });
    expect(d).toMatchObject({ template: null, name: "", job: "", instructions: "", avatar: null, visibility: "PRIVATE" });
    expect(d.tools).toContain("search_tasks");
    expect(d.tools).toEqual(expect.arrayContaining(["remember", "forget", "create_routine"]));
    expect(d.tools).not.toContain("read_talk");
    expect(d.tools).not.toContain("list_my_inbox");
    expect(d.tools).not.toContain("list_data_tables");
    for (const t of d.tools) expect(["READ", "INTERNAL"]).toContain(BASE_RISK[t]);
    expect(d.tools.filter((t) => BASE_RISK[t] === "INTERNAL").sort()).toEqual(["create_routine", "forget", "remember"]);
  });

  it("knows when something was typed", () => {
    const start = draftFromTemplate(triage, ALL_ON);
    expect(draftChanged(start, { ...start })).toBe(false);
    expect(draftChanged(start, { ...start, tools: [...start.tools].reverse() })).toBe(false);
    expect(draftChanged(start, { ...start, instructions: `${start.instructions} More.` })).toBe(true);
    expect(draftChanged(start, { ...start, choices: { create_task: "ask" } })).toBe(true);
  });

  it("needs a name and a job, within the route's lengths", () => {
    expect(draftProblems({ name: "  ", job: "", instructions: "" })).toEqual({ name: "Give it a name.", job: "Say its one job." });
    expect(draftProblems({ name: "x".repeat(61), job: "y".repeat(201), instructions: "z".repeat(8001) })).toEqual({
      name: "A name can be up to 60 characters.",
      job: "Keep its job to 200 characters.",
      instructions: "Instructions can be up to 8,000 characters.",
    });
    expect(draftProblems({ name: ` ${"x".repeat(60)} `, job: "Writes my status.", instructions: "" })).toEqual({});
  });

  it("sends only what the person chose, for tools they ticked, and Just me unless they may make one for everyone", () => {
    const d: TeammateDraft = {
      ...draftFromTemplate(null, ALL_ON),
      name: "  Weekly reporter ",
      job: " Writes my status. ",
      instructions: "Be brief.",
      tools: ["search_tasks", "create_task", "send_kudos", "post_in_talk", "invite_person_with_role", "create_contract", "create_data_table", "search_tasks"] as ToolName[],
      choices: { create_task: "always", send_kudos: "always", post_in_talk: "always", invite_person_with_role: "always", update_task: "ask", search_tasks: "ask" },
      visibility: "WORKSPACE",
    };
    expect(newTeammateBody(d, { canCreateWorkspace: false, talkOn: true, tablesOn: false })).toEqual({
      template: null,
      name: "Weekly reporter",
      hue: "sky",
      avatar: null,
      job: "Writes my status.",
      instructions: "Be brief.",
      toolNames: ["create_task", "invite_person_with_role", "post_in_talk", "search_tasks", "send_kudos"],
      visibility: "PRIVATE",
      personRules: { send_kudos: "always" },
    });
    expect(newTeammateBody({ ...d, choices: {} }, { canCreateWorkspace: true, ...ALL_ON })).toMatchObject({ visibility: "WORKSPACE", toolNames: expect.arrayContaining(["create_data_table"]) });
    expect(newTeammateBody({ ...d, choices: {} }, { canCreateWorkspace: true, ...ALL_ON })).not.toHaveProperty("personRules");
  });
});

describe("the Instructions tab", () => {
  const saved = instructionsFormOf({ name: "Planner", hue: "teal", job: "Plans my day.", instructions: "Be brief.", monthlyQuestionCap: 40 });

  it("reads the Monthly limit as a whole number from 1 to 100,000, or none", () => {
    expect(monthlyLimitFrom("")).toBeNull();
    expect(monthlyLimitFrom(" 40 ")).toBe(40);
    for (const bad of ["0", "100001", "4.5", "-3", "ten", "1e3"]) expect(monthlyLimitFrom(bad), bad).toBeUndefined();
    expect(saved.monthlyLimit).toBe("40");
  });

  it("saves only what changed", () => {
    expect(instructionsPatch(saved, { ...saved })).toEqual({ ok: true, patch: {} });
    expect(instructionsPatch(saved, { ...saved, name: " Planner ", instructions: "Be brief.  " })).toEqual({ ok: true, patch: {} });
    expect(instructionsPatch(saved, { ...saved, name: "Day planner ", hue: "rose", monthlyLimit: "" })).toEqual({
      ok: true,
      patch: { name: "Day planner", hue: "rose", monthlyQuestionCap: null },
    });
  });

  it("says what is wrong instead of saving", () => {
    expect(instructionsPatch(saved, { ...saved, name: "", monthlyLimit: "0" })).toEqual({
      ok: false,
      problems: { name: "Give it a name.", monthlyLimit: "Use a whole number from 1 to 100,000, or leave it empty." },
    });
  });
});
