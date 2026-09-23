"use client";

// IncomingCallWatcher: an incoming call rings within a second or two rather
// than on the notification bell's poll. Mounted once at shell level.
//
// PHASE 4 (spec-talk.md section 2.6) changed three things:
//
//   1. THE RING IS A CARD, NOT A TOAST. `IncomingCallCard` renders in the
//      bottom-right reserved region above the call dock, with Decline, Join
//      with video and the one blue Join. A toast shared its three-slot cap
//      with "Saved" messages and could be pushed off screen by them.
//   2. IT DOES NOT POLL WHEN TALK IS OFF. The 15s fetch used to run on every
//      route in every workspace, and answered 403 forever in one that never
//      bought the module (comms #27). The module list comes from /api/boot
//      through the shell, so this costs no request.
//   3. SSE FIRST. The poll is a BACKSTOP that runs only while the stream is
//      down. `workwrk:realtime-state` says which, so a healthy stream means
//      one fetch on mount and then nothing until an event says otherwise.
//
// Rings stop when the call ends: `call.changed` and `call.ended` both fan out
// to workwrk:call-changed, and a call that vanishes from the list clears its
// card. Declining hides that call for this tab and does not ring again, and
// so does letting it ring out or answering it: see SILENCED below. Without
// that memory the card came back, because /api/calls/incoming keeps reporting
// a live call for two minutes and every roster change re-reads it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { IncomingCallCard, type IncomingCall } from "@/components/calls/incoming-call-card";
import { WINDOW_EVENTS } from "@/lib/realtime-events";

/** Backstop only: the SSE path is about a second, this covers a dead stream. */
const POLL_MS = 15_000;
/** A card stops ringing on its own, as a phone does. */
const RING_MS = 45_000;
/** /api/calls/incoming only returns calls younger than its own FRESH_MS of
 *  two minutes, so an elapsed time outside this range does not mean the call
 *  is old: it means the browser's clock and the server's disagree. */
const CLOCK_SANITY_MS = 180_000;

/** A row as the API sends it. `startedAt` is on the wire but not on
 *  `IncomingCall`, which is the card's prop type and has no use for it. The
 *  ring clock does, so the watcher reads it here and the card never sees it. */
type IncomingRow = IncomingCall & { startedAt?: string };

/**
 * How much of this call's 45 seconds is left, in ms, and 0 once it has rung
 * out. Exported for its test.
 *
 * The clock is the CALL'S OWN START wherever the server gave us one, so the
 * answer never depends on when this component last rendered. That dependence
 * was the bug: every poll handed `setCalls` a freshly filtered array, so a
 * ring timeout armed from the array as a whole was torn down and re-armed
 * three times over before it could reach 45 seconds.
 *
 * Two guards on that clock:
 *
 *   * `startedAt` is the SERVER's clock and `now` is the BROWSER's. A machine
 *     running minutes fast would read every call as long expired and would
 *     never ring at all, which is far worse than ringing a little late. So an
 *     elapsed time that cannot be real (negative, or older than the server's
 *     own freshness window) is disbelieved and we fall back to
 *   * `firstSeenAt`, the moment this tab first saw the call. One clock at
 *     both ends, and it is remembered for as long as the call is live, so a
 *     poll every 15s cannot restart it either.
 *
 * Both clocks only ever run forwards, which is what lets the caller treat a
 * result of 0 as final: a call that has rung out cannot ring again on a later
 * tick just because the server still reports it.
 */
export function ringRemainingMs(
  startedAt: string | undefined,
  firstSeenAt: number,
  now: number,
): number {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const sinceStart = now - started;
  const elapsed =
    Number.isFinite(sinceStart) && sinceStart >= 0 && sinceStart <= CLOCK_SANITY_MS
      ? sinceStart
      : now - firstSeenAt;
  return Math.max(0, RING_MS - elapsed);
}

/**
 * First-sight times, one entry per conversation. Exported for its test.
 *
 * Entries survive for exactly as long as the server still reports the call,
 * so a poll does not reset a ring in progress, and a call that ends and comes
 * back five minutes later is a new call with a fresh 45 seconds. Same
 * recycling rule as `declined` and `silenced` below, for the same reason.
 */
export function keepFirstSeen(
  prev: ReadonlyMap<string, number>,
  ids: readonly string[],
  now: number,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const id of ids) next.set(id, prev.get(id) ?? now);
  return next;
}

export function IncomingCallWatcher() {
  const { activeCall, startCall, prefs } = useOsShell();
  const { data: session } = useSession();

  const [calls, setCalls] = useState<IncomingRow[]>([]);
  const [declined, setDeclined] = useState<Set<string>>(() => new Set());
  const inCall = useRef(false);
  const startCallRef = useRef(startCall);
  const myNameRef = useRef<string | null>(null);
  const declinedRef = useRef(declined);
  // SILENCED: calls this tab has already finished ringing for, either because
  // the 45 seconds ran out or because the user answered. `declined` is the
  // explicit button and stays its own set; this is everything else that means
  // "stop shouting about this call". Both are cleared when the call leaves the
  // server's list, so a call back later rings again.
  const silencedRef = useRef<Set<string>>(new Set());
  // First sight per conversation, and the live ring timeout per conversation.
  // Refs, not state: they are bookkeeping for the timers and no pixel depends
  // on them, so writing one must not cost a render.
  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const ringTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => { inCall.current = !!activeCall; }, [activeCall]);
  useEffect(() => { startCallRef.current = startCall; }, [startCall]);
  useEffect(() => { myNameRef.current = session?.user?.name ?? null; }, [session]);
  useEffect(() => { declinedRef.current = declined; }, [declined]);

  // The Talk module, read from what the shell already loaded by /api/boot.
  // NOT from `railApps`: the Talk hub deliberately survives the module being
  // off so the Announcements row stays reachable (rail-apps.ts
  // MODULE_HUB_SURVIVES_ON), so the presence of the chat hub says nothing
  // about whether calls exist. The module list is the fact.
  const talkOn = Array.isArray(prefs.modules?.activeAppKeys)
    && prefs.modules.activeAppKeys.includes("chat");

  useEffect(() => {
    if (!talkOn) return;
    let alive = true;
    let connected = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch("/api/calls/incoming", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d = await r.json();
        const rows: IncomingRow[] = Array.isArray(d?.calls) ? d.calls : [];
        const now = Date.now();
        const live = new Set(rows.map((c) => c.conversationId));
        firstSeenRef.current = keepFirstSeen(
          firstSeenRef.current,
          rows.map((c) => c.conversationId),
          now,
        );
        // A call that has ended stops being declined or silenced, so the same
        // person calling back in five minutes rings again.
        for (const id of silencedRef.current) {
          if (!live.has(id)) silencedRef.current.delete(id);
        }
        // Three reasons not to ring: the user said no, this tab has already
        // rung for it, or its 45 seconds are spent. The last one is what stops
        // a card the user let ring out from coming back on the next roster
        // change or on returning to the tab, both of which re-run this.
        setCalls(rows.filter((c) => {
          if (declinedRef.current.has(c.conversationId)) return false;
          if (silencedRef.current.has(c.conversationId)) return false;
          const firstSeen = firstSeenRef.current.get(c.conversationId) ?? now;
          return ringRemainingMs(c.startedAt, firstSeen, now) > 0;
        }));
        setDeclined((prev) => {
          const next = new Set([...prev].filter((id) => live.has(id)));
          return next.size === prev.size ? prev : next;
        });
      } catch {
        // The bell's own poll is the backstop behind this backstop.
      }
    };

    const startPolling = () => {
      if (timer) return;
      timer = setInterval(() => void tick(), POLL_MS);
    };
    const stopPolling = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    void tick();
    startPolling();

    const onRealtime = () => void tick();
    const onState = (e: Event) => {
      connected = Boolean((e as CustomEvent<{ connected?: boolean }>).detail?.connected);
      if (connected) stopPolling(); else startPolling();
    };
    window.addEventListener(WINDOW_EVENTS.callIncoming, onRealtime);
    window.addEventListener(WINDOW_EVENTS.callChanged, onRealtime);
    window.addEventListener(WINDOW_EVENTS.realtimeState, onState);
    // A tab that comes back to the front after being hidden has missed
    // whatever happened while it slept, stream or no stream.
    document.addEventListener("visibilitychange", onRealtime);

    return () => {
      alive = false;
      stopPolling();
      window.removeEventListener(WINDOW_EVENTS.callIncoming, onRealtime);
      window.removeEventListener(WINDOW_EVENTS.callChanged, onRealtime);
      window.removeEventListener(WINDOW_EVENTS.realtimeState, onState);
      document.removeEventListener("visibilitychange", onRealtime);
    };
  }, [talkOn]);

  // Each card rings for 45 seconds and then stops, as a phone does. The call
  // itself keeps running; it is simply no longer shouting at this person.
  //
  // ONE TIMER PER CONVERSATION, ARMED ONCE. This effect still watches `calls`,
  // because that is how it learns about a new one, but it owns a keyed map
  // rather than a fresh array of timers per render. Re-arming from the array
  // meant a 45s timeout was cleared and restarted on every 15s poll and so
  // never fired at all, and it made the timers shared-fate: a second call
  // arriving at 30s restarted the first card's clock from zero.
  useEffect(() => {
    const timers = ringTimersRef.current;
    const now = Date.now();
    for (const call of calls) {
      const id = call.conversationId;
      if (timers.has(id)) continue; // already counting down, leave it alone
      const firstSeen = firstSeenRef.current.get(id) ?? now;
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        silencedRef.current.add(id);
        setCalls((prev) => prev.filter((x) => x.conversationId !== id));
      }, ringRemainingMs(call.startedAt, firstSeen, now)));
    }
    // A card that has gone for any other reason (answered, declined, the call
    // ended) has no clock left to run.
    for (const [id, t] of timers) {
      if (!calls.some((c) => c.conversationId === id)) {
        clearTimeout(t);
        timers.delete(id);
      }
    }
  }, [calls]);

  // The timers deliberately outlive the render that armed them, so unmount is
  // the one place they are all dropped.
  useEffect(() => {
    const timers = ringTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const decline = useCallback((conversationId: string) => {
    setDeclined((prev) => new Set(prev).add(conversationId));
    setCalls((prev) => prev.filter((c) => c.conversationId !== conversationId));
  }, []);

  // With the module off there is nothing to render and nothing was polled.
  // The list is read through this guard rather than cleared in an effect, so
  // turning Talk off never costs a cascading render.
  const live = talkOn ? calls : [];
  if (live.length === 0) return null;

  // Stack above the dock when there is one. 20px page margin, the dock's own
  // height, then 12px between surfaces, then 96 per card below this one.
  const dockHeight = activeCall ? (activeCall.minimized ? 64 : 440) : 0;
  const base = 20 + (dockHeight ? dockHeight + 12 : 0);

  return (
    <>
      {live.slice(0, 3).map((call, i) => (
        <IncomingCallCard
          key={call.conversationId}
          call={call}
          busy={Boolean(activeCall)}
          offset={base + i * 108}
          onDecline={() => decline(call.conversationId)}
          onJoin={(audioOnly) => {
            // Answered counts as rung: the roster on the server catches up a
            // moment later, and until it does /api/calls/incoming still lists
            // this call, which would put the card back on screen on top of the
            // call the user is now in.
            silencedRef.current.add(call.conversationId);
            setCalls((prev) => prev.filter((c) => c.conversationId !== call.conversationId));
            startCallRef.current({
              conversationId: call.conversationId,
              subject: call.label,
              displayName: myNameRef.current,
              audioOnly,
              href: `/tlk/${call.conversationId}`,
            });
          }}
        />
      ))}
    </>
  );
}
