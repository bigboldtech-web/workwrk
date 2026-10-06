// POST /api/agents/actions/decide
//   { decisions: [{ id, decision: "approve" | "deny", edit?: { text } }] (1..50), always?: boolean }
//
// Approve or deny this person's own requests (actions.ts decideActions):
// each runs at most once however many arrive at once, as the person is now,
// and anyone else's id answers not_found exactly like a missing one, an
// Admin's included. `always` is "Approve and don't ask again", stored as the
// person's own rule only where the policy offers it. Answers
// { results, resume, agentSlug }: when anything ran, the chat continues once.
//
// At most 60 requests a minute per person: an approval runs a tool, and
// nobody clicks that fast; a script does.
//
// docs/plans/ai-teammates.md 3.7 and 4. Every refusal is { error, code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { rateLimit } from "@/lib/rate-limit-memory";
import { MAX_DECISIONS, decideActions } from "@/lib/agents/actions";
import { tooManyDecisions } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";

/** Decide requests one person may send in a minute. */
const DECIDE_PER_MINUTE = 60;

const decideSchema = z.object({
  decisions: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        decision: z.enum(["approve", "deny"]),
        // Clamped to the action's own field length when it runs (EDITABLE_FIELD).
        edit: z.object({ text: z.string().max(20000) }).optional(),
      }),
    )
    .min(1)
    .max(MAX_DECISIONS),
  always: z.boolean().optional(),
});

export async function POST(req: Request) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const limited = rateLimit(`agent-decide:${viewer.userId}`, { max: DECIDE_PER_MINUTE, windowMs: 60_000 });
  if (!limited.ok) {
    return teammateError(429, "rate_limited", tooManyDecisions(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });
  }
  const parsed = decideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const out = await decideActions(viewer, parsed.data.decisions, { always: parsed.data.always === true });
  return NextResponse.json(out);
}
