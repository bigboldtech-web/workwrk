"use client";

// One group chat (docs/plans/ai-teammates-phase2.md step 4): the person with
// two to five of their teammates, over useGroupChat (teammate-store.ts).
//
// Header: Back (under 1024px), the group's stacked avatars, its name
// (16/600), and a ghost "N teammates" that opens group-members-menu.tsx
// (Remove, Add teammate, Rename, Leave group chat).
//
// The thread is TeammateThread with each answer under its own teammate's
// avatar and name. The composer is a teammate chat's without Practice run:
// under the box, who will answer the words typed so far ("Answers: Triage
// and Project Manager", group-chat.ts pickAnswerers on the draft), and an @
// list of the group's teammates while a name is being typed after "@".
//
// The states are a teammate chat's: loading, a chat that failed to load, a
// group that is not there, a new group, the thread; AI off or not set up at
// the foot instead of the composer; the error row with Try again where
// sending again can work. Read again on focus and on agent.changed for this
// group; opening it and each answer that arrives mark it read.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, Users } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";
import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { leadOf, pickAnswerers, type GroupMember } from "@/lib/agents/group-chat";
import { GROUP_COPY, TEAMMATE_CHAT, titleList } from "@/lib/agents/teammate-copy";
import { useAiAvailability, useGroupChat } from "@/lib/agents/teammate-store";
import { canRetrySend, lastAnswerId, sendErrorSentence, type GroupDetail, type GroupMemberView, type GroupRow, type TeammateMessageView, type TeammateSettingsTab } from "@/lib/agents/teammate-thread";
import type { TeammateRow } from "@/lib/agents/teammate-views";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import { cn } from "@/lib/utils";
import { GroupMembersMenu } from "./group-members-menu";
import { StackedAvatars } from "./stacked-avatars";
import { TeammateAvatar } from "./teammate-avatar";
import { UnsentDraft } from "./teammate-chat";
import { TeammateThread, type ThreadTeammate } from "./teammate-thread";

const GHOST_28 = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";
const LINK = "whitespace-nowrap font-medium text-brand-deep hover:underline";
const COLUMN = "mx-auto w-[min(720px,100%-32px)]";
const ACTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MESSAGE_MAX = 20000;

/** The rules' members, from the page's view of them (group-chat.ts). */
function rulesMembers(members: readonly GroupMemberView[]): GroupMember[] {
  return members.map((m) => ({
    agentId: m.agentId,
    slug: m.slug,
    name: m.name,
    // The server already chose the lead; the rules only need to find it.
    template: m.lead ? "chief-of-staff" : null,
    position: m.lead ? -1 : m.position,
    status: m.status,
    usable: m.canAnswer || m.status !== "ENABLED",
  }));
}

export function GroupChat({
  group: g,
  teammates,
  actionId,
  onBack,
  onChanged,
  onLeft,
  onOpenSettings,
}: {
  group: GroupRow;
  /** The person's teammates, for Add teammate. */
  teammates: readonly TeammateRow[] | null;
  actionId: string | null;
  onBack: () => void;
  /** The group changed (renamed, a teammate added or removed): the list reads it again. */
  onChanged: (group: GroupDetail) => void;
  onLeft: () => void;
  onOpenSettings: (tab?: TeammateSettingsTab) => void;
}) {
  const chat = useGroupChat(g.id);
  const { status, offline } = useAiAvailability();
  const { toast } = useOsToast();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const membersRef = useRef<HTMLButtonElement>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  // The members a change just answered with, until the next read (put off
  // while an answer streams) brings its own: a removal shows at once
  // (review round 1). Else the members as the newest read names them, else
  // as the list does.
  const [changedTo, setChangedTo] = useState<{ members: GroupDetail["members"]; over: GroupDetail["members"] } | null>(null);
  const members = changedTo && changedTo.over === chat.members ? changedTo.members : chat.members.length > 0 ? chat.members : g.members;
  const byId = useMemo(() => new Map(members.map((m) => [m.agentId, m])), [members]);

  const { open, refresh, markRead } = chat;
  useEffect(() => {
    void open();
  }, [open]);

  useEffect(() => {
    const ids = new Set(members.map((m) => m.agentId));
    const onFocus = () => void refresh();
    const onRealtime = (e: Event) => {
      const d = (e as CustomEvent<RealtimeEvent>).detail;
      if (d?.type === "agent.changed" && (d.sessionId === g.id || (!d.sessionId && ids.has(d.agentId)))) void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
    };
  }, [refresh, g.id, members]);

  const answerId = useMemo(() => lastAnswerId(chat.messages), [chat.messages]);
  const markedFor = useRef<string | null | undefined>(undefined);
  const viewable = chat.ready && !chat.missing && !chat.loadError;
  useEffect(() => {
    if (!viewable) return;
    if (markedFor.current === answerId && !g.unread) return;
    const first = markedFor.current === undefined;
    markedFor.current = answerId;
    if (first && !g.unread) return;
    void markRead();
  }, [viewable, answerId, g.unread, markRead]);

  const last = chat.messages[chat.messages.length - 1];
  const lastKey = last ? `${last.id}:${last.text.length}:${last.kind === "agent" ? last.toolCalls.length : 0}:${chat.messages.length}` : "";
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

  function sendDraft() {
    if (!chat.draft.trim() || chat.streaming || offline) return;
    void chat.send(chat.draft);
  }

  // Each answer under its own teammate; one removed from the group since
  // keeps the name its rows were saved with (review of step 4).
  const fallback: ThreadTeammate = { name: g.name, hue: null, avatar: null };
  const teammateFor = (m: TeammateMessageView): ThreadTeammate => {
    const agentId = m.kind === "agent" || m.kind === "approval" ? m.agentId : undefined;
    const member = agentId ? byId.get(agentId) : undefined;
    if (member) return { name: member.name, hue: member.hue, avatar: member.avatar };
    if (m.kind === "agent" && m.agentName) return { name: m.agentName, hue: null, avatar: null };
    return fallback;
  };

  // A line's links go to its own teammate: its settings open in that
  // teammate's chat, and Pause pauses the routine (review of step 4).
  function openSettingsFrom(tab?: TeammateSettingsTab, from?: TeammateMessageView) {
    const agentId = from && from.kind === "event" ? from.agentId : undefined;
    // A teammate no longer in the group is found in the person's own list
    // (review round 1); with neither, the link has nowhere to go and does nothing.
    const slug = agentId ? byId.get(agentId)?.slug ?? teammates?.find((t) => t.id === agentId)?.slug : undefined;
    if (!slug) {
      if (!agentId) onOpenSettings(tab);
      return;
    }
    router.push(`/agents?chat=${encodeURIComponent(slug)}&settings=${encodeURIComponent(tab ?? "instructions")}`);
  }
  async function pauseRoutine(routineId: string) {
    const r = await apiFetch(`/api/agents/routines/${encodeURIComponent(routineId)}`, { method: "PATCH", json: { status: "paused" } });
    if (!r.ok) {
      toast(r.code ? r.error : TEAMMATE_CHAT.routinePauseFailed, { tone: "danger" });
      return;
    }
    toast(TEAMMATE_CHAT.routinePaused);
  }

  const aiOff = status !== null && !status.enabled;
  const notSetUp = status !== null && status.enabled && !status.configured;
  const canCompose = viewable && !aiOff && !notSetUp;

  let foot: ReactNode = null;
  if (!viewable) foot = null;
  else if (aiOff) foot = <FootLine>{TEAMMATE_CHAT.aiOff}</FootLine>;
  else if (notSetUp) foot = <FootLine>{TEAMMATE_CHAT.notSetUp}</FootLine>;
  else {
    foot = (
      <GroupComposer
        name={g.name}
        members={members}
        value={chat.draft}
        busy={chat.streaming}
        offline={offline}
        onChange={chat.setDraft}
        onSend={sendDraft}
        inputRef={composerRef}
      />
    );
  }

  // Words the person wrote that could not go out stay on screen whenever
  // there is no composer to hold them (review of step 4, as a teammate chat).
  const unsent = !canCompose && chat.draft.trim() ? <UnsentDraft text={chat.draft} className={foot ? "mt-1" : undefined} /> : null;

  const errorRow = chat.error ? (
    <div role="alert" className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-danger-text">
      <span>{sendErrorSentence(chat.error, chat.errorText, g.name)}</span>
      {canRetrySend(chat.error) && canCompose ? (
        <button
          type="button"
          className="whitespace-nowrap font-medium underline underline-offset-2"
          onClick={() => {
            chat.clearError();
            if (chat.draft.trim()) void chat.retry();
            else requestAnimationFrame(() => composerRef.current?.focus());
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
    body = (
      <>
        <div className="flex h-11 items-center gap-2 text-row text-ink-2">
          {GROUP_COPY.notFound} ·
          <button type="button" className={LINK} onClick={onBack}>{TEAMMATE_CHAT.back}</button>
        </div>
        {/* The unsent words show once, at the foot (review round 1). */}
      </>
    );
  } else if (chat.messages.length === 0) {
    body = (
      <div className="mt-8 flex flex-col items-center text-center">
        <StackedAvatars members={members} variant="header" />
        <h2 className="mt-3 text-xl font-semibold text-ink">{g.name}</h2>
        <p className="mt-2 max-w-[480px] text-base text-ink-2">{titleList(members.map((m) => m.name), 5)}</p>
        <p className="mt-1 max-w-[480px] text-sm text-ink-2">{GROUP_COPY.composerHint}</p>
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
          teammate={fallback}
          teammateFor={teammateFor}
          showNames
          messages={chat.messages}
          actions={chat.actions}
          deciding={chat.deciding}
          onDecide={chat.decide}
          onOpenSettings={openSettingsFrom}
          onPauseRoutine={(id) => void pauseRoutine(id)}
        />
        {errorRow ? <div className="mt-5">{errorRow}</div> : null}
      </>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={g.name}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <button type="button" onClick={onBack} className={cn(GHOST_28, "-ms-1 lg:hidden")}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
          {TEAMMATE_CHAT.back}
        </button>
        <StackedAvatars members={members} variant="header" />
        <h2 className="min-w-0 truncate text-lg font-semibold text-ink">{g.name}</h2>
        <span className="min-w-0 flex-1" />
        <button
          ref={membersRef}
          type="button"
          onClick={() => setMembersOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={membersOpen}
          className={cn(GHOST_28, membersOpen && "bg-active text-ink")}
        >
          <Users className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          {GROUP_COPY.membersButton(members.length)}
        </button>
      </header>
      {membersOpen ? (
        <MorePortal
          anchorRef={membersRef}
          width={280}
          open
          placement="below"
          onClose={() => {
            setMembersOpen(false);
            membersRef.current?.focus();
          }}
        >
          <GroupMembersMenu
            group={{ ...g, members }}
            teammates={teammates}
            onChanged={(next) => {
              setChangedTo({ members: next.members, over: chat.members });
              onChanged(next);
              void refresh();
            }}
            draft={chat.draft}
            onLeft={() => {
              setMembersOpen(false);
              onLeft();
            }}
            onClose={() => setMembersOpen(false)}
          />
        </MorePortal>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(COLUMN, "py-6")}>{body}</div>
      </div>

      {foot || unsent ? (
        <div className="shrink-0 bg-app">
          <div className={cn(COLUMN, "py-3")}>
            {foot}
            {unsent}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FootLine({ children }: { children: ReactNode }) {
  return <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 text-row text-ink-2">{children}</div>;
}

/** The "@name" being typed at the caret, if any: where it starts and what is typed after the "@". */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && /[\p{L}\p{N}_]/u.test(before.charAt(at - 1))) return null;
  const query = before.slice(at + 1);
  if (query.length > 60 || /\n/.test(query)) return null;
  return { start: at, query };
}

/**
 * A group chat's composer: a teammate chat's (Enter sends, Shift+Enter
 * breaks the line, it grows to 8 lines, the blue Send is the page's one
 * primary), without Practice run. Under the box, who will answer; above it,
 * while "@" starts a word, the group's teammates to pick from.
 */
function GroupComposer({
  name,
  members,
  value,
  busy,
  offline,
  onChange,
  onSend,
  inputRef,
}: {
  name: string;
  members: readonly GroupMemberView[];
  value: string;
  busy: boolean;
  offline: boolean;
  onChange: (text: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  // Escape closes the @ list for the "@" it was open for, without touching the words (review of step 4).
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const listId = useId();
  const canSend = value.trim().length > 0 && !busy && !offline;
  const rules = useMemo(() => rulesMembers(members), [members]);

  useEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [value, inputRef]);

  const mention = mentionAt(value, caret);
  const matches = mention ? members.filter((m) => m.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 5) : [];
  const listOpen = Boolean(mention) && matches.length > 0 && mention?.start !== dismissedAt;
  const activeId = listOpen ? `${listId}-${Math.min(picked, matches.length - 1)}` : undefined;

  // Who answers the words so far: the named ones that can, else the lead;
  // named ones that can't say so (review of step 4).
  const hint = useMemo(() => {
    if (!value.trim()) {
      const lead = leadOf(rules);
      return lead ? GROUP_COPY.composerHintLead(lead.name) : GROUP_COPY.composerHint;
    }
    const pick = pickAnswerers(value, rules);
    if (!pick.named) {
      const lead = leadOf(rules);
      return lead ? GROUP_COPY.answersFrom(lead.name) : GROUP_COPY.noOneCanAnswer(titleList(rules.map((m) => m.name)));
    }
    const can = pick.answerers.filter((a) => a.skip === null).map((a) => a.member.name);
    if (can.length === 0) return GROUP_COPY.noOneCanAnswer(titleList(pick.answerers.map((a) => a.member.name)));
    return GROUP_COPY.answersFrom(titleList(can));
  }, [value, rules]);

  function choose(m: GroupMemberView) {
    if (!mention) return;
    const next = `${value.slice(0, mention.start)}@${m.name} ${value.slice(caret)}`;
    onChange(next);
    const at = mention.start + m.name.length + 2;
    requestAnimationFrame(() => {
      const t = inputRef.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(at, at);
      setCaret(at);
    });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (listOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setPicked((i) => (e.key === "ArrowDown" ? (i + 1) % matches.length : (i - 1 + matches.length) % matches.length));
      return;
    }
    if (listOpen && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(matches[Math.min(picked, matches.length - 1)]);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    } else if (e.key === "Escape") {
      if (listOpen && mention) {
        e.preventDefault();
        setDismissedAt(mention.start);
        return;
      }
      e.currentTarget.blur();
    }
  }

  return (
    <div className="relative rounded-lg border border-line-strong bg-raised p-3 focus-within:border-brand">
      {listOpen ? (
        <ul id={listId} role="listbox" aria-label={GROUP_COPY.mentionLabel} className="absolute bottom-full start-0 mb-1 w-64 rounded-md border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]">
          {matches.map((m, i) => (
            <li
              key={m.agentId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === picked}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(m)}
              className={cn("flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 px-3 text-start text-base text-ink", i === picked ? "bg-active" : "hover:bg-hover")}
            >
              <TeammateAvatar name={m.name} hue={m.hue} avatar={m.avatar} size="sm" />
              <span className="min-w-0 truncate">{m.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={activeId}
        className="block max-h-40 min-h-5 w-full resize-none bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
        placeholder={GROUP_COPY.placeholder(name)}
        aria-label={GROUP_COPY.placeholder(name)}
        value={value}
        maxLength={MESSAGE_MAX}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setPicked(0);
          setDismissedAt(null);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKey}
        rows={1}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-ink-2" aria-live="polite">
          {hint}
        </span>
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={busy ? TEAMMATE_CHAT.working : TEAMMATE_CHAT.send}
          title={offline ? TEAMMATE_CHAT.offline : TEAMMATE_CHAT.sendHint}
          className={
            busy
              ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2"
              : "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
          }
        >
          {busy ? <Dots variant="pending" label={TEAMMATE_CHAT.working} /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
