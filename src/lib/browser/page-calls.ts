// What each browser call does on the page (docs/plans/ai-teammates-phase4.md
// step 3), given the session's browser as this process holds it (live.ts):
// open, read, find, scroll, take a picture, prepare a card's step, and run
// an approved step. The tools (src/lib/agents/browser-tools.ts) and the
// cards (src/lib/agents/browser-previews.ts) call these under the browser's
// lock, after reading who acts and whether the computer may be used; what a
// call answers here is what the model reads, and the step it names is what
// they record. No database: the stand-in's self-test drives these against a
// real browser with no app.
//
// EVERY CALL OBEYS THE RULES OF ITS OWN READ (carried from step 2): the
// caller sets `lb.rules` from that call's fresh computerAccess first, and
// every read checks the page the browser is on now against them before it
// reads. A page they refuse is left for about:blank, its ids forgotten, and
// the answer says why (siteNoLongerAllowed).
//
// A PAGE'S WORDS REACH THE MODEL ONLY AS A READ'S DATA (Decisions 16 and
// 17): a read is snapshot.ts's view (plain, redacted, clipped); a find, the
// words around each match, redacted; an open, a scroll, a picture and an act
// answer their site and a note, never the page's text or a picture. Every
// call that met the page says so (`touched`), and the executor marks the turn
// as one that read the web (Decision 15) before the model reads the answer,
// a refusal that names a host the page sent the browser to included.
//
// AFTER A READ, ONLY LINKS (Decision 11). In a turn that read anything,
// open_page opens only an exact link a read in this session showed, or the
// page it is on, never an address the model composed.
//
// AN APPROVED STEP ACTS ON THE PAGE AND THE ELEMENT ITS CARD SHOWED
// (Decision 14): the page's address (fragment dropped) must be the card's,
// its site still allowed, and the element found again by its fingerprint
// (the driver), or nothing is done. A step the browser lost before sending
// anything waits (held retry_later); one sent and not confirmed fails and is
// never run again.
//
// NEVER A SENSITIVE FIELD (Decision 18): typing into, choosing in, or
// clicking a password, code, card or bank field is refused before any card,
// and the driver refuses it again on the element it finds.
//
// Server-only: drives a browser.

import { actSentence, navSentence, pageKey, pageWords, verdictSentence, type BrowserCardInput, type TakeOverReason } from "@/lib/agents/browser-rules";
import { clampText } from "@/lib/agents/clamp";
import type { HeldCode } from "@/lib/agents/connector-rules";
import { plainData } from "@/lib/agents/plain-data";
import { BROWSER_COPY } from "@/lib/agents/teammate-copy";
import { PAGE_LIMITS, clickWarnings, isSensitiveField } from "./classes";
import { BrowserLost } from "./cdp-driver";
import { rememberLinks, takeEvents, type LiveBrowser } from "./live";
import { redactPageText } from "./redact";
import { controlOf, sameFingerprint, shapeSnapshot } from "./snapshot";
import { siteOf, siteVerdict } from "./sites";
import type { ElementFingerprint, FieldKind, StepKind, StepOutcome } from "./types";

/** The step a call leaves on the session's record (sessions.ts recordStep): kinds and hosts only. */
export interface StepDraft {
  kind: StepKind;
  site: string | null;
  outcome: StepOutcome;
  code?: string | null;
  shotId?: string | null;
}

/** One call's outcome on the page. */
export interface PageCall {
  /** What the model reads: the result, or { error } (with `held` or `unknownOutcome` for an approval). */
  answer: Record<string, unknown>;
  /** The step to record, or none (a call that never reached the page). */
  step: StepDraft | null;
  /** Something the page wrote, or a host it sent the browser to, reached the answer (Decision 15). */
  touched: boolean;
  /** The session's host now: a host, null when the browser left every page, undefined when unchanged. */
  site?: string | null;
  /** The connection is gone: the caller ends the session. */
  lost?: true;
}

function refusal(error: string, step: StepDraft | null, o: { touched?: boolean; site?: string | null; held?: HeldCode; unknownOutcome?: true; lost?: true } = {}): PageCall {
  return {
    answer: { error, ...(o.held ? { held: o.held } : {}), ...(o.unknownOutcome ? { unknownOutcome: true } : {}) },
    step,
    touched: o.touched === true,
    ...(o.site !== undefined ? { site: o.site } : {}),
    ...(o.lost ? { lost: true as const } : {}),
  };
}

/**
 * The notes the guard left since the last call (a dialog closed, a popup, a
 * refused hop), ready sentences (live.ts noteEvent), joined to the answer's
 * note. A note can name a host the page chose, so a call that carries one
 * has met the page.
 */
export function withNotes(lb: LiveBrowser, call: PageCall): PageCall {
  const notes = takeEvents(lb);
  if (notes.length === 0) return call;
  const note = [typeof call.answer.note === "string" ? call.answer.note : "", ...notes].filter(Boolean).join(" ");
  return { ...call, answer: { ...call.answer, note }, touched: true };
}

function lostOr(err: unknown): boolean {
  return err instanceof BrowserLost;
}

/** The page the browser is on, if it is one the rules allow now; else the call's answer (see the header). */
async function onAllowedPage(lb: LiveBrowser, kind: StepKind): Promise<{ url: string; site: string } | PageCall> {
  const url = lb.handle.currentUrl();
  const site = /^https?:/i.test(url) ? siteOf(url) : null;
  if (!site) return refusal(BROWSER_COPY.noBrowserYet, null);
  const v = siteVerdict(url, lb.rules);
  if (v.ok) return { url, site };
  // Left as refreshLiveRules leaves it (step 2): about:blank, its ids forgotten.
  await lb.handle.blank().catch(() => undefined);
  lb.refs.clear();
  lb.refsUrl = null;
  return refusal(BROWSER_COPY.siteNoLongerAllowed(site), { kind, site, outcome: "refused", code: v.code }, { site: null });
}

function isCall(v: unknown): v is PageCall {
  return Boolean(v) && typeof v === "object" && "answer" in (v as object) && "step" in (v as object);
}

// ── Opening ─────────────────────────────────────────────────────────

/**
 * open_page: the guard's verdict first, then (in a turn that read anything)
 * only a link a read showed or the page it is on, then the navigation,
 * every hop asked of the guard again (cdp-driver.ts). It answers whether the
 * page opened and its site, never its title or text; the old page's ids are
 * forgotten.
 */
export async function openOn(lb: LiveBrowser, url: string, o: { tainted: boolean }): Promise<PageCall> {
  const v = siteVerdict(url, lb.rules);
  if (!v.ok) return refusal(verdictSentence(v), { kind: "open", site: v.site, outcome: "refused", code: v.code });
  if (o.tainted) {
    const asked = pageKey(url);
    if (!lb.links.has(asked) && asked !== pageKey(lb.handle.currentUrl())) return refusal(BROWSER_COPY.linkOnly, { kind: "open", site: v.site, outcome: "refused", code: "link_only" });
  }
  let nav: Awaited<ReturnType<LiveBrowser["handle"]["navigate"]>>;
  try {
    nav = await lb.handle.navigate(url);
  } catch {
    nav = { ok: false, code: "lost" };
  }
  lb.refs.clear();
  lb.refsUrl = null;
  if (!nav.ok) {
    if (nav.code === "lost") return refusal(BROWSER_COPY.browserClosed, { kind: "open", site: v.site, outcome: "failed", code: "lost" }, { lost: true });
    // The page may have stayed where it was, or half loaded: its host as it is now.
    const now = lb.handle.currentUrl();
    const here = /^https?:/i.test(now) ? siteOf(now) : null;
    return refusal(navSentence(nav), { kind: "open", site: v.site, outcome: nav.code === "blocked_hop" || nav.code === "private_address" ? "refused" : "failed", code: nav.code }, { touched: true, site: here });
  }
  return { answer: { ok: true, site: nav.site, note: BROWSER_COPY.openedNote }, step: { kind: "open", site: nav.site, outcome: "ok" }, touched: true, site: nav.site };
}

// ── Reading ─────────────────────────────────────────────────────────

/**
 * read_page: the page as snapshot.ts shapes it, its ids and the page they
 * belong to kept for the acts (lb.refs, lb.refsUrl), its links kept for
 * open_page (lb.links). A document that is not HTML is not a page.
 */
export async function readOn(lb: LiveBrowser, part: number | undefined): Promise<PageCall> {
  const at = await onAllowedPage(lb, "read");
  if (isCall(at)) return at;
  let raw: Awaited<ReturnType<LiveBrowser["handle"]["snapshot"]>>;
  try {
    raw = await lb.handle.snapshot();
  } catch (err) {
    if (lostOr(err)) return refusal(BROWSER_COPY.browserClosed, { kind: "read", site: at.site, outcome: "failed", code: "lost" }, { lost: true });
    return refusal(BROWSER_COPY.readFailed, { kind: "read", site: at.site, outcome: "failed", code: "reader" });
  }
  if (raw.contentType && !/html/i.test(raw.contentType)) return refusal(BROWSER_COPY.notAPage, { kind: "read", site: at.site, outcome: "refused", code: "not_html" });
  const shaped = shapeSnapshot(raw, { part: part ?? 1, site: at.site, note: BROWSER_COPY.pageNote });
  lb.refs = shaped.refs;
  lb.refsUrl = pageKey(lb.handle.currentUrl());
  rememberLinks(lb, shaped.links);
  return { answer: { ...shaped.view }, step: { kind: "read", site: at.site, outcome: "ok" }, touched: true, site: at.site };
}

/** Words a page wrote, as a find's match carries them: plain, one line, redacted, at most `max`. */
function pageWordsOf(s: string, max: number): string {
  const flat = plainData(String(s ?? "")).replace(/\s+/g, " ").trim();
  return clampText(redactPageText(flat).text, max);
}

/**
 * find_on_page: each place the words appear (text a person sees), the words
 * around it redacted, and the id of the nearest control from a fresh read,
 * which replaces the ids the acts use. The read's links are not kept: the
 * model was not shown them.
 */
export async function findOn(lb: LiveBrowser, text: string): Promise<PageCall> {
  const at = await onAllowedPage(lb, "find");
  if (isCall(at)) return at;
  let shaped: ReturnType<typeof shapeSnapshot>;
  let found: Awaited<ReturnType<LiveBrowser["handle"]["find"]>>;
  try {
    shaped = shapeSnapshot(await lb.handle.snapshot(), { part: 1, site: at.site, note: BROWSER_COPY.pageNote });
    found = await lb.handle.find(text);
  } catch (err) {
    if (lostOr(err)) return refusal(BROWSER_COPY.browserClosed, { kind: "find", site: at.site, outcome: "failed", code: "lost" }, { lost: true });
    return refusal(BROWSER_COPY.readFailed, { kind: "find", site: at.site, outcome: "failed", code: "reader" });
  }
  lb.refs = shaped.refs;
  lb.refsUrl = pageKey(lb.handle.currentUrl());
  const idOf = (fp: ElementFingerprint | null): string | null => {
    if (!fp) return null;
    for (const [id, f] of shaped.refs) if (sameFingerprint(f, fp)) return id;
    return null;
  };
  const matches = found.matches.slice(0, PAGE_LIMITS.findMatches).map((m) => {
    const id = idOf(m.near);
    return { text: pageWordsOf(m.text, 200), ...(id ? { element: id } : {}) };
  });
  return { answer: { site: at.site, count: matches.length, matches, note: BROWSER_COPY.pageNote }, step: { kind: "find", site: at.site, outcome: "ok" }, touched: true, site: at.site };
}

/** scroll_page: one to three screens; its ids stay the page's. */
export async function scrollOn(lb: LiveBrowser, direction: "down" | "up", screens: number | undefined): Promise<PageCall> {
  const at = await onAllowedPage(lb, "scroll");
  if (isCall(at)) return at;
  try {
    const out = await lb.handle.scroll(direction, screens ?? 1);
    return { answer: { site: at.site, atEnd: out.atEnd }, step: { kind: "scroll", site: at.site, outcome: "ok" }, touched: true, site: at.site };
  } catch (err) {
    if (lostOr(err)) return refusal(BROWSER_COPY.browserClosed, { kind: "scroll", site: at.site, outcome: "failed", code: "lost" }, { lost: true });
    return refusal(BROWSER_COPY.readFailed, { kind: "scroll", site: at.site, outcome: "failed", code: "reader" });
  }
}

/**
 * show_page's picture of the page (Decision 16: for the person only; the
 * caller seals and keeps it, shots.ts, and the model reads only that it was
 * shown).
 */
export async function pictureOn(lb: LiveBrowser): Promise<{ picture: { jpeg: Uint8Array; width: number; height: number }; site: string } | PageCall> {
  const at = await onAllowedPage(lb, "show");
  if (isCall(at)) return at;
  try {
    return { picture: await lb.handle.screenshot({}), site: at.site };
  } catch (err) {
    if (lostOr(err)) return refusal(BROWSER_COPY.browserClosed, { kind: "show", site: at.site, outcome: "failed", code: "lost" }, { lost: true });
    return refusal(BROWSER_COPY.noPictureNow, { kind: "show", site: at.site, outcome: "failed", code: "picture" });
  }
}

// ── A card's step ───────────────────────────────────────────────────

/** The field kinds that take typed words: text of any kind, and a text area (an editable region reads as one). */
const TYPED_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(["text", "email", "search", "number", "tel", "url", "date", "textarea"]);

/** A link to a file a click would download (Decision 20 says downloads are off; the card says so). */
const FILE_LINK = /\.(?:pdf|zip|exe|dmg|pkg|msi|apk|docx?|xlsx?|pptx?|csv|rar|7z|tar|gz|tgz|iso)$/i;

function downloadLink(href: string | null): boolean {
  if (!href) return false;
  try {
    return FILE_LINK.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

/** Typed words as a card shows them and the step types them: made plain, no control character but a line break or a tab, at most 2,000. */
export function cleanTyped(text: unknown): string {
  const s = plainData(typeof text === "string" ? text : "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\r\n?/g, "\n");
  return clampText(s, PAGE_LIMITS.typeMax);
}

/** What a card's preparation found on the page: the card's facts and the picture's bytes, or why there is no card. */
export type StepPrepared = { ok: true; facts: Omit<BrowserCardInput, "browserSessionId" | "shotId" | "shot">; picture: { jpeg: Uint8Array; width: number; height: number } | null } | { ok: false; error: string };

/**
 * A click, a typing or a choice the model asks for, checked on the page as
 * it is now (spec step 3, the first preparation): the page allowed; the id
 * from the newest read of this very page; the control found again in a
 * fresh read by its fingerprint; never a sensitive field (Decision 18), a
 * file input (uploads are off), one turned off, or a choice the list does
 * not have; the words cleaned; then a picture around it for the card.
 */
export async function prepareStepOn(
  lb: LiveBrowser,
  tool: "click" | "type_text" | "select_option",
  input: { element: string; text?: string; pressEnter?: boolean; option?: string },
  first: string,
): Promise<StepPrepared> {
  const url = lb.handle.currentUrl();
  const site = /^https?:/i.test(url) ? siteOf(url) : null;
  if (!site) return { ok: false, error: BROWSER_COPY.noBrowserYet };
  const v = siteVerdict(url, lb.rules);
  if (!v.ok) return { ok: false, error: verdictSentence(v) };
  const key = pageKey(url);
  const fp = lb.refs.get(input.element);
  if (!fp || lb.refsUrl !== key) return { ok: false, error: BROWSER_COPY.staleElement };
  let raw: Awaited<ReturnType<LiveBrowser["handle"]["snapshot"]>>;
  try {
    raw = await lb.handle.snapshot();
  } catch {
    return { ok: false, error: BROWSER_COPY.readFailed };
  }
  const found = controlOf(raw, fp);
  if (!found) return { ok: false, error: BROWSER_COPY.elementGone };
  const who = first || "the person";
  if (isSensitiveField(fp.kind) || isSensitiveField(found.raw.kind)) return { ok: false, error: BROWSER_COPY.sensitiveField(who) };
  if (tool === "click" && fp.kind === "file") return { ok: false, error: BROWSER_COPY.uploadsOff };
  if (found.facts.disabled) return { ok: false, error: BROWSER_COPY.elementHidden };
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "/";
    }
  })();
  const base = {
    site,
    pageUrl: key,
    page: pageWords(key),
    element: input.element,
    target: fp,
    role: found.facts.role,
    name: found.facts.name,
    inForm: fp.formHost !== null,
  };
  let facts: Omit<BrowserCardInput, "browserSessionId" | "shotId" | "shot">;
  if (tool === "type_text") {
    if (!TYPED_KINDS.has(fp.kind)) return { ok: false, error: BROWSER_COPY.notAField };
    const text = cleanTyped(input.text);
    if (!text.trim()) return { ok: false, error: BROWSER_COPY.emptyText };
    facts = { ...base, text, pressEnter: input.pressEnter === true };
  } else if (tool === "select_option") {
    const wanted = String(input.option ?? "").trim().toLowerCase();
    const shown = found.facts.options ?? [];
    const at = shown.findIndex((o) => o.trim().toLowerCase() === wanted);
    const rawOption = at >= 0 ? (found.raw.options ?? [])[at] : undefined;
    if (!wanted || at < 0 || typeof rawOption !== "string") return { ok: false, error: BROWSER_COPY.noSuchOption(clampText(String(input.option ?? ""), 80)) };
    // What the card shows is the option as the list shows it; the step chooses the very same one.
    facts = { ...base, option: shown[at] };
  } else {
    const formHasSensitive = fp.formHost !== null && raw.elements.some((e) => e && e.inMainFrame === true && e.formHost === fp.formHost && isSensitiveField(e.kind));
    facts = { ...base, warnings: clickWarnings(fp, { path, formHasSensitive, downloadLink: downloadLink(fp.href) }) };
  }
  let picture: { jpeg: Uint8Array; width: number; height: number } | null = null;
  try {
    picture = await lb.handle.screenshot({ around: fp });
  } catch {
    picture = null;
  }
  return { ok: true, facts, picture };
}

/** A take over request's facts (spec step 3): the page it asks on, allowed now. */
export function prepareTakeOverOn(lb: LiveBrowser, reason: TakeOverReason): { ok: true; facts: Omit<BrowserCardInput, "browserSessionId" | "shotId" | "shot"> } | { ok: false; error: string } {
  const url = lb.handle.currentUrl();
  const site = /^https?:/i.test(url) ? siteOf(url) : null;
  if (!site) return { ok: false, error: BROWSER_COPY.noBrowserYet };
  const v = siteVerdict(url, lb.rules);
  if (!v.ok) return { ok: false, error: verdictSentence(v) };
  const key = pageKey(url);
  return { ok: true, facts: { site, pageUrl: key, page: pageWords(key), reason } };
}

// ── An approved step ────────────────────────────────────────────────

/**
 * An approved click, typing or choice, run on the page its card showed (see
 * the header): the page must still be the card's, its site allowed now,
 * then the driver finds the element again and acts. A step lost before
 * anything was sent answers `held` (the card waits); one whose outcome is
 * unknown answers `unknownOutcome` (the card fails, never re-run).
 */
export async function runStepOn(lb: LiveBrowser, tool: "click" | "type_text" | "select_option", input: BrowserCardInput, first: string): Promise<PageCall> {
  const kind: StepKind = tool === "click" ? "click" : tool === "type_text" ? "type" : "select";
  const current = pageKey(lb.handle.currentUrl());
  if (current !== input.pageUrl) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "page_changed" });
  const v = siteVerdict(current, lb.rules);
  if (!v.ok) return refusal(BROWSER_COPY.siteNowNotAllowed(input.site), { kind, site: input.site, outcome: "refused", code: v.code });
  if (!input.target) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "no_target" });
  let out: Awaited<ReturnType<LiveBrowser["handle"]["click"]>>;
  try {
    out =
      tool === "click"
        ? await lb.handle.click(input.target)
        : tool === "type_text"
          ? await lb.handle.type(input.target, input.text ?? "", input.pressEnter === true)
          : await lb.handle.select(input.target, input.option ?? "");
  } catch {
    // A driver that threw mid-act may have sent input: never re-run (Decision 14).
    out = { ok: false, code: "unknown_outcome" };
  }
  if (out.ok) {
    lb.refs.clear();
    lb.refsUrl = null;
    return { answer: { ok: true, site: out.site || input.site, settled: out.settled, note: BROWSER_COPY.actNote }, step: { kind, site: input.site, outcome: "ok" }, touched: true, site: out.site || input.site };
  }
  if (out.code === "lost_before") return refusal(BROWSER_COPY.providerUnavailable, null, { held: "retry_later" });
  if (out.code === "unknown_outcome" || out.code === "blocked_hop") {
    lb.refs.clear();
    lb.refsUrl = null;
  }
  const error = actSentence(out, first);
  return refusal(error, { kind, site: input.site, outcome: out.code === "blocked_hop" ? "refused" : "failed", code: out.code }, {
    touched: out.code === "blocked_hop",
    ...(out.code === "unknown_outcome" ? { unknownOutcome: true as const } : {}),
    ...(out.code === "unknown_outcome" && lb.lost ? { lost: true as const } : {}),
  });
}
