"use client";

// AskAiThread: the one Ask AI conversation surface (spec-ai-automation
// section 3). The /sidekick page renders it in a 720 column, the Ask AI panel
// at its 360 width; everything else comes from useAiSession(), so the two
// are one thread and never two.
//
// It renders the landing (the headline, the one line about what it can see,
// the six starter prompts, then the composer right under them), the turns,
// the tool rows, the approval cards for what Ask AI asked the person first
// (the cards AI teammates use, follow-up 1.5c) with each decision's line,
// the composer, and every state between: loading, a chat that
// failed to load, a chat that is not there any more, an answer that stopped
// (live, or found on reload as a question with no answer), AI turned off, AI
// not set up, an archived chat, offline.
//
// .os-chrome on the root: the thread is drawn on the px grid like the rest
// of the frame, so h-9 is 36, h-12 is 48 and rounded-lg is 8 here, the sizes
// the spec names (not 14/16 of them under the 14px page root).

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUp, Sparkles } from "lucide-react";
import { OsMarkdown } from "@/components/layout/os/markdown";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { ToolCallRow } from "@/components/ai/tool-call-row";
import { ApprovalCard } from "@/components/agents/approval-card";
import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { useAiSession, type AiMessage, type AiSendError, type ChatContext } from "@/lib/ai/session-store";
import { isStoppedAnswer, unansweredQuestion, withPromptAbove } from "@/lib/ai/thread";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { ASK_AI_STARTERS, starterLabel, starterWantsMore } from "@/lib/ai/starters";
import { ASK_AI_CARDS, TEAMMATE_CHAT } from "@/lib/agents/teammate-copy";
import type { ActionView, DecideAnswer, TeammateDecision } from "@/lib/agents/teammate-thread";
import { SUPPORT_EMAIL } from "@/lib/nav/labels";
import { cn } from "@/lib/utils";

const ERROR_TEXT: Record<AiSendError, string> = {
  not_sent: "Your message wasn't sent. Check your connection and try again.",
  stopped: "The answer stopped.",
  start_failed: "Couldn't start a chat.",
  agent_off: "That agent is not turned on, so this would be a plain Ask AI chat.",
  gone: "This chat was archived or removed, so your message wasn't sent.",
  ai_limit: "This workspace has used all its AI questions. An Owner or Admin can change the plan in Settings, Plan & billing.",
  rate_limited: "Too many AI requests at once. Wait a minute and try again.",
};

const OFFLINE_TEXT = "You're offline. Changes will save when you reconnect.";
const LINK = "whitespace-nowrap font-medium text-brand-deep hover:underline";

export function AskAiThread({
  width,
  context,
  active = true,
  composerRef,
}: {
  width: "panel" | "page";
  /** The page a new chat starts on (the panel passes the route under it). */
  context?: ChatContext;
  /** The panel is closed: no status read, no autoscroll. */
  active?: boolean;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const s = useAiSession();
  const { isAdmin } = useViewerRole();
  const { toast } = useOsToast();
  const localRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = composerRef ?? localRef;
  const scrollRef = useRef<HTMLDivElement>(null);
  const page = width === "page";

  // Re-read the honest state every time the surface becomes active, so a key
  // added or AI turned back on shows without a reload.
  const { loadStatus } = s;
  useEffect(() => {
    if (active) void loadStatus(true);
  }, [active, loadStatus]);

  useEffect(() => {
    if (!active || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [active, s.messages, s.error, s.streaming]);

  // The composer grows with its text, 1 to 8 rows.
  useEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [s.draft, inputRef]);

  function focusComposer() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const off = s.status !== null && !s.status.enabled;
  const notSetUp = s.status !== null && s.status.enabled && !s.status.configured;
  const unavailable = off || notSetUp;
  const landing = !s.sessionId && s.messages.length === 0 && !s.loading;
  const agentOff = s.error === "agent_off";
  const unanswered = !s.loading && !s.missing && !s.loadError && !s.error ? unansweredQuestion(s.messages, { streaming: s.streaming }) : null;
  const starters = s.agent?.examplePrompts?.length ? s.agent.examplePrompts.slice(0, 6) : ASK_AI_STARTERS;

  function sendDraft() {
    // Not while the chat loads or after it failed to load: the store refuses a send then too.
    if (!s.draft.trim() || s.streaming || s.offline || s.loading || s.loadError) return;
    void s.send(s.draft, context);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendDraft();
    } else if (e.key === "Escape" && page) {
      // On the page Esc leaves the composer; in the panel the shell's layer
      // stack closes the panel.
      e.currentTarget.blur();
    }
  }

  async function restore() {
    if (!s.meta) return;
    const r = await apiFetch(`/api/sidekick/sessions/${s.meta.id}`, { method: "PATCH", json: { archived: false } });
    if (!r.ok) { toast("Couldn't restore the chat", { tone: "danger", action: { label: "Try again", onClick: () => void restore() } }); return; }
    s.patchMeta({ archived: false });
    notifyAiChatsChanged();
    toast("Chat restored");
  }

  function newChat(keepDraft = false) {
    s.reset({ keepDraft });
    focusComposer();
  }

  const column = page ? "mx-auto w-[min(720px,100%-32px)]" : "px-4";

  const errorRow = s.error ? (
    <div role="alert" className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-danger-text">
      <span>{(s.error === "ai_limit" || s.error === "rate_limited") && s.errorText ? s.errorText : ERROR_TEXT[s.error]}</span>
      {s.error === "ai_limit" ? null : s.error === "agent_off" ? (
        <Link href="/agents" className="font-medium underline underline-offset-2">{TEAMMATE_CHAT.seeAiTeammates}</Link>
      ) : s.error === "gone" ? (
        <button type="button" className="whitespace-nowrap font-medium underline underline-offset-2" onClick={() => newChat(true)}>
          Start a new chat with it
        </button>
      ) : (
        <button
          type="button"
          className="whitespace-nowrap font-medium underline underline-offset-2"
          onClick={() => {
            s.clearError();
            if (s.draft.trim()) void s.retry(context);
            else focusComposer();
          }}
        >
          Try again
        </button>
      )}
    </div>
  ) : null;

  // The composer, or the one line that says why there is none.
  const composer = off ? (
    landing ? null : <div className="flex min-h-11 items-center text-row text-ink-2">AI is turned off for this workspace.</div>
  ) : notSetUp ? (
    // The landing says it at the top; under a saved chat it says it here.
    landing ? null : (
      <div className="flex min-h-11 flex-col justify-center text-row text-ink-2">
        <span>Ask AI isn&apos;t set up for this workspace yet.</span>
        <span className="text-sm">
          {isAdmin ? (
            <>It needs an AI key before it can answer. <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Turn on Ask AI")}`} className={LINK}>Contact support</a></>
          ) : "Ask a workspace admin to set it up."}
        </span>
      </div>
    )
  ) : s.missing ? null : agentOff ? null : s.meta?.archived ? (
    <div className="flex min-h-11 items-center gap-2 text-row text-ink-2">
      This chat is archived.
      <button type="button" className={LINK} onClick={() => void restore()}>Restore</button>
    </div>
  ) : (
    <div className="rounded-lg border border-line-strong bg-raised p-3 focus-within:border-brand">
      <textarea
        ref={inputRef}
        className="block max-h-40 min-h-5 w-full resize-none bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
        placeholder={landing ? "Ask about your work…" : "Ask a follow-up…"}
        value={s.draft}
        onChange={(e) => s.setDraft(e.target.value)}
        onKeyDown={onKey}
        rows={1}
        aria-label="Ask AI"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        {page ? <span className="text-sm text-ink-2">Sees only what you can see.</span> : <span />}
        <button
          type="button"
          onClick={sendDraft}
          disabled={!s.draft.trim() || s.streaming || s.offline || s.loading || s.loadError}
          aria-label={s.streaming ? "Answering" : "Send"}
          title={s.offline ? OFFLINE_TEXT : "Send · Enter"}
          className={
            s.streaming
              ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2"
              : "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
          }
        >
          {s.streaming ? <Dots variant="pending" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  // On the page's landing the composer sits right under the starters, where
  // the eye already is; everywhere else it is pinned to the foot.
  const composerInline = page && landing && !unavailable;

  return (
    <div className="os-chrome flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(column, page ? "py-8" : "py-4")}>
          {landing ? (
            <div className={cn("flex flex-col", page ? "mt-8 items-center text-center" : "items-center pt-4 text-center")}>
              {off ? (
                <>
                  <h2 className={cn("font-semibold text-ink", page ? "text-xl" : "text-lg")}>AI is turned off</h2>
                  <p className="mt-2 text-sm text-ink-2">AI features are turned off for this workspace.</p>
                </>
              ) : notSetUp ? (
                <>
                  <h2 className={cn("font-semibold text-ink", page ? "text-xl" : "text-lg")}>Ask AI isn&apos;t set up yet</h2>
                  <p className="mt-2 max-w-[440px] text-sm text-ink-2">
                    {isAdmin ? (
                      <>
                        It needs an AI key before it can answer.{" "}
                        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Turn on Ask AI")}`} className={LINK}>Contact support</a>{" "}
                        to turn it on for this workspace.
                      </>
                    ) : "Ask a workspace admin to set it up."}
                  </p>
                </>
              ) : agentOff ? (
                <>
                  <h2 className={cn("font-semibold text-ink", page ? "text-xl" : "text-lg")}>That agent is not turned on</h2>
                  <p className="mt-2 text-sm text-ink-2">It is paused or was removed, so it can&apos;t chat right now.</p>
                  <div className="mt-4 flex items-center gap-4 text-row">
                    <Link href="/agents" className={LINK}>{TEAMMATE_CHAT.seeAiTeammates}</Link>
                    <button type="button" className={LINK} onClick={() => newChat()}>Ask AI instead</button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className={cn("font-semibold text-ink", page ? "text-xl" : "text-lg")}>
                    {s.agent?.name ? `Chat with ${s.agent.name}` : "What can I help with?"}
                  </h2>
                  <p className="mt-2 text-sm text-ink-2">
                    {s.agent?.name ? `${s.agent.name} can only see the work you already have access to.` : "Ask AI can only see the work you already have access to."}
                  </p>
                  <div className={cn("mt-6 grid w-full gap-2", page ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
                    {starters.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={s.streaming || s.status === null || s.offline}
                        onClick={() => {
                          // A starter that ends in a space wants the rest typed; it goes
                          // above what is already in the composer, never in place of it.
                          if (starterWantsMore(q)) { s.setDraft(withPromptAbove(s.draft, q)); focusComposer(); }
                          else void s.send(q, context);
                        }}
                        className="inline-flex h-9 min-w-0 items-center rounded-md border border-line bg-raised px-3 text-start text-base text-ink hover:bg-hover disabled:opacity-60"
                      >
                        <span className="truncate">{starterLabel(q)}</span>
                      </button>
                    ))}
                  </div>
                  {composerInline ? <div className="mt-4 w-full text-start">{composer}</div> : null}
                </>
              )}
              {errorRow && !agentOff ? <div className="mt-4 self-stretch text-start">{errorRow}</div> : null}
            </div>
          ) : s.loading ? (
            <div aria-busy="true" aria-label="Loading this chat">
              <SkeletonLines lines={3} />
            </div>
          ) : s.loadError ? (
            <div className="flex h-11 items-center gap-2 text-row text-ink-2">
              Couldn&apos;t load this chat.
              <button type="button" className={LINK} onClick={() => s.sessionId && void s.open(s.sessionId)}>
                Try again
              </button>
            </div>
          ) : s.missing ? (
            <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-row text-ink-2">
              <span>That chat isn&apos;t here any more.</span>
              {page ? (
                <>
                  <Link href="/sidekick?new=1" className={LINK}>Start a new chat</Link>
                  <Link href="/sidekick?view=all" className={LINK}>All chats</Link>
                </>
              ) : (
                <button type="button" className={LINK} onClick={() => newChat()}>Start a new chat</button>
              )}
            </div>
          ) : (
            <div className={cn("flex flex-col", page ? "gap-5" : "gap-4")}>
              {s.messages.map((m) =>
                m.role === "SYSTEM" ? (
                  m.kind === "APPROVAL" ? (
                    <AskAiCard key={m.id} ids={m.actionIds ?? []} actions={s.actions} deciding={s.deciding} onDecide={s.decide} />
                  ) : (
                    <p key={m.id} className="text-center text-sm text-ink-2">{m.content}</p>
                  )
                ) : (
                  <Turn key={m.id} m={m} page={page} />
                ),
              )}
              {unanswered ? (
                <div role="status" className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-0.5 ps-7 text-sm text-ink-2">
                  <span>{unanswered.recent ? "The answer may still be on its way." : "The answer stopped before it was saved."}</span>
                  <button type="button" className={LINK} onClick={() => s.sessionId && void s.refresh(s.sessionId)}>Check again</button>
                  {!s.meta?.archived && !unavailable ? (
                    <button type="button" className={LINK} onClick={() => { s.setDraft(withPromptAbove(s.draft, unanswered.text)); focusComposer(); }}>Ask again</button>
                  ) : null}
                </div>
              ) : null}
              {errorRow}
            </div>
          )}
        </div>
      </div>

      {composerInline || composer === null ? null : (
        <div className={cn("shrink-0 bg-app", page ? "" : "border-t border-line-soft")}>
          <div className={cn(column, "py-3")}>{composer}</div>
        </div>
      )}
    </div>
  );
}

/** What Ask AI asked the person first: the teammates' own card, under the answer that asked. */
function AskAiCard({
  ids,
  actions,
  deciding,
  onDecide,
}: {
  ids: readonly string[];
  actions: Readonly<Record<string, ActionView>>;
  deciding: Readonly<Record<string, "approve" | "deny">>;
  onDecide: (decisions: TeammateDecision[], opts?: { always?: boolean }) => Promise<DecideAnswer>;
}) {
  const list = ids.flatMap((id) => (actions[id] ? [actions[id]] : []));
  if (list.length === 0) return null;
  return (
    <div className="ps-7">
      <ApprovalCard actions={list} agentName={ASK_AI_CARDS.name} deciding={deciding} onDecide={onDecide} />
    </div>
  );
}

function Turn({ m, page }: { m: AiMessage; page: boolean }) {
  if (m.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className={cn("whitespace-pre-wrap break-words rounded-lg bg-subtle px-4 py-3 text-base text-ink", page ? "max-w-[560px]" : "max-w-[85%]")}>{m.content}</div>
      </div>
    );
  }
  const stopped = !m.streaming && isStoppedAnswer(m.content);
  const waiting = m.streaming && !m.content && !m.toolCalls.some((c) => c.pending);
  return (
    <div className="flex gap-3">
      <Sparkles className="mt-1 h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0 flex-1">
        {m.toolCalls.length > 0 ? (
          <div className="mb-1 flex flex-col">
            {m.toolCalls.map((c, i) => (
              <ToolCallRow key={i} name={c.name} input={c.input} failed={c.failed} pending={c.pending} outcome={c.outcome} durationMs={c.durationMs} />
            ))}
          </div>
        ) : null}
        {stopped ? (
          <div className="flex min-h-9 items-center text-sm text-danger-text">This answer didn&apos;t finish.</div>
        ) : m.content ? (
          <div className="text-prose text-ink">
            <OsMarkdown text={m.content} />
          </div>
        ) : null}
        {waiting || (m.streaming && m.content) ? (
          <div className="pt-1"><Dots variant="pending" label="Answering" /></div>
        ) : null}
      </div>
    </div>
  );
}
