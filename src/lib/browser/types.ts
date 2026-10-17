// The computer for AI teammates (docs/plans/ai-teammates-phase4.md): the
// words every part of src/lib/browser shares. A browser rented from a
// provider for one person and one teammate in one chat (Decisions 1, 6, 7),
// what it did (its steps, kinds and sites only, Decision 23), what the page
// reader hands the shaper (snapshot.ts), and what the driver answers.
//
// The lists below are the ones prisma/sql/2026-10-11-ai-teammates-phase4.sql
// holds its CHECKs to (types.test.ts reads the file), so a word the code
// writes is a word the database takes.
//
// Pure: types and constants only, safe on the client.

import type { RecordedEvent } from "@/lib/skills/types";

export type BrowserProviderName = "browserbase" | "stand-in";

export const BROWSER_PROVIDERS: readonly BrowserProviderName[] = ["browserbase", "stand-in"];

export type SessionStatus = "starting" | "live" | "waiting" | "handed_over" | "ending" | "ended";

export const SESSION_STATUSES: readonly SessionStatus[] = ["starting", "live", "waiting", "handed_over", "ending", "ended"];

/** A session that holds a browser: at most one per person in a workspace (the partial unique index). */
export const LIVE_STATUSES: readonly SessionStatus[] = ["starting", "live", "waiting", "handed_over"];

export type EndReason =
  | "idle"
  | "time_cap"
  | "waited_too_long"
  | "take_over_too_long"
  | "stopped"
  | "closed_by_teammate"
  | "turned_off"
  | "plan"
  | "left"
  | "deactivated"
  | "no_access"
  | "workspace_closed"
  | "teammate_off"
  | "restarted"
  | "start_failed"
  | "provider_ended"
  | "admin_stopped";

export const END_REASONS: readonly EndReason[] = [
  "idle",
  "time_cap",
  "waited_too_long",
  "take_over_too_long",
  "stopped",
  "closed_by_teammate",
  "turned_off",
  "plan",
  "left",
  "deactivated",
  "no_access",
  "workspace_closed",
  "teammate_off",
  "restarted",
  "start_failed",
  "provider_ended",
  "admin_stopped",
];

/**
 * Whether an end holds for the rest of the answer it landed in (review round
 * 4 of Phase 4: a Stop holds). Once a browser of this person and teammate
 * ends so while a run of theirs is answering, no call of that run opens
 * another (sessions.ts runEnds and openBrowserSession, browser-tools.ts
 * openPageRun); a later run, a new message, may. Each decided by the worst
 * case of opening a new browser again in the same answer, against the worst
 * case of holding, which is only that the person asks again in a new message:
 *   held   a person chose it on purpose: their Stop (stopped), an Owner or
 *          Admin's Stop every browser (admin_stopped), the switch off
 *          (turned_off), a plan changed (plan), the person removed,
 *          deactivated or no longer acted for (left, deactivated, no_access),
 *          the workspace suspended or closed (workspace_closed), the teammate
 *          paused, removed or changed by its managers (teammate_off). Worst
 *          case of opening again: a new paid browser, signed in to nothing,
 *          the moment after a person said stop.
 *   free   no person chose it. The system: idle, restarted, start_failed,
 *          provider_ended. The teammate itself (closed_by_teammate): a turn
 *          that read any page can start no browser at all (Decision 11), so
 *          this reopens only in an answer that met no page, at most once
 *          (Decision 22). The timers: time_cap, waited_too_long,
 *          take_over_too_long. A timer is a limit on one browser, not on the
 *          answer; the answer may start at most one browser, which the plan's
 *          caps still count, and holding would refuse what the person asked
 *          for in a message whose answer happened to outlast an older
 *          browser's window.
 */
export const END_HOLDS: Readonly<Record<EndReason, boolean>> = {
  idle: false,
  time_cap: false,
  waited_too_long: false,
  take_over_too_long: false,
  stopped: true,
  closed_by_teammate: false,
  turned_off: true,
  plan: true,
  left: true,
  deactivated: true,
  no_access: true,
  workspace_closed: true,
  teammate_off: true,
  restarted: false,
  start_failed: false,
  provider_ended: false,
  admin_stopped: true,
};

/** The reasons that hold (END_HOLDS), as a list for a query. */
export const HELD_END_REASONS: readonly EndReason[] = END_REASONS.filter((r) => END_HOLDS[r]);

export type StepKind = "open" | "read" | "find" | "scroll" | "show" | "click" | "type" | "select" | "take_over" | "give_back" | "close" | "end";

export const STEP_KINDS: readonly StepKind[] = ["open", "read", "find", "scroll", "show", "click", "type", "select", "take_over", "give_back", "close", "end"];

export type StepOutcome = "ok" | "refused" | "failed" | "waiting" | "practice";

export const STEP_OUTCOMES: readonly StepOutcome[] = ["ok", "refused", "failed", "waiting", "practice"];

/**
 * What a field is, as classes.ts fieldKindOf reads it. The last six are the
 * ones a teammate never types or chooses in (Decision 18, isSensitiveField);
 * "none" is anything that takes no input (a button, a link).
 */
export type FieldKind =
  | "text"
  | "email"
  | "search"
  | "number"
  | "tel"
  | "url"
  | "date"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "password"
  | "one_time_code"
  | "card_number"
  | "card_code"
  | "card_expiry"
  | "bank_account"
  | "none";

export const FIELD_KINDS: readonly FieldKind[] = [
  "text",
  "email",
  "search",
  "number",
  "tel",
  "url",
  "date",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "file",
  "password",
  "one_time_code",
  "card_number",
  "card_code",
  "card_expiry",
  "bank_account",
  "none",
];

/**
 * How an element is found again when a card is approved (Decision 14): its
 * tag, role, accessible name, field kind, input type, the host its form sends
 * to, its link's address, and its place among elements identical in all of
 * these. Never what is typed in it.
 *
 * WHICH TWIN (review of Phase 4 step 3): the twin index alone let an approval
 * act on a different twin than the card showed (a new "Add to cart" row
 * inserted above moved every index down by one). So it also records how many
 * twins there were (`twins`), and a context anchor: a short hash of the words
 * a person sees in the control's nearest row, list item or block (`anchor`,
 * page-reader.ts; the words never leave the browser), and its index among all
 * the page's controls (`at`). An approval acts only when all three match
 * exactly; otherwise it answers `changed` (cdp-driver.ts locateTarget,
 * snapshot.ts controlOf).
 *
 * The anchor is 32 bits, unkeyed, of words the redaction never saw, so a card
 * keeps it only sealed (snapshot.ts sealFingerprint `anchorHash`, review
 * round 2 of Phase 4): alone, it gives a short code in the row back to
 * anyone who tries every value.
 */
export interface ElementFingerprint {
  tag: string;
  role: string;
  name: string;
  kind: FieldKind;
  type: string | null;
  formHost: string | null;
  href: string | null;
  twin: number;
  /** How many controls share every field above but the twin index (review of Phase 4 step 3). */
  twins: number;
  /** A short hash of the words a person sees in the control's nearest row, list item or block (review of Phase 4 step 3). */
  anchor: string;
  /** The control's index among all the page's controls, in the reader's one walk (review of Phase 4 step 3). */
  at: number;
}

/** One element as the page reader saw it (step 2, page-reader.ts). `filled` says only whether a field holds something. */
export interface RawElement extends ElementFingerprint {
  disabled: boolean;
  filled: boolean;
  options?: string[];
  /** How many options with words the list has, all of them, not only those in `options` (review of Phase 4 step 3). */
  optionCount?: number;
  /** Other words it is called by, for click warnings only (review round 1 of Phase 4); never in the fingerprint or the model's read. */
  alsoNamed?: string;
  inMainFrame: boolean;
}

/**
 * One option of a list as the reader reads it for matching only (review of
 * Phase 4 step 3, BrowserHandle.options): its label, made one line, and
 * whether it can be chosen. Never shown to the model.
 */
export interface ListOption {
  label: string;
  disabled: boolean;
}

/** The most options a list is read for when a choice is matched (review of Phase 4 step 3): past it, the reader says how many there are. */
export const OPTIONS_MATCH_MAX = 1000;

/** The longest an option's label is kept for matching and on a card (review of Phase 4 step 3). */
export const OPTION_LABEL_MAX = 500;

export interface RawLink {
  text: string;
  href: string;
}

/** What the page reader hands the shaper (snapshot.ts shapeSnapshot): text a person sees, as blocks, never a field's value. */
export interface RawSnapshot {
  url: string;
  title: string;
  contentType: string;
  blocks: string[];
  elements: RawElement[];
  links: RawLink[];
}

/**
 * A navigation's outcome: the page it reached, or why it stopped where it
 * was. `unreachable` (step 2, toward Decision 33): the site did not answer
 * or its name did not resolve, its own reason rather than "too slow".
 */
export type NavOutcome =
  | { ok: true; url: string; site: string }
  | { ok: false; code: "blocked_hop" | "not_html" | "timeout" | "lost" | "private_address" | "unreachable"; host?: string };

/**
 * An act's outcome. `lost_before`: nothing was sent, so the card may wait to
 * be approved again; `unknown_outcome`: input was sent and not confirmed, so
 * the card fails and is never run again (Decision 14).
 */
export type ActOutcome =
  | { ok: true; settled: boolean; url: string; site: string }
  | { ok: false; code: "not_found" | "changed" | "covered" | "frame" | "disabled" | "sensitive" | "lost_before" | "unknown_outcome" | "blocked_hop"; host?: string };

/**
 * One browser, as the driver hands it out (cdp-driver.ts attachBrowser):
 * driven only through the guard it was attached with (Decision 7). A call
 * made after the connection was lost throws BrowserLost (cdp-driver.ts);
 * the acts answer lost_before or unknown_outcome instead.
 */
export interface BrowserHandle {
  navigate(url: string): Promise<NavOutcome>;
  snapshot(): Promise<RawSnapshot>;
  find(text: string): Promise<{ matches: Array<{ text: string; near: ElementFingerprint | null }> }>;
  scroll(direction: "down" | "up", screens: number): Promise<{ atEnd: boolean }>;
  screenshot(o: { around?: ElementFingerprint | null }): Promise<{ jpeg: Uint8Array; width: number; height: number }>;
  /**
   * Every option the list really has, at most OPTIONS_MATCH_MAX, read for
   * matching a choice only (review of Phase 4 step 3): `total` is how many it
   * has, so a longer list says so. The list found again by its fingerprint.
   */
  options(target: ElementFingerprint): Promise<{ ok: true; options: ListOption[]; total: number } | { ok: false; code: "not_found" | "changed" }>;
  click(target: ElementFingerprint): Promise<ActOutcome>;
  /** Replaces what the field holds with `text` (review of Phase 4 step 3: it added to it). */
  type(target: ElementFingerprint, text: string, pressEnter: boolean): Promise<ActOutcome>;
  /**
   * Chooses the option at `index`, only while its label there is still
   * `label` (review of Phase 4 step 3); otherwise `changed`.
   */
  select(target: ElementFingerprint, choice: { index: number; label: string }): Promise<ActOutcome>;
  currentUrl(): string;
  /**
   * The document the tab shows now (review of Phase 4 step 3): it changes
   * with every commit of the main frame and every move within its document
   * (a fragment, the history API), so a card asked on one document never
   * acts on another at the same address.
   */
  documentId(): string;
  /**
   * Leave the page for about:blank, nothing of it read, found or pictured
   * meanwhile (review of Phase 4 step 2: a site the rules no longer allow,
   * sessions.ts refreshLiveRules). Never asks the verdict: about:blank is no
   * site.
   */
  blank(): Promise<void>;
  /**
   * Start or stop recording the person's own input in this tab
   * (docs/plans/ai-teammates-phase5.md step 2, cdp-driver.ts): the recorder
   * put into every new document before the page's scripts and started in the
   * open one, or removed and stopped. Never throws out of a lost connection.
   */
  watch(on: boolean): Promise<void>;
  /**
   * The person's input since the last call while recording: the events the
   * guard drained at each page change, the "may be missing" ones, then the
   * open document's queue, and the pages committed. Never makes a world;
   * nothing while not recording; never throws.
   */
  drainEvents(): Promise<{ events: RecordedEvent[]; pages: Array<{ url: string; at: number }> }>;
  close(): Promise<void>;
}
