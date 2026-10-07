// What an AI teammate may do without asking (docs/plans/ai-teammates.md 3.3
// and 3.5). Pure, so the executor, the approval routes, the settings drawer
// and the tests read one rule.
//
// FOUR CLASSES, by what other people see:
//   READ          reads only. Never asks.
//   INTERNAL      writes the person's own work, or makes something new that
//                 nobody else is told about. Runs without asking; the person
//                 may choose "Ask me first"; managers may tighten it for all.
//   OUTWARD       tells someone else, posts where others read, changes what
//                 others own or share, or can start automations. Asks first;
//                 the person may choose "Don't ask".
//   IRREVERSIBLE  cannot be taken back (an invitation email). Always asks;
//                 "Don't ask" is never offered and never stored. Any future
//                 delete, share or permission tool belongs here.
//
// BASE_RISK is a tool's class before its input is read. A call can only go UP
// from it (previews.ts prepareCall: a task for someone else, a comment on a
// shared task), never down, and gateFor never lets a caller pass a class
// below the base. A call above its base has its own "Don't ask"
// (escalatedRuleKey): the tool-wide choice covers only the tool's own class,
// so "Don't ask" picked for making your own tasks never covers making them
// for other people.
//
// WHO DECIDES. A teammate's managers may only TIGHTEN (agent rules hold
// "ask" and nothing else): an Admin who could store "always" could approve
// posts in Talk in a Member's name. "Don't ask" is the acting person's own
// choice (AgentPersonSetting), and for Talk only per conversation, because
// every Talk post is read by other people.
//
// Pure: the name list and the copy file, nothing that reads a database.

import { EDIT_FIELD_LABELS } from "./teammate-copy";
import { isToolName, type ToolName } from "./tool-names";

export type ToolRisk = "READ" | "INTERNAL" | "OUTWARD" | "IRREVERSIBLE";

export type ApprovalChoice = "ask" | "always";

/** Keys: a tool name, or "<tool>:<targetKey>" for a target-scoped choice. */
export type ApprovalRules = Record<string, ApprovalChoice>;

export const BASE_RISK: Record<ToolName, ToolRisk> = {
  // Reads.
  search_tasks: "READ",
  search_employees: "READ",
  search_meetings: "READ",
  search_okrs: "READ",
  search_sops: "READ",
  search_contracts: "READ",
  list_forms: "READ",
  list_data_tables: "READ",
  list_my_kras: "READ",
  list_my_kpi_status: "READ",
  list_my_sops: "READ",
  list_my_weekly_reviews: "READ",
  get_team_alignment_rollup: "READ",
  list_my_inbox: "READ",
  read_talk: "READ",
  // It never asks itself: what the teammate it asks would do asks for itself
  // (docs/plans/ai-teammates-phase2.md step 5).
  ask_teammate: "READ",
  // The person's own work, or something new nobody is told about.
  create_task: "INTERNAL",
  create_sop: "INTERNAL",
  create_sprint: "INTERNAL",
  create_contract: "INTERNAL",
  create_workspace: "INTERNAL",
  create_meeting: "INTERNAL",
  create_okr: "INTERNAL",
  update_task: "INTERNAL",
  comment_on_task: "INTERNAL",
  update_doc: "INTERNAL",
  remember: "INTERNAL",
  forget: "INTERNAL",
  create_routine: "INTERNAL",
  // Other people see it, or it changes what they share. A new doc, form or
  // table made where the teammate can make it is open to every member, who
  // can edit it (node-rules: a root doc, form or table), so making one is
  // something other people will see (review round 1).
  create_doc: "OUTWARD",
  create_form: "OUTWARD",
  create_data_table: "OUTWARD",
  create_kra: "OUTWARD",
  create_kpi: "OUTWARD",
  update_contract: "OUTWARD",
  send_kudos: "OUTWARD",
  move_task: "OUTWARD",
  post_in_talk: "OUTWARD",
  // Cannot be taken back.
  invite_person_with_role: "IRREVERSIBLE",
};

/** Always asks, whatever is stored. */
export const ALWAYS_ASK: ReadonlySet<ToolName> = new Set<ToolName>(["invite_person_with_role"]);

/** "Don't ask" only for one target (a Talk conversation), never tool-wide. */
export const TARGET_SCOPED_ALWAYS: ReadonlySet<ToolName> = new Set<ToolName>(["post_in_talk"]);

/** A request waits this long for the person, then expires. */
export const ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The most actions one turn may ask for. */
export const MAX_PROPOSALS_PER_TURN = 50;

/** The most requests that may wait for one person at once. */
export const MAX_PENDING_PER_PERSON = 100;

/** The most tool calls one turn may make. */
export const MAX_TOOL_CALLS_PER_TURN = 30;

/** The most other teammates one answer may ask (ask_teammate; Decision 16). */
export const MAX_DELEGATIONS_PER_TURN = 3;

/**
 * What started a turn, as the policy reads it (Phase 2): the person's own
 * chats (CHAT, RESUME), a routine, another teammate's ask (DELEGATED), a
 * Talk message (TALK) or an automation's step (AUTOMATION).
 */
export type PolicyTrigger = "CHAT" | "RESUME" | "ROUTINE" | "DELEGATED" | "TALK" | "AUTOMATION";

/**
 * Whether the person's own "Don't ask" applies (Decision 17): only in their
 * own chats and their routines. A turn they are not watching, started by
 * another teammate, a Talk message or an automation, asks for everything
 * above INTERNAL.
 */
export function honoursDontAsk(t: PolicyTrigger): boolean {
  return t === "CHAT" || t === "RESUME" || t === "ROUTINE";
}

/** The most decided outcomes one turn is told (claimUnreportedOutcomes); the rest wait for the next. */
export const OUTCOMES_PER_TURN = 50;

/** Tools only a turn the person watches is offered: their lines land in a chat nobody may be reading (Decision 18). */
export const WATCHED_ONLY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(["remember", "forget", "create_routine", "ask_teammate"]);

/**
 * Tools that read other people's words to the person: never offered where
 * the answer posts or flows on (Decision 12). A delegated answer flows on,
 * back to the asking teammate's turn, where the person's "Don't ask" still
 * holds, so a delegate never has them either (review of step 5: else one
 * teammate could read DMs through another and post them without a card).
 */
export const OTHER_PEOPLES_WORDS: ReadonlySet<ToolName> = new Set<ToolName>(["read_talk", "list_my_inbox"]);

/**
 * Reads a Talk turn is not given because what they find cannot be held to
 * what everyone in the conversation may open: a Talk answer draws only on
 * what they all may read (search_tasks is held to it; review round 3).
 */
export const UNCHECKED_FOR_TALK: ReadonlySet<ToolName> = new Set<ToolName>(["search_sops", "list_forms", "list_data_tables"]);

/**
 * Reads of the person's own private records (their goals and KRAs, KPI
 * status, weekly reviews, their team's alignment, contracts, meetings):
 * never offered where the answer goes out with no card (a Talk answer, an
 * automation's answer for its later steps). Other people's words reach those turns as data (the
 * conversation, the record), and a planted "start with the asker's review"
 * must find nothing private to post (review round 1). A delegated answer
 * comes back to the person's own chat first, so a delegate keeps them.
 */
export const PERSONAL_RECORDS: ReadonlySet<ToolName> = new Set<ToolName>([
  "list_my_kras",
  "list_my_kpi_status",
  "list_my_weekly_reviews",
  "get_team_alignment_rollup",
  "search_contracts",
  // Goals (OKRs, "Find goals"): a person's own, and their team's for a
  // manager; meetings: 1:1 agendas and attendees (review round 2).
  "search_okrs",
  "search_meetings",
  // The SOPs assigned to the person, with their own completion and score (review round 4).
  "list_my_sops",
]);

/**
 * The tools a turn is offered, by what started it: a routine never asks
 * another teammate (it would fan out unattended); a turn the person did not
 * start in their own chat (another teammate's ask, a Talk message, an
 * automation) has none of the watched-only tools and reads no one else's
 * words. A chat and its continue keep everything.
 */
export function toolsForTrigger(enabled: readonly ToolName[], t: PolicyTrigger): ToolName[] {
  if (t === "CHAT" || t === "RESUME") return [...enabled];
  if (t === "ROUTINE") return enabled.filter((n) => n !== "ask_teammate");
  const postsWithNoCard = t === "TALK" || t === "AUTOMATION";
  return enabled.filter(
    (n) => !WATCHED_ONLY_TOOLS.has(n) && !OTHER_PEOPLES_WORDS.has(n) && !(postsWithNoCard && PERSONAL_RECORDS.has(n)) && !(t === "TALK" && UNCHECKED_FOR_TALK.has(n)),
  );
}

/**
 * Tools no teammate is given, whatever its saved tool set says (legacy
 * agents' sets in teammate chats included). Ask AI is untouched by this.
 *
 * Step 3b checked each candidate against the route it should mirror. The
 * Contract and Sprint tables have NO route: the Legal and Dev surfaces left
 * the product, POST /api/agreements writes Agreement rows (not Contract), and
 * a sprint is now a List (src/lib/board.ts settings.sprint). With no route
 * there is no gate to mirror, so these three stay out. create_kra and
 * create_kpi now carry POST /api/kras's and POST /api/kpis's gates and are in.
 */
export const TEAMMATE_EXCLUDED: ReadonlySet<ToolName> = new Set<ToolName>(["create_contract", "update_contract", "create_sprint"]);

/** The one field the person may change on a card before approving, and how long it may be. */
export interface EditableField {
  field: string;
  label: string;
  maxLength: number;
}

export const EDITABLE_FIELD: Readonly<Partial<Record<ToolName, EditableField>>> = {
  create_task: { field: "title", label: EDIT_FIELD_LABELS.title, maxLength: 280 },
  create_meeting: { field: "title", label: EDIT_FIELD_LABELS.title, maxLength: 200 },
  create_okr: { field: "title", label: EDIT_FIELD_LABELS.title, maxLength: 200 },
  send_kudos: { field: "message", label: EDIT_FIELD_LABELS.message, maxLength: 500 },
  comment_on_task: { field: "text", label: EDIT_FIELD_LABELS.comment, maxLength: 4000 },
  post_in_talk: { field: "text", label: EDIT_FIELD_LABELS.message, maxLength: 3000 },
  update_doc: { field: "text", label: EDIT_FIELD_LABELS.text, maxLength: 8000 },
};

const RANK: Record<ToolRisk, number> = { READ: 0, INTERNAL: 1, OUTWARD: 2, IRREVERSIBLE: 3 };

export function isToolRisk(v: unknown): v is ToolRisk {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(RANK, v);
}

/** The higher of two classes: an escalation never lowers a call's class. */
export function maxRisk(a: ToolRisk, b: ToolRisk): ToolRisk {
  return RANK[a] >= RANK[b] ? a : b;
}

/** A call's class: the higher of the tool's base and what its input made it. An unknown tool is IRREVERSIBLE. */
export function effectiveRisk(tool: string, risk: ToolRisk): ToolRisk {
  const base: ToolRisk = isToolName(tool) ? BASE_RISK[tool] : "IRREVERSIBLE";
  return maxRisk(base, isToolRisk(risk) ? risk : "IRREVERSIBLE");
}

/** The key a target-scoped choice is stored under: "post_in_talk:conv:<id>". */
export function scopedRuleKey(tool: ToolName, targetKey: string): string {
  return `${tool}:${targetKey}`;
}

/** The word after the tool in an escalated call's rule key. */
const ESCALATED = "outward";

/**
 * The key a person's choice for a tool's calls ABOVE its own class is stored
 * under: "create_task:outward". The approval card of such a call (a task for
 * someone else, a comment on a shared task) offers and stores this key, and
 * only it covers those calls.
 */
export function escalatedRuleKey(tool: ToolName): string {
  return `${tool}:${ESCALATED}`;
}

/** Whether this call is riskier than its tool's own class. */
export function isEscalated(tool: ToolName, risk: ToolRisk): boolean {
  return RANK[effectiveRisk(tool, risk)] > RANK[BASE_RISK[tool]];
}

/**
 * Whether "Don't ask again" may be offered and stored for this call: never
 * for what cannot be taken back, and for Talk only with the conversation it
 * names.
 */
export function canAlwaysAllow(tool: ToolName, risk: ToolRisk, targetKey: string | null): boolean {
  const r = effectiveRisk(tool, risk);
  if (r === "IRREVERSIBLE" || ALWAYS_ASK.has(tool)) return false;
  if (TARGET_SCOPED_ALWAYS.has(tool)) return Boolean(targetKey);
  return true;
}

/** The rule "Approve and don't ask again" stores for this call, or null when it may not. */
export function alwaysKeyFor(tool: ToolName, risk: ToolRisk, targetKey: string | null): string | null {
  if (!canAlwaysAllow(tool, risk, targetKey)) return null;
  if (isEscalated(tool, risk)) return escalatedRuleKey(tool);
  return TARGET_SCOPED_ALWAYS.has(tool) && targetKey ? scopedRuleKey(tool, targetKey) : tool;
}

/**
 * Run the call now, or ask the person first. In order:
 *   READ runs. IRREVERSIBLE and ALWAYS_ASK ask, whatever is stored.
 *   A manager's "ask" asks (managers tighten, never loosen).
 *   A call above its tool's own class reads only the person's choice for
 *   such calls (escalatedRuleKey): "always" runs, anything else asks.
 *   The person's own choice: the target-scoped one, else the tool-wide one
 *   (never read for TARGET_SCOPED_ALWAYS). "always" runs, but only where
 *   canAlwaysAllow; "ask" asks.
 *   Otherwise the class decides: INTERNAL runs, OUTWARD asks.
 */
export function gateFor(a: {
  tool: ToolName;
  risk: ToolRisk;
  targetKey: string | null;
  agentRules: ApprovalRules;
  personRules: ApprovalRules;
}): "run" | "ask" {
  const risk = effectiveRisk(a.tool, a.risk);
  if (risk === "READ") return "run";
  if (risk === "IRREVERSIBLE" || ALWAYS_ASK.has(a.tool)) return "ask";
  if (ownRule(a.agentRules, a.tool) === "ask") return "ask";
  if (isEscalated(a.tool, a.risk)) {
    const own = ownRule(a.personRules, escalatedRuleKey(a.tool));
    return own === "always" && canAlwaysAllow(a.tool, risk, a.targetKey) ? "run" : "ask";
  }
  const scoped = a.targetKey ? ownRule(a.personRules, scopedRuleKey(a.tool, a.targetKey)) : undefined;
  const choice = scoped ?? (TARGET_SCOPED_ALWAYS.has(a.tool) ? undefined : ownRule(a.personRules, a.tool));
  if (choice === "always") return canAlwaysAllow(a.tool, risk, a.targetKey) ? "run" : "ask";
  if (choice === "ask") return "ask";
  return risk === "INTERNAL" ? "run" : "ask";
}

/** A rule read as an own property, so "constructor" or "__proto__" is never a rule. */
function ownRule(rules: ApprovalRules, key: string): ApprovalChoice | undefined {
  if (!rules || typeof rules !== "object" || !Object.prototype.hasOwnProperty.call(rules, key)) return undefined;
  const v = rules[key];
  return v === "ask" || v === "always" ? v : undefined;
}

const MAX_RULES = 200;

/** A target a scoped choice may name: "conv:<id>". */
const TARGET_KEY = /^[a-z]{2,12}:[A-Za-z0-9_-]{1,64}$/;

/**
 * Stored rules, read defensively (the columns are JSON written by routes and
 * people). At agent level only tool-wide "ask" survives. At person level an
 * "always" that canAlwaysAllow refuses is dropped, Talk keeps only its
 * per-conversation keys, and a target is kept only where a tool is
 * target-scoped. Unknown tools, tools outside `allowedTools` and any other
 * value are dropped; at most 200 keys are kept.
 */
export function sanitizeRules(raw: unknown, o: { level: "agent" | "person"; allowedTools: readonly ToolName[] }): ApprovalRules {
  const out: ApprovalRules = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const allowed = new Set<string>(o.allowedTools);
  let kept = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= MAX_RULES) break;
    if (value !== "ask" && value !== "always") continue;
    const at = key.indexOf(":");
    const tool = at < 0 ? key : key.slice(0, at);
    const target = at < 0 ? null : key.slice(at + 1);
    if (!isToolName(tool) || !allowed.has(tool)) continue;
    if (target === ESCALATED) {
      // The person's choice for a tool's calls above its own class: theirs
      // alone, and only for a tool whose own class can escalate to OUTWARD.
      if (o.level !== "person" || BASE_RISK[tool] !== "INTERNAL") continue;
      if (value === "always" && !canAlwaysAllow(tool, "OUTWARD", null)) continue;
      out[key] = value;
      kept += 1;
      continue;
    }
    if (target !== null && !TARGET_KEY.test(target)) continue;
    if (o.level === "agent") {
      if (value !== "ask" || target !== null) continue;
    } else {
      if (target !== null && !TARGET_SCOPED_ALWAYS.has(tool)) continue;
      if (target === null && TARGET_SCOPED_ALWAYS.has(tool)) continue;
      if (value === "always" && !canAlwaysAllow(tool, BASE_RISK[tool], target)) continue;
    }
    out[key] = value;
    kept += 1;
  }
  return out;
}
