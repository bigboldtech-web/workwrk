// What the browser routes answer (docs/plans/ai-teammates-phase4.md step 2):
// a session as its person sees it, its steps as kinds and hosts only (never a
// page's address path, an element's words or typed text, Decision 23), and
// the workspace's policy as Owners and Admins see it, usage as numbers only
// (Decision 30).
//
// Pure: types and words, safe on the client.

import { BROWSER_PANEL_COPY, BROWSER_POLICY_COPY, RECORDING_COPY } from "@/lib/agents/teammate-copy";
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
  /**
   * The card its session waits on, live, waiting or handed over (review of
   * Phase 4 step 4: handed over too), else null. "show_me": the teammate's
   * ask to be shown how (Phase 5 step 2), which only Show how answers, never
   * the browser card's Take over (takeOverRequestOf names none for it).
   */
  waiting: { actionId: string; kind: "act" | "take_over" | "show_me" } | null;
  steps: BrowserStepView[];
  shots: Array<{ id: string; kind: "page" | "element"; at: string; expiresAt: string }>;
  /** The person is showing the teammate how in it (Phase 5 step 2): their own skill's name and its steps so far, else null. */
  recording: { skillId: string; name: string; steps: number; full: boolean } | null;
  /** Show how may start a recording now: skills available here, the teammate holding use_skill, live or waiting, 3 minutes or more left, no recording of this person (Phase 5 step 2). */
  canRecord: boolean;
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
  /** Teaching teammates by showing (Phase 5 Decision 2): the workspace's switch, whether this WorkwrK offers it, and how many skills are kept and by how many people (numbers only, Decision 25), null where it is not offered or the computer is not available. */
  skillsEnabled: boolean;
  skillsOffered: boolean;
  skills: { kept: number; people: number } | null;
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

const ASKED_WORDS: Readonly<Record<string, (s: string) => string>> = BROWSER_PANEL_COPY.ASKED_WORDS;

/**
 * What a step did, by its kind and host alone. A step that waited on its
 * card reads as the ask (review round 3 follow-up of Phase 4): "Asked to
 * click on", not "Clicked on", since the click, once approved and done, is
 * its own step after it. A recording's start and end (Phase 5 step 2: a
 * take_over and a give_back with code "recording") read as showing how.
 */
export function stepLine(s: { kind: StepKind; site: string | null; outcome: StepOutcome; code?: string | null }): string {
  const site = hostOf(s.site) ?? STEP_WORDS.unknownSite;
  const asked = s.outcome === "waiting" ? ASKED_WORDS[s.kind] : undefined;
  if (asked) return asked(site);
  if (s.code === "recording" && s.kind === "take_over") return RECORDING_COPY.STEP_WORDS.recording(site);
  if (s.code === "recording" && s.kind === "give_back") return RECORDING_COPY.STEP_WORDS.recordingEnd;
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
 *
 * An ask waits only while its card is the one the session waits on
 * (review round 3 follow-up of Phase 4). Steps are never rewritten, so
 * once that card is decided, expired or its browser closed, the ask's row
 * still says "waiting"; it then shows as the ask alone, without "waiting
 * for you" (the step after it, if any, says what came of it).
 */
export function stepViewOf(
  s: { seq: number; kind: string; site: string | null; outcome: string; code: string | null; at: Date; shotId: string | null; actionId?: string | null },
  waitingActionId: string | null = null,
): BrowserStepView {
  const kind = s.kind as StepKind;
  const stored = s.outcome as StepOutcome;
  const site = hostOf(s.site);
  const line = stepLine({ kind, site, outcome: stored, code: s.code });
  const stillWaiting = stored === "waiting" && !!s.actionId && s.actionId === waitingActionId;
  const outcome: StepOutcome = stored === "waiting" && !stillWaiting ? "ok" : stored;
  return { seq: s.seq, kind, site, outcome, code: s.code, at: s.at.toISOString(), shotId: s.shotId, line };
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

/**
 * The take over request a browser card's own Take over answers (review of
 * Phase 4 step 4): the one its session waits on, so the request is decided
 * with the take over and Done continues the chat once. Null when none waits,
 * or when what waits is a step (Take over then names nothing).
 */
export function takeOverRequestOf(v: Pick<BrowserSessionView, "waiting"> | null | undefined): string | null {
  return v?.waiting?.kind === "take_over" ? v.waiting.actionId : null;
}

/**
 * What a browser card drawn for a take over request (approval-card.tsx
 * `takeOverFor`) does with a read of its session (review of Phase 4 step 4):
 *   take  the browser is open and that request still waits, whether the
 *         browser is live, waiting or already handed over (taken from the
 *         browser card without naming it): take it over for the request, so
 *         the request is answered and Done continues the chat
 *   done  the request no longer waits (handed over through it already, or
 *         decided elsewhere) or the browser closed: nothing is sent, now or
 *         at any later read, so Done never asks a second time
 */
export function takeOverForStep(v: Pick<BrowserSessionView, "status" | "waiting">, actionId: string): "take" | "done" {
  if (browserCardState(v) === "closed") return "done";
  return takeOverRequestOf(v) === actionId ? "take" : "done";
}

/** Where a picture of a page is read from: the person's own, through its route only (Decision 16). Null for an id that is not one. */
export function shotSrc(id: string | null | undefined): string | null {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return `/api/teammate-browser/shots/${encodeURIComponent(id)}`;
}

/**
 * The newest picture of a page the teammate showed the person and the route
 * still keeps (review of Phase 4 step 4): what an open browser card shows as
 * a thumbnail, so a show_page picture is seen while the browser is open, not
 * only once it closed. A picture of what an act would touch (kind element) is
 * its approval card's, never this one. Null when none is kept.
 */
export function newestPageShot(v: Pick<BrowserSessionView, "shots">): string | null {
  let best: { id: string; at: string } | null = null;
  for (const s of v.shots) {
    if (s.kind !== "page" || !shotSrc(s.id)) continue;
    // The route lists them oldest first; a later one at the same moment is the newer.
    if (!best || s.at >= best.at) best = s;
  }
  return best?.id ?? null;
}

/**
 * Whether Settings, Apps & modules draws the computer's section for an answer
 * (review of Phase 4 step 4): only once it is known to be available, or held
 * back by the plan, a trial or a closed workspace. Nothing while it loads, nor
 * where this WorkwrK does not offer the computer (production until the
 * founder configures it), so the section never flashes its card there.
 */
export function browserSectionShown(v: Pick<BrowserPolicyView, "available" | "reason"> | null | undefined): boolean {
  if (!v) return false;
  if (v.available) return true;
  return v.reason === "plan" || v.reason === "trial" || v.reason === "workspace_closed";
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
