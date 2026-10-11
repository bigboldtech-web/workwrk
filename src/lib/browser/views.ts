// What the browser routes answer (docs/plans/ai-teammates-phase4.md step 2):
// a session as its person sees it, its steps as kinds and hosts only (never a
// page's address path, an element's words or typed text, Decision 23), and
// the workspace's policy as Owners and Admins see it, usage as numbers only
// (Decision 30).
//
// Pure: types and words, safe on the client.

import { BROWSER_PANEL_COPY, BROWSER_POLICY_COPY } from "@/lib/agents/teammate-copy";
import type { EndReason, SessionStatus, StepKind, StepOutcome } from "./types";

/** Why the computer cannot be used here, each its own reason (Decision 33; sessions.ts computerAccess). */
export type ComputerRefusal = "not_configured" | "workspace_closed" | "trial" | "plan" | "workspace_off" | "no_sites";

export interface BrowserUsage {
  minutesUsed: number;
  minutesCap: number;
  atOnce: number;
  atOnceCap: number;
  sessionsToday: number;
  sessionsTodayCap: number;
  /** About this month's cost, from the rate the founder set (Decision 34), or null. */
  costCents: number | null;
}

export interface BrowserStepView {
  seq: number;
  kind: StepKind;
  site: string | null;
  outcome: StepOutcome;
  code: string | null;
  at: string;
  shotId: string | null;
  line: string;
}

export interface BrowserSessionView {
  id: string;
  /** The workspace it was read in (step 4): every write from its card sends it, and a session switched in another tab answers workspace_changed. */
  organizationId: string;
  agentId: string;
  agentName: string;
  status: SessionStatus;
  site: string | null;
  startedAt: string;
  endsBy: string;
  endedAt: string | null;
  endReason: EndReason | null;
  endedLine: string | null;
  minutes: number;
  waiting: { actionId: string; kind: "act" | "take_over" } | null;
  steps: BrowserStepView[];
  shots: Array<{ id: string; kind: "page" | "element"; at: string; expiresAt: string }>;
}

export interface BrowserPolicyView {
  /** The workspace it was read in (step 4): every change from the section sends it. */
  organizationId: string;
  /** The computer can be turned on here: this WorkwrK offers it, the plan has it, the workspace is live and not on a trial. */
  available: boolean;
  /** Why not, when not (never workspace_off, which is the switch itself). */
  reason: ComputerRefusal | null;
  plan: string;
  region: string | null;
  enabled: boolean;
  allowSites: string[];
  blockSites: string[];
  usage: BrowserUsage | null;
  updatedAt: string | null;
}

const STEP_WORDS = BROWSER_PANEL_COPY.STEP_WORDS;

/** A host as a step or a card names it: letters, digits, hyphens and underscores between dots. */
const HOST = /^(?=.{1,253}$)[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;

/**
 * A site reduced to its host, or null (step 4: "a view's steps never carry a
 * path"). Steps keep a host only (Decision 23), so this is the last guard: a
 * value that carries more (a path, a query, a user name, a port) shows its
 * host alone, and one that is not a host at all shows as no site.
 */
export function hostOf(site: string | null | undefined): string | null {
  if (typeof site !== "string") return null;
  const t = site.trim().toLowerCase();
  if (!t) return null;
  if (HOST.test(t)) return t;
  // An address with a scheme as it is; anything else as a host with more after it ("site/path", "user@site:port").
  const whole = /^[a-z][a-z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`;
  const parsed = URL.canParse(whole) ? new URL(whole) : null;
  const host = parsed?.hostname ?? "";
  return HOST.test(host) ? host : null;
}

/** What a step did, by its kind and host alone. */
export function stepLine(s: { kind: StepKind; site: string | null; outcome: StepOutcome }): string {
  const site = hostOf(s.site) ?? STEP_WORDS.unknownSite;
  switch (s.kind) {
    case "open":
    case "read":
    case "find":
    case "scroll":
    case "show":
    case "click":
    case "type":
    case "select":
    case "take_over":
      return STEP_WORDS[s.kind](site);
    case "give_back":
      return STEP_WORDS.give_back;
    case "close":
      return STEP_WORDS.close;
    default:
      return STEP_WORDS.end;
  }
}

/** Why a session closed, as its card and the chat line say it. */
export function endedLine(reason: EndReason | null): string {
  if (!reason) return BROWSER_PANEL_COPY.closed;
  const words = (BROWSER_PANEL_COPY.ENDED_WORDS as Readonly<Record<string, string>>)[reason];
  return words ?? BROWSER_PANEL_COPY.closed;
}

/**
 * One step as its person's card lists it, from its row: its host alone
 * (hostOf), never an address path, an element's words or typed text.
 */
export function stepViewOf(s: { seq: number; kind: string; site: string | null; outcome: string; code: string | null; at: Date; shotId: string | null }): BrowserStepView {
  const kind = s.kind as StepKind;
  const outcome = s.outcome as StepOutcome;
  const site = hostOf(s.site);
  return { seq: s.seq, kind, site, outcome, code: s.code, at: s.at.toISOString(), shotId: s.shotId, line: stepLine({ kind, site, outcome }) };
}

/** The word after a step's line for its outcome ("not allowed"), empty for one that went as asked. */
export function outcomeWord(outcome: StepOutcome): string {
  return (BROWSER_PANEL_COPY.OUTCOME_WORDS as Readonly<Record<string, string>>)[outcome] ?? "";
}

/**
 * What the browser card shows for a session (step 4): live (Watch and Take
 * over offered), waiting (a step waits for the person's card), handed over
 * (the person has it), or closed. A browser still starting reads as live
 * (its live view answers busy until it is), one ending as closed.
 */
export type BrowserCardState = "live" | "waiting" | "handed_over" | "closed";

export function browserCardState(v: Pick<BrowserSessionView, "status" | "waiting">): BrowserCardState {
  switch (v.status) {
    case "handed_over":
      return "handed_over";
    case "waiting":
      return "waiting";
    case "live":
    case "starting":
      return v.waiting ? "waiting" : "live";
    default:
      return "closed";
  }
}

/** Where a picture of a page is read from: the person's own, through its route only (Decision 16). Null for an id that is not one. */
export function shotSrc(id: string | null | undefined): string | null {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return `/api/teammate-browser/shots/${encodeURIComponent(id)}`;
}

/** About this month's cost, in US dollars (Decision 34: only from the founder's rate). */
export function costWords(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.max(0, cents) / 100);
}

/** The usage lines the settings section shows (Decision 30: numbers only), the cost only when a rate is set. */
export function usageLines(u: BrowserUsage): string[] {
  const P = BROWSER_POLICY_COPY;
  const lines = [P.minutes(u.minutesUsed, u.minutesCap), P.atOnce(u.atOnce, u.atOnceCap), P.today(u.sessionsToday, u.sessionsTodayCap)];
  if (typeof u.costCents === "number" && Number.isFinite(u.costCents)) lines.push(P.cost(costWords(u.costCents)));
  return lines;
}

/** A session row's minutes: what it was billed once ended, else the minutes it has run, at least one once started. */
export function sessionMinutes(row: { status: string; startedAt: Date; endedAt: Date | null; billedMinutes: number | null; reservedMinutes: number }, now: Date): number {
  if (row.status === "ended") return Math.max(0, row.billedMinutes ?? row.reservedMinutes);
  const ran = Math.ceil((now.getTime() - row.startedAt.getTime()) / 60_000);
  return Math.max(0, Math.min(row.reservedMinutes, ran));
}
