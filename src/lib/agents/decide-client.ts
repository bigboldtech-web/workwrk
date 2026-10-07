"use client";

// POST /api/agents/actions/decide from a browser. The chat's approval cards
// (teammate-store.ts) and the Inbox's approval pane send their decisions
// through this one call, so both read the answer the same way: the server's
// own sentence only for its per-minute limit (the card says the rest), and
// `resume` naming the chat that may carry on once something ran.

import { apiFetch } from "@/lib/api-fetch";
import type { TeammateDecision, TeammateDecisionResult } from "./teammate-thread";

export type DecideReply =
  | { ok: true; results: TeammateDecisionResult[]; resume: boolean; agentSlug: string | null }
  | { ok: false; error: string | null };

export async function sendDecisions(decisions: TeammateDecision[], opts: { always?: boolean } = {}): Promise<DecideReply> {
  const r = await apiFetch<{ results: TeammateDecisionResult[]; resume: boolean; agentSlug: string | null }>("/api/agents/actions/decide", {
    method: "POST",
    json: { decisions, ...(opts.always ? { always: true } : {}) },
  });
  if (!r.ok) return { ok: false, error: r.status === 429 ? r.error : null };
  return {
    ok: true,
    results: Array.isArray(r.data.results) ? r.data.results : [],
    resume: r.data.resume === true,
    agentSlug: typeof r.data.agentSlug === "string" ? r.data.agentSlug : null,
  };
}
