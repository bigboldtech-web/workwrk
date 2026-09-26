"use client";

// AskAiThread: the one Ask AI conversation surface (spec-ai-automation
// section 3). The /sidekick page renders it in a 720 column, the Ask AI panel
// at its 360 width; everything else comes from useAiSession(), so the two
// are one thread and never two.
//
// It renders the landing (the headline, the one line about what it can see,
// the six starter prompts, each of which runs), the turns, the tool rows,
// the composer, and every state between: loading, a chat that failed to
// load, an answer that stopped, AI turned off, AI not set up, an archived
// chat, offline.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUp, Sparkles } from "lucide-react";
import { OsMarkdown } from "@/components/layout/os/markdown";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { ToolCallRow } from "@/components/ai/tool-call-row";
import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { useAiSession, type AiMessage, type AiSendError, type ChatContext } from "@/lib/ai/session-store";
import { isStoppedAnswer } from "@/lib/ai/thread";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { ASK_AI_STARTERS, starterLabel, starterWantsMore } from "@/lib/ai/starters";
import { cn } from "@/lib/utils";

const ERROR_TEXT: Record<AiSendError, string> = {
  not_sent: "Your message wasn't sent. Check your connection and try again.",
  stopped: "The answer stopped.",
  start_failed: "Couldn't start a chat.",
  agent_off: "That agent is not turned on.",
};

const OFFLINE_TEXT = "You're offline. Changes will save when you reconnect.";

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

  function sendDraft() {
    if (!s.draft.trim() || s.streaming || s.offline) return;
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
    if (!r.ok) { toast("Couldn't restore the chat", { tone: "danger" }); return; }
    s.patchMeta({ archived: false });
    notifyAiChatsChanged();
    toast("Chat restored");
  }

  const column = page ? "mx-auto w-[min(720px,100%-32px)]" : "px-4";

  const errorRow = s.error ? (
    <div role="alert" className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-danger-text">
      <span>{ERROR_TEXT[s.error]}</span>
      {s.error === "agent_off" ? (
        <Link href="/agents" className="font-medium underline underline-offset-2">See agents</Link>
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(column, page ? "py-8" : "py-4")}>
          {landing ? (
            <div className={cn("flex flex-col", page ? "mt-8 items-center text-center" : "items-center pt-4 text-center")}>
              <h2 className={cn("font-semibold text-ink", page ? "text-xl" : "text-lg")}>
                {s.agent?.name ? `Chat with ${s.agent.name}` : "What can I help with?"}
              </h2>
              <p className="mt-2 text-sm text-ink-2">Ask AI can only see the work you already have access to.</p>
              {!unavailable ? (
                <div className={cn("mt-6 grid w-full gap-2", page ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
                  {ASK_AI_STARTERS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={s.streaming || s.status === null || s.offline}
                      onClick={() => {
                        // A starter that ends in a space wants the rest typed.
                        if (starterWantsMore(q)) { s.setDraft(q); focusComposer(); }
                        else void s.send(q, context);
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
          ) : s.loading ? (
            <div aria-busy="true" aria-label="Loading this chat">
              <SkeletonLines lines={3} />
            </div>
          ) : s.loadError ? (
            <div className="flex h-11 items-center gap-2 text-row text-ink-2">
              Couldn&apos;t load this chat.
              <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => s.sessionId && void s.open(s.sessionId)}>
                Try again
              </button>
            </div>
          ) : s.missing ? (
            <div className="flex h-11 items-center text-row text-ink-2">That chat isn&apos;t here any more.</div>
          ) : (
            <div className={cn("flex flex-col", page ? "gap-5" : "gap-4")}>
              {s.messages.map((m) => <Turn key={m.id} m={m} page={page} />)}
              {errorRow}
            </div>
          )}
        </div>
      </div>

      <div className={cn("shrink-0 bg-app", page ? "" : "border-t border-line-soft")}>
        <div className={cn(column, "py-3")}>
          {off ? (
            <div className="flex min-h-11 items-center text-row text-ink-2">AI is turned off for this workspace.</div>
          ) : notSetUp ? (
            <div className="flex min-h-11 flex-col justify-center text-row text-ink-2">
              <span>Ask AI isn&apos;t set up for this workspace yet.</span>
              <span className="text-sm">{isAdmin ? "It needs an AI key before it can answer." : "Ask a workspace admin to set it up."}</span>
            </div>
          ) : s.meta?.archived ? (
            <div className="flex min-h-11 items-center gap-2 text-row text-ink-2">
              This chat is archived.
              <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void restore()}>Restore</button>
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
                  disabled={!s.draft.trim() || s.streaming || s.offline}
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
          )}
        </div>
      </div>
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
