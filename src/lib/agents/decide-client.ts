"use client";

// POST /api/agents/actions/decide from a browser. The chat's approval cards
// (teammate-store.ts) and the Inbox's approval pane send their decisions
// through this one call, so both read the answer the same way: the server's
// own sentence only for its per-minute limit (the card says the rest), and
// `resume` and `chat` naming the chat that may carry on once something ran
// (a group chat included, docs/plans/ai-teammates-phase2.md step 3).

import { apiFetch } from "@/lib/api-fetch";
import type { TeammateDecision, TeammateDecisionResult } from "./teammate-thread";

/** The chat a decision continues (actions.ts ResumeChat): a teammate's own, or a group with the teammate whose request ran. */
export type ResumeChat = { kind: "teammate"; slug: string } | { kind: "group"; id: string; agentSlug: string };

export type DecideReply =
  | { ok: true; results: TeammateDecisionResult[]; resume: boolean; agentSlug: string | null; chat: ResumeChat | null }
  | { ok: false; error: string | null };

function chatOf(v: unknown): ResumeChat | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (c.kind === "teammate" && typeof c.slug === "string" && c.slug) return { kind: "teammate", slug: c.slug };
  if (c.kind === "group" && typeof c.id === "string" && c.id && typeof c.agentSlug === "string" && c.agentSlug) return { kind: "group", id: c.id, agentSlug: c.agentSlug };
  return null;
}

export async function sendDecisions(decisions: TeammateDecision[], opts: { always?: boolean } = {}): Promise<DecideReply> {
  const r = await apiFetch<{ results: TeammateDecisionResult[]; resume: boolean; agentSlug: string | null; chat?: unknown }>("/api/agents/actions/decide", {
    method: "POST",
    json: { decisions, ...(opts.always ? { always: true } : {}) },
  });
  if (!r.ok) return { ok: false, error: r.status === 429 ? r.error : null };
  return {
    ok: true,
    results: Array.isArray(r.data.results) ? r.data.results : [],
    resume: r.data.resume === true,
    agentSlug: typeof r.data.agentSlug === "string" ? r.data.agentSlug : null,
    chat: chatOf(r.data.chat),
  };
}
