import { NextRequest } from "next/server";
import { aiOffResponse } from "@/lib/ai/ai-off-gate";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { aiAutoAllowed } from "@/lib/ai-allowance";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { requireApp } from "@/lib/app-gate";

/**
 * AI Inbox suggestions — Phase 6 v1.
 *
 * Given the user's current Inbox items, return a per-item suggestion:
 *   { id, action: "approve" | "hold" | "reassign" | "do" | "review",
 *     rationale: string (≤ 18 words),
 *     confidence: number (0..1) }
 *
 * Body: `{ items: Array<{ id, type, title, context?, link? }> }`
 *
 * The model never sees comp data or PII beyond what the inbox already
 * surfaces — callers are responsible for trimming items before posting.
 *
 * Bounded:
 *   • the AI app's own gate first (Guests, a hidden app, AI turned off)
 *   • items[] capped at 20 (the inbox is a punch list, not a feed), and
 *     every item's type and title at 200 characters, its context too
 *   • response capped at ~700 tokens on the small model (unless the
 *     workspace's own key prefers another); we fail open with empty hints
 *     so the inbox renders normally even if the model returns garbage
 *   • runs only while the workspace has AI questions left, under its daily
 *     total of automatic calls, never spends a question
 *     (src/lib/ai-allowance.ts), and uses BYOK if configured
 */

type SuggestedAction = "approve" | "hold" | "reassign" | "do" | "review";

interface Suggestion {
  id: string;
  action: SuggestedAction;
  rationale: string;
  confidence: number;
}

interface InboxItemInput {
  id: string;
  type: string;
  title: string;
  context?: string;
  link?: string;
}

const VALID_ACTIONS: ReadonlySet<SuggestedAction> = new Set([
  "approve",
  "hold",
  "reassign",
  "do",
  "review",
]);

export async function POST(req: NextRequest) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items.slice(0, 20) : [];
  if (rawItems.length === 0) return jsonSuccess({ suggestions: [] });

  // Drop anything that doesn't have the minimal shape we need to render
  // a suggestion. Skipped items are simply absent from the response.
  const items: InboxItemInput[] = rawItems
    .map((raw: unknown): InboxItemInput | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.type !== "string" || typeof r.title !== "string") {
        return null;
      }
      return {
        id: r.id.slice(0, 200),
        type: r.type.slice(0, 200),
        title: r.title.slice(0, 200),
        context: typeof r.context === "string" ? r.context.slice(0, 200) : undefined,
        link: typeof r.link === "string" ? r.link.slice(0, 200) : undefined,
      };
    })
    .filter((x: InboxItemInput | null): x is InboxItemInput => x !== null);
  if (items.length === 0) return jsonSuccess({ suggestions: [] });

  const orgId = getOrgId(session);
  // AI features turned off for the workspace (settings.data.aiEnabled).
  const aiOff = await aiOffResponse(orgId);
  if (aiOff) return aiOff;

  const resolved = await getAnthropicForOrg(orgId);
  // Suggestions nobody asked for never spend one of the plan's AI questions;
  // they run only while the workspace has some left, under the daily totals
  // on WorkwrK's key (src/lib/ai-allowance.ts).
  if (!(await aiAutoAllowed(orgId, getUserId(session), resolved.source))) return jsonSuccess({ suggestions: [] });
  const ai = resolved.client;
  const model = modelFor(resolved, "claude-haiku-4-5");

  const itemList = items
    .map((it, i) =>
      `${i + 1}. [${it.type}] ${it.title}${it.context ? ` — ${it.context}` : ""}`,
    )
    .join("\n");

  // Strict-schema system prompt. JSON output keeps parsing trivial and
  // lets the UI render badges without natural-language post-processing.
  const completion = await ai.messages.create({
    model,
    max_tokens: 700,
    system:
      "You are an approval-fatigue reducer for a workplace product (WorkwrK). " +
      "Given a list of inbox items needing the user's attention, output JSON: " +
      `[{"i": <1-indexed item number>, "action": "approve"|"hold"|"reassign"|"do"|"review", "rationale": "<≤ 18 words>", "confidence": <0..1>}]. ` +
      "Rules: " +
      "(a) 'approve' only when the item looks routine and low-risk based on its title + context. " +
      "(b) 'hold' if anything looks unusual — a number that's off, a vendor that's repeating, a request that's out-of-band. " +
      "(c) 'reassign' if the wrong person is being asked. " +
      "(d) 'do' for non-approval items that need direct action (tasks due, reviews to write, meetings to prep). " +
      "(e) 'review' when you genuinely cannot tell from the title alone. " +
      "Confidence reflects how sure you are. Keep rationale terse and concrete — no fluff. " +
      "Return ONLY the JSON array, no prose, no markdown.",
    messages: [
      {
        role: "user",
        content: `Inbox items (${items.length}):\n${itemList}`,
      },
    ],
  });

  const block = completion.content.find((c) => c.type === "text");
  const raw = block && block.type === "text" ? block.text.trim() : "";

  // Parse the JSON the model returned. Fail open with empty suggestions
  // rather than 500-ing — the inbox should always render.
  const suggestions: Suggestion[] = [];
  try {
    // Strip any accidental code fences.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        const idx = Number(row?.i) - 1;
        const action = row?.action;
        const rationale = row?.rationale;
        const confidence = Number(row?.confidence);
        if (
          idx >= 0 &&
          idx < items.length &&
          typeof action === "string" &&
          VALID_ACTIONS.has(action as SuggestedAction) &&
          typeof rationale === "string" &&
          Number.isFinite(confidence)
        ) {
          suggestions.push({
            id: items[idx].id,
            action: action as SuggestedAction,
            rationale: rationale.slice(0, 200),
            confidence: Math.max(0, Math.min(1, confidence)),
          });
        }
      }
    }
  } catch {
    // Swallow — return what we have (likely nothing).
  }

  return jsonSuccess({ suggestions });
}
