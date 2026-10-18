// The rules every browser call is held to, as the executor, the approval
// queue, the cards and the tools read them (docs/plans/ai-teammates-phase4.md
// step 3). Pure: the copy file, the name lists and the browser's own pure
// modules, nothing that reads a database or drives a browser.
//
// EVERY REFUSAL NAMES ITS REAL REASON (Decision 33): the computer not set
// up, the workspace closed, a trial, the plan, the switch off, no site, the
// browser another teammate's or the person's own, the caps, the provider,
// where the turn runs; never only "This teammate can't use that tool".
//
// WHAT THE MODEL READS OF A STEP IS ITS KIND (Decision 15): a card's title
// quotes an element's words, which the page wrote, so the model and the
// history name a browser card by browserTitle, never by its title. The card
// the person reads (browserCard) shows the page, the element, every word to
// type and the site.
//
// WHAT IS KEPT (Decision 23): a call record keeps the site and a count
// (browserStored), never the page's text or an address; an audit row the
// site, the kind and the element's role (browserAuditFacts), never its words
// or typed text.
//
// A CARD STORES WHAT IT COMPARES, NEVER THE SECRET (review round 1 of Phase
// 4). AgentAction.input lives as long as the account, in the backups and in
// the export, so a card keeps the page's origin (what siteVerdict reads),
// its address only as sealed words (pageKeyHash: what the approval compares)
// and its Page line as a person reads it (site and path, the path redacted
// as a read shows it); the element's name and link only sealed
// (snapshot.ts sealFingerprint), its words for the card redacted. A card
// stored before keeps its address and raw words: read here into the same
// form, it compares as before, or fails as a page that changed. The
// element's anchor is sealed too (review round 2 of Phase 4: the reader's
// unkeyed 32 bit hash of its row's raw words gave a short code in that row
// back to anyone who tried every value); a card stored before it keeps the
// reader's hash, sealed here in memory the same way.
//
// THE LIMITS (Decision 22): per answer at most 20 browser calls, 8 opens, 6
// reads, 6 finds, 8 scrolls, 3 pictures, 1 step asked, 1 take over request
// and 1 session started (BROWSER_TOOL_COUNTS, classes.ts BROWSER_TURN_LIMITS).

import { BROWSER_TURN_LIMITS, CLICK_WARNINGS, type ClickWarning } from "@/lib/browser/classes";
import { redactPageText } from "@/lib/browser/redact";
import { sealWords, type SealedFingerprint } from "@/lib/browser/snapshot";
import type { SiteVerdict } from "@/lib/browser/sites";
import { END_HOLDS, FIELD_KINDS, OPTION_LABEL_MAX, OPTIONS_MATCH_MAX, type ActOutcome, type EndReason, type NavOutcome, type StepKind } from "@/lib/browser/types";
import { endedLine } from "@/lib/browser/views";
import { clampText } from "./clamp";
import { plainData } from "./plain-data";
import { ACTION_VERB, BROWSER_COPY, BROWSER_PANEL_COPY, BROWSER_TITLES, END_LINES_ADDING_NOTHING, TOOL_PICKER_COPY, quotedTitle } from "./teammate-copy";
import type { ActionPreview } from "./teammate-thread";
import type { BrowserToolName } from "./tool-names";

// ── Refusals ────────────────────────────────────────────────────────

/** Every reason a browser call can be refused before it reaches a page (sessions.ts ComputerRefusal, OpenRefusal and UseRefusal, browser-access.ts teammate_off). */
export type BrowserRefusal =
  | "not_configured"
  | "workspace_closed"
  | "trial"
  | "plan"
  | "workspace_off"
  | "no_sites"
  | "teammate_off"
  | "other_teammate"
  | "busy"
  | "person_today"
  | "workspace_today"
  | "workspace_at_once"
  | "platform_at_once"
  | "month_used"
  | "provider_unavailable"
  | "provider_busy"
  | "start_failed"
  | "none"
  | "ended"
  | "other_turn"
  | "person_has_it"
  | "restarted"
  | "time_cap"
  | "closed_in_answer"
  | "not_reached";

/**
 * A browser that closed, in its end's own words (review round 1 of Phase 4):
 * "WorkwrK restarted" only when it did, the time cap with its minutes when
 * they are known, and every other end in a sentence of its own that names
 * the reason as the browser card does (BROWSER_COPY.closedBecause, Decision
 * 33). Follow-up to review round 1 of Phase 4: before, the switch, the plan
 * and a closed workspace borrowed a fresh call's refusal, and every other
 * end put the card's line after "Open a page to start a new one". An end
 * with no known reason says only that the browser closed. Here since review
 * round 4 of Phase 4, so the executor's card and every refusal read it too
 * (browser-tools.ts exports it as before).
 *
 * `mayOpen: false` (review round 5 of Phase 4): the answer told can start
 * no browser (one that read anything, Decision 11; one that used its one
 * start, Decision 22; a card's approval, whose continue starts tainted,
 * Decision 15), so the two sentences that invite a new one say instead
 * that this answer can't (BROWSER_COPY.restartedNoOther, closedNoOther).
 * Left out, as before.
 *
 * A start that failed (polish after review round 6 of Phase 4) never drew a
 * browser card and never closed: it says so in its own words, no page open
 * (noBrowserYet where the answer may still start one, startFailedNoOther
 * where it can't), never "the browser card says why".
 *
 * `noCard` (last polish of Phase 4): the browser closed while it was
 * starting, so no browser card was drawn (sessions.ts runEnds reads its
 * browser_started line): its end's line is quoted as the chat shows it
 * (BROWSER_COPY.closedNoCard), never "the browser card says why".
 *
 * The teammate's words. At an approval the person reads closedForPersonLine.
 */
export function closedSentence(endReason: string | null | undefined, minutes?: number, o: { mayOpen?: boolean; noCard?: boolean } = {}): string {
  const noOther = o.mayOpen === false;
  if (endReason === "start_failed") return noOther ? BROWSER_COPY.startFailedNoOther : BROWSER_COPY.noBrowserYet;
  const ended: Readonly<Record<string, string>> = BROWSER_PANEL_COPY.ENDED_WORDS;
  // A line that says no reason ("Closed." for a person who left or was deactivated) is not quoted (after the last polish of Phase 4).
  if (o.noCard === true && endReason && Object.hasOwn(ended, endReason)) return addsToStepClosed(ended[endReason]) ? BROWSER_COPY.closedNoCard(ended[endReason]) : BROWSER_COPY.closedNoCardPlain;
  if (endReason === "restarted") return noOther ? BROWSER_COPY.restartedNoOther : BROWSER_COPY.restarted;
  if (endReason === "time_cap" && minutes && minutes > 0) return BROWSER_COPY.timeCap(minutes);
  if (endReason && Object.hasOwn(ended, endReason)) return BROWSER_COPY.closedBecause(ended[endReason]);
  return noOther ? BROWSER_COPY.closedNoOther : BROWSER_COPY.browserClosed;
}

/** Whether an end holds for the rest of its answer (review round 4 of Phase 4, browser/types.ts END_HOLDS). Anything not an end reason does not. */
export function endHolds(endReason: unknown): endReason is EndReason {
  return typeof endReason === "string" && Object.hasOwn(END_HOLDS, endReason) && END_HOLDS[endReason as EndReason] === true;
}

/**
 * open_page refused after a browser of this answer ended for a reason that
 * holds (review round 4 of Phase 4): the card's ended line, quoted, and no
 * invitation to open another. A reason that does not hold reads as the
 * card's plain "Closed.", never as a reason it was not.
 *
 * `anyReason` (review round 5 of Phase 4): open_page after this answer's
 * browser ended for any reason, in an answer that can start no other (one
 * that read anything, Decision 11, or used its one start, Decision 22). It
 * is just as true there, so every known reason is quoted in the card's own
 * words, and only an unknown one reads "Closed.".
 *
 * A start that failed (polish after review round 6 of Phase 4): the retry
 * in the same answer hears the start's own reason (startFailedNoOther),
 * never the browser card, which a failed start never drew, and never "try
 * again": the answer's one start is used, or it read anything.
 *
 * `noCard` (last polish of Phase 4): the browser closed while it was
 * starting (a Stop, the switch, a leave), so no browser card was drawn: the
 * end's line as the chat shows it (BROWSER_COPY.closedForAnswerNoCard).
 */
export function closedForAnswerSentence(endReason: unknown, o: { anyReason?: boolean; noCard?: boolean } = {}): string {
  const ended: Readonly<Record<string, string>> = BROWSER_PANEL_COPY.ENDED_WORDS;
  if (endReason === "start_failed") return BROWSER_COPY.startFailedNoOther;
  // With no card, a line that says no reason is not quoted (after the last polish of Phase 4).
  const say = (why: string) =>
    o.noCard !== true ? BROWSER_COPY.closedForAnswer(why) : addsToStepClosed(why) ? BROWSER_COPY.closedForAnswerNoCard(why) : BROWSER_COPY.closedForAnswerNoCardPlain;
  if (endHolds(endReason)) return say(ended[endReason]);
  const known = o.anyReason === true && typeof endReason === "string" && Object.hasOwn(ended, endReason);
  return say(known ? ended[endReason] : ended.left);
}

/**
 * The end lines that add nothing after "The browser closed before the step
 * could run" (last polish of Phase 4): the card's plain "Closed." (a person
 * who left or was deactivated, BROWSER_PANEL_COPY.ENDED_WORDS) and "It
 * didn't start.", which a browser that ran a card's step never says and which
 * would contradict it. The one list is teammate-copy.ts
 * END_LINES_ADDING_NOTHING, which a session's cancelled cards read too
 * (BROWSER_COPY.cancelledClosed, docs-found fixes batch 5).
 */
const ADDS_NOTHING: ReadonlySet<string> = new Set<string>(END_LINES_ADDING_NOTHING);

function addsToStepClosed(line: string): boolean {
  return !ADDS_NOTHING.has(line.trim());
}

/**
 * At an approval, a browser that closed before its step could run, in the
 * person's own words (polish after review round 6 of Phase 4): what the
 * card's failed line, its chat line and the Inbox show them. The teammate's
 * sentence (closedSentence) speaks of "the person" and of what this answer
 * may open, so it stays the teammate's, told in its outcome note
 * (executor.ts runApprovedAction keeps it). `endReason` is read as the
 * browser card's own end line (views.ts endedLine); none known, or one that
 * adds nothing (addsToStepClosed, last polish of Phase 4: "...so nothing was
 * done. Closed."), the plain line alone.
 */
export function closedForPersonLine(endReason: unknown): string {
  const known = typeof endReason === "string" && Object.hasOwn(BROWSER_PANEL_COPY.ENDED_WORDS, endReason);
  const line = known ? endedLine(endReason as EndReason) : null;
  return BROWSER_PANEL_COPY.stepClosed(line && addsToStepClosed(line) ? line : null);
}

/**
 * A card's own session refused at its approval (useBrowserSession with
 * purpose approval, polish after review round 6 of Phase 4): the teammate's
 * sentence, which never invites a browser (the continue starts tainted,
 * Decision 15), and for a browser that closed or is gone the person's own
 * words (closedForPersonLine). The person holding the browser, and one still
 * starting, are held by the caller, as before.
 */
export function approvalRefusal(
  reason: BrowserRefusal,
  agentName: string,
  first: string,
  extra: { minutes?: number; endReason?: string | null } = {},
): { error: string; forPerson?: string } {
  const error = browserRefusalSentence(reason, agentName, first, { ...extra, mayOpen: false });
  switch (reason) {
    case "ended":
      return { error, forPerson: closedForPersonLine(extra.endReason) };
    case "restarted":
    case "time_cap":
      return { error, forPerson: closedForPersonLine(reason) };
    case "none":
      // The card's session row is gone: closed, for no reason on record.
      return { error, forPerson: closedForPersonLine(null) };
    default:
      return { error };
  }
}

/**
 * Why a browser call can't run now, in the person's words (Decision 33).
 * `first` is the person's first name; `extra` what the refusal carried
 * (another teammate's name, the provider's wait, the workspace's cap, a
 * session's minutes, an end's reason). `mayOpen: false` (last polish of
 * Phase 4 too): a start that failed and used the answer's one start says
 * it can't try again, never "Try again in a moment"; `noCard`: closedSentence's.
 */
export function browserRefusalSentence(
  reason: BrowserRefusal,
  agentName: string,
  first: string,
  extra: { otherName?: string; retryAfter?: number; atOnce?: number; minutes?: number; endReason?: string | null; mayOpen?: boolean; noCard?: boolean } = {},
): string {
  // An answer that can start no browser is never told to open one (closedSentence, review round 5 of Phase 4).
  const may = { mayOpen: extra.mayOpen, noCard: extra.noCard };
  // A failed start that used the answer's one start never says "Try again" (last polish of Phase 4).
  const noOther = extra.mayOpen === false;
  switch (reason) {
    case "not_configured":
      return BROWSER_COPY.notConfigured;
    case "workspace_closed":
      return BROWSER_COPY.workspaceClosed;
    case "trial":
      return BROWSER_COPY.trial;
    case "plan":
      return BROWSER_COPY.plan;
    case "workspace_off":
      return BROWSER_COPY.workspaceOff;
    case "no_sites":
      return BROWSER_COPY.noSites(agentName);
    case "teammate_off":
      return BROWSER_COPY.teammateOff;
    case "other_teammate":
      return extra.otherName ? BROWSER_COPY.otherTeammate(extra.otherName) : BROWSER_COPY.otherTeammateUnnamed;
    case "busy":
      return BROWSER_COPY.starting;
    case "person_today":
      return BROWSER_COPY.personToday(20);
    case "workspace_today":
      return BROWSER_COPY.workspaceToday;
    case "workspace_at_once":
      return BROWSER_COPY.workspaceAtOnce(Math.max(1, Math.floor(extra.atOnce ?? 1)));
    case "platform_at_once":
      return BROWSER_COPY.platformAtOnce;
    case "month_used":
      return BROWSER_COPY.monthUsed;
    case "provider_unavailable":
      return noOther ? BROWSER_COPY.providerUnavailableNoOther : BROWSER_COPY.providerUnavailable;
    case "provider_busy": {
      const wait = Math.max(1, Math.round(extra.retryAfter ?? 30));
      return noOther ? BROWSER_COPY.providerBusyNoOther(wait) : BROWSER_COPY.providerBusy(wait);
    }
    case "start_failed":
      return noOther ? BROWSER_COPY.startFailedNoOther : BROWSER_COPY.startFailed;
    case "none":
      // Never "Open one with open_page first" to an answer that can start none (polish after review round 6 of Phase 4).
      return extra.mayOpen === false ? BROWSER_COPY.noBrowserNoOther : BROWSER_COPY.noBrowserYet;
    case "ended":
      // In its end's own words when the refusal carried them (review round 4 of Phase 4).
      return closedSentence(extra.endReason, extra.minutes, may);
    case "other_turn":
      return BROWSER_COPY.otherTurn;
    case "person_has_it":
      return BROWSER_COPY.personHasIt(first || "The person");
    case "restarted":
      return closedSentence("restarted", undefined, may);
    case "time_cap":
      // With no minutes known, the card's reason, never "Open a page" (review round 4 of Phase 4).
      return closedSentence("time_cap", extra.minutes, may);
    case "closed_in_answer":
      return closedForAnswerSentence(extra.endReason, { noCard: extra.noCard });
    case "not_reached":
      // Not known to be closed (sessions.ts useBrowserSession, after the last polish of Phase 4).
      return BROWSER_COPY.notReachedNow;
  }
}

/** Where a turn runs when that is why it has no browser (Decision 21). */
export type BrowserNotHere = "talk" | "automation" | "delegated" | "routine" | "group";

/** The kind of a turn that never gets the browser; null for the person's own one-teammate chats and continues. */
export function browserNotHereOf(trigger: string, group: boolean): BrowserNotHere | null {
  if (trigger === "TALK") return "talk";
  if (trigger === "AUTOMATION") return "automation";
  if (trigger === "DELEGATED") return "delegated";
  if (trigger === "ROUTINE") return "routine";
  return group ? "group" : null;
}

export function browserNotHereSentence(kind: BrowserNotHere): string {
  switch (kind) {
    case "talk":
      return BROWSER_COPY.notHereTalk;
    case "automation":
      return BROWSER_COPY.notHereAutomation;
    case "delegated":
      return BROWSER_COPY.notHereDelegated;
    case "routine":
      return BROWSER_COPY.notHereRoutine;
    case "group":
      return BROWSER_COPY.notHereGroup;
  }
}

/** Why the guard refuses an address, in the model's words (sites.ts siteVerdict, Decision 9). */
export function verdictSentence(v: Extract<SiteVerdict, { ok: false }>): string {
  const site = v.site ?? BROWSER_PANEL_COPY.STEP_WORDS.unknownSite;
  switch (v.code) {
    case "not_allowed":
      return BROWSER_COPY.notAllowedSite(site);
    case "blocked":
      return BROWSER_COPY.blockedSite(site);
    case "never":
      return BROWSER_COPY.neverSite;
    case "not_https":
      return BROWSER_COPY.notHttps;
    default:
      return BROWSER_COPY.badAddress;
  }
}

/** Why a navigation stopped where it was (cdp-driver.ts navigate; step 2's "unreachable" its own sentence). */
export function navSentence(o: Extract<NavOutcome, { ok: false }>): string {
  switch (o.code) {
    case "blocked_hop":
      return BROWSER_COPY.redirectRefused(o.host ?? BROWSER_PANEL_COPY.STEP_WORDS.unknownSite);
    case "not_html":
      return BROWSER_COPY.notAPage;
    case "timeout":
      return BROWSER_COPY.pageTooSlow;
    case "private_address":
      return BROWSER_COPY.privateAddress;
    case "unreachable":
      return BROWSER_COPY.unreachable;
    case "lost":
      return BROWSER_COPY.browserClosed;
  }
}

/**
 * Why an act did nothing, or may have done something (Decision 14): an
 * element not found again, a different count of twins, or covered, is a page
 * that changed; lost_before sent nothing; unknown_outcome may have run, and
 * so may an act after which the page tried a hop the guard refused (review
 * of Phase 4 step 3: it read as refused, as if nothing had happened).
 */
export function actSentence(o: Extract<ActOutcome, { ok: false }>, first: string): string {
  switch (o.code) {
    case "not_found":
    case "changed":
    case "covered":
      return BROWSER_COPY.pageChanged;
    case "disabled":
      return BROWSER_COPY.elementHidden;
    case "frame":
      return BROWSER_COPY.inFrame;
    case "sensitive":
      return BROWSER_COPY.sensitiveField(first || "the person");
    case "lost_before":
      return BROWSER_COPY.providerUnavailable;
    case "unknown_outcome":
      return BROWSER_COPY.unknownOutcome;
    case "blocked_hop":
      return BROWSER_COPY.mayHaveGoneThrough(o.host ?? BROWSER_PANEL_COPY.STEP_WORDS.unknownSite);
  }
}

/**
 * An approved act's failure in the person's own words, where actSentence's
 * is the teammate's (last polish of Phase 4): a password, code or payment
 * field says "Ask Max to take over" to Max. Every other act sentence reads
 * the same to both, so there is none.
 */
export function actForPersonLine(o: Extract<ActOutcome, { ok: false }>): string | undefined {
  return o.code === "sensitive" ? BROWSER_PANEL_COPY.sensitiveStep : undefined;
}

// ── Names, records and audit facts ──────────────────────────────────

/** What the model and the history call a browser step: BROWSER_TITLES, else the tool's picker label. Never an element's words. */
export function browserTitle(tool: BrowserToolName): string {
  return BROWSER_TITLES[tool] ?? TOOL_PICKER_COPY[tool].label;
}

/** Each browser tool's step kind (TeammateBrowserStep.kind). */
export const BROWSER_STEP_KIND: Readonly<Record<BrowserToolName, StepKind>> = {
  open_page: "open",
  read_page: "read",
  find_on_page: "find",
  scroll_page: "scroll",
  show_page: "show",
  click: "click",
  type_text: "type",
  select_option: "select",
  ask_to_take_over: "take_over",
  close_browser: "close",
  // Phase 5: a fill card types (and chooses) on one page; asking to be shown hands the person the browser.
  fill_fields: "type",
  ask_to_show_me: "take_over",
};

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function hostOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 253 && /^[a-z0-9._-]+$/i.test(v) ? v.toLowerCase() : null;
}

/**
 * What a call record keeps of a browser read (Decision 23): its site,
 * whether it worked, how many it found and which part it read. Never the
 * page's text, a link or an address.
 */
export function browserStored(result: unknown): { site: string | null; ok: boolean; count?: number; part?: number } {
  const r = rec(result);
  const out: { site: string | null; ok: boolean; count?: number; part?: number } = { site: hostOf(r.site), ok: typeof r.error !== "string" };
  if (typeof r.count === "number" && Number.isFinite(r.count)) out.count = Math.max(0, Math.floor(r.count));
  if (typeof r.part === "number" && Number.isInteger(r.part)) out.part = r.part;
  return out;
}

/** How an act came out, as its audit row says it (review of Phase 4 step 3): ran, did nothing, or may have run. */
export type BrowserActOutcome = "ok" | "failed" | "unknown";

/** An act's outcome from its result: `unknown` when it may have gone through (result.unknownOutcome), `failed` for any other error. */
export function browserActOutcome(result: unknown): BrowserActOutcome {
  const r = rec(result);
  if (r.unknownOutcome === true) return "unknown";
  return typeof r.error === "string" ? "failed" : "ok";
}

/**
 * A browser step's audit facts (Decision 24): its site, its kind, its
 * session, the element's role and how it came out (review of Phase 4 step
 * 3: every act is audited, whatever its outcome). Never the element's words,
 * typed text or a page's address path.
 */
export function browserAuditFacts(
  tool: BrowserToolName,
  input: Record<string, unknown> | null,
  result: unknown,
): { site: string | null; kind: StepKind; browserSessionId: string | null; element: string | null; outcome: BrowserActOutcome; fields?: number; filled?: number; skillId?: string } {
  const i = input ?? {};
  const target = rec(i.target);
  const role = typeof target.role === "string" ? target.role : typeof i.role === "string" ? i.role : null;
  const session = typeof i.browserSessionId === "string" && i.browserSessionId.length <= 64 ? i.browserSessionId : null;
  // An act of a skill run names the skill by its id only (Phase 5 Decision 24), never its name or a step.
  const skill = rec(i.skill);
  const skillId = typeof skill.id === "string" && skill.id.length > 0 && skill.id.length <= 64 ? skill.id : null;
  // A fill card's counts (Decision 24): how many fields it asked and how many it filled, never a label or a word.
  const fill = tool === "fill_fields" && Array.isArray(i.fields) ? { fields: Math.min(FILL_FIELDS_MAX, i.fields.length), filled: countOf(rec(result).filled) } : {};
  return {
    site: hostOf(i.site) ?? hostOf(rec(result).site),
    kind: BROWSER_STEP_KIND[tool],
    browserSessionId: session,
    element: tool === "fill_fields" ? null : role ? clampText(role, 40) : null,
    outcome: browserActOutcome(result),
    ...fill,
    ...(skillId ? { skillId } : {}),
  };
}

/** A count as a record keeps it: a whole number from 0 to FILL_FIELDS_MAX, else 0. */
function countOf(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(FILL_FIELDS_MAX, v) : 0;
}

// ── The answer's counts ─────────────────────────────────────────────

/** One answer's browser counts (Decision 22): every call, and each tool's own. */
export interface BrowserCounters {
  calls: number;
  opens: number;
  reads: number;
  finds: number;
  scrolls: number;
  shows: number;
  asks: number;
  takeOvers: number;
  starts: number;
}

export function emptyBrowserCounters(): BrowserCounters {
  return { calls: 0, opens: 0, reads: 0, finds: 0, scrolls: 0, shows: 0, asks: 0, takeOvers: 0, starts: 0 };
}

const L = BROWSER_TURN_LIMITS;

/**
 * Each browser tool's own count per answer, and what passing it says. The
 * three acts share one: one step asked an answer. Asks and take over
 * requests are counted when their card is made (executor.ts), so a step the
 * page refused before it was asked can be asked again.
 */
export const BROWSER_TOOL_COUNTS: Readonly<Record<BrowserToolName, { key: keyof BrowserCounters; max: number; sentence: string } | null>> = {
  open_page: { key: "opens", max: L.opens, sentence: BROWSER_COPY.tooManyOpens },
  read_page: { key: "reads", max: L.reads, sentence: BROWSER_COPY.tooManyReads },
  find_on_page: { key: "finds", max: L.finds, sentence: BROWSER_COPY.tooManyFinds },
  scroll_page: { key: "scrolls", max: L.scrolls, sentence: BROWSER_COPY.tooManyScrolls },
  show_page: { key: "shows", max: L.shows, sentence: BROWSER_COPY.tooManyShows },
  click: { key: "asks", max: L.asks, sentence: BROWSER_COPY.oneAsk },
  type_text: { key: "asks", max: L.asks, sentence: BROWSER_COPY.oneAsk },
  select_option: { key: "asks", max: L.asks, sentence: BROWSER_COPY.oneAsk },
  ask_to_take_over: { key: "takeOvers", max: L.takeOvers, sentence: BROWSER_COPY.oneTakeOver },
  close_browser: null,
  // Phase 5: a fill card is the answer's one step asked (Decision 19); a
  // request to be shown is its one take over request.
  fill_fields: { key: "asks", max: L.asks, sentence: BROWSER_COPY.oneAsk },
  ask_to_show_me: { key: "takeOvers", max: L.takeOvers, sentence: BROWSER_COPY.oneTakeOver },
};

/** The counts taken only when a card is made, never by a call that was refused before it. */
export const COUNTED_ON_CARD: ReadonlySet<keyof BrowserCounters> = new Set<keyof BrowserCounters>(["asks", "takeOvers"]);

// ── Addresses ───────────────────────────────────────────────────────

/** A page's address as two reads of it compare it (Decision 14): its fragment dropped. The text itself when it is no URL. */
export function pageKey(url: string): string {
  if (typeof url !== "string") return "";
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

/** An address with its escapes decoded, as the page meant it; the raw text when they are not valid. */
function decodedPath(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * A page as its card's Page line names it: its site and its path, at most
 * 120 characters, never its query. A path with a code or a card number in
 * it is shown redacted, as a read shows it (review round 1 of Phase 4).
 */
export function pageWords(url: string): string {
  try {
    const u = new URL(url);
    const raw = u.pathname === "/" ? "" : u.pathname;
    const r = redactPageText(plainData(decodedPath(raw)));
    return clampText(`${u.hostname}${r.hidden > 0 ? r.text : raw}`, 120);
  } catch {
    return "";
  }
}

/** A page's origin (scheme, host and port), all siteVerdict reads of it; "" when it is no URL (review round 1 of Phase 4). */
export function pageOrigin(url: string): string {
  try {
    const o = new URL(url).origin;
    return o === "null" ? "" : o;
  } catch {
    return "";
  }
}

/** A page's address as a card keeps it to compare: its pageKey, sealed (review round 1 of Phase 4). */
export function pageKeyHash(url: string): string {
  return sealWords(pageKey(url));
}

// ── The cards ───────────────────────────────────────────────────────

export type TakeOverReason = "sign_in" | "code" | "payment" | "captcha" | "other";

const TAKE_OVER_REASONS: ReadonlySet<string> = new Set<TakeOverReason>(["sign_in", "code", "payment", "captcha", "other"]);

export function isTakeOverReason(v: unknown): v is TakeOverReason {
  return typeof v === "string" && TAKE_OVER_REASONS.has(v);
}

/**
 * What a browser card stores (AgentAction.input), written by its
 * preparation (browser-previews.ts) and read by its approval and its
 * handler: the session, the site and the page it was asked on, the element
 * found by its fingerprint, the picture, the facts the card shows, and the
 * step itself. The card is built from it alone (browserCard), so an approval
 * shows exactly what it runs, an edited text included.
 */
export interface BrowserCardInput {
  browserSessionId: string;
  site: string;
  /**
   * The page's ORIGIN, never its path or query (review round 1 of Phase 4):
   * what siteVerdict reads at the approval. A card stored before kept the
   * whole address here, read as its origin now.
   */
  pageUrl: string;
  /** The page's address, fragment dropped (pageKey), sealed: an approval acts only on this page (Decision 14). */
  pageKeyHash: string;
  /**
   * The document the card was asked on (BrowserHandle.documentId, review of
   * Phase 4 step 3): an approval acts only while the tab still shows it, so
   * a cart changed under a waiting card, at the same address, runs nothing.
   */
  documentId?: string;
  /** Its Page line: site and path (pageWords). */
  page: string;
  /** The element's id from the model's read, and its fingerprint, sealed (acts only). */
  element?: string;
  target?: SealedFingerprint;
  /** The element's role and words as the card shows them (acts only). */
  role?: string;
  name?: string;
  warnings?: ClickWarning[];
  /** The field is in a form: typing and Enter may send it. */
  inForm?: boolean;
  shotId: string | null;
  shot: { width: number; height: number } | null;
  text?: string;
  pressEnter?: boolean;
  /** The field held something when the card was asked: the typing replaces it, and the card says so (review of Phase 4 step 3). */
  replaces?: boolean;
  /** The option's words as the card shows them: made one line and plain, redacted, clipped. */
  option?: string;
  /**
   * The very option chosen (review of Phase 4 step 3): its label as the list
   * has it and its index there. The step chooses by the index, only while
   * the label there is unchanged.
   */
  optionLabel?: string;
  optionIndex?: number;
  reason?: TakeOverReason;
  /**
   * A request to be shown how (ask_to_show_me, Phase 5 step 2): the
   * person's own words from their Teach a skill message, when that started
   * the turn (the newest USER row's meta.showMe), made one line and plain, at
   * most 80. Never anything the model or a page wrote.
   */
  personWhat?: string;
  /**
   * A fill card's fields (fill_fields, Phase 5 Decision 19): each found by
   * its sealed fingerprint, its label as the page shows it, and every word it
   * types or the very option it chooses. At most 10.
   */
  fields?: FillField[];
  /**
   * The skill the browser followed when the card was asked (Phase 5 Decision
   * 20): its id and version, the person's name for it, and the steps the card
   * matched (indexes; one for a click, a typing or a choice, one a field for
   * a fill card; null when it matched none), of `total`. A typing or a choice
   * whose words differ from a fixed step's keeps that step's words (`fixed`).
   * These lines inform the card; they never let anything run.
   */
  skill?: CardSkill;
}

/** One field of a fill card (BrowserCardInput.fields). */
export interface FillField {
  element: string;
  target: SealedFingerprint;
  label: string;
  kind: "type" | "choose";
  text?: string;
  /** The field held something when the card was asked: the typing replaces it. */
  replaces?: true;
  option?: string;
  optionLabel?: string;
  optionIndex?: number;
}

/** The skill a card was asked in (BrowserCardInput.skill). */
export interface CardSkill {
  id: string;
  version: number;
  name: string;
  /** The matched steps' indexes, in the card's order (a fill card: one a field); empty when it matched none. */
  steps: number[];
  total: number;
  /** A fixed step's words the card's typing or choice differs from. */
  fixed?: { kind: "type" | "choose"; value: string };
}

const FIELD_KIND_SET: ReadonlySet<string> = new Set<string>(FIELD_KINDS);
const WARNING_SET: ReadonlySet<string> = new Set<string>(CLICK_WARNINGS);

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
}

function nullableText(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" && v.length <= max ? v : undefined;
}

const SEALED = /^[0-9a-f]{64}$/;

/** Sealed words as stored: 64 hex digits, or null. */
function sealed(v: unknown): string | null {
  return typeof v === "string" && SEALED.test(v) ? v : null;
}

/**
 * A stored fingerprint, read defensively (every field its type), as a
 * sealed one, or null. One stored before review round 1 of Phase 4 kept its
 * raw name and link, and one stored before review round 2 of Phase 4 the
 * reader's own anchor (its 32 bit hash, at most 16 hex digits): they are
 * sealed here, in memory, so it compares as it did (snapshot.ts controlOf).
 */
function storedFingerprint(v: unknown): SealedFingerprint | null {
  const f = rec(v);
  const tag = text(f.tag, 40);
  const role = text(f.role, 40);
  const type = nullableText(f.type, 40);
  const formHost = nullableText(f.formHost, 253);
  if (tag === null || role === null || type === undefined || formHost === undefined) return null;
  let nameHash: string | null;
  let hrefHash: string | null;
  if ("nameHash" in f) {
    nameHash = sealed(f.nameHash);
    if (nameHash === null) return null;
    if (f.hrefHash === null) hrefHash = null;
    else {
      hrefHash = sealed(f.hrefHash);
      if (hrefHash === null) return null;
    }
  } else {
    const name = text(f.name, 400);
    const href = nullableText(f.href, 8192);
    if (name === null || href === undefined) return null;
    nameHash = sealWords(name);
    hrefHash = href === null ? null : sealWords(href);
  }
  if (typeof f.kind !== "string" || !FIELD_KIND_SET.has(f.kind)) return null;
  if (!Number.isInteger(f.twin) || (f.twin as number) < 0) return null;
  // Which twin (review of Phase 4 step 3): how many there were, the anchor and the place, each required.
  if (!Number.isInteger(f.twins) || (f.twins as number) < 1 || (f.twin as number) >= (f.twins as number)) return null;
  // The anchor sealed (review round 2 of Phase 4), or a card's stored before it, sealed here.
  let anchorHash: string | null;
  if ("anchorHash" in f) anchorHash = sealed(f.anchorHash);
  else {
    const anchor = text(f.anchor, 16);
    anchorHash = anchor === null ? null : sealWords(anchor);
  }
  if (anchorHash === null || !Number.isInteger(f.at) || (f.at as number) < 0) return null;
  return { tag, role, nameHash, kind: f.kind as SealedFingerprint["kind"], type, formHost, hrefHash, twin: f.twin as number, twins: f.twins as number, anchorHash, at: f.at as number };
}

/**
 * A browser card's stored input as its approval and its handler read it
 * (AgentAction.input, written by browser-previews.ts), every field checked
 * for its type and size, or null when it is not one: an act needs its
 * element and fingerprint, a take over its reason.
 */
/** The most fields one fill card holds (Phase 5 Decision 3, SKILL_LIMITS.fillFieldsMax). */
export const FILL_FIELDS_MAX = 10;

/** A card's skill as stored (BrowserCardInput.skill), every field its type and size, or null. */
function storedCardSkill(v: unknown): CardSkill | null {
  const s = rec(v);
  const id = text(s.id, 64);
  const name = text(s.name, 80);
  if (!id || name === null || !Number.isInteger(s.version) || (s.version as number) < 1) return null;
  if (!Number.isInteger(s.total) || (s.total as number) < 1 || (s.total as number) > 100) return null;
  const total = s.total as number;
  if (!Array.isArray(s.steps) || s.steps.length > FILL_FIELDS_MAX || !s.steps.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < total)) return null;
  const fixed = rec(s.fixed);
  const fixedValue = text(fixed.value, 2000);
  const out: CardSkill = { id, version: s.version as number, name, steps: s.steps as number[], total };
  if ((fixed.kind === "type" || fixed.kind === "choose") && fixedValue) out.fixed = { kind: fixed.kind, value: fixedValue };
  return out;
}

/** A fill card's fields as stored, each read as a typing's or a choice's is, at most FILL_FIELDS_MAX, each element once; null when any is not one. */
function storedFillFields(v: unknown): FillField[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > FILL_FIELDS_MAX) return null;
  const out: FillField[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const f = rec(raw);
    const element = text(f.element, 8);
    const target = storedFingerprint(f.target);
    const label = text(f.label, 400);
    if (!element || !/^e\d{1,4}$/.test(element) || seen.has(element) || !target || !label || !label.trim()) return null;
    seen.add(element);
    if (f.kind === "type") {
      const t = text(f.text, 2000);
      if (t === null || !t.trim()) return null;
      out.push({ element, target, label, kind: "type", text: t, ...(f.replaces === true ? { replaces: true as const } : {}) });
      continue;
    }
    if (f.kind !== "choose") return null;
    const o = text(f.option, 200);
    const optionLabel = text(f.optionLabel, OPTION_LABEL_MAX);
    const index = f.optionIndex;
    if (!o || optionLabel === null || !Number.isInteger(index) || (index as number) < 0 || (index as number) >= OPTIONS_MATCH_MAX) return null;
    out.push({ element, target, label, kind: "choose", option: o, optionLabel, optionIndex: index as number });
  }
  return out;
}

export function storedCardInput(tool: "click" | "type_text" | "select_option" | "ask_to_take_over" | "ask_to_show_me" | "fill_fields", raw: unknown): BrowserCardInput | null {
  const r = rec(raw);
  const browserSessionId = text(r.browserSessionId, 64);
  const site = hostOf(r.site);
  const address = text(r.pageUrl, 8192);
  if (!browserSessionId || !site || !address) return null;
  // The origin, and the sealed address (review round 1 of Phase 4). A card
  // stored before holds the whole address: sealed here, it compares as it
  // did; a sealed address that is not one compares with nothing.
  const pageUrl = pageOrigin(address);
  if (!pageUrl) return null;
  const pageKeyHashStored = "pageKeyHash" in r ? sealed(r.pageKeyHash) : pageKeyHash(address);
  if (!pageKeyHashStored) return null;
  const shotId = r.shotId === null || r.shotId === undefined ? null : text(r.shotId, 64);
  if (shotId === null && r.shotId !== null && r.shotId !== undefined) return null;
  const shot = rec(r.shot);
  const size = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 4000 ? Math.floor(v) : null);
  const width = size(shot.width);
  const height = size(shot.height);
  const documentId = text(r.documentId, 80);
  const out: BrowserCardInput = {
    browserSessionId,
    site,
    pageUrl,
    pageKeyHash: pageKeyHashStored,
    ...(documentId ? { documentId } : {}),
    // A card stored before: its Page line again from its address, redacted.
    page: "pageKeyHash" in r ? (text(r.page, 200) ?? "") : pageWords(address),
    shotId,
    shot: shotId && width && height ? { width, height } : null,
  };
  if (tool === "ask_to_take_over") {
    if (!isTakeOverReason(r.reason)) return null;
    out.reason = r.reason;
    return out;
  }
  if (tool === "ask_to_show_me") {
    const w = typeof r.personWhat === "string" ? personWords(r.personWhat) : "";
    if (w) out.personWhat = w;
    return out;
  }
  // An act is bound to its document (review of Phase 4 step 3): none, no act.
  if (!documentId) return null;
  if (tool === "fill_fields") {
    // A fill card is always asked in a skill run (Decision 19): its fields and its skill, or no card.
    const fields = storedFillFields(r.fields);
    const skill = storedCardSkill(r.skill);
    if (!fields || !skill || skill.steps.length !== fields.length) return null;
    out.fields = fields;
    out.skill = skill;
    out.inForm = r.inForm === true;
    return out;
  }
  // A card asked in a skill run keeps the skill's step it matched (Decision 20); a skill that does not read is none.
  const cardSkill = "skill" in r ? storedCardSkill(r.skill) : null;
  if (cardSkill) out.skill = cardSkill;
  const element = text(r.element, 8);
  const target = storedFingerprint(r.target);
  if (!element || !/^e\d{1,4}$/.test(element) || !target) return null;
  out.element = element;
  out.target = target;
  out.role = text(r.role, 40) ?? target.role;
  out.name = text(r.name, 400) ?? "";
  out.inForm = r.inForm === true;
  if (tool === "click") out.warnings = Array.isArray(r.warnings) ? (r.warnings.filter((w) => typeof w === "string" && WARNING_SET.has(w)) as ClickWarning[]) : [];
  if (tool === "type_text") {
    const t = text(r.text, 2000);
    if (t === null) return null;
    out.text = t;
    out.pressEnter = r.pressEnter === true;
    out.replaces = r.replaces === true;
  }
  if (tool === "select_option") {
    const o = text(r.option, 200);
    // The very option, by its label and its index (review of Phase 4 step 3).
    const label = text(r.optionLabel, OPTION_LABEL_MAX);
    const index = r.optionIndex;
    if (!o || label === null || !Number.isInteger(index) || (index as number) < 0 || (index as number) >= OPTIONS_MATCH_MAX) return null;
    out.option = o;
    out.optionLabel = label;
    out.optionIndex = index as number;
  }
  return out;
}

/** The longest the person's own words for the job run on a request to be shown how (Phase 5 step 2). */
export const PERSON_WHAT_MAX = 80;

/** The person's own words for the job, as a request to be shown how keeps them: one line, plain, at most 80; "" when none. */
export function personWords(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = plainData(raw)
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clampText(t, PERSON_WHAT_MAX).trim();
}

/** The longest an element's words run on a card's title line (previews.ts SUBJECT_MAX). */
const SUBJECT_MAX = 80;

function short(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > SUBJECT_MAX ? `${clampText(t, SUBJECT_MAX - 1).trimEnd()}…` : t;
}

const ROLE_WORDS = BROWSER_COPY.ROLE_WORDS as Readonly<Record<string, string>>;

/** An element's role as the card says it: "the button", "the link", else "the item". */
export function roleWords(role: string | null | undefined): string {
  const r = typeof role === "string" ? role.toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(ROLE_WORDS, r) ? ROLE_WORDS[r] : ROLE_WORDS.other;
}

const WARNING_LINE: Readonly<Record<ClickWarning, string>> = {
  buys: BROWSER_COPY.buysLine,
  sends: BROWSER_COPY.sendsLine,
  deletes: BROWSER_COPY.deletesLine,
  terms: BROWSER_COPY.termsLine,
  submits: BROWSER_COPY.submitsLine,
  settings: BROWSER_COPY.settingsLine,
  download: BROWSER_COPY.downloadLine,
};

/**
 * A browser step's card, built from its stored input alone (see
 * BrowserCardInput): what it does, on which page, the element and every
 * word, why to look twice, the picture, and that it cannot be undone. The
 * card's target names the site with no link: a link would open it in the
 * person's own browser. IRREVERSIBLE, so it always stands alone and never
 * offers "don't ask again" (Decision 12).
 */
/**
 * Where a card in a skill run is in it (Phase 5 Decision 20): "Step 4 of 7
 * of your skill", the steps a fill card covers, or that it is none of them,
 * and a typing or a choice whose words differ from a fixed step's. They
 * inform; nothing reads them to decide.
 */
function skillLines(i: BrowserCardInput): string[] {
  const s = i.skill;
  if (!s) return [];
  if (s.steps.length === 0) return [BROWSER_COPY.skillNoStepLine(s.name)];
  const nums = s.steps.map((n) => n + 1);
  const at =
    nums.length === 1 ? BROWSER_COPY.skillStepLine(s.name, nums[0], s.total) : BROWSER_COPY.skillStepsLine(s.name, Math.min(...nums), Math.max(...nums), s.total);
  const fixed = s.fixed ? [s.fixed.kind === "type" ? BROWSER_COPY.skillFixedDiffLine(s.fixed.value) : BROWSER_COPY.skillFixedChoiceDiffLine(s.fixed.value)] : [];
  return [at, ...fixed];
}

export function browserCard(tool: "click" | "type_text" | "select_option" | "ask_to_take_over" | "ask_to_show_me" | "fill_fields", i: BrowserCardInput): ActionPreview {
  const page = BROWSER_COPY.pageLine(i.page || i.site);
  const shot = i.shotId && i.shot ? { shot: { id: i.shotId, width: i.shot.width, height: i.shot.height } } : {};
  const browser = { sessionId: i.browserSessionId, site: i.site };
  const noPicture = i.shotId ? [] : [BROWSER_COPY.noPicture];
  const words = (i.name ?? "").trim();
  const role = roleWords(i.role);
  const label = words || role;
  if (tool === "fill_fields") {
    // One page's typing and choosing (Phase 5 Decision 19): every field and
    // every word in the body, never a click, and what a site may do with it.
    const fields = i.fields ?? [];
    return {
      title: BROWSER_COPY.fillTitle(fields.length),
      body: fields.map((f) => (f.kind === "type" ? BROWSER_COPY.fieldValueLine(f.label, f.text ?? "") : BROWSER_COPY.fieldChoiceLine(f.label, f.option ?? ""))).join("\n"),
      lines: [
        page,
        BROWSER_COPY.fillNoClick,
        ...(i.inForm ? [BROWSER_COPY.submitsLine] : []),
        ...fields.filter((f) => f.replaces === true).map((f) => BROWSER_COPY.fillReplaces(f.label)),
        ...skillLines(i),
        ...noPicture,
      ],
      target: { label: i.site },
      ...shot,
      browser,
    };
  }
  if (tool === "ask_to_take_over") {
    const reason = isTakeOverReason(i.reason) ? i.reason : "other";
    return {
      title: BROWSER_COPY.takeOverTitle(i.site),
      lines: [BROWSER_COPY.TAKE_OVER_REASON[reason], BROWSER_COPY.takeOverBlind, BROWSER_COPY.takeOverTrust(i.site), page],
      target: { label: i.site },
      browser: { ...browser, takeOver: true },
    };
  }
  if (tool === "ask_to_show_me") {
    // A fixed sentence, or the person's own words (Decision 5): never the
    // model's, never the page's. Show how decides it, never Approve.
    const what = personWords(i.personWhat);
    return {
      title: BROWSER_COPY.showMeTitle(i.site),
      lines: [what ? BROWSER_COPY.showMePersonWhat(what) : BROWSER_COPY.showMeAsk(i.site), BROWSER_COPY.showMeRecords, BROWSER_COPY.showMeBlind, BROWSER_COPY.takeOverTrust(i.site), page],
      target: { label: i.site },
      browser: { ...browser, showMe: true, ...(what ? { personWhat: what } : {}) },
    };
  }
  if (tool === "type_text") {
    return {
      title: quotedTitle(ACTION_VERB.type_text ?? "Type into", short(label)),
      body: i.text ?? "",
      lines: [
        page,
        BROWSER_COPY.fieldLine(label),
        // Review of Phase 4 step 3: typing replaces what a filled field holds.
        ...(i.replaces ? [BROWSER_COPY.replacesLine] : []),
        ...(i.pressEnter ? [BROWSER_COPY.pressEnterLine] : []),
        ...(i.inForm ? [BROWSER_COPY.submitsLine] : []),
        ...skillLines(i),
        ...noPicture,
      ],
      target: { label: i.site },
      ...shot,
      browser,
    };
  }
  if (tool === "select_option") {
    return {
      title: quotedTitle(ACTION_VERB.select_option ?? "Choose in", short(label)),
      lines: [page, BROWSER_COPY.optionLine(i.option ?? ""), ...skillLines(i), ...noPicture],
      target: { label: i.site },
      ...shot,
      browser,
    };
  }
  const warnings = CLICK_WARNINGS.filter((w) => (i.warnings ?? []).includes(w));
  return {
    title: words ? quotedTitle(ACTION_VERB.click ?? "Click", short(words)) : `${ACTION_VERB.click ?? "Click"} ${role}`,
    lines: [page, BROWSER_COPY.elementLine(words ? `${role} "${short(words)}"` : role), ...warnings.map((w) => WARNING_LINE[w]), BROWSER_COPY.cantUndo, ...skillLines(i), ...noPicture],
    target: { label: i.site },
    ...shot,
    browser,
  };
}
