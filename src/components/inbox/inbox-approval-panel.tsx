"use client";

// The Inbox's approval pane (docs/plans/ai-teammates.md 3.14 and 5.4). A
// routine that asked its person to approve something writes one Inbox row,
// linked to the first request's card (actions.ts actionHref); here that row
// opens as the card itself, with every request the same run asked, so the
// person decides without leaving the Inbox. The card is the chat's own
// (approval-card.tsx) and so is the call (decide-client.ts): a decision here
// is the decision the chat would make. Two things differ from the chat:
//   - the teammate does not carry on here. A chat continues only while it is
//     open (teammate-store.ts); the teammate hears the outcome on its next
//     turn there (actions.ts claimUnreportedOutcomes).
//   - a request that is gone answers 404, and the pane shows `gone`, which the
//     Inbox passes in: the row's own title and message, and no buttons.
// After a decision the Inbox list and the bell re-read (the server marked the
// row read), and the AI sidebar's count moves.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ApprovalCard } from "@/components/agents/approval-card";
import { TeammateAvatar } from "@/components/agents/teammate-avatar";
import { Dots } from "@/components/ui/dots";
import { apiFetch } from "@/lib/api-fetch";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { sendDecisions } from "@/lib/agents/decide-client";
import type { TeammateHue } from "@/lib/agents/hues";
import { INBOX_APPROVAL } from "@/lib/agents/teammate-copy";
import { applyDecisionResults, type ActionView, type DecideAnswer, type TeammateDecision } from "@/lib/agents/teammate-thread";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";

interface Loaded {
  actions: ActionView[];
  agent: { slug: string; name: string; hue: TeammateHue | null; avatar: string | null };
}

type PaneState = { status: "loading" } | { status: "ready"; data: Loaded } | { status: "gone" } | { status: "failed" };

export function InboxApprovalPanel({
  actionId,
  title,
  message,
  time,
  chatHref,
  gone,
}: {
  /** The request the Inbox row links to (the first one its run asked). */
  actionId: string;
  /** The row's own words, shown above the card. */
  title: string;
  message: string;
  time: string;
  /** The teammate's chat at this card, or null when the row has no link. */
  chatHref: string | null;
  /** What shows when the request is gone. */
  gone: ReactNode;
}) {
  const [state, setState] = useState<PaneState>({ status: "loading" });
  const [deciding, setDeciding] = useState<Readonly<Record<string, "approve" | "deny">>>({});

  const load = useCallback(async () => {
    const r = await apiFetch<{ action: ActionView; actions?: ActionView[]; agent: Loaded["agent"] }>(
      `/api/agents/actions/${encodeURIComponent(actionId)}`,
      { cache: "no-store" },
    );
    if (r.ok) {
      const actions = Array.isArray(r.data.actions) && r.data.actions.length > 0 ? r.data.actions : [r.data.action];
      setState({ status: "ready", data: { actions, agent: r.data.agent } });
    } else if (r.status === 404) {
      setState({ status: "gone" });
    } else {
      // A failed read again keeps the card on screen; only a first read says so.
      setState((s) => (s.status === "ready" ? s : { status: "failed" }));
    }
  }, [actionId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    // Decided in another tab, expired, or its teammate removed: read again.
    const onRealtime = (e: Event) => {
      if ((e as CustomEvent<RealtimeEvent>).detail?.type === "agent.changed") void load();
    };
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => {
      clearTimeout(t);
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
    };
  }, [load]);

  const onDecide = useCallback(
    async (decisions: TeammateDecision[], opts?: { always?: boolean }): Promise<DecideAnswer> => {
      if (decisions.length === 0) return { ok: true, results: [] };
      setDeciding((d) => ({ ...d, ...Object.fromEntries(decisions.map((x) => [x.id, x.decision] as const)) }));
      const r = await sendDecisions(decisions, opts);
      setDeciding((d) => {
        const next = { ...d };
        for (const x of decisions) delete next[x.id];
        return next;
      });
      if (!r.ok) return { ok: false, error: r.error };
      const at = new Date().toISOString();
      setState((s) => {
        if (s.status !== "ready") return s;
        // The chat's own rule, which keeps cards by id; the order stays the run's.
        const byId = applyDecisionResults(Object.fromEntries(s.data.actions.map((a) => [a.id, a])), r.results, at);
        return { status: "ready", data: { ...s.data, actions: s.data.actions.map((a) => byId[a.id] ?? a) } };
      });
      notifyAiChatsChanged();
      window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.notifChanged));
      void load();
      return { ok: true, results: r.results };
    },
    [load],
  );

  if (state.status === "gone") return <>{gone}</>;

  return (
    <div className="mx-auto w-full max-w-[760px]">
      {state.status === "ready" ? (
        <div className="flex min-w-0 items-center gap-2">
          <TeammateAvatar name={state.data.agent.name} hue={state.data.agent.hue} avatar={state.data.agent.avatar} size="md" />
          <span className="min-w-0 truncate text-sm font-medium text-ink">{state.data.agent.name}</span>
        </div>
      ) : null}
      <h2 className="mt-3 text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-base text-ink">{message}</p>
      <p className="mt-1 text-xs text-ink-2">{time}</p>
      <div className="mt-4">
        {state.status === "ready" ? (
          <ApprovalCard actions={state.data.actions} agentName={state.data.agent.name} deciding={deciding} onDecide={onDecide} />
        ) : state.status === "loading" ? (
          <div className="flex h-8 items-center gap-2 text-sm text-ink-2">
            <Dots variant="pending" label={INBOX_APPROVAL.loading} />
            <span aria-hidden>{INBOX_APPROVAL.loading}</span>
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {INBOX_APPROVAL.failed}
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                void load();
              }}
              className="font-medium text-brand-deep hover:underline"
            >
              {INBOX_APPROVAL.retry}
            </button>
          </p>
        )}
      </div>
      {chatHref ? (
        <Link
          href={chatHref}
          className="mt-4 inline-flex h-9 items-center rounded-md border border-line px-3 text-base font-medium text-ink hover:bg-hover"
        >
          {INBOX_APPROVAL.openChat}
        </Link>
      ) : null}
    </div>
  );
}
