// Making a teammate and setting one up (teammate-setup.ts, docs/plans/ai-
// teammates.md 5.5): the picker's four groups and what each row offers; the
// tab's rows read the policy as the route's table does, managers alone tick
// tools and ask everyone first, and a "Don't ask" for one conversation or for
// calls other people will see is listed with a Remove and never offered; the
// edits each control sends; and the new teammate form's start, checks and
// request.

import { describe, expect, it } from "vitest";
import {
  GOOGLE_CONNECTIONS_HREF,
  TOOL_GROUPS,
  agentRulesWith,
  choiceEdit,
  connectorNote,
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
  toolsPatch,
  type ConnectorRowStates,
  type TeammateDraft,
  type ToolPickerGroup,
  type ToolPickerRow,
} from "./teammate-setup";
import { NO_PRODUCTS } from "@/lib/connectors/products";
import { CONNECTOR_ROW_STATES, GIVABLE_TOOLS, NO_GOOGLE_ROWS, givableTools, toolSettings } from "./teammate-views";
import { templateCards } from "./templates";
import { BASE_RISK } from "./tool-policy";
import { CONNECTOR_TOOL_NAMES, type ToolName } from "./tool-names";

const ALL_ON = { talkOn: true, tablesOn: true };
/** No Google product on: what every surface had before Phase 3 step 5. */
const NO_GOOGLE = { connectors: NO_PRODUCTS, google: NO_GOOGLE_ROWS };

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

  it("hold every tool a teammate may be given, each once, and no Google tool while no product is on (Phase 3)", () => {
    const groups = draftToolGroups({ tools: [], choices: {} }, { ...ALL_ON, ...NO_GOOGLE });
    const names = groups.flatMap((g) => g.rows.map((r) => r.name));
    expect([...names].sort()).toEqual([...givableTools(NO_PRODUCTS)].sort());
    for (const t of CONNECTOR_TOOL_NAMES) expect(names, t).not.toContain(t);
    // Ticked or not, a Google tool has no row to tick.
    expect(rowOf(draftToolGroups({ tools: ["search_email", "send_email"], choices: {} }, { ...ALL_ON, ...NO_GOOGLE }), "send_email")).toBeUndefined();
    expect(groups.map((g) => g.key)).toEqual(["look_up", "own_work", "others_see", "always_asks"]);
    expect(groupOf(groups, "search_tasks")).toBe("look_up");
    expect(groupOf(groups, "create_task")).toBe("own_work");
    expect(groupOf(groups, "post_in_talk")).toBe("others_see");
    expect(groupOf(groups, "invite_person_with_role")).toBe("always_asks");
    expect(rowOf(groups, "create_contract")).toBeUndefined();
  });
});

describe("a row in the new teammate form", () => {
  const groups = draftToolGroups(
    { tools: ["search_tasks", "create_task", "send_kudos", "post_in_talk", "read_talk"], choices: { send_kudos: "always", create_task: "ask" } },
    { talkOn: false, tablesOn: true, ...NO_GOOGLE },
  );

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
    ...NO_GOOGLE,
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
    expect(groups.flatMap((g) => g.rows).length).toBe(givableTools(NO_PRODUCTS).length);
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
    ...NO_GOOGLE,
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
    expect(newTeammateBody(d, { canCreateWorkspace: false, talkOn: true, tablesOn: false, connectors: NO_PRODUCTS })).toEqual({
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
    expect(newTeammateBody({ ...d, choices: {} }, { canCreateWorkspace: true, ...ALL_ON, connectors: NO_PRODUCTS })).toMatchObject({ visibility: "WORKSPACE", toolNames: expect.arrayContaining(["create_data_table"]) });
    expect(newTeammateBody({ ...d, choices: {} }, { canCreateWorkspace: true, ...ALL_ON, connectors: NO_PRODUCTS })).not.toHaveProperty("personRules");
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

describe("a Google tool's row (docs/plans/ai-teammates-phase3.md step 5)", () => {
  const GMAIL_TOOLS = ["search_email", "read_email", "draft_email", "send_email", "reply_email"];
  const BOTH = { gmail: true, calendar: true };
  const READY: ConnectorRowStates = { gmail: "ready", calendar: "ready" };
  const names = (groups: readonly ToolPickerGroup[]) => groups.flatMap((g) => g.rows.map((r) => r.name));
  const table = (o: { enabled: ToolName[]; connectors: { gmail: boolean; calendar: boolean }; google: ConnectorRowStates }) =>
    toolSettings({ agentRules: {}, personRules: {}, talkOn: true, tablesOn: true, ...o });

  it("is not drawn while Gmail is off, in the form or on the tab, whatever the teammate stores", () => {
    const gmailOff = { gmail: false, calendar: true };
    // Before: every Google row was hidden; now Calendar's show, and Gmail's still do not.
    const form = draftToolGroups({ tools: ["search_email", "list_events"], choices: {} }, { ...ALL_ON, connectors: gmailOff, google: READY });
    for (const t of GMAIL_TOOLS) expect(names(form), t).not.toContain(t);
    expect(rowOf(form, "list_events")).toMatchObject({ on: true, connector: { product: "calendar", state: "ready" } });
    const stored = table({ enabled: ["search_email", "send_email", "list_events", "search_tasks"], connectors: gmailOff, google: READY });
    for (const canManage of [true, false]) {
      const tab = settingsToolGroups(stored, { canManage, workspace: true });
      for (const t of GMAIL_TOOLS) expect(names(tab), t).not.toContain(t);
      expect(names(tab)).toContain("list_events");
    }
    // Every other row has no Google line.
    expect(rowOf(form, "search_tasks")?.connector).toBeNull();
  });

  it("says Connect Google first, with a link to the person's own card, until they connect", () => {
    const google: ConnectorRowStates = { gmail: "connect_first", calendar: "connect_first" };
    const form = rowOf(draftToolGroups({ tools: [], choices: {} }, { ...ALL_ON, connectors: BOTH, google }), "search_email");
    expect(form?.connector).toEqual({ product: "gmail", state: "connect_first" });
    expect(connectorNote({ state: "connect_first" })).toEqual({
      text: "Uses your own Google account. Connect Google first.",
      link: { label: "Connect", href: "/account/connections#ai-google" },
    });
    const tab = settingsToolGroups(table({ enabled: ["search_email"], connectors: BOTH, google }), { canManage: false, workspace: false });
    expect(rowOf(tab, "search_email")?.connector).toEqual({ product: "gmail", state: "connect_first" });
    // Nothing to do there: no link. Anything else: the person's card (Decision 25).
    expect(connectorNote({ state: "ready" })).toEqual({ text: "Uses your own Google account.", link: null });
    for (const state of CONNECTOR_ROW_STATES) {
      expect(connectorNote({ state }).link?.href ?? null, state).toBe(state === "ready" ? null : GOOGLE_CONNECTIONS_HREF);
    }
  });

  it("asks the person to allow a teammate made for everyone first, and never one of their own", () => {
    const form = (visibility: "PRIVATE" | "WORKSPACE", google: ConnectorRowStates) =>
      rowOf(draftToolGroups({ tools: ["search_email"], choices: {}, visibility }, { ...ALL_ON, connectors: BOTH, google }), "search_email")?.connector?.state;
    // Before: the same "ready" for both, and a workspace teammate never used the person's Google until they allowed it (Decision 6).
    expect(form("WORKSPACE", READY)).toBe("allow_first");
    expect(form("PRIVATE", READY)).toBe("ready");
    // A form that never chose is Just me.
    expect(rowOf(draftToolGroups({ tools: [], choices: {} }, { ...ALL_ON, connectors: BOTH, google: READY }), "search_email")?.connector?.state).toBe("ready");
    // A connection to make or mend comes first, as connectorAccess checks it first.
    expect(form("WORKSPACE", { gmail: "reconnect", calendar: "ready" })).toBe("reconnect");
    expect(form("WORKSPACE", { gmail: "connect_first", calendar: "ready" })).toBe("connect_first");
    // The person's own teammate never reads allow_first from the form, whatever it starts from.
    for (const state of CONNECTOR_ROW_STATES.filter((s) => s !== "allow_first")) expect(form("PRIVATE", { gmail: state, calendar: state }), state).toBe(state);
    // The tab shows what the route read for this person and this teammate.
    const tab = settingsToolGroups(table({ enabled: ["search_email"], connectors: BOTH, google: { gmail: "allow_first", calendar: "ready" } }), { canManage: false, workspace: true });
    expect(rowOf(tab, "search_email")?.connector?.state).toBe("allow_first");
    expect(connectorNote({ state: "allow_first" })).toEqual({ text: "Uses your own Google account once you allow it.", link: { label: "Allow", href: GOOGLE_CONNECTIONS_HREF } });
  });

  it("ticks like any other tool, and the form sends it", () => {
    const d: TeammateDraft = { ...draftFromTemplate(null, ALL_ON), name: "Inbox helper", job: "Reads my email.", tools: ["search_email", "send_email", "search_tasks"] };
    const groups = draftToolGroups(d, { ...ALL_ON, connectors: BOTH, google: READY });
    expect(rowOf(groups, "send_email")).toMatchObject({ on: true, approval: { kind: "always_asks" } });
    expect(newTeammateBody(d, { canCreateWorkspace: false, ...ALL_ON, connectors: BOTH }).toolNames).toEqual(["search_email", "search_tasks", "send_email"]);
  });

  it("sends no Google tool whose product was turned off while the form was open (review of step 5)", () => {
    const d: TeammateDraft = { ...draftFromTemplate(null, ALL_ON), name: "Inbox helper", job: "Reads my email.", tools: ["search_email", "read_email", "list_events", "search_tasks"] };
    // Ticked while Gmail was on; Gmail went off before Create, and its rows went with it.
    const gmailOff = { gmail: false, calendar: true };
    for (const t of GMAIL_TOOLS) expect(names(draftToolGroups(d, { ...ALL_ON, connectors: gmailOff, google: READY })), t).not.toContain(t);
    // Before: ["list_events", "read_email", "search_email", "search_tasks"], Gmail tools nobody could see or untick.
    expect(newTeammateBody(d, { canCreateWorkspace: false, ...ALL_ON, connectors: gmailOff }).toolNames).toEqual(["list_events", "search_tasks"]);
    expect(newTeammateBody(d, { canCreateWorkspace: false, ...ALL_ON, connectors: NO_PRODUCTS }).toolNames).toEqual(["search_tasks"]);
  });

  it("asks for the allow of a teammate made for everyone with no link, since the card lists only teammates that exist (review of step 5)", () => {
    const row = rowOf(draftToolGroups({ tools: ["search_email"], choices: {}, visibility: "WORKSPACE" }, { ...ALL_ON, connectors: BOTH, google: READY }), "search_email");
    expect(row?.connector).toEqual({ product: "gmail", state: "allow_first", unmade: true });
    // Before: an Allow link to a card that cannot list the teammate yet.
    expect(connectorNote(row?.connector ?? { state: "ready" })).toEqual({
      text: "Uses your own Google account once you allow it. Allow it in Settings, Calendar & connections once the teammate is made.",
      link: null,
    });
    // A connection to make or mend can be done before the teammate exists: its link stays.
    const connect = rowOf(draftToolGroups({ tools: [], choices: {}, visibility: "WORKSPACE" }, { ...ALL_ON, connectors: BOTH, google: NO_GOOGLE_ROWS }), "search_email");
    expect(connect?.connector).toEqual({ product: "gmail", state: "connect_first" });
    expect(connectorNote(connect?.connector ?? { state: "ready" }).link).toEqual({ label: "Connect", href: GOOGLE_CONNECTIONS_HREF });
    // The tab's allow, for a teammate that exists, keeps its link.
    const tab = settingsToolGroups(table({ enabled: ["search_email"], connectors: BOTH, google: { gmail: "allow_first", calendar: "ready" } }), { canManage: true, workspace: true });
    expect(connectorNote(rowOf(tab, "search_email")?.connector ?? { state: "ready" }).link).toEqual({ label: "Allow", href: GOOGLE_CONNECTIONS_HREF });
  });

  // Review of step 5: a tick sent the whole set the tab showed, so a tab read
  // before someone else's change wrote back what it showed (a Gmail tool
  // removed meanwhile came back; one added meanwhile was dropped).
  it("sends, for a tick of the tab, only that one tool's change, never the set the tab shows", () => {
    // What the tab shows never reaches the request: a tab that still shows
    // read_email on, removed in another tab since, sends only its tick.
    expect(toolsPatch("create_doc", true)).toEqual({ toolChanges: { add: ["create_doc"] } });
    expect(toolsPatch("search_email", false)).toEqual({ toolChanges: { remove: ["search_email"] } });
    expect(Object.keys(toolsPatch("create_doc", true))).toEqual(["toolChanges"]);
  });

  it("is never ticked by a template or by Start from scratch (Decision 28)", () => {
    for (const card of [...templateCards(ALL_ON), null]) {
      for (const t of draftFromTemplate(card, ALL_ON).tools) expect((CONNECTOR_TOOL_NAMES as readonly string[]).includes(t), `${card?.key ?? "scratch"}: ${t}`).toBe(false);
    }
  });
});
