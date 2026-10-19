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
// page it is on, never an address the model composed. It goes to the very
// address that matched, the link as the read kept it or the page's own,
// never the model's string (review of Phase 4 step 3: a fragment the model
// added was dropped for the check and then sent with the navigation).
//
// A CARD KEEPS NO SECRET IT ONLY COMPARES (review round 1 of Phase 4): its
// page as its origin and its sealed address, its element's fingerprint
// sealed (snapshot.ts sealFingerprint), its words redacted. An approval
// finds the element again by sealing a fresh read the same way (controlOf)
// and hands the driver that fresh read's own fingerprint, so a stored one
// never reaches the driver.
//
// AN APPROVED STEP ACTS ON THE PAGE AND THE ELEMENT ITS CARD SHOWED
// (Decision 14): the page's address (fragment dropped) must be the card's,
// the tab must still show the document the card was asked on (review of
// Phase 4 step 3: a cart changed under a waiting card at the same address),
// its site still allowed, and the element found again by its fingerprint
// (the driver), or nothing is done. A step the browser lost before sending
// anything waits (held retry_later); one sent and not confirmed fails and is
// never run again, and so does one after which the page tried a hop the
// guard refused (review of Phase 4 step 3): it may have gone through.
//
// NEVER A SENSITIVE FIELD (Decision 18): typing into, choosing in, or
// clicking a password, code, card or bank field is refused before any card,
// and the driver refuses it again on the element it finds.
//
// Server-only: drives a browser.

import { actForPersonLine, actSentence, navSentence, pageKey, pageKeyHash, pageOrigin, pageWords, roleWords, verdictSentence, type BrowserCardInput, type FillField, type TakeOverReason } from "@/lib/agents/browser-rules";
import { clampText } from "@/lib/agents/clamp";
import type { HeldCode } from "@/lib/agents/connector-rules";
import { plainData } from "@/lib/agents/plain-data";
import { BROWSER_COPY, BROWSER_PANEL_COPY, SKILL_COPY, type FillStop } from "@/lib/agents/teammate-copy";
import type { FollowedSkill } from "@/lib/skills/follow";
import { normName } from "@/lib/skills/steps";
import { PAGE_LIMITS, actingAddress, actingWords, clickWarnings, isSensitiveField } from "./classes";
import { BrowserLost } from "./cdp-driver";
import { rememberLinks, takeEvents, type LiveBrowser } from "./live";
import { redactPageText } from "./redact";
import { alsoNamedOf, controlOf, fingerprintOf, optionWords, sameFingerprint, sealFingerprint, shapeSnapshot } from "./snapshot";
import { siteOf, siteVerdict } from "./sites";
import { OPTIONS_MATCH_MAX, type ElementFingerprint, type FieldKind, type StepKind, type StepOutcome } from "./types";

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
  /** What the model reads: the result, or { error } (with `held`, `unknownOutcome` or the person's own words, `forPerson`, for an approval). */
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

function refusal(error: string, step: StepDraft | null, o: { touched?: boolean; site?: string | null; held?: HeldCode; unknownOutcome?: true; lost?: true; forPerson?: string } = {}): PageCall {
  return {
    answer: { error, ...(o.held ? { held: o.held } : {}), ...(o.unknownOutcome ? { unknownOutcome: true } : {}), ...(o.forPerson ? { forPerson: o.forPerson } : {}) },
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
export async function openOn(lb: LiveBrowser, url: string, o: { tainted: boolean; also?: readonly string[] }): Promise<PageCall> {
  const v = siteVerdict(url, lb.rules);
  if (!v.ok) return refusal(verdictSentence(v), { kind: "open", site: v.site, outcome: "refused", code: v.code });
  // Outside a taint, the address as asked; in one, only the canonical address that matched (see the header).
  let target = url;
  if (o.tainted) {
    const asked = pageKey(url);
    const here = pageKey(lb.handle.currentUrl());
    // `also` (Phase 5 Decision 17): the one more address a turn following a
    // skill may open, the skill's own start exactly as stored, matched as a
    // shown link is and opened by its own canonical form.
    const also = (o.also ?? []).map((a) => pageKey(a));
    if (lb.links.has(asked)) target = [...lb.links].find((l) => l === asked) ?? asked;
    else if (asked === here) target = here;
    else if (also.includes(asked)) target = asked;
    else return refusal(BROWSER_COPY.linkOnly, { kind: "open", site: v.site, outcome: "refused", code: "link_only" });
  }
  let nav: Awaited<ReturnType<LiveBrowser["handle"]["navigate"]>>;
  try {
    nav = await lb.handle.navigate(target);
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
  // The links whose words, as the read shows them, or whose address act are
  // marked too (Phase 5 Decision 18): while a skill runs, open_page refuses them.
  rememberLinks(lb, shaped.links, actingLinksOf(shaped.view.links));
  return { answer: { ...shaped.view }, step: { kind: "read", site: at.site, outcome: "ok" }, touched: true, site: at.site };
}

/**
 * The links of a read whose words, as the read shows them, or whose address
 * act (Phase 5 Decision 18, classes.ts actingWords and actingAddress): "Approve"
 * to /x/7, or "Open" to /wf.do?method=approve&id=5.
 */
export function actingLinksOf(links: ReadonlyArray<{ text: string; href: string }>): string[] {
  return links.filter((l) => actingWords(l.text) !== null || actingAddress(l.href)).map((l) => l.href);
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

/** A choice's words made one line, for matching. */
function oneLine(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The option a choice names, matched against every option the list really
 * has, at most OPTIONS_MATCH_MAX (review of Phase 4 step 3: only the 30 the
 * model was shown were matched, and their shortened, cleaned words were
 * stored, so a long or cleaned option could never be chosen). The words the
 * model asks with are the ones a read shows (snapshot.ts optionWords): an
 * exact match first; a match with another case only when it is the list's
 * only one, so a case-only difference never matches an earlier option; two
 * options the same words are refused, as is one with something hidden in
 * it (its label would be kept on the card) or one that cannot be chosen.
 */
async function matchOption(lb: LiveBrowser, fp: ElementFingerprint, asked: unknown, who: string): Promise<{ ok: true; words: string; label: string; index: number } | { ok: false; error: string }> {
  const wanted = oneLine(asked);
  const said = clampText(String(asked ?? ""), 80);
  if (!wanted) return { ok: false, error: BROWSER_COPY.noSuchOption(said) };
  let listed: Awaited<ReturnType<LiveBrowser["handle"]["options"]>>;
  try {
    listed = await lb.handle.options(fp);
  } catch {
    return { ok: false, error: BROWSER_COPY.readFailed };
  }
  if (!listed.ok) return { ok: false, error: listed.code === "changed" ? BROWSER_COPY.staleElement : BROWSER_COPY.elementGone };
  const words = listed.options.map((o) => (o.label ? optionWords(o.label) : null));
  const where = (same: (w: string) => boolean) => words.flatMap((w, k) => (w && same(w.text) ? [k] : []));
  let found = where((w) => w === wanted);
  if (found.length === 0) {
    const lower = wanted.toLowerCase();
    found = where((w) => w.toLowerCase() === lower);
  }
  if (found.length === 0) return { ok: false, error: listed.total > listed.options.length ? BROWSER_COPY.optionNotInFirst(said, OPTIONS_MATCH_MAX) : BROWSER_COPY.noSuchOption(said) };
  if (found.length > 1) return { ok: false, error: BROWSER_COPY.optionTwice(said) };
  const k = found[0];
  const w = words[k]!;
  if (w.hidden) return { ok: false, error: BROWSER_COPY.sensitiveField(who) };
  if (listed.options[k].disabled) return { ok: false, error: BROWSER_COPY.elementHidden };
  return { ok: true, words: w.text, label: listed.options[k].label, index: k };
}

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
  // The document the card is bound to, taken before it is read (review of Phase 4 step 3).
  const documentId = lb.handle.documentId();
  let raw: Awaited<ReturnType<LiveBrowser["handle"]["snapshot"]>>;
  try {
    raw = await lb.handle.snapshot();
  } catch {
    return { ok: false, error: BROWSER_COPY.readFailed };
  }
  const target = sealFingerprint(fp);
  const found = controlOf(raw, target);
  if (!found) return { ok: false, error: BROWSER_COPY.elementGone };
  // Another count of twins, another anchor or another place: the page changed since the model read it (review of Phase 4 step 3).
  if ("changed" in found) return { ok: false, error: BROWSER_COPY.staleElement };
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
  // What the card stores (review round 1 of Phase 4): the origin and the
  // sealed address, the sealed fingerprint, the redacted words.
  const base = {
    site,
    pageUrl: pageOrigin(key),
    pageKeyHash: pageKeyHash(key),
    documentId,
    page: pageWords(key),
    element: input.element,
    target,
    role: found.facts.role,
    name: found.facts.name,
    inForm: fp.formHost !== null,
  };
  let facts: Omit<BrowserCardInput, "browserSessionId" | "shotId" | "shot">;
  if (tool === "type_text") {
    if (!TYPED_KINDS.has(fp.kind)) return { ok: false, error: BROWSER_COPY.notAField };
    const text = cleanTyped(input.text);
    if (!text.trim()) return { ok: false, error: BROWSER_COPY.emptyText };
    // The typing replaces what the field holds, and a filled field's card says so (review of Phase 4 step 3).
    facts = { ...base, text, pressEnter: input.pressEnter === true, ...(found.raw.filled === true ? { replaces: true } : {}) };
  } else if (tool === "select_option") {
    const chosen = await matchOption(lb, fp, input.option, who);
    if (!chosen.ok) return { ok: false, error: chosen.error };
    // The card shows the option's words as a read shows them; the step chooses that very option, by its index and label.
    facts = { ...base, option: chosen.words, optionLabel: chosen.label, optionIndex: chosen.index };
  } else {
    const formHasSensitive = fp.formHost !== null && raw.elements.some((e) => e && e.inMainFrame === true && e.formHost === fp.formHost && isSensitiveField(e.kind));
    // The words it is also called by count for the warnings too (review round 1 of Phase 4).
    facts = { ...base, warnings: clickWarnings(fp, { path, formHasSensitive, downloadLink: downloadLink(fp.href), alsoNamed: alsoNamedOf(found.raw) }) };
  }
  let picture: { jpeg: Uint8Array; width: number; height: number } | null = null;
  try {
    picture = await lb.handle.screenshot({ around: fp });
  } catch {
    picture = null;
  }
  // The page moved while the card was made: what it read is not what the tab shows (review of Phase 4 step 3).
  if (lb.handle.documentId() !== documentId) return { ok: false, error: BROWSER_COPY.staleElement };
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
  return { ok: true, facts: { site, pageUrl: pageOrigin(key), pageKeyHash: pageKeyHash(key), documentId: lb.handle.documentId(), page: pageWords(key), reason } };
}

// ── An approved step ────────────────────────────────────────────────

/**
 * An approved click, typing or choice, run on the page its card showed (see
 * the header): the page must still be the card's, its site allowed now,
 * then the driver finds the element again and acts. A step lost before
 * anything was sent answers `held` (the card waits); one whose outcome is
 * unknown answers `unknownOutcome` (the card fails, never re-run). A
 * sensitive field carries the person's own words (`forPerson`, last polish
 * of Phase 4, browser-rules.ts actForPersonLine) beside the teammate's.
 */
export async function runStepOn(lb: LiveBrowser, tool: "click" | "type_text" | "select_option", input: BrowserCardInput, first: string): Promise<PageCall> {
  const kind: StepKind = tool === "click" ? "click" : tool === "type_text" ? "type" : "select";
  const current = pageKey(lb.handle.currentUrl());
  // The card's address, sealed (review round 1 of Phase 4).
  if (pageKeyHash(current) !== input.pageKeyHash) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "page_changed" });
  // The same document, not only the same address (review of Phase 4 step 3).
  if (!input.documentId || lb.handle.documentId() !== input.documentId) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "page_changed" });
  const v = siteVerdict(current, lb.rules);
  if (!v.ok) return refusal(BROWSER_COPY.siteNowNotAllowed(input.site), { kind, site: input.site, outcome: "refused", code: v.code });
  if (!input.target) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "no_target" });
  // The element, found again in a fresh read sealed as the card's was (see
  // the header); nothing is sent yet, so a read that fails waits.
  let fresh: Awaited<ReturnType<LiveBrowser["handle"]["snapshot"]>>;
  try {
    fresh = await lb.handle.snapshot();
  } catch (err) {
    return refusal(lostOr(err) ? BROWSER_COPY.providerUnavailable : BROWSER_COPY.readFailed, null, { held: "retry_later" });
  }
  if (lb.handle.documentId() !== input.documentId) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "page_changed" });
  const found = controlOf(fresh, input.target);
  if (!found) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "not_found" });
  if ("changed" in found) return refusal(BROWSER_COPY.pageChanged, { kind, site: input.site, outcome: "failed", code: "changed" });
  const target = fingerprintOf(found.raw);
  let out: Awaited<ReturnType<LiveBrowser["handle"]["click"]>>;
  try {
    out =
      tool === "click"
        ? await lb.handle.click(target)
        : tool === "type_text"
          ? await lb.handle.type(target, input.text ?? "", input.pressEnter === true)
          : await lb.handle.select(target, { index: input.optionIndex ?? -1, label: input.optionLabel ?? "" });
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
  // Input was sent before either: the step may have gone through (review of
  // Phase 4 step 3, a refused hop after the act included), so the card fails
  // marked unknownOutcome and is never run again.
  const mayHaveRun = out.code === "unknown_outcome" || out.code === "blocked_hop";
  if (mayHaveRun) {
    lb.refs.clear();
    lb.refsUrl = null;
  }
  const error = actSentence(out, first);
  // The person's own words where the teammate's speak of them by name (last polish of Phase 4): only an approval runs a step.
  const forPerson = actForPersonLine(out);
  return refusal(error, { kind, site: input.site, outcome: "failed", code: out.code }, {
    touched: out.code === "blocked_hop",
    ...(forPerson ? { forPerson } : {}),
    ...(mayHaveRun ? { unknownOutcome: true as const } : {}),
    ...(out.code === "unknown_outcome" && lb.lost ? { lost: true as const } : {}),
  });
}

// ── A fill card (docs/plans/ai-teammates-phase5.md Decision 19, step 4) ─────
//
// ONE PAGE'S TYPING AND CHOOSING ON ONE CARD, NEVER A CLICK OR AN ENTER.
// The preparation, on the page as it is now: every field an id from the
// newest read of this very page, each once, each exactly one of text or an
// option; a fresh read finds each again by its whole fingerprint; none a
// password, code, card or bank field, none turned off, none whose own
// onchange or oninput attribute is set (it acts the moment it is filled, so
// it goes on its own card); text only into a text field, an option only in a
// native list that holds it (Phase 4's rules); each a "type" or "choose"
// (via list) step of the skill this browser follows, on this host, by its
// visible label, and a fixed step's words exactly the skill's. At most 10.
// Then a picture of the page for the card, and no card when the document
// changed while it was made.
//
// THE RUN, field by field, only from its approval: the page and the document
// the card showed, its site allowed now; then for each field a fresh read,
// the control by its sealed fingerprint, its typing (replacing what it
// holds) or its choice (by index and label), and the document still the
// card's. It stops at the first change: before anything was sent, a field
// not found says nothing was filled (or, the connection lost, the card
// waits); once anything was sent, the card fails as one that may have gone
// through, names the fields filled and says the site may have saved or sent
// them, and is never run again (Phase 4 step 3 review's rule).

/** What the model asks a fill card for: each field's id, and its text or its option. */
export type FillAsk = { element: string; text?: string; option?: string };

/** A fill card's facts as its preparation found them (browser-rules.ts BrowserCardInput's fill fields). */
export type FillPrepared =
  | { ok: true; facts: Omit<BrowserCardInput, "browserSessionId" | "shotId" | "shot">; picture: { jpeg: Uint8Array; width: number; height: number } | null }
  | { ok: false; error: string };

/** A field's label as the card and the skill name it: its visible words, else its role and id. */
function fieldLabel(name: string, role: string, element: string): string {
  const words = oneLine(name);
  return words || `${roleWords(role === "combobox" || role === "listbox" ? role : "textbox")} ${element}`;
}

/**
 * The skill's step a field is (Decision 19): a "type" step for text, a
 * "choose" step made in a native list for an option, on this host, its
 * words the field's visible label (a step whose words were removed is
 * matched by none), not taken by another field of the card; the next one
 * after the run's place first, then any. Null when the skill has none.
 */
function fillStepOf(steps: FollowedSkill["steps"], after: number, a: { kind: "type" | "choose"; site: string; label: string }, taken: ReadonlySet<number>): number | null {
  const want = normName(a.label);
  if (!want) return null;
  const fits = (i: number) => {
    const s = steps[i];
    if (!s || taken.has(i) || s.site !== a.site) return false;
    if (a.kind === "type") return s.kind === "type" && Boolean(s.name) && normName(s.name) === want;
    return s.kind === "choose" && s.via === "list" && Boolean(s.name) && normName(s.name) === want;
  };
  for (let i = Math.max(0, after + 1); i < steps.length; i += 1) if (fits(i)) return i;
  for (let i = 0; i < steps.length; i += 1) if (fits(i)) return i;
  return null;
}

/**
 * A fill card the model asks for, checked on the page as it is now (see
 * above). `skill` is the one the session follows (sessions.ts sessionSkill),
 * `stepAt` the run's place in it.
 */
export async function prepareFillOn(lb: LiveBrowser, asked: readonly FillAsk[], first: string, skill: FollowedSkill, stepAt: number): Promise<FillPrepared> {
  const url = lb.handle.currentUrl();
  const site = /^https?:/i.test(url) ? siteOf(url) : null;
  if (!site) return { ok: false, error: BROWSER_COPY.noBrowserYet };
  const v = siteVerdict(url, lb.rules);
  if (!v.ok) return { ok: false, error: verdictSentence(v) };
  const key = pageKey(url);
  if (lb.refsUrl !== key) return { ok: false, error: BROWSER_COPY.staleElement };
  const seen = new Set<string>();
  for (const f of asked) {
    if (seen.has(f.element)) return { ok: false, error: SKILL_COPY.fillSameField };
    seen.add(f.element);
    if ((f.text === undefined) === (f.option === undefined)) return { ok: false, error: SKILL_COPY.fillBothOrNone };
    if (!lb.refs.get(f.element)) return { ok: false, error: BROWSER_COPY.staleElement };
  }
  // The document the card is bound to, taken before it is read (review of Phase 4 step 3).
  const documentId = lb.handle.documentId();
  let raw: Awaited<ReturnType<LiveBrowser["handle"]["snapshot"]>>;
  try {
    raw = await lb.handle.snapshot();
  } catch {
    return { ok: false, error: BROWSER_COPY.readFailed };
  }
  const who = first || "the person";
  const taken = new Set<number>();
  const fields: FillField[] = [];
  const stepsOf: number[] = [];
  let inForm = false;
  for (const f of asked) {
    const fp = lb.refs.get(f.element)!;
    const target = sealFingerprint(fp);
    const found = controlOf(raw, target);
    if (!found) return { ok: false, error: BROWSER_COPY.elementGone };
    if ("changed" in found) return { ok: false, error: BROWSER_COPY.staleElement };
    const label = fieldLabel(found.facts.name, found.facts.role, f.element);
    if (isSensitiveField(fp.kind) || isSensitiveField(found.raw.kind)) return { ok: false, error: BROWSER_COPY.sensitiveField(who) };
    if (found.facts.disabled) return { ok: false, error: BROWSER_COPY.elementHidden };
    // A field that acts the moment it is filled goes on its own card (Decision 19).
    if (found.raw.actsOnInput === true) return { ok: false, error: SKILL_COPY.fillActsAtOnce(label) };
    let field: FillField;
    let words: string;
    if (f.text !== undefined) {
      if (!TYPED_KINDS.has(fp.kind)) return { ok: false, error: BROWSER_COPY.notAField };
      const text = cleanTyped(f.text);
      if (!text.trim()) return { ok: false, error: SKILL_COPY.fillEmpty };
      // A line break or a tab only where the field takes one, a text area or
      // an editable region (review of Phase 5 step 4, M2): in a one-line
      // field it would not land as the card shows it, and on the card it
      // could draw what looks like another field's line.
      if (/[\n\t]/.test(text) && (fp.kind !== "textarea" || found.raw.kind !== "textarea")) return { ok: false, error: SKILL_COPY.fillOneLine(label) };
      words = text;
      field = { element: f.element, target, label, kind: "type", text, ...(found.raw.filled === true ? { replaces: true as const } : {}) };
    } else {
      if (fp.kind !== "select") return { ok: false, error: SKILL_COPY.fillNotAList(label) };
      if (!oneLine(f.option)) return { ok: false, error: SKILL_COPY.fillEmpty };
      const chosen = await matchOption(lb, fp, f.option, who);
      if (!chosen.ok) return { ok: false, error: chosen.error };
      words = chosen.words;
      field = { element: f.element, target, label, kind: "choose", option: chosen.words, optionLabel: chosen.label, optionIndex: chosen.index };
    }
    const step = fillStepOf(skill.steps, stepAt, { kind: field.kind, site, label }, taken);
    if (step === null) return { ok: false, error: SKILL_COPY.fillNotInSkill(label) };
    const s = skill.steps[step];
    if ((s.kind === "type" || s.kind === "choose") && "fixed" in s.value && s.value.fixed !== words) return { ok: false, error: SKILL_COPY.fillNotFixed(label, s.value.fixed) };
    taken.add(step);
    stepsOf.push(step);
    fields.push(field);
    if (fp.formHost !== null) inForm = true;
  }
  let picture: { jpeg: Uint8Array; width: number; height: number } | null = null;
  try {
    picture = await lb.handle.screenshot({});
  } catch {
    picture = null;
  }
  // The page moved while the card was made: what it read is not what the tab shows.
  if (lb.handle.documentId() !== documentId) return { ok: false, error: BROWSER_COPY.staleElement };
  return {
    ok: true,
    facts: {
      site,
      pageUrl: pageOrigin(key),
      pageKeyHash: pageKeyHash(key),
      documentId,
      page: pageWords(key),
      inForm,
      fields,
      skill: { id: skill.id, version: skill.version, name: skill.name, steps: stepsOf, total: skill.steps.length },
    },
    picture,
  };
}

/** A fill card's run on the page: what the model reads, each field's step, and how many it filled (sent, or may have). */
export interface FillRun extends PageCall {
  steps: StepDraft[];
  filled: number;
}

/**
 * An approved fill card, run field by field on the page its card showed (see
 * above). A card held before anything was sent answers `held`; one that
 * stopped after anything was sent answers `unknownOutcome` (and, when the
 * page moved or tried a refused hop after an input, `mayHaveGoneThrough`):
 * the card fails and is never run again.
 */
export async function runFillOn(lb: LiveBrowser, input: BrowserCardInput, first: string): Promise<FillRun> {
  const fields = input.fields ?? [];
  const n = fields.length;
  const site = input.site;
  const steps: StepDraft[] = [];
  const done: string[] = [];
  const out = (call: PageCall): FillRun => ({ ...call, steps, filled: done.length });
  const current = pageKey(lb.handle.currentUrl());
  // The card's address and its document (review of Phase 4 step 3): else nothing is done.
  if (pageKeyHash(current) !== input.pageKeyHash || !input.documentId || lb.handle.documentId() !== input.documentId) {
    steps.push({ kind: "type", site, outcome: "failed", code: "page_changed" });
    return out(refusal(BROWSER_COPY.pageChanged, null));
  }
  const v = siteVerdict(current, lb.rules);
  if (!v.ok) {
    steps.push({ kind: "type", site, outcome: "refused", code: v.code });
    return out(refusal(BROWSER_COPY.siteNowNotAllowed(site), null));
  }
  if (n === 0) return out(refusal(BROWSER_COPY.pageChanged, null));
  /**
   * Stopped before a field's input, with nothing of it sent, for its real
   * reason (review of Phase 5 step 4): the page changed, a field covered,
   * the connection lost, the page unread, or the next field's own refusal.
   */
  const stoppedBefore = (why: FillStop = "changed"): FillRun => {
    if (done.length === 0) {
      if (why === "covered") return out(refusal(SKILL_COPY.fillNothingCovered, null, { touched: true, forPerson: BROWSER_PANEL_COPY.fillNothingCoveredForPerson }));
      return out(refusal(SKILL_COPY.fillNothing, null, { touched: true, forPerson: BROWSER_COPY.pageChanged }));
    }
    // Something was filled: the site may have saved or sent it (Decision 19).
    lb.refs.clear();
    lb.refsUrl = null;
    return out(refusal(SKILL_COPY.fillPartial(done.length, n, done.join(", "), why), null, { touched: true, unknownOutcome: true, forPerson: BROWSER_PANEL_COPY.fillPartialForPerson(done.length, n, why) }));
  };
  /** Stopped after an input was sent: the page reacted, so it may have saved or sent what was filled. */
  const mayHaveGone = (lost: boolean, why: FillStop = lost ? "lost" : "changed"): FillRun => {
    lb.refs.clear();
    lb.refsUrl = null;
    const call = refusal(SKILL_COPY.fillPartial(done.length, n, done.join(", "), why), null, { touched: true, unknownOutcome: true, forPerson: BROWSER_PANEL_COPY.fillPartialForPerson(done.length, n, why), ...(lost ? { lost: true as const } : {}) });
    return out({ ...call, answer: { ...call.answer, mayHaveGoneThrough: true } });
  };
  for (const f of fields) {
    const kind: StepKind = f.kind === "type" ? "type" : "select";
    // The page moved since the last field's input: it reacted (Decision 19).
    if (lb.handle.documentId() !== input.documentId) return done.length === 0 ? stoppedBefore() : mayHaveGone(false);
    let fresh: Awaited<ReturnType<LiveBrowser["handle"]["snapshot"]>>;
    try {
      fresh = await lb.handle.snapshot();
    } catch (err) {
      // Nothing sent yet: the card waits (Decision 14). After a field: it stops there.
      if (done.length === 0) return out(refusal(lostOr(err) ? BROWSER_COPY.providerUnavailable : BROWSER_COPY.readFailed, null, { held: "retry_later" }));
      steps.push({ kind, site, outcome: "failed", code: "reader" });
      return stoppedBefore(lostOr(err) ? "lost" : "unread");
    }
    if (lb.handle.documentId() !== input.documentId) return done.length === 0 ? stoppedBefore() : mayHaveGone(false);
    const found = controlOf(fresh, f.target);
    if (!found || "changed" in found) {
      steps.push({ kind, site, outcome: "failed", code: found ? "changed" : "not_found" });
      return stoppedBefore();
    }
    const target = fingerprintOf(found.raw);
    let act: Awaited<ReturnType<LiveBrowser["handle"]["type"]>>;
    try {
      act = f.kind === "type" ? await lb.handle.type(target, f.text ?? "", false) : await lb.handle.select(target, { index: f.optionIndex ?? -1, label: f.optionLabel ?? "" });
    } catch {
      // A driver that threw mid-act may have sent input: never re-run (Decision 14).
      act = { ok: false, code: "unknown_outcome" };
    }
    if (act.ok) {
      steps.push({ kind, site, outcome: "ok" });
      done.push(f.label);
      // After each field the document must still be the card's.
      if (lb.handle.documentId() !== input.documentId) return mayHaveGone(false);
      continue;
    }
    steps.push({ kind, site, outcome: "failed", code: act.code });
    if (act.code === "lost_before") {
      // Nothing of this field was sent.
      if (done.length === 0) return out(refusal(BROWSER_COPY.providerUnavailable, null, { held: "retry_later" }));
      return stoppedBefore("lost");
    }
    if (act.code === "unknown_outcome" || act.code === "blocked_hop") {
      // Its input was sent: it may have been filled, and the page may have reacted.
      done.push(f.label);
      const lost = act.code === "unknown_outcome" && lb.lost;
      return mayHaveGone(lost, act.code === "blocked_hop" ? "blocked" : lost ? "lost" : "unconfirmed");
    }
    // Refused before its input (not found, changed, covered, turned off, a frame, a sensitive field).
    if (done.length === 0 && (act.code === "sensitive" || act.code === "disabled" || act.code === "frame")) {
      const forPerson = actForPersonLine(act);
      return out(refusal(actSentence(act, first), null, { touched: true, ...(forPerson ? { forPerson } : {}) }));
    }
    return stoppedBefore(act.code === "covered" || act.code === "disabled" || act.code === "frame" || act.code === "sensitive" ? act.code : "changed");
  }
  lb.refs.clear();
  lb.refsUrl = null;
  return out({ answer: { ok: true, site, filled: n, note: SKILL_COPY.fillDone(n) }, step: null, touched: true, site });
}
