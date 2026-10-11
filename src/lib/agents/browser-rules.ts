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
// THE LIMITS (Decision 22): per answer at most 20 browser calls, 8 opens, 6
// reads, 6 finds, 8 scrolls, 3 pictures, 1 step asked, 1 take over request
// and 1 session started (BROWSER_TOOL_COUNTS, classes.ts BROWSER_TURN_LIMITS).

import { BROWSER_TURN_LIMITS, CLICK_WARNINGS, type ClickWarning } from "@/lib/browser/classes";
import type { SiteVerdict } from "@/lib/browser/sites";
import { FIELD_KINDS, OPTION_LABEL_MAX, OPTIONS_MATCH_MAX, type ActOutcome, type ElementFingerprint, type NavOutcome, type StepKind } from "@/lib/browser/types";
import { clampText } from "./clamp";
import { ACTION_VERB, BROWSER_COPY, BROWSER_PANEL_COPY, BROWSER_TITLES, TOOL_PICKER_COPY, quotedTitle } from "./teammate-copy";
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
  | "time_cap";

/**
 * Why a browser call can't run now, in the person's words (Decision 33).
 * `first` is the person's first name; `extra` what the refusal carried
 * (another teammate's name, the provider's wait, the workspace's cap, a
 * session's minutes).
 */
export function browserRefusalSentence(
  reason: BrowserRefusal,
  agentName: string,
  first: string,
  extra: { otherName?: string; retryAfter?: number; atOnce?: number; minutes?: number } = {},
): string {
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
      return BROWSER_COPY.providerUnavailable;
    case "provider_busy":
      return BROWSER_COPY.providerBusy(Math.max(1, Math.round(extra.retryAfter ?? 30)));
    case "start_failed":
      return BROWSER_COPY.startFailed;
    case "none":
      return BROWSER_COPY.noBrowserYet;
    case "ended":
      return BROWSER_COPY.browserClosed;
    case "other_turn":
      return BROWSER_COPY.otherTurn;
    case "person_has_it":
      return BROWSER_COPY.personHasIt(first || "The person");
    case "restarted":
      return BROWSER_COPY.restarted;
    case "time_cap":
      return extra.minutes && extra.minutes > 0 ? BROWSER_COPY.timeCap(extra.minutes) : BROWSER_COPY.browserClosed;
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
): { site: string | null; kind: StepKind; browserSessionId: string | null; element: string | null; outcome: BrowserActOutcome } {
  const i = input ?? {};
  const target = rec(i.target);
  const role = typeof target.role === "string" ? target.role : typeof i.role === "string" ? i.role : null;
  const session = typeof i.browserSessionId === "string" && i.browserSessionId.length <= 64 ? i.browserSessionId : null;
  return {
    site: hostOf(i.site) ?? hostOf(rec(result).site),
    kind: BROWSER_STEP_KIND[tool],
    browserSessionId: session,
    element: role ? clampText(role, 40) : null,
    outcome: browserActOutcome(result),
  };
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

/** A page as its card's Page line names it: its site and its path, at most 120 characters, never its query. */
export function pageWords(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return clampText(`${u.hostname}${path}`, 120);
  } catch {
    return "";
  }
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
  /** The page's address, fragment dropped (pageKey): an approval acts only on this page (Decision 14). */
  pageUrl: string;
  /**
   * The document the card was asked on (BrowserHandle.documentId, review of
   * Phase 4 step 3): an approval acts only while the tab still shows it, so
   * a cart changed under a waiting card, at the same address, runs nothing.
   */
  documentId?: string;
  /** Its Page line: site and path (pageWords). */
  page: string;
  /** The element's id from the model's read, and its fingerprint (acts only). */
  element?: string;
  target?: ElementFingerprint;
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

/** A stored fingerprint, read defensively (every field its type), or null. */
function storedFingerprint(v: unknown): ElementFingerprint | null {
  const f = rec(v);
  const tag = text(f.tag, 40);
  const role = text(f.role, 40);
  const name = text(f.name, 400);
  const type = nullableText(f.type, 40);
  const formHost = nullableText(f.formHost, 253);
  const href = nullableText(f.href, 8192);
  if (tag === null || role === null || name === null || type === undefined || formHost === undefined || href === undefined) return null;
  if (typeof f.kind !== "string" || !FIELD_KIND_SET.has(f.kind)) return null;
  if (!Number.isInteger(f.twin) || (f.twin as number) < 0) return null;
  // Which twin (review of Phase 4 step 3): how many there were, the anchor and the place, each required.
  if (!Number.isInteger(f.twins) || (f.twins as number) < 1 || (f.twin as number) >= (f.twins as number)) return null;
  const anchor = text(f.anchor, 16);
  if (anchor === null || !Number.isInteger(f.at) || (f.at as number) < 0) return null;
  return { tag, role, name, kind: f.kind as ElementFingerprint["kind"], type, formHost, href, twin: f.twin as number, twins: f.twins as number, anchor, at: f.at as number };
}

/**
 * A browser card's stored input as its approval and its handler read it
 * (AgentAction.input, written by browser-previews.ts), every field checked
 * for its type and size, or null when it is not one: an act needs its
 * element and fingerprint, a take over its reason.
 */
export function storedCardInput(tool: "click" | "type_text" | "select_option" | "ask_to_take_over", raw: unknown): BrowserCardInput | null {
  const r = rec(raw);
  const browserSessionId = text(r.browserSessionId, 64);
  const site = hostOf(r.site);
  const pageUrl = text(r.pageUrl, 8192);
  if (!browserSessionId || !site || !pageUrl) return null;
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
    ...(documentId ? { documentId } : {}),
    page: text(r.page, 200) ?? "",
    shotId,
    shot: shotId && width && height ? { width, height } : null,
  };
  if (tool === "ask_to_take_over") {
    if (!isTakeOverReason(r.reason)) return null;
    out.reason = r.reason;
    return out;
  }
  // An act is bound to its document (review of Phase 4 step 3): none, no act.
  if (!documentId) return null;
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
export function browserCard(tool: "click" | "type_text" | "select_option" | "ask_to_take_over", i: BrowserCardInput): ActionPreview {
  const page = BROWSER_COPY.pageLine(i.page || i.site);
  const shot = i.shotId && i.shot ? { shot: { id: i.shotId, width: i.shot.width, height: i.shot.height } } : {};
  const browser = { sessionId: i.browserSessionId, site: i.site };
  const noPicture = i.shotId ? [] : [BROWSER_COPY.noPicture];
  const words = (i.name ?? "").trim();
  const role = roleWords(i.role);
  const label = words || role;
  if (tool === "ask_to_take_over") {
    const reason = isTakeOverReason(i.reason) ? i.reason : "other";
    return {
      title: BROWSER_COPY.takeOverTitle(i.site),
      lines: [BROWSER_COPY.TAKE_OVER_REASON[reason], BROWSER_COPY.takeOverBlind, BROWSER_COPY.takeOverTrust(i.site), page],
      target: { label: i.site },
      browser: { ...browser, takeOver: true },
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
      lines: [page, BROWSER_COPY.optionLine(i.option ?? ""), ...noPicture],
      target: { label: i.site },
      ...shot,
      browser,
    };
  }
  const warnings = CLICK_WARNINGS.filter((w) => (i.warnings ?? []).includes(w));
  return {
    title: words ? quotedTitle(ACTION_VERB.click ?? "Click", short(words)) : `${ACTION_VERB.click ?? "Click"} ${role}`,
    lines: [page, BROWSER_COPY.elementLine(words ? `${role} "${short(words)}"` : role), ...warnings.map((w) => WARNING_LINE[w]), BROWSER_COPY.cantUndo, ...noPicture],
    target: { label: i.site },
    ...shot,
    browser,
  };
}
