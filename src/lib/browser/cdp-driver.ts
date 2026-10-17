// One rented browser, driven only through its navigation guard
// (docs/plans/ai-teammates-phase4.md Decisions 7, 10, 14, 16 to 20).
//
// THE GUARD IS SET UP BEFORE THE HANDLE EXISTS. attachBrowser, in order:
//   1. downloads denied (Browser.setDownloadBehavior deny, each one reported),
//      every permission reset and denied;
//   2. new targets held before they load (Target.setAutoAttach with
//      waitForDebuggerOnStart and flat sessions), and targets discovered;
//   3. one tab: the browser's first page is the tab; every other page target
//      (a new tab, a popup) is reported and closed. It is held at its start,
//      its every Document request refused (Fetch on its own session), then
//      let run and closed: a popup of the same site shares the tab's
//      renderer, and one closed while still held froze the tab with it (the
//      stand-in's self-test, step 2), so it is never closed paused, and it
//      never loads anything;
//   4. on the tab and on every frame target under it: every Document request
//      paused (CDP Fetch, request stage, redirect hops included) and asked
//      of the guard's verdict before it continues. The main frame gets the
//      whole verdict (sites.ts siteVerdict, through the hooks); other frames
//      only the never-allowed hosts. A refused main-frame hop is failed as
//      Aborted, which leaves the page where it was (BlockedByClient would put
//      Chrome's error page in its place); a refused frame request as
//      BlockedByClient. Only then is a held target let run;
//   5. Network on, every service worker bypassed (Network.setBypassServiceWorker,
//      so a site's worker can never answer a navigation Fetch did not
//      see), and a main-frame document served from a private address
//      (addresses.ts, outside the stand-in's fixture sites), or with no
//      address at all (the check fails closed), stops the page and puts
//      about:blank in its place before anything is read;
//   6. file choosers intercepted and never answered; JavaScript dialogs
//      dismissed (a "leave this page" one accepted); each reported;
//   7. the connection's close reported once.
//
// THE COMMIT CHECK (review of Phase 4 step 2). Fetch sees every request, but
// a document can commit without one: a back/forward cache restore (no CDP
// command turns that cache off on a session, and the provider takes no
// Chrome flags), or a navigation a service worker answered. So every main
// frame commit other than about:blank is asked of the verdict again, and a
// refused one, or a host a private address served earlier in this session,
// is held (nothing read, found or pictured, no act), stopped and replaced by
// about:blank, and told. The hold lasts until about:blank, or a page the
// verdict allows that no private address served, is in the tab's place.
// Chrome's own error page for a load that failed is replaced quietly: the
// navigation already answers it as unreachable.
//
// READING runs page-reader.ts in an isolated world of the main frame, which
// the page's scripts cannot reach. The model never sees a picture: a
// screenshot is bytes for the person only (Decision 16). Nothing is drawn on
// the page.
//
// ACTING (Decision 14): the element is found again by its fingerprint in a
// fresh read (none: not_found; another count of twins, another anchor or
// another place among the controls: changed, review of Phase 4 step 3),
// checked again for a sensitive kind (sensitive), the main frame (frame) and
// disabled, scrolled into view, and the point at its centre hit-tested
// (covered) before any input is sent. A failure before input is lost_before;
// a lost connection or a command past its limit after input was sent is
// unknown_outcome, and the step is never run again. A main-frame hop the
// guard refused during the act answers blocked_hop: the act ran, the page
// stayed.
//
// A READER CALL THAT CHANGES THE PAGE RUNS ONCE (review of Phase 4 step 3).
// The reader is called again in a new world when a call fails, which for a
// choice could make it twice. Locating (it scrolls), focusing and choosing
// are sent once: an error after the call left is unknown_outcome
// (ReaderSent), never a second try.
//
// THE DOCUMENT (review of Phase 4 step 3): documentId() changes with every
// commit of the main frame and every move within its document, so a card is
// bound to the document it was asked on, not only its address.
//
// THE RECORDER (docs/plans/ai-teammates-phase5.md Decision 7, step 2): while
// the person shows the teammate how to do a job (watch(true) to
// watch(false)), page-recorder.ts runs in a world of its own, "wk-recorder",
// in every document of the tab, and its events reach the server with
// nothing lost at a page change:
//   - watch(true) puts the recorder into every new document before the
//     page's scripts (Page.addScriptToEvaluateOnNewDocument with worldName
//     and runImmediately), then finds the open document's recorder world by
//     its name (Page.createIsolatedWorld) and starts it there;
//   - the Runtime domain is never enabled: its cost would be every console
//     message of the page streamed to us and a signal bot managers test for,
//     which could block the person's own sign-in mid-recording (spec review
//     2, finding 9a). Each document's recorder context is found by
//     Page.createIsolatedWorld with the recorder's name instead, at each
//     main-frame commit, and the install-once body answers how the world got
//     the recorder: "late" (the new-document script was not there) adds a
//     "may be missing" event for that page, so a wrong world is a gap, never
//     a silent loss;
//   - EACH EVENT LEAVES THE PAGE AS IT HAPPENS (reconciled with the stand-in's
//     Chrome, Phase 5 step 2): a binding in that world alone
//     (Runtime.addBinding by the context's id, which needs no Runtime.enable
//     and which no page script can see or call), which the recorder calls in
//     the capture phase of each event, so its Runtime.bindingCalled is on its
//     way before anything the event causes, a page change included. The
//     spec's hand-off at the guard (drain the page being left inside
//     Fetch.requestPaused, before the request continues) cannot work: from
//     the start of a main-frame navigation until it commits Chrome holds back
//     every command sent to the page, so the drain answered only once the
//     new document was in, "Cannot find context" (the self-test saw it for a
//     click, a form, a page's own script and Page.navigate alike). Requests
//     are therefore never held for the recorder;
//   - the queue stays the fallback: a document whose binding could not be
//     added queues its events for the poll, and a page change from it adds a
//     gap (its last events may be lost); so do a "late" install and a
//     binding the new document could not be given. Nothing is missing
//     without a step that says so. A move within a document keeps the
//     document, its world and its binding; a back/forward cache restore
//     brings back a document whose events already left;
//   - drainEvents() (the server's poll) hands over what the bindings sent and
//     the gaps, then drains the known context's queue only, and never makes a
//     world; watch(false) removes the script and the binding's notices and
//     stops the open document's recorder. Neither throws out of a lost
//     connection.
// **verify:** on the provider's Chrome: Page.addScriptToEvaluateOnNewDocument
// with `worldName` and `runImmediately`; Page.createIsolatedWorld answering
// the world the new-document script ran in (the same name, the same
// document); Runtime.addBinding with `executionContextId` (deprecated in the
// protocol in favour of `executionContextName`, which needs Runtime.enable)
// exposing the binding to that world alone and Runtime.bindingCalled
// arriving with Runtime never enabled. The stand-in's chrome-headless-shell
// 154 holds each in the self-test.
//
// **verify:** the CDP method names against the protocol the provider's
// Chrome speaks (the stand-in's chrome-headless-shell holds them in the
// self-test).
//
// Server-only: speaks to a browser.

import type { RecordedControl, RecordedEvent } from "@/lib/skills/types";
import { isPrivateAddress } from "./addresses";
import { connectCdp, CdpClosed, CdpTimeout, type Cdp } from "./cdp";
import { fieldKindOf, isSensitiveField, type FieldHints } from "./classes";
import { randomUUID } from "node:crypto";
import { READER_SOURCE, READER_WORLD } from "./page-reader";
import { RECORDER_BINDING, RECORDER_CALL, RECORDER_SOURCE, RECORDER_WORLD } from "./page-recorder";
import { siteOf, type SiteVerdict } from "./sites";
import { sealWords, type SealedFingerprint } from "./snapshot";
import { OPTION_LABEL_MAX, OPTIONS_MATCH_MAX, type ActOutcome, type BrowserHandle, type ElementFingerprint, type FieldKind, type ListOption, type NavOutcome, type RawElement, type RawLink, type RawSnapshot } from "./types";

export interface GuardHooks {
  /** Whether a Document request may leave: the whole verdict for the main frame, the never-allowed hosts for other frames. */
  verdict(url: string, mainFrame: boolean): SiteVerdict | { ok: true; frame: true };
  /** A request the guard refused: the main frame's (a hop, a private address) or another frame's. */
  onRefused(host: string | null, code: string, mainFrame?: boolean): void;
  onLost(): void;
  onDialog(type: string): void;
  onDownload(): void;
  onUpload(): void;
  onPopup(url: string): void;
}

/** A call on a browser whose connection is gone. */
export class BrowserLost extends Error {
  constructor() {
    super("The browser connection is gone");
    this.name = "BrowserLost";
  }
}

/**
 * A reader call that changes the page failed after it was sent (review of
 * Phase 4 step 3): it may have run, so the act's outcome is unknown and it is
 * never sent again.
 */
export class ReaderSent extends Error {
  constructor(mode: string) {
    super(`The page reader's ${mode} may have run`);
    this.name = "ReaderSent";
  }
}

/** The reader's modes that change the page: never sent twice (review of Phase 4 step 3). */
const ONCE_MODES: ReadonlySet<string> = new Set(["locate", "focus", "select"]);

/** How long a navigation may take to commit and load. */
export const NAV_TIMEOUT_MS = 20_000;
/** How long an act waits for the page to settle (Decision 14 step 5). */
export const SETTLE_MAX_MS = 8_000;
/** How long the connection may take to open. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Every Document request, at the request stage: the guard's one pattern. */
const DOCUMENT_PATTERNS = [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }];
/** The permissions denied outright (Decision 20), by their PermissionDescriptor names. */
const DENIED_PERMISSIONS = ["geolocation", "notifications", "camera", "microphone", "clipboard-read", "clipboard-write", "midi", "background-sync", "payment-handler", "idle-detection", "storage-access", "window-management", "local-fonts", "display-capture"];
/** A picture around an element shows this much of the page on each side. */
const AROUND_PX = 160;

type Raw = Record<string, unknown>;

function rec(v: unknown): Raw {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** One control as the reader describes it (page-reader.ts describe). */
interface ReaderElement {
  i: number;
  tag: string;
  role: string;
  name: string;
  type: string | null;
  autocomplete: string | null;
  inputmode: string | null;
  nameAttr: string | null;
  idAttr: string | null;
  label: string | null;
  maxLength: number | null;
  codeBoxes: number | null;
  formAction: string | null;
  href: string | null;
  editable: boolean;
  disabled: boolean;
  filled: boolean;
  /** The context anchor's hash (review of Phase 4 step 3). */
  anchor: string;
  options?: string[];
  optionCount: number | null;
  /** Other words it is called by (aria-labelledby or aria-label, review round 1 of Phase 4): for click warnings only, never its name, its fingerprint or the model's read. */
  alsoNamed: string | null;
}

function readerElement(v: unknown, i: number): ReaderElement {
  const r = rec(v);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    i: typeof r.i === "number" ? r.i : i,
    tag: (str(r.tag) ?? "").toLowerCase().slice(0, 40),
    role: (str(r.role) ?? "other").slice(0, 40),
    name: (str(r.name) ?? "").slice(0, 300),
    type: str(r.type),
    autocomplete: str(r.autocomplete),
    inputmode: str(r.inputmode),
    nameAttr: str(r.nameAttr),
    idAttr: str(r.idAttr),
    label: str(r.label),
    maxLength: num(r.maxLength),
    codeBoxes: num(r.codeBoxes),
    formAction: str(r.formAction),
    href: str(r.href),
    editable: r.editable === true,
    disabled: r.disabled === true,
    filled: r.filled === true,
    anchor: typeof r.anchor === "string" && /^[0-9a-f]{1,16}$/.test(r.anchor) ? r.anchor : "",
    ...(Array.isArray(r.options) ? { options: r.options.filter((o): o is string => typeof o === "string") } : {}),
    optionCount: num(r.optionCount),
    alsoNamed: typeof r.alsoNamed === "string" && r.alsoNamed ? r.alsoNamed.slice(0, 300) : null,
  };
}

/** What a field kind is read from, as a read gives it and as the recorder's events carry it: an editable region read as a text area, by the same hints. */
type HintSource = Pick<ReaderElement, "tag" | "type" | "autocomplete" | "inputmode" | "nameAttr" | "idAttr" | "label" | "maxLength" | "codeBoxes" | "editable" | "name">;

function hintsOf(e: HintSource): FieldHints {
  return {
    tag: e.editable ? "textarea" : e.tag,
    type: e.type,
    autocomplete: e.autocomplete,
    inputmode: e.inputmode,
    name: e.nameAttr,
    id: e.idAttr,
    label: e.label ?? (e.editable ? e.name : null),
    maxLength: e.maxLength,
    codeBoxes: e.codeBoxes,
  };
}

/** A control's field kind: an editable region is read as a text area, by the same hints. */
function kindOfElement(e: ReaderElement): FieldKind {
  return fieldKindOf(hintsOf(e));
}

// ── The recorder's events (docs/plans/ai-teammates-phase5.md step 2) ──

/** The recorder world's own binding (page-recorder.ts RECORDER_BINDING), added to each document's recorder context. */
const BINDING = RECORDER_BINDING;
/** The most rounds one drain takes (page-recorder.ts DRAIN_MAX events a round). */
const DRAIN_ROUNDS = 10;
const RECORDED_TYPES: ReadonlySet<string> = new Set(["click", "input", "change", "enter", "frame_focus", "gap"]);

/** A recorder's hints, read defensively, then as a read's (hintsOf). */
function recordedHints(v: unknown): FieldHints {
  const r = rec(v);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const s = (x: unknown, max: number) => (typeof x === "string" && x ? x.slice(0, max) : null);
  return hintsOf({
    tag: (s(r.tag, 40) ?? "").toLowerCase(),
    type: s(r.type, 40),
    autocomplete: s(r.autocomplete, 200),
    inputmode: s(r.inputmode, 40),
    nameAttr: s(r.nameAttr, 300),
    idAttr: s(r.idAttr, 300),
    label: s(r.label, 300),
    maxLength: num(r.maxLength),
    codeBoxes: num(r.codeBoxes),
    editable: r.editable === true,
    name: s(r.name, 300) ?? "",
  });
}

function recordedControl(v: unknown): RecordedControl | null {
  const r = rec(v);
  if (typeof r.tag !== "string" || !r.tag) return null;
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : null);
  const host = typeof r.formHost === "string" && /^[a-z0-9._-]{1,253}$/.test(r.formHost) ? r.formHost : null;
  return {
    tag: r.tag.toLowerCase().slice(0, 40),
    role: (s(r.role, 40) ?? "other") || "other",
    name: s(r.name, 300) ?? "",
    type: s(r.type, 40),
    formHost: host,
    formKey: typeof r.formKey === "number" && Number.isInteger(r.formKey) && r.formKey >= 0 ? r.formKey : null,
    group: typeof r.group === "string" && r.group ? r.group.slice(0, 300) : null,
    choice: r.choice === true,
    opener: r.opener === true,
    inRow: typeof r.inRow === "string" ? r.inRow.slice(0, 300) : null,
    inNav: r.inNav === true,
    suggestion: r.suggestion === true,
    wordsChanged: r.wordsChanged === true,
    // A link's address, read to class it and dropped: one past 8,192 is
    // kept past it, so actingAddress fails closed on it (Decision 7).
    href: typeof r.href === "string" && r.href ? r.href.slice(0, 8193) : null,
    hints: recordedHints(r.hints),
    formFields: (Array.isArray(r.formFields) ? r.formFields : []).slice(0, 40).map(recordedHints),
  };
}

/**
 * The recorder's events as the server reads them (src/lib/skills/types.ts
 * RecordedEvent), each field checked for its type and size, and every hint
 * through hintsOf, as a read's (spec step 2: "each control's hints go
 * through kindOfElement as a read's do"). One that is not an event is
 * dropped. Nothing here is kept: steps.ts builds steps from them.
 */
export function recordedEventsFrom(raw: unknown): RecordedEvent[] {
  const out: RecordedEvent[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const r = rec(v);
    if (typeof r.type !== "string" || !RECORDED_TYPES.has(r.type)) continue;
    const page = typeof r.page === "string" ? r.page.slice(0, 8192) : "";
    const at = typeof r.at === "number" && Number.isFinite(r.at) ? r.at : Date.now();
    const control = r.control === null || r.control === undefined ? null : recordedControl(r.control);
    if ((r.type === "click" || r.type === "input" || r.type === "change" || r.type === "enter") && !control) continue;
    out.push({ type: r.type as RecordedEvent["type"], control, at, page });
  }
  return out;
}

/** A "may be missing" event at a page (Decision 7: a gap is never silent). */
function gapAt(page: string): RecordedEvent {
  return { type: "gap", control: null, at: Date.now(), page };
}

/** What the driver holds while the person records (see the header). */
interface RecState {
  /** This recording's own token, which every binding call carries: a call of an earlier recording's document is not this one's. */
  token: string;
  /** The new-document script's identifier, removed by watch(false). */
  identifier: string | null;
  /** The recorder context of the document open now, and which document (epoch) it is. */
  ctx: number | null;
  ctxEpoch: number;
  /** The document open now sends each event through its binding; false: only its queue holds them. */
  bound: boolean;
  /** Events the bindings sent, the queues drained and the gaps, for the next drainEvents. */
  buffer: RecordedEvent[];
  pages: Array<{ url: string; at: number }>;
}

/** The fingerprint fields twins share (everything but which twin it is, review of Phase 4 step 3). */
function twinKey(f: Pick<ElementFingerprint, "tag" | "role" | "name" | "kind" | "type" | "formHost" | "href">): string {
  return JSON.stringify([f.tag, f.role, f.name, f.kind, f.type, f.formHost, f.href]);
}

/**
 * A target as a card may hold it (review round 1 of Phase 4): its name and
 * link as read, or sealed (snapshot.ts sealFingerprint, a keyed hash of each,
 * nameHash and hrefHash, and of its anchor, anchorHash, review round 2 of
 * Phase 4). A sealed one is compared by sealing the fresh read's words and
 * anchor the same way; a plain one as before.
 */
export type TargetFingerprint = ElementFingerprint | SealedFingerprint;

function isSealed(t: TargetFingerprint): t is SealedFingerprint {
  return typeof (t as Partial<SealedFingerprint>).nameHash === "string";
}

/** Whether a fresh control shares the target's twin key, in the target's own form (see TargetFingerprint). */
function sameTwinOf(e: ElementFingerprint, target: TargetFingerprint): boolean {
  if (!isSealed(target)) return twinKey(e) === twinKey(target);
  return (
    e.tag === target.tag &&
    e.role === target.role &&
    e.kind === target.kind &&
    e.type === target.type &&
    e.formHost === target.formHost &&
    sealWords(e.name) === target.nameHash &&
    (e.href === null ? null : sealWords(e.href)) === target.hrefHash
  );
}

/**
 * Whether a fresh control's anchor is the target's, in the target's own form
 * (review round 2 of Phase 4): a sealed target keeps only anchorHash, so the
 * fresh read's anchor is sealed first. Never part of the twin key: twins
 * share it and differ by their anchors.
 */
function sameAnchorOf(e: ElementFingerprint, target: TargetFingerprint): boolean {
  return isSealed(target) ? sealWords(e.anchor) === target.anchorHash : e.anchor === target.anchor;
}

/**
 * The reader's controls as fingerprinted raw elements, each with its reader
 * index: its twin index, how many twins it has, its anchor and its place
 * among all the controls (review of Phase 4 step 3).
 */
function fingerprinted(list: ReaderElement[]): Array<RawElement & { readerIndex: number }> {
  const bases = list.map((e) => ({ tag: e.tag, role: e.role, name: e.name, kind: kindOfElement(e), type: e.type, formHost: e.formAction ? siteOf(e.formAction) : null, href: e.href }));
  const counts = new Map<string, number>();
  for (const b of bases) counts.set(twinKey(b), (counts.get(twinKey(b)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return list.map((e, n) => {
    const base = bases[n];
    const key = twinKey(base);
    const twin = seen.get(key) ?? 0;
    seen.set(key, twin + 1);
    return {
      ...base,
      twin,
      twins: counts.get(key) ?? 1,
      anchor: e.anchor,
      at: e.i,
      disabled: e.disabled,
      filled: e.filled,
      ...(e.options ? { options: e.options } : {}),
      ...(e.optionCount !== null ? { optionCount: e.optionCount } : {}),
      // Kept beside the fingerprint, never in it or in the twin key (review round 1 of Phase 4).
      ...(e.alsoNamed ? { alsoNamed: e.alsoNamed } : {}),
      inMainFrame: true,
      readerIndex: e.i,
    };
  });
}

interface NavWatch {
  refusedHost: string | null;
  refused: boolean;
  download: boolean;
  privateHit: boolean;
}

export interface AttachOptions {
  /** The stand-in's fixture suffix: its sites are served from this machine and are never read as private (Decision 2). */
  fixtureSuffix: string | null;
  /** Tests pass their own connection. */
  connect?: (url: string) => Promise<Cdp>;
  /** Tests shorten the waits. */
  navTimeoutMs?: number;
  settleMaxMs?: number;
}

/**
 * Connect to a provider's browser and put the guard in place (see the
 * header). Rejects, with the connection closed, when any part of the setup
 * fails: a browser is never handed out half guarded.
 */
export async function attachBrowser(connectUrl: string, hooks: GuardHooks, o: AttachOptions): Promise<BrowserHandle> {
  const cdp = await (o.connect ?? ((u: string) => connectCdp(u, { timeoutMs: CONNECT_TIMEOUT_MS })))(connectUrl);
  const driver = new Driver(cdp, hooks, o);
  try {
    await driver.setup();
  } catch (err) {
    await cdp.close().catch(() => undefined);
    throw err;
  }
  return driver.handle();
}

class Driver {
  private mainTarget: string | null = null;
  private mainSession: string | null = null;
  /** The tab's guard being put in place: the handle is given out only once it is. */
  private mainReady: Promise<void> | null = null;
  /** Pages already closed and told of, so one popup is one note. */
  private closedPages = new Set<string>();
  /** Sessions of pages being closed: every request of theirs is refused, unasked. */
  private closingSessions = new Set<string>();
  private url = "about:blank";
  private loading = false;
  private lost = false;
  private lostTold = false;
  /** The tab's document must not be read (see the header): a private address, a refused commit, a site taken away. */
  private privateHold = false;
  /** Hosts a private address served in this session: never committed again (review of Phase 4 step 2). */
  private privateHosts = new Set<string>();
  /** The load whose response came from a private address, so its own commit is not told twice. */
  private privateLoader: string | null = null;
  private nav: NavWatch | null = null;
  private act: { refusedHost: string | null } | null = null;
  private lastMime: string | null = null;
  private world: { epoch: number; id: number } | null = null;
  private epoch = 0;
  private loadWaiters: Array<() => void> = [];
  private stopWaiters: Array<() => void> = [];
  private sessions = new Map<string, { targetId: string; type: string }>();
  /** The document the tab shows (review of Phase 4 step 3): this driver's own nonce, and a count of every commit and move within a document. */
  private readonly docNonce = randomUUID();
  private docSeq = 0;
  /** The recorder while the person records (see the header), else null. */
  private rec: RecState | null = null;

  constructor(
    private readonly cdp: Cdp,
    private readonly hooks: GuardHooks,
    private readonly o: AttachOptions,
  ) {}

  private loseOnce(): void {
    this.lost = true;
    if (this.lostTold) return;
    this.lostTold = true;
    try {
      this.hooks.onLost();
    } catch {
      /* the hook's own failure */
    }
  }

  private send<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    return this.cdp.send<T>(method, params, sessionId);
  }

  /** Fire and forget: a target that went away meanwhile is not an error. */
  private quiet(method: string, params: object, sessionId?: string): void {
    this.cdp.send(method, params, sessionId).catch(() => undefined);
  }

  async setup(): Promise<void> {
    const cdp = this.cdp;
    cdp.onClose(() => this.loseOnce());
    this.listen();

    // 1. Downloads and permissions, before any page can ask.
    await this.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
    await this.send("Browser.resetPermissions", {}).catch(() => undefined);
    for (const name of DENIED_PERMISSIONS) {
      // A name this Chrome does not know is not a permission it can grant.
      await this.send("Browser.setPermission", { permission: { name }, setting: "denied" }).catch(() => undefined);
    }

    // 2 and 3. The tab: the first page there is, or a new one; any other is closed.
    await this.send("Target.setDiscoverTargets", { discover: true });
    const targets = rec(await this.send("Target.getTargets", {})).targetInfos;
    const pages = (Array.isArray(targets) ? targets : []).map(rec).filter((t) => t.type === "page" && typeof t.targetId === "string");
    if (pages.length > 0) this.mainTarget = String(pages[0].targetId);
    else this.mainTarget = String(rec(await this.send("Target.createTarget", { url: "about:blank" })).targetId ?? "");
    if (!this.mainTarget) throw new Error("No tab to drive");
    for (const p of pages.slice(1)) await this.send("Target.closeTarget", { targetId: p.targetId }).catch(() => undefined);

    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    // Auto-attach may have attached the tab already (its event came first);
    // otherwise attach it here. Either way one session drives it.
    if (!this.mainReady) {
      const sessionId = str(rec(await this.send("Target.attachToTarget", { targetId: this.mainTarget, flatten: true })).sessionId);
      if (!sessionId) throw new Error("The tab could not be attached");
      if (!this.mainReady) this.mainReady = this.setupPage(sessionId, this.mainTarget);
      else if (sessionId !== this.mainSession) this.quiet("Target.detachFromTarget", { sessionId });
    }
    await this.mainReady;
    if (!this.mainSession) throw new Error("The tab could not be guarded");
  }

  /** The guard on the tab, before it runs (see the header, step 4). */
  private async setupPage(sessionId: string, targetId: string): Promise<void> {
    // Set before the first await, so an event for this session in the meantime is read as the tab's.
    this.mainSession = sessionId;
    this.sessions.set(sessionId, { targetId, type: "page" });
    await this.send("Fetch.enable", { patterns: DOCUMENT_PATTERNS }, sessionId);
    await this.send("Network.enable", {}, sessionId);
    // No service worker answers anything here: every request goes to the
    // network, where Fetch sees it (review of Phase 4 step 2). A Chrome
    // that cannot do this hands out no browser.
    await this.send("Network.setBypassServiceWorker", { bypass: true }, sessionId);
    await this.send("Page.enable", {}, sessionId);
    await this.send("Page.setInterceptFileChooserDialog", { enabled: true }, sessionId);
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    const tree = rec(rec(await this.send("Page.getFrameTree", {}, sessionId)).frameTree);
    const frame = rec(tree.frame);
    if (typeof frame.url === "string") this.url = frame.url + (typeof frame.urlFragment === "string" ? frame.urlFragment : "");
    await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
  }

  /** A frame of another site in its own process: only the never-allowed hosts are refused there. */
  private async setupFrame(sessionId: string, targetId: string): Promise<void> {
    this.sessions.set(sessionId, { targetId, type: "iframe" });
    try {
      await this.send("Fetch.enable", { patterns: DOCUMENT_PATTERNS }, sessionId);
      await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
      await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    } catch {
      // A frame whose guard could not be set never runs.
      this.quiet("Target.detachFromTarget", { sessionId });
    }
  }

  private listen(): void {
    const cdp = this.cdp;
    const tell = (targetId: string, url: string): boolean => {
      if (this.closedPages.has(targetId)) return false;
      this.closedPages.add(targetId);
      try {
        this.hooks.onPopup(url);
      } catch {
        /* the hook's own failure */
      }
      return true;
    };
    /** A held page: every request of its refused, then let run, then closed (see the header, step 3). */
    const closeHeld = (sessionId: string, targetId: string, url: string) => {
      tell(targetId, url);
      this.closingSessions.add(sessionId);
      void (async () => {
        await this.send("Fetch.enable", { patterns: DOCUMENT_PATTERNS }, sessionId).catch(() => undefined);
        await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
        await this.send("Target.closeTarget", { targetId }).catch(() => undefined);
      })();
    };
    cdp.on("Target.attachedToTarget", (p: Raw) => {
      const sessionId = str(p.sessionId);
      const info = rec(p.targetInfo);
      const targetId = str(info.targetId);
      const type = str(info.type) ?? "";
      if (!sessionId || !targetId) return;
      if (type === "page") {
        if (targetId === this.mainTarget && !this.mainReady) {
          this.mainReady = this.setupPage(sessionId, targetId);
          this.mainReady.catch(() => this.loseOnce());
          return;
        }
        if (targetId === this.mainTarget) {
          // A second session on the tab: only the guarded one drives it.
          if (sessionId !== this.mainSession) this.quiet("Target.detachFromTarget", { sessionId });
          return;
        }
        // One tab (Decision 10): a new tab or popup is reported and closed,
        // nothing of it ever loaded.
        closeHeld(sessionId, targetId, str(info.url) ?? "");
        return;
      }
      if (type === "iframe") {
        void this.setupFrame(sessionId, targetId);
        return;
      }
      // Workers and the rest load no document: let them run, unread.
      this.quiet("Runtime.runIfWaitingForDebugger", {}, sessionId);
    });

    cdp.on("Target.targetCreated", (p: Raw) => {
      const info = rec(p.targetInfo);
      // A page auto-attach did not hold (opened in a way it missed) is closed
      // too, once it has had its moment to be attached and guarded.
      if (info.type === "page" && typeof info.targetId === "string" && this.mainTarget && info.targetId !== this.mainTarget) {
        const targetId = info.targetId;
        const url = str(info.url) ?? "";
        const t = setTimeout(() => {
          if (this.closedPages.has(targetId) || this.lost) return;
          tell(targetId, url);
          this.quiet("Target.closeTarget", { targetId });
        }, 1000);
        t.unref?.();
      }
    });

    const mainGone = (targetId: unknown) => {
      if (typeof targetId === "string" && targetId === this.mainTarget) {
        this.loseOnce();
        void this.cdp.close();
      }
    };
    cdp.on("Target.targetDestroyed", (p: Raw) => mainGone(p.targetId));
    cdp.on("Target.targetCrashed", (p: Raw) => mainGone(p.targetId));
    cdp.on("Target.detachedFromTarget", (p: Raw) => {
      const sessionId = str(p.sessionId);
      if (sessionId && sessionId === this.mainSession) {
        this.loseOnce();
        void this.cdp.close();
      }
      if (sessionId) {
        this.sessions.delete(sessionId);
        this.closingSessions.delete(sessionId);
      }
    });
    cdp.on("Inspector.targetCrashed", (_p: Raw, sessionId?: string) => {
      if (sessionId && sessionId === this.mainSession) {
        this.loseOnce();
        void this.cdp.close();
      }
    });

    // 4. The guard itself.
    cdp.on("Fetch.requestPaused", (p: Raw, sessionId?: string) => {
      const requestId = str(p.requestId);
      if (!requestId) return;
      // A page being closed loads nothing at all.
      if (sessionId && this.closingSessions.has(sessionId)) {
        this.quiet("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId);
        return;
      }
      const url = str(rec(p.request).url) ?? "";
      const main = Boolean(sessionId && sessionId === this.mainSession && str(p.frameId) === this.mainTarget);
      if (p.resourceType !== "Document") {
        this.quiet("Fetch.continueRequest", { requestId }, sessionId);
        return;
      }
      let verdict: SiteVerdict | { ok: true; frame: true };
      try {
        verdict = this.hooks.verdict(url, main);
      } catch {
        verdict = { ok: false, code: "never", site: null };
      }
      if (verdict.ok) {
        // Never held for the recorder (see the header): the page's events left as they happened.
        this.quiet("Fetch.continueRequest", { requestId }, sessionId);
        return;
      }
      const host = siteOf(url);
      this.quiet("Fetch.failRequest", { requestId, errorReason: main ? "Aborted" : "BlockedByClient" }, sessionId);
      if (main) {
        if (this.nav) {
          this.nav.refused = true;
          this.nav.refusedHost = host;
        }
        if (this.act) this.act.refusedHost = host;
      }
      try {
        this.hooks.onRefused(host, verdict.code, main);
      } catch {
        /* the hook's own failure */
      }
    });

    // 5. A main-frame document from a private address, or from no address
    // at all: isPrivateAddress fails closed on a missing one (review of
    // Phase 4 step 2). The stand-in's fixture sites keep their allowance.
    cdp.on("Network.responseReceived", (p: Raw, sessionId?: string) => {
      if (!sessionId || sessionId !== this.mainSession || p.type !== "Document" || str(p.frameId) !== this.mainTarget) return;
      const response = rec(p.response);
      this.lastMime = str(response.mimeType);
      const ip = str(response.remoteIPAddress);
      const host = siteOf(str(response.url) ?? "");
      const suffix = this.o.fixtureSuffix;
      const fixture = Boolean(suffix && host && host.length > suffix.length && host.endsWith(suffix));
      if (fixture || !isPrivateAddress(ip)) return;
      if (this.nav) this.nav.privateHit = true;
      if (host) this.privateHosts.add(host);
      this.privateLoader = str(p.loaderId);
      void this.blankPage(sessionId);
      this.tellRefused(host, "private_address");
    });

    // Where the tab is, whether it is loading, and the commit check.
    cdp.on("Page.frameNavigated", (p: Raw, sessionId?: string) => {
      if (!sessionId || sessionId !== this.mainSession) return;
      const frame = rec(p.frame);
      if (frame.parentId !== undefined || str(frame.id) !== this.mainTarget) return;
      const bare = str(frame.url) ?? "about:blank";
      this.url = bare + (str(frame.urlFragment) ?? "");
      this.epoch += 1;
      this.docSeq += 1;
      this.world = null;
      this.recorderCommit(bare, this.url);
      if (bare === "about:blank") {
        this.privateHold = false;
        // The private load is behind us: a later commit of it (the
        // back/forward cache keeps its loader) is held and told again.
        this.privateLoader = null;
        return;
      }
      this.checkCommit(bare, str(frame.loaderId), typeof frame.unreachableUrl === "string" || bare.startsWith("chrome-error:"), sessionId);
    });
    cdp.on("Page.navigatedWithinDocument", (p: Raw, sessionId?: string) => {
      if (sessionId !== this.mainSession || str(p.frameId) !== this.mainTarget) return;
      const url = str(p.url);
      if (url) this.url = url;
      // A fragment or the history API moved the page: a card asked before it never acts after it (review of Phase 4 step 3).
      this.docSeq += 1;
    });
    cdp.on("Page.frameStartedLoading", (p: Raw, sessionId?: string) => {
      if (sessionId === this.mainSession && str(p.frameId) === this.mainTarget) this.loading = true;
    });
    cdp.on("Page.frameStoppedLoading", (p: Raw, sessionId?: string) => {
      if (sessionId === this.mainSession && str(p.frameId) === this.mainTarget) {
        this.loading = false;
        for (const w of this.stopWaiters.splice(0)) w();
      }
    });
    cdp.on("Page.loadEventFired", (_p: Raw, sessionId?: string) => {
      if (sessionId !== this.mainSession) return;
      for (const w of this.loadWaiters.splice(0)) w();
    });

    // The recorder's events, as they happen (see the header): only this
    // recording's, from a recorder world (the binding lives there alone).
    cdp.on("Runtime.bindingCalled", (p: Raw, sessionId?: string) => {
      const r = this.rec;
      if (!r || sessionId !== this.mainSession || p.name !== BINDING || typeof p.payload !== "string" || p.payload.length > 200_000) return;
      let msg: Raw;
      try {
        msg = rec(JSON.parse(p.payload));
      } catch {
        return;
      }
      if (msg.t !== r.token) return;
      r.buffer.push(...recordedEventsFrom([msg.e]));
    });

    // 6. Dialogs, file choosers and downloads.
    cdp.on("Page.javascriptDialogOpening", (p: Raw, sessionId?: string) => {
      const type = str(p.type) ?? "alert";
      this.quiet("Page.handleJavaScriptDialog", { accept: type === "beforeunload" }, sessionId);
      try {
        this.hooks.onDialog(type);
      } catch {
        /* the hook's own failure */
      }
    });
    cdp.on("Page.fileChooserOpened", () => {
      try {
        this.hooks.onUpload();
      } catch {
        /* the hook's own failure */
      }
    });
    const download = () => {
      if (this.nav) this.nav.download = true;
      try {
        this.hooks.onDownload();
      } catch {
        /* the hook's own failure */
      }
    };
    cdp.on("Browser.downloadWillBegin", download);
    cdp.on("Page.downloadWillBegin", download);
  }

  /** A refusal of the main frame, told to the hooks. */
  private tellRefused(host: string | null, code: string): void {
    try {
      this.hooks.onRefused(host, code, true);
    } catch {
      /* the hook's own failure */
    }
  }

  /**
   * Hold the tab's document (nothing read, found or pictured, no act), stop
   * it and put about:blank in its place. Sent again for each refusal: a
   * later navigation may have cancelled the first about:blank.
   */
  private blankPage(sessionId: string): Promise<void> {
    this.privateHold = true;
    return (async () => {
      await this.send("Page.stopLoading", {}, sessionId).catch(() => undefined);
      await this.send("Page.navigate", { url: "about:blank" }, sessionId).catch(() => undefined);
    })();
  }

  /**
   * The commit check (see the header; review of Phase 4 step 2): a main
   * frame document that committed, asked of the verdict again whether or
   * not Fetch saw a request for it.
   */
  private checkCommit(url: string, loaderId: string | null, errorPage: boolean, sessionId: string): void {
    const host = siteOf(url);
    if (host && this.privateHosts.has(host)) {
      // The private page's own load was closed and told at its response.
      if (loaderId !== null && loaderId === this.privateLoader) return;
      // Back from the back/forward cache, or loaded again.
      if (this.nav) this.nav.privateHit = true;
      void this.blankPage(sessionId);
      this.tellRefused(host, "private_address");
      return;
    }
    let verdict: SiteVerdict | { ok: true; frame: true };
    try {
      verdict = this.hooks.verdict(url, true);
    } catch {
      verdict = { ok: false, code: "never", site: host };
    }
    if (verdict.ok) {
      // A page the guard accepts is in the tab's place now: nothing held is left.
      this.privateHold = false;
      return;
    }
    void this.blankPage(sessionId);
    // Chrome's own page for a load that failed: no site's words, and the
    // navigation answers it as unreachable.
    if (errorPage) return;
    if (this.nav) {
      this.nav.refused = true;
      this.nav.refusedHost = host;
    }
    if (this.act) this.act.refusedHost = host;
    this.tellRefused(host, verdict.code);
  }

  /** The reader's isolated world in the tab's current document, made once per document. */
  private async worldId(): Promise<number> {
    if (this.world && this.world.epoch === this.epoch) return this.world.id;
    const epoch = this.epoch;
    const out = rec(await this.send("Page.createIsolatedWorld", { frameId: this.mainTarget, worldName: READER_WORLD, grantUniveralAccess: false }, this.mainSession!));
    const id = out.executionContextId;
    if (typeof id !== "number") throw new Error("No reading world");
    this.world = { epoch, id };
    return id;
  }

  /**
   * The reader in its world, its arguments passed by value (never written
   * into code). A mode that changes the page (ONCE_MODES) is sent once: its
   * world may be made again, which runs nothing on the page, but an error
   * once the call itself was sent throws ReaderSent (see the header).
   */
  private async reader(mode: string, arg: Record<string, unknown>): Promise<Raw> {
    if (this.lost) throw new BrowserLost();
    const once = ONCE_MODES.has(mode);
    const call = (contextId: number) =>
      this.send(
        "Runtime.callFunctionOn",
        { functionDeclaration: READER_SOURCE, executionContextId: contextId, arguments: [{ value: mode }, { value: arg }], returnByValue: true, awaitPromise: false, silent: true },
        this.mainSession!,
      ).then(rec);
    let out: Raw;
    if (once) {
      let contextId: number;
      try {
        contextId = await this.worldId();
      } catch (err) {
        if (this.lost || err instanceof CdpClosed) throw new BrowserLost();
        // Nothing ran on the page: a new world, once.
        this.world = null;
        contextId = await this.worldId();
      }
      try {
        out = await call(contextId);
      } catch {
        throw new ReaderSent(mode);
      }
      if (out.exceptionDetails) throw new ReaderSent(mode);
      return rec(rec(out.result).value);
    }
    try {
      out = await call(await this.worldId());
    } catch (err) {
      if (this.lost || err instanceof CdpClosed) throw new BrowserLost();
      // The document changed under the world: once more in a new one.
      this.world = null;
      out = await call(await this.worldId());
    }
    if (out.exceptionDetails) throw new Error("The page reader stopped");
    return rec(rec(out.result).value);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      t.unref?.();
    });
  }

  private waitFor(list: Array<() => void>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(false);
      }, ms);
      timer.unref?.();
      list.push(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async navigate(url: string): Promise<NavOutcome> {
    if (this.lost) return { ok: false, code: "lost" };
    const host = siteOf(url);
    // The guard answers first (Decision 10); the request stage asks again for every hop.
    let first: SiteVerdict | { ok: true; frame: true };
    try {
      first = this.hooks.verdict(url, true);
    } catch {
      first = { ok: false, code: "never", site: host };
    }
    if (!first.ok) return { ok: false, code: "blocked_hop", ...(host ? { host } : {}) };
    const watch: NavWatch = { refusedHost: null, refused: false, download: false, privateHit: false };
    this.nav = watch;
    this.lastMime = null;
    const budget = this.o.navTimeoutMs ?? NAV_TIMEOUT_MS;
    const started = Date.now();
    try {
      const loaded = this.waitFor(this.loadWaiters, budget);
      let answer: Raw;
      try {
        // The command's own limit (cdp.ts, 15 seconds) is within the budget.
        answer = rec(await this.send("Page.navigate", { url }, this.mainSession!));
      } catch (err) {
        if (this.lost || err instanceof CdpClosed) return { ok: false, code: "lost" };
        await this.send("Page.stopLoading", {}, this.mainSession!).catch(() => undefined);
        return { ok: false, code: err instanceof CdpTimeout ? "timeout" : "unreachable", ...(host ? { host } : {}) };
      }
      if (watch.privateHit) return { ok: false, code: "private_address", ...(host ? { host } : {}) };
      if (watch.refused) return { ok: false, code: "blocked_hop", ...(watch.refusedHost ? { host: watch.refusedHost } : {}) };
      if (watch.download) return { ok: false, code: "not_html", ...(host ? { host } : {}) };
      const errorText = str(answer.errorText);
      if (errorText) {
        if (/ERR_ABORTED/.test(errorText)) return { ok: false, code: "not_html", ...(host ? { host } : {}) };
        if (/ERR_BLOCKED_BY_CLIENT/.test(errorText)) return { ok: false, code: "blocked_hop", ...(host ? { host } : {}) };
        if (/TIMED_OUT/.test(errorText)) return { ok: false, code: "timeout", ...(host ? { host } : {}) };
        return { ok: false, code: "unreachable", ...(host ? { host } : {}) };
      }
      // Committed: wait for its load within what is left (none for a move
      // within the same document); a page still loading is read as it stands.
      if (typeof answer.loaderId === "string") {
        const left = Math.max(0, budget - (Date.now() - started));
        const fired = await Promise.race([loaded, this.sleep(left).then(() => false)]);
        if (!fired) await this.send("Page.stopLoading", {}, this.mainSession!).catch(() => undefined);
      }
      if (this.lost) return { ok: false, code: "lost" };
      if (watch.privateHit) return { ok: false, code: "private_address", ...(host ? { host } : {}) };
      if (watch.refused) return { ok: false, code: "blocked_hop", ...(watch.refusedHost ? { host: watch.refusedHost } : {}) };
      if (watch.download) return { ok: false, code: "not_html", ...(host ? { host } : {}) };
      const mime = (this.lastMime ?? "").toLowerCase();
      if (mime && mime !== "text/html" && mime !== "application/xhtml+xml") return { ok: false, code: "not_html", ...(host ? { host } : {}) };
      const site = siteOf(this.url);
      if (!site) return { ok: false, code: "unreachable", ...(host ? { host } : {}) };
      return { ok: true, url: this.url, site };
    } finally {
      if (this.nav === watch) this.nav = null;
    }
  }

  async snapshot(): Promise<RawSnapshot> {
    if (this.lost) throw new BrowserLost();
    if (this.privateHold) return { url: "about:blank", title: "", contentType: "", blocks: [], elements: [], links: [] };
    const out = await this.reader("read", {});
    const elements = (Array.isArray(out.elements) ? out.elements : []).map(readerElement);
    const links: RawLink[] = (Array.isArray(out.links) ? out.links : []).map(rec).map((l) => ({ text: str(l.text) ?? "", href: str(l.href) ?? "" }));
    return {
      url: str(out.url) ?? this.url,
      title: str(out.title) ?? "",
      contentType: str(out.contentType) ?? "",
      blocks: (Array.isArray(out.blocks) ? out.blocks : []).filter((b): b is string => typeof b === "string"),
      // The hints the kind was read from, and the reader's index, stay here.
      elements: fingerprinted(elements).map((e) => {
        const { readerIndex: _index, ...raw } = e;
        void _index;
        return raw;
      }),
      links,
    };
  }

  /**
   * The target's control in a fresh read: its reader index, or why not. The
   * same count of twins, the same twin, the same anchor and the same place
   * among the controls, or `changed` (review of Phase 4 step 3: a twin
   * inserted above moved the card's index onto another one).
   *
   * The target may be in either form (TargetFingerprint, review round 1 of
   * Phase 4): its name and link as read, or sealed, compared by sealing the
   * fresh read's the same way, its anchor too (review round 2 of Phase 4).
   * The reader's own check in the page still gets the fresh read's plain
   * anchor (placeArg).
   */
  private async locateTarget(target: TargetFingerprint): Promise<{ ok: true; el: RawElement & { readerIndex: number } } | { ok: false; code: "not_found" | "changed" }> {
    const out = await this.reader("read", {});
    const all = fingerprinted((Array.isArray(out.elements) ? out.elements : []).map(readerElement));
    const twins = all.filter((e) => sameTwinOf(e, target));
    if (twins.length === 0) return { ok: false, code: "not_found" };
    if (twins.length !== target.twins) return { ok: false, code: "changed" };
    const el = twins.find((e) => e.twin === target.twin);
    if (!el || !sameAnchorOf(el, target) || el.at !== target.at) return { ok: false, code: "changed" };
    return { ok: true, el };
  }

  /** The reader's own check of the control it is passed: its index, tag, name and anchor. */
  private static placeArg(el: RawElement & { readerIndex: number }): Record<string, unknown> {
    return { i: el.readerIndex, tag: el.tag, name: el.name, anchor: el.anchor };
  }

  async find(text: string): Promise<{ matches: Array<{ text: string; near: ElementFingerprint | null }> }> {
    if (this.lost) throw new BrowserLost();
    if (this.privateHold) return { matches: [] };
    const read = await this.reader("read", {});
    const all = fingerprinted((Array.isArray(read.elements) ? read.elements : []).map(readerElement));
    const out = await this.reader("find", { text });
    const byIndex = new Map(all.map((e) => [e.readerIndex, e]));
    const matches = (Array.isArray(out.matches) ? out.matches : []).map(rec).map((m) => {
      const near = typeof m.near === "number" ? byIndex.get(m.near) : undefined;
      const fp: ElementFingerprint | null = near
        ? { tag: near.tag, role: near.role, name: near.name, kind: near.kind, type: near.type, formHost: near.formHost, href: near.href, twin: near.twin, twins: near.twins, anchor: near.anchor, at: near.at }
        : null;
      return { text: str(m.text) ?? "", near: fp };
    });
    return { matches };
  }

  async scroll(direction: "down" | "up", screens: number): Promise<{ atEnd: boolean }> {
    if (this.lost) throw new BrowserLost();
    const out = await this.reader("scroll", { dir: direction, screens: Math.min(Math.max(Math.floor(screens) || 1, 1), 3) });
    return { atEnd: out.atEnd === true };
  }

  async screenshot(o: { around?: TargetFingerprint | null }): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
    if (this.lost) throw new BrowserLost();
    if (this.privateHold) throw new Error("The page was closed");
    let clip: { x: number; y: number; width: number; height: number; scale: number } | null = null;
    if (o.around) {
      const found = await this.locateTarget(o.around);
      if (found.ok) {
        const box = await this.reader("box", Driver.placeArg(found.el));
        const b = rec(box.box);
        const v = rec(box.viewport);
        const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
        if (box.ok === true && num(b.width) > 0 && num(v.width) > 0) {
          const left = Math.max(num(v.x), num(b.x) - AROUND_PX);
          const top = Math.max(num(v.y), num(b.y) - AROUND_PX);
          const right = Math.min(num(v.x) + num(v.width), num(b.x) + num(b.width) + AROUND_PX);
          const bottom = Math.min(num(v.y) + num(v.height), num(b.y) + num(b.height) + AROUND_PX);
          if (right - left >= 1 && bottom - top >= 1) clip = { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top), scale: 1 };
        }
      }
    }
    const shot = rec(await this.send("Page.captureScreenshot", { format: "jpeg", quality: 60, captureBeyondViewport: false, ...(clip ? { clip } : {}) }, this.mainSession!));
    const data = str(shot.data);
    if (!data) throw new Error("No picture");
    let width = clip?.width ?? 0;
    let height = clip?.height ?? 0;
    if (!clip) {
      const metrics = rec(await this.send("Page.getLayoutMetrics", {}, this.mainSession!).catch(() => ({})));
      const vv = rec(metrics.cssVisualViewport);
      width = Math.round(typeof vv.clientWidth === "number" ? vv.clientWidth : 1280);
      height = Math.round(typeof vv.clientHeight === "number" ? vv.clientHeight : 800);
    }
    return { jpeg: Buffer.from(data, "base64"), width: Math.max(1, width), height: Math.max(1, height) };
  }

  /**
   * Every option the list has, at most OPTIONS_MATCH_MAX, for matching a
   * choice only (review of Phase 4 step 3): read, never shown to the model.
   */
  async options(target: TargetFingerprint): Promise<{ ok: true; options: ListOption[]; total: number } | { ok: false; code: "not_found" | "changed" }> {
    if (this.lost) throw new BrowserLost();
    if (this.privateHold) return { ok: false, code: "changed" };
    const found = await this.locateTarget(target);
    if (!found.ok) return found;
    const out = await this.reader("options", Driver.placeArg(found.el));
    if (out.ok !== true) return { ok: false, code: out.code === "not_found" ? "not_found" : "changed" };
    const options = (Array.isArray(out.options) ? out.options : []).slice(0, OPTIONS_MATCH_MAX).map((o) => {
      const r = rec(o);
      return { label: (str(r.label) ?? "").slice(0, OPTION_LABEL_MAX), disabled: r.disabled === true };
    });
    const total = typeof out.total === "number" && Number.isInteger(out.total) && out.total >= options.length ? out.total : options.length;
    return { ok: true, options, total };
  }

  /** The checks every act makes before any input (see the header). */
  private async prepareAct(target: TargetFingerprint): Promise<{ ok: true; el: RawElement & { readerIndex: number } } | { ok: false; outcome: ActOutcome }> {
    if (this.lost) return { ok: false, outcome: { ok: false, code: "lost_before" } };
    // A page being closed is acted on no more than it is read (review of Phase 4 step 2).
    if (this.privateHold) return { ok: false, outcome: { ok: false, code: "changed" } };
    if (isSensitiveField(target.kind)) return { ok: false, outcome: { ok: false, code: "sensitive" } };
    let found: Awaited<ReturnType<Driver["locateTarget"]>>;
    try {
      found = await this.locateTarget(target);
    } catch {
      return { ok: false, outcome: { ok: false, code: "lost_before" } };
    }
    if (!found.ok) return { ok: false, outcome: { ok: false, code: found.code } };
    if (!found.el.inMainFrame) return { ok: false, outcome: { ok: false, code: "frame" } };
    if (isSensitiveField(found.el.kind)) return { ok: false, outcome: { ok: false, code: "sensitive" } };
    if (found.el.disabled) return { ok: false, outcome: { ok: false, code: "disabled" } };
    return found;
  }

  private placeCode(code: unknown): ActOutcome {
    if (code === "disabled") return { ok: false, code: "disabled" };
    if (code === "changed") return { ok: false, code: "changed" };
    if (code === "not_found") return { ok: false, code: "not_found" };
    return { ok: false, code: "covered" };
  }

  /** Up to settleMaxMs for the page to stop loading after an act. */
  private async settle(): Promise<boolean> {
    const max = this.o.settleMaxMs ?? SETTLE_MAX_MS;
    await this.sleep(Math.min(250, max));
    if (!this.loading) return true;
    return this.waitFor(this.stopWaiters, Math.max(0, max - 250));
  }

  private async finishAct(): Promise<ActOutcome> {
    const settled = await this.settle();
    if (this.lost) return { ok: false, code: "unknown_outcome" };
    const refused = this.act?.refusedHost ?? null;
    if (refused) return { ok: false, code: "blocked_hop", host: refused };
    const site = siteOf(this.url) ?? "";
    return { ok: true, settled, url: this.url, site };
  }

  async click(target: TargetFingerprint): Promise<ActOutcome> {
    const prep = await this.prepareAct(target);
    if (!prep.ok) return prep.outcome;
    let sent = false;
    this.act = { refusedHost: null };
    try {
      let place: Raw;
      try {
        place = await this.reader("locate", Driver.placeArg(prep.el));
      } catch (err) {
        // Sent once: it may have run on the page (review of Phase 4 step 3).
        return err instanceof ReaderSent ? { ok: false, code: "unknown_outcome" } : { ok: false, code: "lost_before" };
      }
      if (place.ok !== true) return this.placeCode(place.code);
      const x = Number(place.x);
      const y = Number(place.y);
      try {
        await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, this.mainSession!);
        // From the press on, a lost answer may still have clicked.
        sent = true;
        await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, this.mainSession!);
        await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }, this.mainSession!);
      } catch {
        return sent ? { ok: false, code: "unknown_outcome" } : { ok: false, code: "lost_before" };
      }
      return await this.finishAct();
    } finally {
      this.act = null;
    }
  }

  async type(target: TargetFingerprint, text: string, pressEnter: boolean): Promise<ActOutcome> {
    const prep = await this.prepareAct(target);
    if (!prep.ok) return prep.outcome;
    let sent = false;
    this.act = { refusedHost: null };
    try {
      let focus: Raw;
      try {
        // What the field holds is selected, so the words replace it (review of Phase 4 step 3).
        focus = await this.reader("focus", { ...Driver.placeArg(prep.el), replace: true });
      } catch (err) {
        // Sent once: a page's focus handler may have run (review of Phase 4 step 3).
        return err instanceof ReaderSent ? { ok: false, code: "unknown_outcome" } : { ok: false, code: "lost_before" };
      }
      if (focus.ok !== true) return this.placeCode(focus.code);
      try {
        // The words may have arrived even when the answer did not.
        sent = true;
        await this.send("Input.insertText", { text }, this.mainSession!);
        if (pressEnter) {
          await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }, this.mainSession!);
          await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, this.mainSession!);
        }
      } catch {
        return sent ? { ok: false, code: "unknown_outcome" } : { ok: false, code: "lost_before" };
      }
      return await this.finishAct();
    } finally {
      this.act = null;
    }
  }

  async select(target: TargetFingerprint, choice: { index: number; label: string }): Promise<ActOutcome> {
    const prep = await this.prepareAct(target);
    if (!prep.ok) return prep.outcome;
    this.act = { refusedHost: null };
    try {
      let out: Raw;
      try {
        // The choice and its events are sent by this one call, once, so a
        // call that is lost may have made it (review of Phase 4 step 3: it
        // was sent again in a new world, choosing twice). By its index, only
        // while its label there is the card's.
        out = await this.reader("select", { ...Driver.placeArg(prep.el), index: choice.index, label: choice.label });
      } catch (err) {
        return err instanceof ReaderSent ? { ok: false, code: "unknown_outcome" } : { ok: false, code: "lost_before" };
      }
      if (out.ok !== true) return this.placeCode(out.code);
      return await this.finishAct();
    } finally {
      this.act = null;
    }
  }

  /** Leave the page for about:blank, held meanwhile (types.ts BrowserHandle.blank). */
  async blank(): Promise<void> {
    if (this.lost || !this.mainSession) return;
    await this.blankPage(this.mainSession);
  }

  async close(): Promise<void> {
    if (this.mainTarget && !this.lost) await this.send("Target.closeTarget", { targetId: this.mainTarget }).catch(() => undefined);
    await this.cdp.close().catch(() => undefined);
  }

  handle(): BrowserHandle {
    return {
      navigate: (url) => this.navigate(url),
      snapshot: () => this.snapshot(),
      find: (text) => this.find(text),
      scroll: (d, n) => this.scroll(d, n),
      screenshot: (o) => this.screenshot(o),
      options: (t) => this.options(t),
      click: (t) => this.click(t),
      type: (t, text, enter) => this.type(t, text, enter),
      select: (t, choice) => this.select(t, choice),
      currentUrl: () => this.url,
      documentId: () => `${this.docNonce}.${this.docSeq}`,
      blank: () => this.blank(),
      watch: (on) => this.watch(on),
      drainEvents: () => this.drainEvents(),
      close: () => this.close(),
    };
  }

  // ── The recorder (see the header) ─────────────────────────────────

  /** One recorder operation in a context, its answer by value; null when it failed. */
  private async recorderCall(contextId: number, op: "start" | "ensure" | "stop" | "drain", token: string | null = null): Promise<Raw | null> {
    if (this.lost || !this.mainSession) return null;
    try {
      const out = rec(
        await this.send(
          "Runtime.callFunctionOn",
          { functionDeclaration: RECORDER_CALL, executionContextId: contextId, arguments: [{ value: op }, { value: token }], returnByValue: true, awaitPromise: false, silent: true },
          this.mainSession,
        ),
      );
      if (out.exceptionDetails) return null;
      return rec(rec(out.result).value);
    } catch {
      return null;
    }
  }

  /**
   * The recorder world of the document open now, by its name
   * (Page.createIsolatedWorld): the world the new-document script ran in.
   * **verify:** that it answers that same world on the provider's Chrome.
   */
  private async recorderWorld(): Promise<number | null> {
    if (this.lost || !this.mainSession || !this.mainTarget) return null;
    try {
      const out = rec(await this.send("Page.createIsolatedWorld", { frameId: this.mainTarget, worldName: RECORDER_WORLD, grantUniveralAccess: false }, this.mainSession));
      return typeof out.executionContextId === "number" ? out.executionContextId : null;
    } catch {
      return null;
    }
  }

  /**
   * The binding in one recorder context only (see the header): no page
   * script can see it, and Runtime is never enabled. **verify:**
   * Runtime.addBinding with executionContextId, and Runtime.bindingCalled
   * without Runtime.enable, on the provider's Chrome. False when it failed:
   * that document's events wait in its queue for the poll.
   */
  private async bindRecorder(contextId: number): Promise<boolean> {
    if (this.lost || !this.mainSession) return false;
    try {
      await this.send("Runtime.addBinding", { name: BINDING, executionContextId: contextId }, this.mainSession);
      return true;
    } catch {
      return false;
    }
  }

  /** A recorder's answer: the events it held in its queue, its gaps. */
  private takeAnswer(r: RecState, out: Raw | null): void {
    if (!out) return;
    r.buffer.push(...recordedEventsFrom(out.events));
    if (out.lost === true) r.buffer.push(gapAt(this.url));
  }

  /**
   * A main-frame commit while the person records (see the header): a page
   * change from a document whose events relied on its queue is a gap; the
   * new document's recorder found, bound and ensured, its queue so far taken,
   * "late" or a recorder or binding it could not get a gap too.
   */
  private recorderCommit(bare: string, url: string): void {
    const r = this.rec;
    if (!r) return;
    const wasBound = r.bound;
    r.ctx = null;
    r.ctxEpoch = this.epoch;
    // The document left relied on its queue: what it held since the last poll may be lost here.
    if (!wasBound) r.buffer.push(gapAt(url));
    // About:blank and Chrome's own error page are no page of a site: nothing
    // is recorded there, so nothing of theirs can be lost.
    if (bare === "about:blank" || bare.startsWith("chrome-error:") || !/^https?:/i.test(bare)) {
      r.bound = true;
      return;
    }
    r.bound = false;
    r.pages.push({ url, at: Date.now() });
    const epoch = this.epoch;
    void (async () => {
      const id = await this.recorderWorld();
      if (this.rec !== r || this.epoch !== epoch) return;
      if (id === null) {
        r.buffer.push(gapAt(url));
        return;
      }
      const bound = await this.bindRecorder(id);
      if (this.rec !== r || this.epoch !== epoch) return;
      const out = await this.recorderCall(id, "ensure", bound ? r.token : null);
      if (this.rec !== r || this.epoch !== epoch) return;
      if (!out || out.installed === null || out.installed === undefined) {
        r.buffer.push(gapAt(url));
        return;
      }
      if (out.installed === "late") r.buffer.push(gapAt(url));
      this.takeAnswer(r, out);
      r.ctx = id;
      r.bound = bound;
    })();
  }

  /** Drain the queue of a recorder context, every event it holds, into the buffer. False when it could not be read. */
  private async drainInto(r: RecState, contextId: number): Promise<boolean> {
    for (let i = 0; i < DRAIN_ROUNDS; i += 1) {
      const out = await this.recorderCall(contextId, "drain");
      if (this.rec !== r) return false;
      if (!out || out.installed === null || out.installed === undefined) return false;
      this.takeAnswer(r, out);
      if (out.more !== true) return true;
    }
    return true;
  }

  /** Start or stop recording the person's own input in this tab (types.ts BrowserHandle.watch). Never throws. */
  private async watch(on: boolean): Promise<void> {
    try {
      if (on) await this.startWatching();
      else await this.stopWatching();
    } catch {
      /* a lost connection: the recording ends with the session */
    }
  }

  private async startWatching(): Promise<void> {
    if (this.lost || !this.mainSession) return;
    let r = this.rec;
    if (!r) {
      r = { token: randomUUID(), identifier: null, ctx: null, ctxEpoch: this.epoch, bound: false, buffer: [], pages: [] };
      this.rec = r;
      try {
        // **verify:** worldName and runImmediately on the provider's Chrome.
        const out = rec(await this.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER_SOURCE, worldName: RECORDER_WORLD, runImmediately: true }, this.mainSession));
        r.identifier = str(out.identifier);
      } catch {
        // Every later document is then installed late at its commit, each a gap.
        r.identifier = null;
      }
    }
    // The document open now: its world found, bound, and the recorder started
    // there with its queue emptied (a second watch(true) installs nothing twice).
    const epoch = this.epoch;
    const id = await this.recorderWorld();
    if (id === null || this.rec !== r || this.epoch !== epoch) return;
    const bound = await this.bindRecorder(id);
    if (this.rec !== r || this.epoch !== epoch) return;
    const out = await this.recorderCall(id, "start", bound ? r.token : null);
    if (this.rec !== r || this.epoch !== epoch) return;
    if (out && out.installed !== null && out.installed !== undefined) {
      r.ctx = id;
      r.ctxEpoch = epoch;
      r.bound = bound;
    }
  }

  private async stopWatching(): Promise<void> {
    const r = this.rec;
    this.rec = null;
    if (!r || this.lost || !this.mainSession) return;
    if (r.identifier) await this.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier }, this.mainSession).catch(() => undefined);
    // Its notices stop here (the binding itself stays in the worlds, unused once they stop).
    await this.send("Runtime.removeBinding", { name: BINDING }, this.mainSession).catch(() => undefined);
    const id = r.ctx !== null && r.ctxEpoch === this.epoch ? r.ctx : await this.recorderWorld();
    if (id !== null) await this.recorderCall(id, "stop");
  }

  /** The events since the last call (types.ts BrowserHandle.drainEvents): the pauses' and the gaps, then the known context's queue. Never makes a world; never throws. */
  private async drainEvents(): Promise<{ events: RecordedEvent[]; pages: Array<{ url: string; at: number }> }> {
    const r = this.rec;
    if (!r) return { events: [], pages: [] };
    if (!this.lost && r.ctx !== null && r.ctxEpoch === this.epoch) {
      await this.drainInto(r, r.ctx).catch(() => false);
    }
    return { events: r.buffer.splice(0), pages: r.pages.splice(0) };
  }
}
