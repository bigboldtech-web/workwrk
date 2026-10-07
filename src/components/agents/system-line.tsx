"use client";

// A centred line in a teammate's chat (docs/plans/ai-teammates.md 5.2, 5.6):
// an EVENT row the server wrote, 13px ink-2 with a 16px icon. The row's
// words ARE the sentence ("Memory updated: ...", "You approved: ..."); the
// event only picks the icon and the links:
//
//   memory_updated    See memory               (the settings drawer's Memory tab)
//   routine_created   Pause, Settings          (the routine; its Routines tab)
//
//   a line with a link (Phase 2: a teammate's card, a Talk message, an
//   automation's run)  Open, Open in Talk, Open the run
//
// A line whose event this code does not know still shows its words.

import { Ban, Brain, CalendarClock, CircleAlert, CircleCheck, Clock, Info, MessageSquare, PenLine, SkipForward, UserMinus, UserPlus, Users, Workflow, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { LINE_LINKS, TEAMMATE_CHAT } from "@/lib/agents/teammate-copy";
import { eventLinkHref, type TeammateEventKind, type TeammateMessageView, type TeammateSettingsTab } from "@/lib/agents/teammate-thread";

const EVENT_ICON: Record<TeammateEventKind, LucideIcon> = {
  memory_updated: Brain,
  memory_forgotten: Brain,
  routine_created: CalendarClock,
  routine_paused: CalendarClock,
  routine_skipped: CalendarClock,
  action_approved: CircleCheck,
  action_denied: Ban,
  action_expired: Clock,
  action_failed: CircleAlert,
  schedule_moved: CalendarClock,
  group_skipped: SkipForward,
  group_member_added: UserPlus,
  group_member_removed: UserMinus,
  group_renamed: PenLine,
  delegated_asked: Users,
  delegate_waiting: Clock,
  talk_asked: MessageSquare,
  automation_asked: Workflow,
};

const LINK = "whitespace-nowrap font-medium text-brand-deep hover:underline";

export function SystemLine({
  m,
  onOpenSettings,
  onPauseRoutine,
}: {
  m: Extract<TeammateMessageView, { kind: "event" }>;
  onOpenSettings: (tab?: TeammateSettingsTab) => void;
  onPauseRoutine: (routineId: string) => void;
}) {
  const Icon = m.event ? EVENT_ICON[m.event] : Info;
  const routineId = m.routineId;
  return (
    <div className="flex min-h-6 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center text-sm text-ink-2">
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 break-words">{m.text}</span>
      {m.event === "memory_updated" ? (
        <button type="button" className={LINK} onClick={() => onOpenSettings("memory")}>{TEAMMATE_CHAT.seeMemory}</button>
      ) : null}
      {m.event === "routine_created" ? (
        <>
          {routineId ? (
            <button type="button" className={LINK} onClick={() => onPauseRoutine(routineId)}>{TEAMMATE_CHAT.pause}</button>
          ) : null}
          <button type="button" className={LINK} onClick={() => onOpenSettings("routines")}>{TEAMMATE_CHAT.routineSettings}</button>
        </>
      ) : null}
      {/* Where the line points (a teammate's card, a Talk message, an automation's run): the address is built from its ids, never read from the row. */}
      {m.link ? (
        <Link href={eventLinkHref(m.link)} className={LINK}>
          {LINE_LINKS[m.link.kind]}
        </Link>
      ) : null}
    </div>
  );
}
