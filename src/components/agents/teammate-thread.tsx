"use client";

// The messages of a chat with an AI teammate (docs/plans/ai-teammates.md
// 5.1, 5.2), in the 720 column the chat gives it, 20 apart:
//
//   UserBubble     the person's words at the right, Ask AI's user bubble
//                  (bg-subtle rounded-lg px-4 py-3, at most 560 wide)
//   AgentTurn      the teammate's answer at the left, Ask AI's assistant turn
//                  with the teammate's avatar (sm) for its Sparkles: the tool
//                  rows (a pending one with its dots; one that waits for
//                  approval or only practised says so), the answer as
//                  markdown, "Working" dots while it arrives, and the footer
//                  of a practice run
//   ReportBubble   a routine's report (report-bubble.tsx)
//   SystemLine     a centred line the server wrote (system-line.tsx)
//
// A group chat (docs/plans/ai-teammates-phase2.md step 4) passes teammateFor,
// so each answer and card is its own teammate's, and showNames, so each
// answer has its teammate's name (12/500 ink-2) above it.
//   ApprovalCard   one card for what a turn asked (approval-card.tsx), its
//                  actions grouped by teammate-thread.ts groupApprovals; when
//                  none of them can be read here, the row's own sentence
//   BrowserCard    a teammate's browser (docs/plans/ai-teammates-phase4.md
//                  step 4, browser-card.tsx), in place of the browser_started
//                  line that names it; the browser_ended line stays a line.
//                  The thread holds its browser cards (BrowserCardsProvider)
//                  so a take over card hands the browser to the one on screen

import { useCallback, useMemo } from "react";
import { Clock } from "lucide-react";
import { OsMarkdown } from "@/components/layout/os/markdown";
import { ToolCallRow } from "@/components/ai/tool-call-row";
import { Dots } from "@/components/ui/dots";
import type { TeammateHue } from "@/lib/agents/hues";
import { useOsToast } from "@/components/layout/os/toast";
import { RUN_NOW_SENT, SKILLS_COPY, TEAMMATE_CHAT } from "@/lib/agents/teammate-copy";
import { sendSkillRun, skillSendBlocked } from "@/lib/agents/teammate-store";
import {
  answerLinks,
  groupApprovals,
  skillReviewHref,
  type ActionView,
  type DecideAnswer,
  type TeammateDecision,
  type TeammateMessageView,
  type TeammateSettingsTab,
} from "@/lib/agents/teammate-thread";
import { ApprovalCard } from "./approval-card";
import { BrowserCard, BrowserCardsProvider } from "./browser-card";
import { ReportBubble } from "./report-bubble";
import { SystemLine } from "./system-line";
import { TeammateAvatar } from "./teammate-avatar";

export interface ThreadTeammate {
  name: string;
  hue: TeammateHue | null;
  avatar: string | null;
  /** A one-teammate chat's teammate (Phase 5 step 3): a skill line's Review link opens its Skills tab. */
  slug?: string;
}

export function TeammateThread({
  teammate,
  teammateFor,
  showNames = false,
  messages,
  actions,
  deciding,
  onDecide,
  onOpenSettings,
  onPauseRoutine,
}: {
  teammate: ThreadTeammate;
  /** A group chat: the teammate a row is from (its answer's avatar, its card's name). */
  teammateFor?: (m: TeammateMessageView) => ThreadTeammate;
  /** A group chat: each answer shows its teammate's name above it. */
  showNames?: boolean;
  messages: readonly TeammateMessageView[];
  actions: Readonly<Record<string, ActionView>>;
  deciding: Readonly<Record<string, "approve" | "deny">>;
  onDecide: (decisions: TeammateDecision[], opts?: { always?: boolean }) => Promise<DecideAnswer>;
  /** The line it came from is passed too: a group opens that line's own teammate's settings. */
  onOpenSettings: (tab?: TeammateSettingsTab, from?: TeammateMessageView) => void;
  onPauseRoutine: (routineId: string) => void;
}) {
  const { toast } = useOsToast();
  // A skill's reminder line's Start (Phase 5 step 5): the person's run message, as Run in chat sends it; the real reason when it can't be sent now.
  const startSkill = useCallback(
    (slug: string, skillId: string, name: string) => {
      if (sendSkillRun(slug, skillId, name)) return;
      toast(skillSendBlocked(slug) === "busy" ? SKILLS_COPY.teachFailed : SKILLS_COPY.chatNotOpen, { tone: "danger" });
    },
    [toast],
  );
  // The waiting browser card links to its request only when that card is drawn here.
  const hasRequest = useCallback((id: string) => Object.prototype.hasOwnProperty.call(actions, id), [actions]);
  // An open browser card reads itself again when the chat's lines, the answer's steps or its cards' statuses change.
  const tick = useMemo(() => {
    const last = messages[messages.length - 1];
    const steps = last && last.kind === "agent" ? last.toolCalls.filter((c) => !c.pending).length : 0;
    return `${messages.length}:${last?.id ?? ""}:${steps}:${Object.values(actions).map((a) => `${a.id}=${a.status}`).join(",")}`;
  }, [messages, actions]);
  return (
    <BrowserCardsProvider hasRequest={hasRequest} tick={tick}>
      <div className="flex flex-col gap-5">
        {messages.map((m) => {
          switch (m.kind) {
            case "user":
              return <UserBubble key={m.id} m={m} />;
            case "agent":
              return <AgentTurn key={m.id} m={m} teammate={teammateFor?.(m) ?? teammate} showName={showNames} />;
            case "report":
              return <ReportBubble key={m.id} m={m} teammate={teammate} />;
            case "event": {
              const slug = teammate.slug;
              const line = (
                <SystemLine
                  key={m.id}
                  m={m}
                  onOpenSettings={(tab) => onOpenSettings(tab, m)}
                  onPauseRoutine={onPauseRoutine}
                  // A one-teammate chat's own line only: a group has no Skills tab of its own.
                  reviewHref={slug && !teammateFor ? (skillId) => skillReviewHref(slug, skillId) : undefined}
                  // A skill's reminder starts the skill in this chat only (Phase 5 step 5): the person's own run message, as Run in chat sends it.
                  onStartSkill={slug && !teammateFor ? (skillId, name) => startSkill(slug, skillId, name) : undefined}
                />
              );
              // A browser opened for this chat draws its card, the line it replaces shown only when the card cannot be read.
              if (m.event === "browser_started" && m.browserSessionId) {
                return (
                  <div key={m.id} className="flex gap-3">
                    <span className="w-[18px] shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <BrowserCard browserSessionId={m.browserSessionId} fallback={line} />
                    </div>
                  </div>
                );
              }
              return line;
            }
            case "approval": {
              const cards = groupApprovals(m.actionIds, actions).groups.flatMap((g) => g.actions);
              if (cards.length === 0) {
                return (
                  <div key={m.id} className="flex min-h-6 items-center justify-center gap-2 text-center text-sm text-ink-2">
                    <Clock className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                    <span className="min-w-0 break-words">{m.text}</span>
                  </div>
                );
              }
              return (
                <div key={m.id} className="flex gap-3">
                  <span className="w-[18px] shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <ApprovalCard actions={cards} agentName={(teammateFor?.(m) ?? teammate).name} deciding={deciding} onDecide={onDecide} />
                  </div>
                </div>
              );
            }
            default:
              return null;
          }
        })}
      </div>
    </BrowserCardsProvider>
  );
}

export function UserBubble({ m }: { m: Extract<TeammateMessageView, { kind: "user" }> }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      {/* Run now sent the agent's saved instructions, which the person may never have typed (review round 8). */}
      {m.runNow ? <span className="text-xs text-ink-2">{RUN_NOW_SENT}</span> : null}
      <div className="max-w-[560px] whitespace-pre-wrap break-words rounded-lg bg-subtle px-4 py-3 text-base text-ink">{m.text}</div>
    </div>
  );
}

export function AgentTurn({ m, teammate, showName = false }: { m: Extract<TeammateMessageView, { kind: "agent" }>; teammate: ThreadTeammate; showName?: boolean }) {
  const arriving = m.streaming === true;
  // Nothing to show yet but the dots; a pending tool row has dots of its own.
  const waiting = arriving && !m.text && !m.toolCalls.some((c) => c.pending);
  return (
    <div className="flex gap-3">
      <TeammateAvatar name={teammate.name} hue={teammate.hue} avatar={teammate.avatar} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {showName ? <p className="m-0 mb-0.5 text-xs font-medium text-ink-2">{teammate.name}</p> : null}
        {m.toolCalls.length > 0 ? (
          <div className="mb-1 flex flex-col">
            {m.toolCalls.map((c, i) => (
              <ToolCallRow key={i} name={c.name} input={c.input} failed={c.failed} pending={c.pending} outcome={c.outcome} durationMs={c.durationMs} />
            ))}
          </div>
        ) : null}
        {m.text ? (
          <div className="text-prose text-ink">
            {/* Every link shows where it goes, and an answer that read the
                person's Google links nothing (review round 3 of Phase 3);
                one still arriving cannot say yet, so it links nothing either,
                nor one that called a Google tool, which an answer settled
                after a failed save shows with no readGoogle (review round 4). */}
            <OsMarkdown text={m.text} links={answerLinks(m)} />
          </div>
        ) : null}
        {waiting || (arriving && m.text) ? (
          <div className="pt-1">
            <Dots variant="pending" label={TEAMMATE_CHAT.working} />
          </div>
        ) : null}
        {m.practice && !arriving ? <p className="mt-1 text-xs text-ink-2">{TEAMMATE_CHAT.practiceFooter}</p> : null}
      </div>
    </div>
  );
}
