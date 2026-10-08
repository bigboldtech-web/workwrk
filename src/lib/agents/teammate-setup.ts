// The pure half of making an AI teammate and setting one up
// (docs/plans/ai-teammates.md 5.5): the tool picker's four groups and its
// rows, what each row offers for approvals, the "Don't ask" choices the
// Tools and approvals tab lists (and only ever removes), the edit each
// control sends, the new teammate form (where it starts, its checks, its
// request) and the Instructions tab's save. The dialog
// (new-teammate-dialog.tsx), the picker (tool-picker.tsx) and the settings
// drawer read these, so the tests hold them without a browser.
//
// WHAT A ROW OFFERS, by the tool's own class (tool-policy.ts BASE_RISK):
//   READ          nothing: reading never asks
//   INTERNAL      "Ask me first" / "Don't ask"; Don't ask until chosen
//   OUTWARD       "Ask me first" / "Don't ask"; Ask me first until chosen
//   Post in Talk  "Ask me first", fixed: one conversation can go without
//                 asking, and only from an approval card
//   IRREVERSIBLE  "Always asks first", fixed (inviting people)
// A manager's "Ask everyone first" (a workspace teammate's INTERNAL rows)
// holds every person's choice at Ask me first.
//
// NEVER OFFERED HERE: a "Don't ask" for one Talk conversation, or for a
// tool's calls above its own class ("<tool>:outward", tool-policy.ts
// escalatedRuleKey, decision 6 of the spec). Only an approval card stores
// those. The tab lists each with a Remove, and the only edit it can send for
// one is null (ruleRemoval).
//
// Pure: no React, no fetch, no prisma.

import { NO_PRODUCTS } from "@/lib/connectors/products";
import type { TeammateHue } from "./hues";
import type { TeammateVisibility } from "./teammate-access";
import { NEW_TEAMMATE_DIALOG, TEAMMATE_SETTINGS, TOOL_PICKER_COPY, asksFirstInLine, dontAskInLine } from "./teammate-copy";
import { GIVABLE_TOOLS, TOOL_MODULE, givableTools, type ToolSetting } from "./teammate-views";
import type { TemplateCard, TemplateKey } from "./templates";
import { ALWAYS_ASK, BASE_RISK, TARGET_SCOPED_ALWAYS, type ApprovalChoice, type ToolRisk } from "./tool-policy";
import type { ToolName } from "./tool-names";

// ── Groups ──────────────────────────────────────────────────────────

export type ToolGroupKey = "look_up" | "own_work" | "others_see" | "always_asks";

/** The picker's groups, in its order. */
export const TOOL_GROUPS: ReadonlyArray<{ key: ToolGroupKey; label: string }> = [
  { key: "look_up", label: NEW_TEAMMATE_DIALOG.groupLookUp },
  { key: "own_work", label: NEW_TEAMMATE_DIALOG.groupOwnWork },
  { key: "others_see", label: NEW_TEAMMATE_DIALOG.groupOthersSee },
  { key: "always_asks", label: NEW_TEAMMATE_DIALOG.groupAlwaysAsks },
];

const GROUP_OF: Record<ToolRisk, ToolGroupKey> = { READ: "look_up", INTERNAL: "own_work", OUTWARD: "others_see", IRREVERSIBLE: "always_asks" };

/** A tool's group, by its own class. */
export function toolGroupOf(risk: ToolRisk): ToolGroupKey {
  return GROUP_OF[risk];
}

// ── A row ───────────────────────────────────────────────────────────

/** What a row offers for approvals (the file header). */
export type ApprovalControl =
  | { kind: "never_asks" }
  | { kind: "always_asks" }
  | { kind: "per_conversation" }
  /** `held`: its managers ask everyone first, so it reads Ask me first and cannot change. */
  | { kind: "choice"; value: ApprovalChoice; held: boolean };

/** The choice a tool makes when nobody made one: its own work runs ("Don't ask"), what others see asks first. */
export function defaultChoice(risk: ToolRisk): ApprovalChoice {
  return risk === "READ" || risk === "INTERNAL" ? "always" : "ask";
}

function controlFor(name: ToolName, value: ApprovalChoice, held: boolean): ApprovalControl {
  const risk = BASE_RISK[name];
  if (risk === "READ") return { kind: "never_asks" };
  if (risk === "IRREVERSIBLE" || ALWAYS_ASK.has(name)) return { kind: "always_asks" };
  if (TARGET_SCOPED_ALWAYS.has(name)) return { kind: "per_conversation" };
  return { kind: "choice", value: held ? "ask" : value, held };
}

export type ModuleOff = "talk_off" | "tables_off";

function unavailableOf(name: ToolName, modules: { talkOn: boolean; tablesOn: boolean }): ModuleOff | null {
  const needs = TOOL_MODULE[name];
  if (needs === "talk" && !modules.talkOn) return "talk_off";
  if (needs === "tables" && !modules.tablesOn) return "tables_off";
  return null;
}

/** Why a row's checkbox is off and cannot be ticked. */
export function moduleNote(off: ModuleOff): string {
  return off === "talk_off" ? NEW_TEAMMATE_DIALOG.talkOff : NEW_TEAMMATE_DIALOG.tablesOff;
}

/** One of the person's choices for one target of a tool, listed with a Remove. */
export interface ChoiceRule {
  /** The stored key: "post_in_talk:conv:<id>" or "<tool>:outward". */
  key: string;
  choice: ApprovalChoice;
  /** "Doesn't ask in #general", "Doesn't ask, even when other people will see it". */
  line: string;
}

export interface ToolPickerRow {
  name: ToolName;
  label: string;
  description: string | null;
  risk: ToolRisk;
  /** In its tool set: the checkbox. */
  on: boolean;
  /** Its module is off here: the checkbox cannot be ticked, and the note says why. */
  unavailable: ModuleOff | null;
  approval: ApprovalControl;
  /** Its managers' "Ask everyone first": offered to the managers of a workspace teammate. */
  askEveryone: { offered: boolean; on: boolean };
  rules: ChoiceRule[];
}

export interface ToolPickerGroup {
  key: ToolGroupKey;
  label: string;
  rows: ToolPickerRow[];
}

function grouped(rows: readonly ToolPickerRow[]): ToolPickerGroup[] {
  return TOOL_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => toolGroupOf(r.risk) === g.key) })).filter((g) => g.rows.length > 0);
}

function own<T>(rules: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(rules, key) ? rules[key] : undefined;
}

/** The person's choices for one target of this tool, as the tab lists them. */
export function choiceRulesOf(t: Pick<ToolSetting, "scoped">): ChoiceRule[] {
  return t.scoped.map((s): ChoiceRule => {
    if (s.target === "outward") {
      return { key: s.key, choice: s.choice, line: s.choice === "always" ? TEAMMATE_SETTINGS.outwardDontAsk : TEAMMATE_SETTINGS.outwardAsks };
    }
    const place = s.label ?? TEAMMATE_SETTINGS.conversationGone;
    return { key: s.key, choice: s.choice, line: s.choice === "always" ? dontAskInLine(place) : asksFirstInLine(place) };
  });
}

/**
 * The new teammate form's tools: every tool a teammate may be given, the
 * ticked ones on (never one whose module is off), each with the person's own
 * choice or, where they made none, its class's default.
 */
export function draftToolGroups(
  d: { tools: readonly ToolName[]; choices: Readonly<Record<string, ApprovalChoice>> },
  modules: { talkOn: boolean; tablesOn: boolean },
): ToolPickerGroup[] {
  const ticked = new Set<string>(d.tools);
  return grouped(
    // No Google row until the workspace's products are read (docs/plans/ai-teammates-phase3.md step 5).
    givableTools(NO_PRODUCTS).map((name): ToolPickerRow => {
      const copy = TOOL_PICKER_COPY[name];
      const unavailable = unavailableOf(name, modules);
      const chosen = own(d.choices, name);
      return {
        name,
        label: copy.label,
        description: copy.description ?? null,
        risk: BASE_RISK[name],
        on: ticked.has(name) && !unavailable,
        unavailable,
        approval: controlFor(name, chosen === "ask" || chosen === "always" ? chosen : defaultChoice(BASE_RISK[name]), false),
        askEveryone: { offered: false, on: false },
        rules: [],
      };
    }),
  );
}

/**
 * The Tools and approvals tab, from the route's table (teammate-views.ts
 * toolSettings). Each choice reads what an ordinary call does now (the
 * table's gate). Its managers see every tool, to tick; on a workspace
 * teammate they also get "Ask everyone first" on the INTERNAL rows (and on
 * any row where it is already on, so they can take it off). Everyone else
 * sees the tools it has, and every choice of their own.
 */
export function settingsToolGroups(tools: readonly ToolSetting[], o: { canManage: boolean; workspace: boolean }): ToolPickerGroup[] {
  const rows = tools.map((t): ToolPickerRow => {
    const held = t.agentRule === "ask";
    return {
      name: t.name,
      label: t.label,
      description: t.description,
      risk: t.risk,
      on: t.enabled,
      unavailable: t.unavailable,
      approval: controlFor(t.name, t.gate === "run" ? "always" : "ask", held),
      askEveryone: { offered: o.canManage && o.workspace && (t.risk === "INTERNAL" || held), on: held },
      rules: choiceRulesOf(t),
    };
  });
  return grouped(o.canManage ? rows : rows.filter((r) => r.on || r.rules.length > 0));
}

// ── What each control sends ─────────────────────────────────────────

/** A person's choice for a whole tool, for PUT .../approvals: the default is no rule at all (null). */
export function choiceEdit(name: ToolName, value: ApprovalChoice): Record<string, ApprovalChoice | null> {
  return { [name]: value === defaultChoice(BASE_RISK[name]) ? null : value };
}

/** Remove one choice for one target: the only edit the tab ever makes to those. */
export function ruleRemoval(key: string): Record<string, null> {
  return { [key]: null };
}

/**
 * The teammate's tools after one is ticked or unticked (PATCH toolNames).
 * A tool whose module is off reads as unticked here; the route keeps what is
 * stored for it, since its row cannot be changed.
 */
export function toolNamesWith(tools: readonly ToolSetting[], name: ToolName, on: boolean): ToolName[] {
  const next = new Set<ToolName>(tools.filter((t) => t.enabled).map((t) => t.name));
  if (on) next.add(name);
  else next.delete(name);
  return [...next].sort();
}

/** Its managers' rules after one "Ask everyone first" changes (PATCH agentRules): each "ask" they hold, this one put on or taken off. */
export function agentRulesWith(tools: readonly ToolSetting[], name: ToolName, ask: boolean): Record<string, "ask"> {
  const out: Record<string, "ask"> = {};
  for (const t of tools) if (t.agentRule === "ask" && t.name !== name) out[t.name] = "ask";
  if (ask) out[name] = "ask";
  return out;
}

// ── The new teammate form ───────────────────────────────────────────

export interface TeammateDraft {
  template: TemplateKey | null;
  name: string;
  hue: TeammateHue;
  /** An icon name from the Space icon catalog; null shows the name's first letter. */
  avatar: string | null;
  job: string;
  instructions: string;
  tools: ToolName[];
  /** The person's own choices, by tool, for the tools that offer one. */
  choices: Record<string, ApprovalChoice>;
  visibility: TeammateVisibility;
}

/** What POST /api/agents/teammates takes (and PATCH .../[slug]). */
export const TEAMMATE_FIELD_MAX = { name: 60, job: 200, instructions: 8000 } as const;

/**
 * The tools a teammate made from scratch starts with: what it can look up
 * about the person's work, and its own notes and routines. Not Talk or the
 * Inbox (they carry other people's words, so ticking them is the person's
 * call), not contracts (no longer a surface of the product), and nothing
 * that writes for anyone but the person.
 */
const SCRATCH_TOOLS: readonly ToolName[] = [
  "search_tasks",
  "search_employees",
  "search_meetings",
  "search_okrs",
  "search_sops",
  "list_forms",
  "list_data_tables",
  "list_my_kras",
  "list_my_kpi_status",
  "list_my_sops",
  "list_my_weekly_reviews",
  "get_team_alignment_rollup",
  "remember",
  "forget",
  "create_routine",
];

/**
 * Where the form starts: a template's words, colour, icon and tools with the
 * risk defaults (no choice made), its teammate named by its persona; or, from
 * scratch, empty words and SCRATCH_TOOLS. Just me until an Owner or Admin
 * chooses otherwise. A tool whose module is off is never ticked.
 */
export function draftFromTemplate(card: TemplateCard | null, modules: { talkOn: boolean; tablesOn: boolean }): TeammateDraft {
  const available = (n: ToolName) => unavailableOf(n, modules) === null;
  if (!card) {
    return { template: null, name: "", hue: "sky", avatar: null, job: "", instructions: "", tools: SCRATCH_TOOLS.filter(available), choices: {}, visibility: "PRIVATE" };
  }
  return {
    template: card.key,
    name: card.persona,
    hue: card.hue,
    avatar: card.avatar,
    job: card.job,
    instructions: card.instructions,
    tools: card.tools.filter(available),
    choices: {},
    visibility: "PRIVATE",
  };
}

/** Whether the form says something other than where it started: what closing it would lose. */
export function draftChanged(start: TeammateDraft, now: TeammateDraft): boolean {
  const tools = (d: TeammateDraft) => [...d.tools].sort().join(",");
  const choices = (d: TeammateDraft) => JSON.stringify(Object.entries(d.choices).sort(([a], [b]) => a.localeCompare(b)));
  return (
    start.name !== now.name ||
    start.hue !== now.hue ||
    start.job !== now.job ||
    start.instructions !== now.instructions ||
    start.visibility !== now.visibility ||
    tools(start) !== tools(now) ||
    choices(start) !== choices(now)
  );
}

export type DraftField = "name" | "job" | "instructions";

/** What stops the form from being made, by field (the route's own limits). Empty when it can be. */
export function draftProblems(d: Pick<TeammateDraft, DraftField>): Partial<Record<DraftField, string>> {
  const out: Partial<Record<DraftField, string>> = {};
  const name = d.name.trim();
  if (!name) out.name = NEW_TEAMMATE_DIALOG.nameRequired;
  else if (name.length > TEAMMATE_FIELD_MAX.name) out.name = NEW_TEAMMATE_DIALOG.nameTooLong;
  const job = d.job.trim();
  if (!job) out.job = NEW_TEAMMATE_DIALOG.jobRequired;
  else if (job.length > TEAMMATE_FIELD_MAX.job) out.job = NEW_TEAMMATE_DIALOG.jobTooLong;
  if (d.instructions.length > TEAMMATE_FIELD_MAX.instructions) out.instructions = NEW_TEAMMATE_DIALOG.instructionsTooLong;
  return out;
}

const GIVABLE: ReadonlySet<string> = new Set(GIVABLE_TOOLS);

/**
 * The form as POST /api/agents/teammates takes it. Only tools a teammate may
 * be given and this workspace has now; the person's choices only where they
 * differ from the default and only for ticked tools that offer one (so
 * nothing is preset to "Don't ask" that they did not choose, and no
 * per-conversation or invitation choice is ever sent); Just me unless the
 * person may make one for everyone.
 */
export function newTeammateBody(d: TeammateDraft, o: { canCreateWorkspace: boolean; talkOn: boolean; tablesOn: boolean }): Record<string, unknown> {
  const modules = { talkOn: o.talkOn, tablesOn: o.tablesOn };
  const toolNames = [...new Set(d.tools)].filter((n) => GIVABLE.has(n) && unavailableOf(n, modules) === null).sort();
  const personRules: Record<string, ApprovalChoice> = {};
  for (const name of toolNames) {
    const chosen = own(d.choices, name);
    if (chosen !== "ask" && chosen !== "always") continue;
    if (controlFor(name, chosen, false).kind !== "choice" || chosen === defaultChoice(BASE_RISK[name])) continue;
    personRules[name] = chosen;
  }
  return {
    template: d.template,
    name: d.name.trim(),
    hue: d.hue,
    avatar: d.avatar,
    job: d.job.trim(),
    instructions: d.instructions,
    toolNames,
    visibility: o.canCreateWorkspace ? d.visibility : "PRIVATE",
    ...(Object.keys(personRules).length > 0 ? { personRules } : {}),
  };
}

// ── The Instructions tab ────────────────────────────────────────────

/** The Instructions tab's fields, as they are typed. */
export interface InstructionsForm {
  name: string;
  hue: TeammateHue | null;
  job: string;
  instructions: string;
  /** The Monthly limit field's text: empty is no limit of its own. */
  monthlyLimit: string;
}

export function instructionsFormOf(t: { name: string; hue: TeammateHue | null; job: string; instructions: string; monthlyQuestionCap: number | null }): InstructionsForm {
  return { name: t.name, hue: t.hue, job: t.job, instructions: t.instructions, monthlyLimit: t.monthlyQuestionCap === null ? "" : String(t.monthlyQuestionCap) };
}

/** The Monthly limit field as PATCH takes it: empty is null; a whole number from 1 to 100,000; anything else is undefined (not a limit). */
export function monthlyLimitFrom(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,6}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= 100_000 ? n : undefined;
}

export type InstructionsField = DraftField | "monthlyLimit";

/**
 * The save of the Instructions tab: only what changed, as PATCH
 * /api/agents/teammates/[slug] takes it (and compares it: names and jobs
 * trimmed, instructions trimmed), or what is wrong with it by field.
 */
export function instructionsPatch(
  saved: InstructionsForm,
  form: InstructionsForm,
): { ok: true; patch: Record<string, unknown> } | { ok: false; problems: Partial<Record<InstructionsField, string>> } {
  const problems: Partial<Record<InstructionsField, string>> = { ...draftProblems(form) };
  const cap = monthlyLimitFrom(form.monthlyLimit);
  if (cap === undefined) problems.monthlyLimit = TEAMMATE_SETTINGS.monthlyLimitInvalid;
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  const patch: Record<string, unknown> = {};
  if (form.name.trim() !== saved.name.trim()) patch.name = form.name.trim();
  if (form.job.trim() !== saved.job.trim()) patch.job = form.job.trim();
  if (form.instructions.trim() !== saved.instructions.trim()) patch.instructions = form.instructions;
  if (form.hue !== saved.hue && form.hue !== null) patch.hue = form.hue;
  if (cap !== monthlyLimitFrom(saved.monthlyLimit)) patch.monthlyQuestionCap = cap;
  return { ok: true, patch };
}
