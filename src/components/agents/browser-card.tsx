"use client";

// The browser card (docs/plans/ai-teammates-phase4.md step 4, Decisions 6,
// 19, 23, 29 and 30): a teammate's browser in the person's chat, drawn by the
// thread in place of the browser_started line (teammate-thread.tsx), the
// approval card's frame and buttons (approval-card.tsx), never a surface of
// its own. It reads GET /api/teammate-browser/sessions/[id] (the person's
// own, Decision 30), and again on the realtime agent.changed naming this
// browser and on window focus.
//
//   Live      "Browser", the site, the Live chip, "Closes by {time}";
//             Watch (secondary) opens the live view under a transparent
//             overlay that takes every pointer event, so it is view-only,
//             with the viewOnly line above it; Take over (secondary), which
//             names the take over request that waits, if one does (review of
//             Phase 4 step 4: the request is answered, and Done continues
//             the chat); Stop (danger ghost, asks first)
//   Waiting   the same, with the Waiting for you chip and a link to the card
//             that waits
//   Handed over  the person has it: Done (secondary) and Give it back
//             (ghost), which send take-over/done with `finished`, then the
//             chat continues once when the teammate's card moved
//             (teammate-store.ts continueAfterTakeOver); the handedOverHint;
//             then clickToUse and the frame with no overlay
//   Open      (live, waiting or handed over) the buttons always come before
//             the frame, and nothing focuses it (review of Phase 4 step 4);
//             under it, a thumbnail of the newest page picture it showed
//             the person (views.ts newestPageShot), opening the lightbox
//   Closed    the Closed chip, why it closed and its minutes; What it did:
//             each step by its kind and host, its time and outcome word, and
//             a thumbnail of each picture still kept (a lightbox), or
//             pictureGone after its day
//
// THE LIVE VIEW'S ADDRESS (Decision 19) is minted on request (POST
// .../live-view, or Take over's answer), held in this card's state only:
// never stored, logged, put in the page's address or kept once the card
// hides it, hands it back or the browser closes. It is embedded only when its
// origin is the provider's (live-view-origin.ts liveViewShownOk: the page
// repeats the server's check), in a frame with sandbox "allow-scripts
// allow-same-origin", no referrer and clipboard-write only. Outside a take
// over the frame is inert (out of the tab order, no keys reach it) under the
// overlay, so watching never drives the browser and never traps focus.
// During one the person clicks into it themselves (review of Phase 4 step 4).
//
// THE APPROVAL CARD'S TAKE OVER hands the browser to this card once it has
// read its browser (review of Phase 4 step 4); until then none is registered
// and the approval card draws its own.
//
// PICTURES load only from /api/teammate-browser/shots/<id> (views.ts
// shotSrc), the person's own.
//
// EVERY WRITE names the workspace the card was read in, and a session
// switched in another tab answers workspace_changed: the page reloads.
// One blue button per page: every button here is secondary or ghost.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Check, Eye } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { APPROVAL_CARD, BROWSER_PANEL_COPY as B } from "@/lib/agents/teammate-copy";
import { continueAfterTakeOver } from "@/lib/agents/teammate-store";
import type { ResumeChat } from "@/lib/agents/decide-client";
import { liveViewShownOk } from "@/lib/browser/live-view-origin";
import {
  browserCardState,
  endedLine,
  hostOf,
  newestPageShot,
  outcomeWord,
  shotSrc,
  takeOverForStep,
  takeOverRequestOf,
  type BrowserCardState,
  type BrowserSessionView,
  type BrowserStepView,
} from "@/lib/browser/views";
import { RUN_TONE_COLOR, type RunTone } from "@/lib/automation/run-status";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import { cn } from "@/lib/utils";

// The approval card's own button weights (approval-card.tsx).
const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";
const GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60";
const DANGER_GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-danger-text hover:bg-hover disabled:opacity-60";
const LINK = "text-sm font-medium text-brand-deep hover:underline";

/** The steps a closed card lists before Show all. */
const STEPS_SHOWN = 20;

/** An action id as it goes into a selector (teammate-chat.tsx ACTION_ID). */
const ACTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const CHIP: Record<BrowserCardState, { label: string; tone: RunTone }> = {
  live: { label: B.live, tone: "info" },
  waiting: { label: B.waiting, tone: "warning" },
  handed_over: { label: B.handedOver, tone: "info" },
  closed: { label: B.closed, tone: "neutral" },
};

/** Whether this page was built for production: the live view's check then holds the provider's origin alone. */
const PRODUCTION = process.env.NODE_ENV === "production";

/* ─────────────────────── the thread's browser cards ─────────────────────── */

/** What a browser card on screen does for the approval card: take the browser over from its card. */
export interface BrowserCardHandle {
  takeOver: (actionId: string) => Promise<boolean>;
}

interface BrowserCards {
  register: (sessionId: string, handle: BrowserCardHandle) => () => void;
  handleFor: (sessionId: string) => BrowserCardHandle | null;
  /** Whether a card of this request is drawn in the thread (the waiting chip's link). */
  hasRequest: (actionId: string) => boolean;
  /**
   * Changes whenever the thread's lines or its cards' statuses do: a step
   * asked (the browser now waits), decided (it waits no more) or handed
   * back arrives in the chat, not as a realtime event naming the browser,
   * so a card still open reads itself again then.
   */
  tick: string;
}

const BrowserCardsContext = createContext<BrowserCards | null>(null);

/**
 * The thread's browser cards, by session (teammate-thread.tsx): the approval
 * card's Take over hands the browser to the card already on screen, which
 * scrolls itself into view, rather than drawing a second one.
 */
export function BrowserCardsProvider({ hasRequest, tick, children }: { hasRequest: (actionId: string) => boolean; tick: string; children: ReactNode }) {
  const handles = useRef(new Map<string, BrowserCardHandle>());
  const register = useCallback((sessionId: string, handle: BrowserCardHandle) => {
    handles.current.set(sessionId, handle);
    return () => {
      if (handles.current.get(sessionId) === handle) handles.current.delete(sessionId);
    };
  }, []);
  const handleFor = useCallback((sessionId: string) => handles.current.get(sessionId) ?? null, []);
  const value = useMemo<BrowserCards>(() => ({ register, handleFor, hasRequest, tick }), [register, handleFor, hasRequest, tick]);
  return <BrowserCardsContext.Provider value={value}>{children}</BrowserCardsContext.Provider>;
}

export function useBrowserCards(): BrowserCards | null {
  return useContext(BrowserCardsContext);
}

/* ─────────────────────────── the card ─────────────────────────── */

type LiveView = { url: string; interactive: boolean };

export function BrowserCard({
  browserSessionId: id,
  takeOverFor,
  fallback,
}: {
  browserSessionId: string;
  /** Drawn by an approval card's Take over when no card of this browser is on screen: take it over for that request while it waits (views.ts takeOverForStep). */
  takeOverFor?: string;
  /** What shows when the browser cannot be read as the person's own (the line it replaces). */
  fallback?: ReactNode;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const cards = useBrowserCards();
  const rootRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<BrowserSessionView | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [live, setLive] = useState<LiveView | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allSteps, setAllSteps] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);

  const url = `/api/teammate-browser/sessions/${encodeURIComponent(id)}`;
  const latest = useRef(0);
  // The read whose answer is on screen (review of Phase 4 step 4: a refused take over is tried again only at a later read).
  const viewRead = useRef(0);
  const read = useCallback(async () => {
    const n = ++latest.current;
    const r = await apiFetch<BrowserSessionView>(url, { cache: "no-store" });
    if (n !== latest.current) return;
    if (!r.ok) {
      setLoad(r.status === 404 ? "missing" : "error");
      return;
    }
    viewRead.current = n;
    setView(r.data);
    setLoad("ready");
  }, [url]);

  useEffect(() => {
    const t = setTimeout(() => void read(), 0);
    const onFocus = () => void read();
    const onRealtime = (e: Event) => {
      const d = (e as CustomEvent<RealtimeEvent>).detail;
      if (d?.type === "agent.changed" && d.browserSessionId === id) void read();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
    };
  }, [read, id]);

  const state = view ? browserCardState(view) : null;
  // A closed browser keeps no live view address.
  const shownLive = state && state !== "closed" ? live : null;
  // The frame takes input only while the person has the browser and the address was minted for that.
  const interactive = Boolean(shownLive?.interactive && state === "handed_over");

  /** A refusal's sentence, and what it means for the card. */
  const refused = useCallback(
    (r: { error: string; code?: string }, fallbackLine: string) => {
      toast(r.error || fallbackLine, { tone: "danger" });
      if (r.code === "workspace_changed") {
        window.location.reload();
        return;
      }
      void read();
    },
    [toast, read],
  );

  /** Hold a live view only when its origin is the provider's (the page repeats the server's check). */
  const hold = useCallback(
    (lv: { url?: unknown; interactive?: unknown } | null | undefined): boolean => {
      const u = typeof lv?.url === "string" ? lv.url : "";
      if (!u || !liveViewShownOk(u, { production: PRODUCTION })) {
        setLive(null);
        setLiveFailed(true);
        return false;
      }
      setLiveFailed(false);
      setLive({ url: u, interactive: lv?.interactive === true });
      return true;
    },
    [],
  );

  const watch = useCallback(async () => {
    if (!view) return;
    setBusy(true);
    const r = await apiFetch<{ url: string; interactive: boolean }>(`${url}/live-view`, { method: "POST", json: { organizationId: view.organizationId } });
    setBusy(false);
    if (!r.ok) {
      setLiveFailed(true);
      refused(r, B.liveViewFailed);
      return;
    }
    if (!hold(r.data)) toast(B.liveViewFailed, { tone: "danger" });
  }, [view, url, refused, hold, toast]);

  const takeOver = useCallback(
    async (actionId: string | null): Promise<boolean> => {
      if (!view) return false;
      setBusy(true);
      const r = await apiFetch<{ session: BrowserSessionView; liveView: { url: string; interactive: boolean } }>(`${url}/take-over`, {
        method: "POST",
        json: { organizationId: view.organizationId, ...(actionId ? { actionId } : {}) },
      });
      setBusy(false);
      if (!r.ok) {
        refused(r, B.takeOverFailed);
        return false;
      }
      setView(r.data.session);
      // Never focused for the person (review of Phase 4 step 4): Done and Give it back sit above it, and they click into it.
      if (!hold({ url: r.data.liveView?.url, interactive: true })) toast(B.liveViewFailed, { tone: "danger" });
      rootRef.current?.scrollIntoView({ block: "center" });
      return true;
    },
    [view, url, refused, hold, toast],
  );

  // The approval card's Take over hands the browser to this card (BrowserCardsProvider).
  const takeOverRef = useRef(takeOver);
  useEffect(() => {
    takeOverRef.current = takeOver;
  }, [takeOver]);
  // Only once this card has read its browser (review of Phase 4 step 4): a
  // card still loading, or one its browser is not the person's own, would
  // take nothing over, so until then the approval card draws its own.
  const register = cards?.register;
  const canTakeOver = view !== null && load !== "missing";
  useEffect(() => {
    if (!register || !canTakeOver) return;
    return register(id, { takeOver: (actionId) => takeOverRef.current(actionId) });
  }, [register, id, canTakeOver]);

  // The chat moved (a step asked, decided or handed back): an open browser reads itself again.
  const tick = cards?.tick ?? "";
  const seenTick = useRef(tick);
  useEffect(() => {
    if (seenTick.current === tick) return;
    seenTick.current = tick;
    if (state === "closed") return;
    const t = setTimeout(() => void read(), 0);
    return () => clearTimeout(t);
  }, [tick, state, read]);

  // Drawn by an approval card that had no card to hand to (review of Phase 4
  // step 4, views.ts takeOverForStep): take it over for that request while it
  // still waits, the browser live, waiting or already handed over, so the
  // request is answered and Done continues the chat; once it no longer waits
  // (handed over through it, decided) or the browser closed, never again.
  // Only a take over that went through counts: one refused (a step in
  // flight) is tried again at a read after the refusal's own, never in a loop.
  const tookOverFor = useRef<string | null>(null);
  const takingOverFor = useRef(false);
  const retryAfterRead = useRef(0);
  useEffect(() => {
    if (!takeOverFor || tookOverFor.current === takeOverFor || !view || takingOverFor.current) return;
    if (takeOverForStep(view, takeOverFor) === "done") {
      tookOverFor.current = takeOverFor;
      return;
    }
    if (viewRead.current <= retryAfterRead.current) return;
    const t = setTimeout(() => {
      takingOverFor.current = true;
      void takeOver(takeOverFor).then((ok) => {
        takingOverFor.current = false;
        if (ok) tookOverFor.current = takeOverFor;
        else retryAfterRead.current = latest.current;
      });
    }, 0);
    return () => clearTimeout(t);
  }, [takeOverFor, view, takeOver]);

  // The person has it but this card holds no address yet (a reload, another tab): show it, once.
  const askedForHandedOver = useRef(false);
  useEffect(() => {
    if (state !== "handed_over") {
      askedForHandedOver.current = false;
      return;
    }
    if (live || liveFailed || busy || askedForHandedOver.current) return;
    askedForHandedOver.current = true;
    const t = setTimeout(() => void watch(), 0);
    return () => clearTimeout(t);
  }, [state, live, liveFailed, busy, watch]);

  // The browser closed: its address goes with it.
  useEffect(() => {
    if (state !== "closed" || !live) return;
    const t = setTimeout(() => setLive(null), 0);
    return () => clearTimeout(t);
  }, [state, live]);

  async function stop() {
    if (!view) return;
    const ok = await confirm({ title: B.stopTitle, description: B.stopBody, confirmLabel: B.stop, destructive: true });
    if (!ok) return;
    setBusy(true);
    const r = await apiFetch<{ session: BrowserSessionView }>(`${url}/stop`, { method: "POST", json: { organizationId: view.organizationId } });
    setBusy(false);
    if (!r.ok) {
      refused({ error: B.stopFailed, code: r.code }, B.stopFailed);
      return;
    }
    setLive(null);
    setView(r.data.session);
    toast(B.stopped);
  }

  async function giveBack(finished: boolean) {
    if (!view) return;
    setBusy(true);
    const r = await apiFetch<{ session: BrowserSessionView; resume: boolean; chat: ResumeChat | null }>(`${url}/take-over/done`, {
      method: "POST",
      json: { organizationId: view.organizationId, finished },
    });
    setBusy(false);
    if (!r.ok) {
      refused(r, B.giveBackFailed);
      return;
    }
    // Handed back: the address the person used goes with it.
    setLive(null);
    setView(r.data.session);
    void continueAfterTakeOver({ resume: r.data.resume === true, chat: r.data.chat ?? null });
  }

  function seeRequest(actionId: string) {
    if (!ACTION_ID.test(actionId)) return;
    const el = document.querySelector<HTMLElement>(`[data-action-id="${actionId}"]`);
    el?.scrollIntoView({ block: "center" });
  }

  if (load === "missing") return <>{fallback ?? null}</>;
  if (load === "error" && !view) {
    return (
      <section aria-label={B.title} className="rounded-lg border border-line bg-raised p-3">
        <p className="m-0 flex min-h-8 flex-wrap items-center gap-2 text-sm text-ink-2">
          {B.loadFailed} ·
          <button type="button" className={LINK} onClick={() => void read()}>{B.tryAgain}</button>
        </p>
      </section>
    );
  }
  if (!view || !state) {
    return (
      <section aria-label={B.title} aria-busy="true" className="rounded-lg border border-line bg-raised p-3">
        <SkeletonLines lines={2} />
      </section>
    );
  }

  const chip = CHIP[state];
  const site = hostOf(view.site);
  const waitingFor = state === "waiting" && view.waiting && cards?.hasRequest(view.waiting.actionId) ? view.waiting.actionId : null;
  // While the browser is open, the newest page it showed the person (review of Phase 4 step 4).
  const latestShot = state === "closed" ? null : newestPageShot(view);

  return (
    <section ref={rootRef} data-browser-session-id={view.id} aria-label={B.title} className="rounded-lg border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-base font-medium text-ink">{B.title}</h3>
        {site ? <span className="min-w-0 break-all text-sm text-ink-2">{site}</span> : null}
        <StatusChip color={RUN_TONE_COLOR[chip.tone]} label={chip.label} className="shrink-0" />
        {state !== "closed" ? (
          <span className="ms-auto text-sm text-ink-2" title={formatDateTitle(view.endsBy, datePrefs)}>
            {B.endsAt(formatDate(view.endsBy, datePrefs, "time"))}
          </span>
        ) : null}
      </div>

      {waitingFor ? (
        <p className="m-0 mt-1">
          <button type="button" className={LINK} onClick={() => seeRequest(waitingFor)}>{B.seeRequest}</button>
        </p>
      ) : null}

      {state === "closed" ? (
        <Closed view={view} datePrefs={datePrefs} all={allSteps} onAll={() => setAllSteps(true)} onPicture={setPicture} />
      ) : (
        <>
          {/* The buttons come before the frame (review of Phase 4 step 4): a
              person in a browser that keeps every key still finds Done and
              Give it back above it, and nothing focuses the frame for them. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {state === "handed_over" ? (
              <>
                <button type="button" className={SECONDARY} disabled={busy} onClick={() => void giveBack(true)}>
                  <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {B.done}
                </button>
                <button type="button" className={GHOST} disabled={busy} onClick={() => void giveBack(false)}>{B.giveBack}</button>
              </>
            ) : (
              <>
                {shownLive ? (
                  <button type="button" className={GHOST} onClick={() => setLive(null)}>{B.hide}</button>
                ) : (
                  <button type="button" className={SECONDARY} disabled={busy} onClick={() => void watch()}>
                    <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {B.watch}
                  </button>
                )}
                {/* A take over request that waits is answered by it (review of Phase 4 step 4), so Done continues the chat. */}
                <button type="button" className={SECONDARY} disabled={busy} onClick={() => void takeOver(takeOverRequestOf(view))}>{B.takeOver}</button>
              </>
            )}
            <button type="button" className={DANGER_GHOST} disabled={busy} onClick={() => void stop()}>{B.stop}</button>
          </div>
          {state === "handed_over" ? <p className="m-0 mt-2 text-sm text-ink-2">{B.handedOverHint}</p> : null}
          {shownLive ? (
            <>
              <p className="m-0 mt-2 text-sm text-ink-2">{interactive ? B.clickToUse : B.viewOnly}</p>
              <LiveFrame key={shownLive.url} url={shownLive.url} interactive={interactive} />
            </>
          ) : liveFailed && state === "handed_over" ? (
            // The person has it but the frame could not be shown: Try again here (Watch has its own button otherwise).
            <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2" role="status">
              {B.liveViewFailed}
              <button type="button" className={LINK} disabled={busy} onClick={() => void watch()}>{B.tryAgain}</button>
            </p>
          ) : null}
          {latestShot ? <LatestPicture key={latestShot} id={latestShot} onOpen={setPicture} /> : null}
        </>
      )}

      <Picture id={picture} onClose={() => setPicture(null)} />
    </section>
  );
}

/* ─────────────────────────── the parts ─────────────────────────── */

/**
 * The live view: the provider's page in a sandboxed frame that sends no
 * referrer. View-only, it is inert (never focused, no key reaches it) under
 * a transparent overlay that takes every pointer event; handed over, the
 * overlay goes and the frame takes the person's input once they click into
 * it. Nothing focuses it for them (review of Phase 4 step 4): a remote
 * browser may keep every key, Tab included, so the card's buttons sit above.
 */
function LiveFrame({ url, interactive }: { url: string; interactive: boolean }) {
  const swallow = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div className="relative mt-2 aspect-[16/10] w-full overflow-hidden rounded-md border border-line bg-subtle">
      <iframe
        src={url}
        title={B.liveViewTitle}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        allow="clipboard-write"
        inert={!interactive}
        tabIndex={interactive ? 0 : -1}
        className="block h-full w-full border-0"
      />
      {interactive ? null : (
        <div
          aria-hidden
          data-view-only
          className="absolute inset-0 cursor-default"
          onPointerDown={swallow}
          onPointerUp={swallow}
          onMouseDown={swallow}
          onMouseUp={swallow}
          onClick={swallow}
          onDoubleClick={swallow}
          onContextMenu={swallow}
          onKeyDown={swallow}
          onKeyUp={swallow}
          onDragStart={swallow}
          onDrop={swallow}
        />
      )}
    </div>
  );
}

function Closed({
  view,
  datePrefs,
  all,
  onAll,
  onPicture,
}: {
  view: BrowserSessionView;
  datePrefs: ReturnType<typeof useDatePrefs>;
  all: boolean;
  onAll: () => void;
  onPicture: (id: string) => void;
}) {
  // The pictures the route still keeps (it lists none past its day); one that goes while the card is open reads as gone.
  const kept = useMemo(() => new Set(view.shots.map((x) => x.id)), [view.shots]);
  const steps = all ? view.steps : view.steps.slice(-STEPS_SHOWN);
  return (
    <>
      <p className="m-0 mt-1 text-sm text-ink-2">
        {view.endedLine ?? endedLine(view.endReason)} · {B.minutesUsed(view.minutes)}
      </p>
      <h4 className="m-0 mt-3 text-sm font-medium text-ink-2">{B.stepsHeading}</h4>
      {view.steps.length === 0 ? (
        <p className="m-0 mt-1 text-sm text-ink-2">{B.noSteps}</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {steps.map((s) => (
            <StepRow key={s.seq} s={s} datePrefs={datePrefs} kept={kept} onPicture={onPicture} />
          ))}
        </ul>
      )}
      {!all && view.steps.length > STEPS_SHOWN ? (
        <button type="button" className={cn(LINK, "mt-1")} onClick={onAll}>{APPROVAL_CARD.showAll}</button>
      ) : null}
    </>
  );
}

function StepRow({ s, datePrefs, kept, onPicture }: { s: BrowserStepView; datePrefs: ReturnType<typeof useDatePrefs>; kept: ReadonlySet<string>; onPicture: (id: string) => void }) {
  const word = outcomeWord(s.outcome);
  // A picture deleted since the card was read (its day passed) reads as gone.
  const [gone, setGone] = useState(false);
  const src = s.shotId && kept.has(s.shotId) && !gone ? shotSrc(s.shotId) : null;
  return (
    <li className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-soft py-1.5 text-sm first:border-t-0">
      <span className="min-w-0 break-words text-ink">{s.line}</span>
      <span className="text-ink-2" title={formatDateTitle(s.at, datePrefs)}>{formatDate(s.at, datePrefs, "time")}</span>
      {word ? <span className="text-ink-2">{word}</span> : null}
      {src && s.shotId ? (
        <button type="button" className="ms-auto rounded-md" aria-label={B.openPicture} onClick={() => onPicture(s.shotId!)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" onError={() => setGone(true)} className="h-10 w-auto max-w-[96px] rounded border border-line object-cover" />
        </button>
      ) : s.shotId ? (
        <span className="ms-auto text-ink-2">{B.pictureGone}</span>
      ) : null}
    </li>
  );
}

/**
 * An open browser's newest page picture (review of Phase 4 step 4, views.ts
 * newestPageShot): a thumbnail, read only through shotSrc, opening the
 * lightbox; nothing once it no longer loads.
 */
function LatestPicture({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const [gone, setGone] = useState(false);
  const src = shotSrc(id);
  if (!src || gone) return null;
  return (
    <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
      <button type="button" className="rounded-md" aria-label={B.openPicture} onClick={() => onOpen(id)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" onError={() => setGone(true)} className="h-10 w-auto max-w-[96px] rounded border border-line object-cover" />
      </button>
      {B.latestPicture}
    </p>
  );
}

/** A step's picture, larger, for its person alone. */
function Picture({ id, onClose }: { id: string | null; onClose: () => void }) {
  const src = shotSrc(id);
  return (
    <Dialog open={Boolean(src)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl text-ink">
        <DialogTitle className="pe-8 text-lg font-semibold text-ink">{B.picture}</DialogTitle>
        <DialogDescription className="text-sm text-ink-2">{B.pictureFor}</DialogDescription>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={B.picture} className="h-auto max-w-full rounded-md border border-line" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
