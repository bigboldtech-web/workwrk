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
}

/** One element as the page reader saw it (step 2, page-reader.ts). `filled` says only whether a field holds something. */
export interface RawElement extends ElementFingerprint {
  disabled: boolean;
  filled: boolean;
  options?: string[];
  inMainFrame: boolean;
}

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

/** A navigation's outcome: the page it reached, or why it stopped where it was. */
export type NavOutcome =
  | { ok: true; url: string; site: string }
  | { ok: false; code: "blocked_hop" | "not_html" | "timeout" | "lost" | "private_address"; host?: string };

/**
 * An act's outcome. `lost_before`: nothing was sent, so the card may wait to
 * be approved again; `unknown_outcome`: input was sent and not confirmed, so
 * the card fails and is never run again (Decision 14).
 */
export type ActOutcome =
  | { ok: true; settled: boolean; url: string; site: string }
  | { ok: false; code: "not_found" | "changed" | "covered" | "frame" | "disabled" | "sensitive" | "lost_before" | "unknown_outcome" | "blocked_hop"; host?: string };

/**
 * One browser, as the driver hands it out (step 2, cdp-driver.ts
 * attachBrowser): driven only through the guard it was attached with
 * (Decision 7). Typed here so every part reads one shape; nothing in step 1
 * makes one.
 */
export interface BrowserHandle {
  navigate(url: string): Promise<NavOutcome>;
  snapshot(): Promise<RawSnapshot>;
  find(text: string): Promise<{ matches: Array<{ text: string; near: ElementFingerprint | null }> }>;
  scroll(direction: "down" | "up", screens: number): Promise<{ atEnd: boolean }>;
  screenshot(o: { around?: ElementFingerprint | null }): Promise<{ jpeg: Uint8Array; width: number; height: number }>;
  click(target: ElementFingerprint): Promise<ActOutcome>;
  type(target: ElementFingerprint, text: string, pressEnter: boolean): Promise<ActOutcome>;
  select(target: ElementFingerprint, option: string): Promise<ActOutcome>;
  currentUrl(): string;
  close(): Promise<void>;
}
