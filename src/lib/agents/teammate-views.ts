// What the AI teammate routes answer with (docs/plans/ai-teammates.md 4), as
// the page, the settings drawer and the store read it: a teammate's row in
// the list and its settings, the table of its tools and who decides each, a
// routine, and a run on the activity tab. The server reads the rows
// (teammate-server.ts); this file only shapes them, so the client and the
// tests read one thing.
//
// NO COST IN CENTS. What a teammate used is counted in AI questions, the unit
// the plan sells; AgentRun.costCents is an estimate no teammate surface
// shows.
//
// Pure: no prisma, no fetch.

import type { ConnectorRefusal } from "@/lib/connectors/connections";
import { TOOL_PRODUCT, type ConnectorProduct, type ProductSet } from "@/lib/connectors/products";
import type { TeammateHue } from "./hues";
import { routineReasonText } from "./routines";
import { describeSchedule, scheduleZone, serverTimeZone, wordsInZone } from "./schedule-words";
import type { TeammateVisibility } from "./teammate-access";
import { LEGACY_COPY, TOOL_PICKER_COPY, type LegacyStopReason } from "./teammate-copy";
import {
  ALWAYS_ASK,
  BASE_RISK,
  TARGET_SCOPED_ALWAYS,
  TEAMMATE_EXCLUDED,
  canAlwaysAllow,
  gateFor,
  sanitizeRules,
  type ApprovalChoice,
  type ApprovalRules,
  type ToolRisk,
} from "./tool-policy";
import { PPMS_TOOL_NAMES, TEAMMATE_TOOL_NAMES, isConnectorToolName, isToolName, type ToolName } from "./tool-names";

// ── A teammate ──────────────────────────────────────────────────────

export type TeammateStatus = "ENABLED" | "DISABLED" | "ARCHIVED";

/** One teammate in the list (GET /api/agents/teammates), for the person reading it. */
export interface TeammateRow {
  id: string;
  slug: string;
  name: string;
  /** Its one job (Agent.description). */
  job: string;
  /** The tile's colour; null is the neutral tile. */
  hue: TeammateHue | null;
  /** An icon name from the Space icon catalog; null shows the name's initial. */
  avatar: string | null;
  visibility: TeammateVisibility;
  status: TeammateStatus;
  /** The starter template it was made from. */
  template: string | null;
  /**
   * An agent the workspace had before teammates (Agent.toolNames null): it
   * keeps the legacy tool set and never counts toward the plan's limit.
   */
  legacy: boolean;
  canManage: boolean;
  /** How many of its requests wait for this person's decision. */
  waiting: number;
  /** An answer or a report this person has not opened yet. */
  unread: boolean;
  /** The time of the chat's newest message (ISO); null before the first. */
  lastAt: string | null;
  /** The row's second line (teammate-thread.ts lastLineFor); null shows the job. */
  lastLine: string | null;
}

/** What a teammate used in a UTC month, in AI questions. */
export interface TeammateUsage {
  /** The month's first day, YYYY-MM-DD (UTC). */
  month: string;
  /** The questions its turns kept this month, everyone's together. */
  used: number;
  /** Its own monthly limit; null when it has none. */
  cap: number | null;
}

/** One teammate's settings (GET /api/agents/teammates/[slug]). */
export interface TeammateDetail extends TeammateRow {
  /** Its instructions (Agent.systemPrompt); read-only for whoever does not manage it. */
  instructions: string;
  /** The tools it may use now (teammate-tools.ts teammateToolNames, with this workspace's modules). */
  toolNames: ToolName[];
  monthlyQuestionCap: number | null;
  usage: TeammateUsage;
  tools: ToolSetting[];
  /** This person's chat with it, once there is one. */
  sessionId: string | null;
}

export interface TeammateLimit {
  used: number;
  /** Null: no limit on this plan. */
  max: number | null;
}

/** The plan's limits (TEAMMATE_LIMITS) as the list shows them. */
export interface TeammateLimits {
  /** The person's own (PRIVATE) teammates. */
  personal: TeammateLimit;
  /** The workspace's shared teammates; agents it had before teammates never count. */
  workspace: TeammateLimit;
}

// ── Tools and approvals ─────────────────────────────────────────────

/** Every tool a teammate may be given, in the picker's order, whatever is on (the tests read every name). */
export const GIVABLE_TOOLS: readonly ToolName[] = (Object.keys(TOOL_PICKER_COPY) as string[]).filter(
  (n): n is ToolName => isToolName(n) && !TEAMMATE_EXCLUDED.has(n),
);

/** The Google product each connector tool needs (products.ts TOOL_PRODUCT), as the picker reads it. */
export const TOOL_CONNECTOR = TOOL_PRODUCT;

/**
 * The tools a teammate may be given here: GIVABLE_TOOLS without the Google
 * tools of a product that is off (docs/plans/ai-teammates-phase3.md), so a
 * row that could never work is never shown.
 */
export function givableTools(connectors: ProductSet): ToolName[] {
  // Read as teammateToolNames reads it: a caller that left it out gets no Google row.
  return GIVABLE_TOOLS.filter((n) => !isConnectorToolName(n) || connectors?.[TOOL_CONNECTOR[n]] === true);
}

/**
 * What stands between a teammate and the reader's own Google now, for one
 * product, as a Google tool's row in the picker says it
 * (docs/plans/ai-teammates-phase3.md step 5; teammate-copy.ts
 * TOOL_PICKER_NOTES): nothing (ready); no connection here (connect_first);
 * one that stopped working (reconnect); one that lacks the product
 * (not_granted); for a teammate someone else may change, no allow from this
 * person (allow_first), or an allow from before it changed (changed).
 * connections.ts connectorAccess decides each, in its own order, so the row
 * says what a turn would meet.
 */
export type ConnectorRowState = "ready" | "connect_first" | "reconnect" | "not_granted" | "allow_first" | "changed";

export const CONNECTOR_ROW_STATES: readonly ConnectorRowState[] = ["ready", "connect_first", "reconnect", "not_granted", "allow_first", "changed"];

/** Per product, how its rows read for this person (teammate-server.ts connectorRowStates). */
export type ConnectorRowStates = Readonly<Record<ConnectorProduct, ConnectorRowState>>;

/**
 * What the rows read before anything is known, and on a WorkwrK that offers
 * no Google, where no Google row is drawn at all.
 */
export const NO_GOOGLE_ROWS: ConnectorRowStates = Object.freeze({ gmail: "connect_first", calendar: "connect_first" });

/**
 * A row's state from connectorAccess's answer. A product off in the
 * workspace, or a WorkwrK with no Google, has no row (givableTools), so the
 * two read as having nothing connected.
 */
export function connectorRowState(access: { ok: true } | { ok: false; reason: ConnectorRefusal }): ConnectorRowState {
  if (access.ok) return "ready";
  switch (access.reason) {
    case "needs_reconnect":
      return "reconnect";
    case "not_granted":
      return "not_granted";
    case "not_allowed":
      return "allow_first";
    case "teammate_changed":
      return "changed";
    case "not_connected":
    case "workspace_off":
    case "not_configured":
      return "connect_first";
  }
}

/** Every tool name, for rules kept while a tool is switched off (actions.ts keeps them too). */
export const ALL_TOOL_NAMES: readonly ToolName[] = [...PPMS_TOOL_NAMES, ...TEAMMATE_TOOL_NAMES];

/**
 * The module a tool needs. teammate-tools.ts teammateToolNames takes these
 * tools out while their module is off (teammate-views.test.ts holds the two
 * to each other); the picker says why they are off.
 */
export const TOOL_MODULE: Readonly<Partial<Record<ToolName, "talk" | "tables">>> = {
  post_in_talk: "talk",
  read_talk: "talk",
  create_data_table: "tables",
  list_data_tables: "tables",
};

/** One of the person's choices for one target of a tool. */
export interface ScopedChoice {
  /** The stored key: "post_in_talk:conv:<id>", or "<tool>:outward". */
  key: string;
  /** What follows the tool: "conv:<id>", or "outward" for its calls above its own class. */
  target: string;
  choice: ApprovalChoice;
  /** The conversation as the person sees it ("#general"); null when the target is not one, or they are no longer in it. */
  label: string | null;
}

/** One row of the Tools and approvals tab (PUT .../approvals answers the whole table). */
export interface ToolSetting {
  name: ToolName;
  label: string;
  description: string | null;
  /** Its own class, before any input. */
  risk: ToolRisk;
  /** In the teammate's tool set now. */
  enabled: boolean;
  /** Off because the module it needs is off in this workspace. */
  unavailable: "talk_off" | "tables_off" | null;
  /** Its managers' "Ask everyone first". */
  agentRule: "ask" | null;
  /** The person's own choice for the tool as a whole. */
  personRule: ApprovalChoice | null;
  /** What an ordinary call of it does now: runs, or asks first. */
  gate: "run" | "ask";
  /** Whether "Don't ask" may be chosen for the tool as a whole. */
  canDontAsk: boolean;
  /** Asks first whatever anyone chooses (inviting people). */
  alwaysAsks: boolean;
  /** The person's choices for one target: a Talk conversation, or its calls for other people. */
  scoped: ScopedChoice[];
  /** A Google tool: its product, and what stands between it and the reader's own Google now. Null for any other tool. */
  connector: { product: ConnectorProduct; state: ConnectorRowState } | null;
}

function ownChoice(rules: ApprovalRules, key: string): ApprovalChoice | null {
  if (!Object.prototype.hasOwnProperty.call(rules, key)) return null;
  const v = rules[key];
  return v === "ask" || v === "always" ? v : null;
}

/**
 * The table of a teammate's tools for one person: each tool's class, whether
 * it is on, its managers' tightening, the person's own choices, and what a
 * call does now (tool-policy.ts gateFor, for a call of the tool's own class
 * with no target). A Google tool has a row only while its product is on here
 * (givableTools), with what stands between it and the person's own Google.
 */
export function toolSettings(a: {
  /** The tools the teammate may use now. */
  enabled: readonly ToolName[];
  /** Agent.approvalRules, as stored. */
  agentRules: unknown;
  /** The person's AgentPersonSetting.approvalRules, as stored. */
  personRules: unknown;
  talkOn: boolean;
  tablesOn: boolean;
  /** The conversations the person's Talk choices name: "conv:<id>" to "#general". */
  targetLabels?: Readonly<Record<string, string>>;
  /** The Google products on here (connections.ts workspaceConnectorProducts): a product off has no rows. */
  connectors: ProductSet;
  /** How each product's rows read for this person (teammate-server.ts connectorRowStates). */
  google: ConnectorRowStates;
}): ToolSetting[] {
  const on = new Set<string>(a.enabled);
  const agentRules = sanitizeRules(a.agentRules, { level: "agent", allowedTools: ALL_TOOL_NAMES });
  const personRules = sanitizeRules(a.personRules, { level: "person", allowedTools: ALL_TOOL_NAMES });
  const labels = a.targetLabels ?? {};
  const scoped = new Map<string, ScopedChoice[]>();
  for (const [key, choice] of Object.entries(personRules)) {
    const at = key.indexOf(":");
    if (at < 0) continue;
    const tool = key.slice(0, at);
    const target = key.slice(at + 1);
    const label = Object.prototype.hasOwnProperty.call(labels, target) ? labels[target] : null;
    scoped.set(tool, [...(scoped.get(tool) ?? []), { key, target, choice, label }]);
  }
  return givableTools(a.connectors).map((name): ToolSetting => {
    const risk = BASE_RISK[name];
    const needs = TOOL_MODULE[name] ?? null;
    const copy = TOOL_PICKER_COPY[name];
    const product = isConnectorToolName(name) ? TOOL_CONNECTOR[name] : null;
    return {
      name,
      label: copy.label,
      description: copy.description ?? null,
      risk,
      enabled: on.has(name),
      unavailable: needs === "talk" && !a.talkOn ? "talk_off" : needs === "tables" && !a.tablesOn ? "tables_off" : null,
      agentRule: ownChoice(agentRules, name) === "ask" ? "ask" : null,
      // Talk's choice is only ever per conversation (in `scoped`).
      personRule: TARGET_SCOPED_ALWAYS.has(name) ? null : ownChoice(personRules, name),
      gate: gateFor({ tool: name, risk, targetKey: null, agentRules, personRules }),
      canDontAsk: risk !== "READ" && !TARGET_SCOPED_ALWAYS.has(name) && canAlwaysAllow(name, risk, null),
      alwaysAsks: risk === "IRREVERSIBLE" || ALWAYS_ASK.has(name),
      scoped: scoped.get(name) ?? [],
      connector: product ? { product, state: a.google?.[product] ?? NO_GOOGLE_ROWS[product] } : null,
    };
  });
}

/** A tool list as a teammate stores it (Agent.toolNames): real tools, none of TEAMMATE_EXCLUDED, each once, sorted. */
export function cleanToolNames(raw: readonly unknown[]): ToolName[] {
  const out = new Set<ToolName>();
  for (const n of raw) if (typeof n === "string" && isToolName(n) && !TEAMMATE_EXCLUDED.has(n)) out.add(n);
  return [...out].sort();
}

/** A rule key a request may name: a tool, or a tool and one target. */
const RULE_KEY = /^[a-z][a-z_]{1,63}(?::[A-Za-z0-9_:-]{1,80})?$/;

/**
 * The person's own approval choices after their edits from the settings
 * (null removes a choice), as sanitizeRules keeps them at person level. A
 * "Don't ask" for one target (a Talk conversation) or for a tool's calls
 * above its own class is never set here: only an approval card offers and
 * stores those (tool-policy.ts escalatedRuleKey), so here they can only be
 * removed. Rules for a tool switched off for now are kept, as an approval
 * card keeps them: they are the person's choices.
 */
export function editedPersonRules(stored: unknown, edits: Readonly<Record<string, ApprovalChoice | null>>): ApprovalRules {
  const rules: ApprovalRules = { ...sanitizeRules(stored, { level: "person", allowedTools: ALL_TOOL_NAMES }) };
  for (const [key, value] of Object.entries(edits)) {
    if (!RULE_KEY.test(key)) continue;
    if (value === null) {
      delete rules[key];
      continue;
    }
    if (value === "always" && key.includes(":")) continue;
    rules[key] = value;
  }
  return sanitizeRules(rules, { level: "person", allowedTools: ALL_TOOL_NAMES });
}

/** Whether two stored rule sets say the same thing. */
export function sameRules(a: ApprovalRules, b: ApprovalRules): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

// ── Routines ────────────────────────────────────────────────────────

/** An AgentRoutine as the routes select it. */
export interface RoutineRowLike {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  status: string;
  pausedReason: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastRunId: string | null;
  lastStatus: string | null;
  lastReason: string | null;
  createdVia: string;
  createdAt: Date;
}

/** One of the person's routines with a teammate (the Routines tab). */
export interface RoutineView {
  id: string;
  name: string;
  /** What it does each time. */
  prompt: string;
  schedule: string;
  /** The schedule in words, its zone named when it is not the viewer's: "Weekdays at 9:00". */
  when: string;
  status: "active" | "paused";
  /** Why it paused (routines.ts RoutineReason); null when its person paused it. */
  pausedReason: string | null;
  /** That reason as a sentence. */
  pausedText: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: "SUCCEEDED" | "FAILED" | "SKIPPED" | null;
  lastReason: string | null;
  lastReasonText: string | null;
  createdVia: "chat" | "settings" | "legacy";
  /** A routine moved from Workspace agents says so (LEGACY_COPY.routineMovedVia); null otherwise. */
  movedVia: string | null;
  createdAt: string;
}

/** The columns routineViewFromRow reads. */
export const ROUTINE_VIEW_SELECT = {
  id: true,
  name: true,
  prompt: true,
  schedule: true,
  status: true,
  pausedReason: true,
  nextRunAt: true,
  lastRunAt: true,
  lastRunId: true,
  lastStatus: true,
  lastReason: true,
  createdVia: true,
  createdAt: true,
} as const;

/** A routine as its row on the Routines tab reads it, in the viewer's zone. */
export function routineViewFromRow(r: RoutineRowLike, viewerZone: string | null): RoutineView {
  const paused = r.status !== "active";
  const lastStatus = r.lastStatus === "SUCCEEDED" || r.lastStatus === "FAILED" || r.lastStatus === "SKIPPED" ? r.lastStatus : null;
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    schedule: r.schedule,
    // A schedule with no zone of its own runs on the server's clock: say so
    // (an old schedule moved onto routines; review round 1).
    when: wordsInZone(describeSchedule(r.schedule, true), scheduleZone(r.schedule, serverTimeZone()), viewerZone),
    status: paused ? "paused" : "active",
    pausedReason: paused ? r.pausedReason : null,
    pausedText: paused ? routineReasonText(r.pausedReason) : null,
    nextRunAt: paused || !r.nextRunAt ? null : r.nextRunAt.toISOString(),
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastRunId: r.lastRunId,
    lastStatus,
    lastReason: r.lastReason,
    lastReasonText: routineReasonText(r.lastReason),
    createdVia: r.createdVia === "settings" || r.createdVia === "legacy" ? r.createdVia : "chat",
    movedVia: r.createdVia === "legacy" ? LEGACY_COPY.routineMovedVia : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── Workspace agents: where an old schedule went ────────────────────

/** What Workspace agents shows for an agent's schedule after Phase 2 (legacy-schedules.ts). */
export interface AgentScheduleView {
  /** "routine": its creator's routine now; "stopped": it stopped, with `reason`; null: never moved. */
  state: "routine" | "stopped" | null;
  /** The first name of the person the routine works for. */
  personName: string | null;
  /** The viewer is that person. */
  isYou: boolean;
  /** Why it stopped (LEGACY_COPY.stopReason), else null. */
  reason: string | null;
  /** Its chat's Routines tab. */
  routinesHref: string;
  /** The routine it became is paused (its creator left, or paused it): it runs no more until it is resumed. */
  paused: boolean;
  /** Why, as the Routines tab says it (routineReasonText), else null. */
  pausedText: string | null;
}

const STOP_REASONS: ReadonlySet<string> = new Set(Object.keys(LEGACY_COPY.stopReason));

/**
 * One agent's schedule line. `routine` is the moved-to routine as read now
 * (null when it was deleted since): a deleted routine reads as never moved,
 * so the row says what is true, "When you ask".
 */
export function agentScheduleView(
  agent: { slug: string; scheduleMovedAt: Date | string | null; scheduleRoutineId: string | null; scheduleMoveReason: string | null },
  routine: { actingForId: string; status?: string | null; pausedReason?: string | null } | null,
  personName: string | null,
  viewerId: string,
): AgentScheduleView {
  const routinesHref = `/agents?chat=${encodeURIComponent(agent.slug)}&settings=routines`;
  const none: AgentScheduleView = { state: null, personName: null, isYou: false, reason: null, routinesHref, paused: false, pausedText: null };
  if (!agent.scheduleMovedAt) return none;
  if (agent.scheduleMoveReason) {
    const reason = STOP_REASONS.has(agent.scheduleMoveReason) ? LEGACY_COPY.stopReason[agent.scheduleMoveReason as LegacyStopReason] : null;
    return { ...none, state: "stopped", reason };
  }
  if (!agent.scheduleRoutineId || !routine) return none;
  // A paused routine says so: the only page the whole workspace sees must not
  // read as running for an agent that will not run again (review round 1).
  const paused = Boolean(routine.status) && routine.status !== "active";
  return {
    state: "routine",
    personName,
    isYou: routine.actingForId === viewerId,
    reason: null,
    routinesHref,
    paused,
    pausedText: paused ? routineReasonText(routine.pausedReason) : null,
  };
}

// ── Activity ────────────────────────────────────────────────────────

/** One run on a teammate's Activity tab: what happened, never what it cost. */
export interface TeammateRunRow {
  id: string;
  /** run-view.ts runTrigger. */
  trigger: string;
  /** run-view.ts runStatus: SUCCEEDED, FAILED or RUNNING. */
  status: string;
  summary: string;
  /** The run's words and results are not this viewer's to read (run-view.ts canReadRunDetail). */
  detailHidden: boolean;
  practice: boolean;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  error: string | null;
}
