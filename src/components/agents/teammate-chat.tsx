"use client";

// One chat with an AI teammate (docs/plans/ai-teammates.md 5.1, 5.2, 5.4):
// the 44px header, the thread in a 720 column, and the composer at the foot,
// over useTeammateChat (src/lib/agents/teammate-store.ts).
//
// Header: Back (under 1024px, where the chat replaces the list), the avatar
// (md), the name (16/600), "Just you" or "Workspace", "Paused" or "Removed";
// at the right the ghost Settings and "..." (Copy link; for whoever manages
// it, Turn on or Pause, and Remove).
//
// The states of 5.4, in order: loading (three skeleton lines), a chat that
// failed to load ("Couldn't load this chat. · Try again"), a teammate that is
// not there, a new chat ("Chat with {name}", its job, the one line about
// what it can see, up to four starters), the thread. At the foot, the one
// line that says why there is no composer (AI off, not set up, removed with
// Add back, paused with Turn on), else the composer; above it the error row
// with the server's sentence, and Try again where sending again can work.
//
// The chat is read again on window focus and on the realtime agent.changed
// for this teammate (a decision in another tab, an expiry, a routine's report
// or pause). Opening it, and each answer that arrives while it is open, marks
// it read (the list's unread dot). &action=<id> scrolls to that card once.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Link2, MoreHorizontal, Pause, Power, SlidersHorizontal, Trash2 } from "lucide-react";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { starterLabel, starterWantsMore } from "@/lib/ai/starters";
import {
  TEAMMATE_CHAT,
  TEAMMATE_CHIPS,
  TEAMMATE_ROUTE_ERRORS,
  TEAMMATE_SETTINGS,
  actionsFor,
  backToast,
  chatWith,
  pausedComposer,
  pausedToast,
  removeTeammateTitle,
  removedComposer,
  removedToast,
  turnedOnToast,
  worksAsYou,
} from "@/lib/agents/teammate-copy";
import { useAiAvailability, useTeammateChat } from "@/lib/agents/teammate-store";
import { canRetrySend, lastAnswerId, sendErrorSentence, type TeammateSettingsTab } from "@/lib/agents/teammate-thread";
import type { TeammateRow } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { SUPPORT_EMAIL } from "@/lib/nav/labels";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import { cn } from "@/lib/utils";
import { TeammateAvatar } from "./teammate-avatar";
import { TeammateComposer } from "./teammate-composer";
import { TeammateThread } from "./teammate-thread";

const GHOST_28 = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";
const LINK = "whitespace-nowrap font-medium text-brand-deep hover:underline";
const COLUMN = "mx-auto w-[min(720px,100%-32px)]";
/** An action id as the address carries it, before it goes into a selector. */
const ACTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function TeammateChat({
  teammate: t,
  starters,
  actionId,
  onBack,
  onOpenSettings,
  onChanged,
}: {
  teammate: TeammateRow;
  /** Its template's starter prompts (at most four). */
  starters: readonly string[];
  /** &action=<id>: the card to scroll to. */
  actionId: string | null;
  onBack: () => void;
  onOpenSettings: (tab?: TeammateSettingsTab) => void;
  /** The teammate changed (paused, turned on, removed, added back): the list reads it again. */
  onChanged: () => void;
}) {
  const chat = useTeammateChat(t.slug);
  const { status, offline } = useAiAvailability();
  const { isAdmin } = useViewerRole();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { open, refresh, markRead } = chat;
  useEffect(() => {
    void open();
  }, [open]);

  // Read again when the person comes back to the tab, and when this
  // teammate's chat changed without them typing.
  const agentId = t.id;
  useEffect(() => {
    const onFocus = () => void refresh();
    const onRealtime = (e: Event) => {
      const d = (e as CustomEvent<RealtimeEvent>).detail;
      if (d?.type === "agent.changed" && d.agentId === agentId) void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
    };
  }, [refresh, agentId]);

  // Read up to the newest answer: when the chat opens with something unread,
  // and when an answer arrives while it is open.
  const answerId = useMemo(() => lastAnswerId(chat.messages), [chat.messages]);
  const markedFor = useRef<string | null | undefined>(undefined);
  const viewable = chat.ready && !chat.missing && !chat.loadError;
  useEffect(() => {
    if (!viewable) return;
    if (markedFor.current === answerId && !t.unread) return;
    const first = markedFor.current === undefined;
    markedFor.current = answerId;
    if (first && !t.unread) return;
    void markRead();
  }, [viewable, answerId, t.unread, markRead]);

  // The foot of the thread follows what arrives; &action=<id> scrolls to its
  // card once, the first time it is on screen.
  const last = chat.messages[chat.messages.length - 1];
  const lastKey = last ? `${last.id}:${last.text.length}:${last.kind === "agent" ? last.toolCalls.length : 0}` : "";
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !viewable) return;
    if (actionId && scrolledTo.current !== actionId && ACTION_ID.test(actionId)) {
      const card = el.querySelector(`[data-action-id="${actionId}"]`);
      if (card) {
        scrolledTo.current = actionId;
        card.scrollIntoView({ block: "center" });
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }, [viewable, lastKey, chat.error, chat.streaming, actionId]);

  // Show earlier messages keeps the message the person was reading in place.
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const firstId = chat.messages[0]?.id ?? null;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollTop = a.top + (el.scrollHeight - a.height);
  }, [firstId]);

  async function showEarlier() {
    const el = scrollRef.current;
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    const ok = await chat.loadOlder();
    requestAnimationFrame(() => {
      anchor.current = null;
    });
    if (!ok) toast(TEAMMATE_CHAT.earlierFailed, { tone: "danger" });
  }

  function focusComposer() {
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function sendDraft() {
    if (!chat.draft.trim() || chat.streaming || offline) return;
    void chat.send(chat.draft);
  }

  /* ── the teammate itself ─────────────────────────────────────── */

  async function patch(body: Record<string, unknown>, done: string, again: () => void) {
    setBusy(true);
    const r = await apiFetch(`/api/agents/teammates/${encodeURIComponent(t.slug)}`, { method: "PATCH", json: body });
    setBusy(false);
    if (!r.ok) {
      // A refusal the route words itself (the plan's limit, not a manager).
      toast(r.code ? r.error : TEAMMATE_CHAT.updateFailed, { tone: "danger", action: { label: TEAMMATE_CHAT.tryAgain, onClick: again } });
      return;
    }
    toast(done);
    chat.clearError();
    onChanged();
  }
  function setStatus(next: "ENABLED" | "DISABLED") {
    void patch({ status: next }, next === "ENABLED" ? turnedOnToast(t.name) : pausedToast(t.name), () => setStatus(next));
  }
  function addBack() {
    void patch({ restore: true }, backToast(t.name), addBack);
  }

  async function remove() {
    const ok = await confirm({
      title: removeTeammateTitle(t.name),
      description: TEAMMATE_SETTINGS.removeConfirmBody,
      confirmLabel: TEAMMATE_SETTINGS.remove,
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const r = await apiFetch(`/api/agents/teammates/${encodeURIComponent(t.slug)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      toast(r.code ? r.error : TEAMMATE_CHAT.removeFailed, { tone: "danger", action: { label: TEAMMATE_CHAT.tryAgain, onClick: () => void remove() } });
      return;
    }
    toast(removedToast(t.name));
    onChanged();
  }

  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/agents?chat=${encodeURIComponent(t.slug)}`).then(
      () => toast(TEAMMATE_CHAT.linkCopied),
      () => toast(TEAMMATE_CHAT.copyFailed, { tone: "danger" }),
    );
  }

  async function pauseRoutine(routineId: string) {
    const r = await apiFetch(`/api/agents/routines/${encodeURIComponent(routineId)}`, { method: "PATCH", json: { status: "paused" } });
    if (!r.ok) {
      toast(r.code ? r.error : TEAMMATE_CHAT.routinePauseFailed, { tone: "danger" });
      return;
    }
    toast(TEAMMATE_CHAT.routinePaused);
  }

  /* ── what shows ──────────────────────────────────────────────── */

  const removed = t.status === "ARCHIVED";
  const paused = t.status === "DISABLED";
  const aiOff = status !== null && !status.enabled;
  const notSetUp = status !== null && status.enabled && !status.configured;
  const canCompose = viewable && !aiOff && !notSetUp && !removed && !paused;

  let foot: ReactNode = null;
  if (!viewable) foot = null;
  else if (aiOff) foot = <FootLine>{TEAMMATE_CHAT.aiOff}</FootLine>;
  else if (notSetUp) {
    foot = (
      <div className="flex min-h-11 flex-col justify-center text-row text-ink-2">
        <span>{TEAMMATE_CHAT.notSetUp}</span>
        <span className="text-sm">
          {isAdmin ? (
            <>
              {TEAMMATE_CHAT.notSetUpAdmin}{" "}
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(TEAMMATE_CHAT.supportSubject)}`} className={LINK}>
                {TEAMMATE_CHAT.contactSupport}
              </a>
            </>
          ) : (
            TEAMMATE_CHAT.notSetUpMember
          )}
        </span>
      </div>
    );
  } else if (removed) {
    foot = (
      <FootLine>
        {removedComposer(t.name)}
        {t.canManage ? (
          <button type="button" className={LINK} disabled={busy} onClick={addBack}>{TEAMMATE_CHAT.addBack}</button>
        ) : null}
      </FootLine>
    );
  } else if (paused) {
    foot = (
      <FootLine>
        {pausedComposer(t.name)}
        {t.canManage ? (
          <button type="button" className={LINK} disabled={busy} onClick={() => setStatus("ENABLED")}>{TEAMMATE_CHAT.turnOn}</button>
        ) : (
          <span>{TEAMMATE_CHAT.askAdminToTurnOn}</span>
        )}
      </FootLine>
    );
  } else {
    foot = (
      <TeammateComposer
        name={t.name}
        value={chat.draft}
        practice={chat.practice}
        busy={chat.streaming}
        offline={offline}
        onChange={chat.setDraft}
        onPractice={chat.setPractice}
        onSend={sendDraft}
        inputRef={composerRef}
      />
    );
  }

  const errorRow = chat.error ? (
    <div role="alert" className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-danger-text">
      <span>{sendErrorSentence(chat.error, chat.errorText, t.name)}</span>
      {canRetrySend(chat.error) && canCompose ? (
        <button
          type="button"
          className="whitespace-nowrap font-medium underline underline-offset-2"
          onClick={() => {
            chat.clearError();
            if (chat.draft.trim()) void chat.retry();
            else focusComposer();
          }}
        >
          {TEAMMATE_CHAT.tryAgain}
        </button>
      ) : null}
    </div>
  ) : null;

  let body: ReactNode;
  if (!chat.ready || (chat.loading && chat.messages.length === 0)) {
    body = (
      <div aria-busy="true">
        <SkeletonLines lines={3} />
      </div>
    );
  } else if (chat.loadError) {
    body = (
      <div className="flex h-11 items-center gap-2 text-row text-ink-2">
        {TEAMMATE_CHAT.loadError} ·
        <button type="button" className={LINK} onClick={() => void open()}>{TEAMMATE_CHAT.tryAgain}</button>
      </div>
    );
  } else if (chat.missing) {
    body = <OsEmptyView title={TEAMMATE_ROUTE_ERRORS.teammateNotFound} compact />;
  } else if (chat.messages.length === 0) {
    body = (
      <div className="mt-8 flex flex-col items-center text-center">
        <h2 className="text-xl font-semibold text-ink">{chatWith(t.name)}</h2>
        {t.job ? <p className="mt-2 max-w-[480px] text-base text-ink-2">{t.job}</p> : null}
        <p className="mt-1 text-sm text-ink-2">{worksAsYou(t.name)}</p>
        {starters.length > 0 && canCompose ? (
          <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {starters.map((q) => (
              <button
                key={q}
                type="button"
                disabled={chat.streaming || offline}
                onClick={() => {
                  // A starter that ends in a space wants the rest typed.
                  if (starterWantsMore(q)) {
                    chat.setDraft(q);
                    focusComposer();
                  } else void chat.send(q);
                }}
                className="inline-flex h-9 min-w-0 items-center rounded-md border border-line bg-raised px-3 text-start text-base text-ink hover:bg-hover disabled:opacity-60"
              >
                <span className="truncate">{starterLabel(q)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {errorRow ? <div className="mt-4 self-stretch text-start">{errorRow}</div> : null}
      </div>
    );
  } else {
    body = (
      <>
        {chat.hasMore ? (
          <div className="mb-5 flex justify-center">
            <button type="button" className={cn(LINK, "text-sm")} disabled={chat.loadingOlder} onClick={() => void showEarlier()}>
              {TEAMMATE_CHAT.showEarlier}
            </button>
          </div>
        ) : null}
        <TeammateThread
          teammate={t}
          messages={chat.messages}
          actions={chat.actions}
          deciding={chat.deciding}
          onDecide={chat.decide}
          onOpenSettings={onOpenSettings}
          onPauseRoutine={(id) => void pauseRoutine(id)}
        />
        {errorRow ? <div className="mt-5">{errorRow}</div> : null}
      </>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={chatWith(t.name)}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <button type="button" onClick={onBack} className={cn(GHOST_28, "-ms-1 lg:hidden")}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
          {TEAMMATE_CHAT.back}
        </button>
        <TeammateAvatar name={t.name} hue={t.hue} avatar={t.avatar} size="md" />
        <h2 className="min-w-0 truncate text-lg font-semibold text-ink">{t.name}</h2>
        <StatusChip
          color={RUN_TONE_COLOR.neutral}
          label={t.visibility === "PRIVATE" ? TEAMMATE_CHIPS.private : TEAMMATE_CHIPS.workspace}
          className="shrink-0 max-sm:hidden"
        />
        {paused || removed ? (
          <StatusChip color={RUN_TONE_COLOR.neutral} label={removed ? TEAMMATE_CHIPS.removed : TEAMMATE_CHIPS.paused} className="shrink-0" />
        ) : null}
        <span className="min-w-0 flex-1" />
        <button type="button" onClick={() => onOpenSettings()} className={GHOST_28}>
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          <span className="max-sm:sr-only">{TEAMMATE_CHAT.settings}</span>
        </button>
        <button
          ref={menuRef}
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={actionsFor(t.name)}
          title={actionsFor(t.name)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={cn(GHOST_28, "w-7 justify-center px-0", menuOpen && "bg-active text-ink")}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
      </header>
      {menuOpen ? (
        <MorePortal anchorRef={menuRef} width={220} open placement="below" onClose={() => setMenuOpen(false)}>
          <MenuList aria-label={actionsFor(t.name)}>
            <MenuItem icon={Link2} label={TEAMMATE_CHAT.copyLink} onClick={() => { setMenuOpen(false); copyLink(); }} />
            {t.canManage && !removed ? (
              <>
                {paused ? (
                  <MenuItem icon={Power} label={TEAMMATE_CHAT.turnOn} disabled={busy} onClick={() => { setMenuOpen(false); setStatus("ENABLED"); }} />
                ) : (
                  <MenuItem icon={Pause} label={TEAMMATE_CHAT.pause} disabled={busy} onClick={() => { setMenuOpen(false); setStatus("DISABLED"); }} />
                )}
                <MenuSeparator />
                <MenuItem icon={Trash2} label={TEAMMATE_CHAT.remove} destructive disabled={busy} onClick={() => { setMenuOpen(false); void remove(); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(COLUMN, "py-6")}>{body}</div>
      </div>

      {foot ? (
        <div className="shrink-0 bg-app">
          <div className={cn(COLUMN, "py-3")}>{foot}</div>
        </div>
      ) : null}
    </section>
  );
}

/** The one line at the foot that says why there is no composer. */
function FootLine({ children }: { children: ReactNode }) {
  return <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 text-row text-ink-2">{children}</div>;
}
