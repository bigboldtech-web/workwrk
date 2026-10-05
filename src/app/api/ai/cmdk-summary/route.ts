import { NextRequest } from "next/server";
import { aiOffResponse } from "@/lib/ai/ai-off-gate";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { aiAutoAllowed } from "@/lib/ai-allowance";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { requireApp } from "@/lib/app-gate";

/** Each text the caller sends is cut to this: a search query and a hit's title are short. */
const FIELD_MAX = 200;
const cut = (v: unknown): string => (typeof v === "string" ? v.slice(0, FIELD_MAX) : "");

/**
 * Cmd-K AI summarization. Given a user's free-text query plus the
 * raw search hits already shown in the palette, returns a one-line
 * synthesis above the results so the user can decide "did the
 * search find what I meant?" without reading every row.
 *
 * Body: `{ query: string, hits: Array<{ title, subtitle, type, href }> }`
 *
 * Response: `{ summary: string, suggestedHref?: string }`
 *
 * `suggestedHref` (when the model picks one of the supplied hits as
 * the best match) drives a one-click "open this" action in the
 * palette.
 *
 * Bounded:
 *   • the AI app's own gate first (Guests, a hidden app, AI turned off)
 *   • hits[] capped at 24, and the query and every hit's fields at 200
 *     characters: the caller writes the prompt, so its size is ours to set
 *   • response capped at ~180 tokens to keep latency tight, on the small
 *     model unless the workspace's own key prefers another
 *   • runs only while the workspace has AI questions left, under its daily
 *     total of automatic calls, never spends a question
 *     (src/lib/ai-allowance.ts), and uses BYOK if configured
 */
export async function POST(req: NextRequest) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const query = cut(body?.query).trim();
  const rawHits: Array<{ title: string; subtitle: string; type: string; href: string }> = (Array.isArray(body?.hits) ? body.hits.slice(0, 24) : [])
    .map((h: unknown) => {
      const r = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
      return { title: cut(r.title), subtitle: cut(r.subtitle), type: cut(r.type), href: cut(r.href) };
    });
  if (!query) return jsonError("query is required");

  // Nothing to summarise: no model call, so nothing of the day is taken.
  if (rawHits.length === 0) {
    return jsonSuccess({
      summary: "No matches yet. Try a person's name, an SOP title or an entity code.",
      suggestedHref: null,
    });
  }

  const orgId = getOrgId(session);
  // A summary nobody asked for never spends one of the plan's AI questions;
  // it runs only while the workspace has some left (src/lib/ai-allowance.ts).
  if (!(await aiAutoAllowed(orgId, getUserId(session)))) return jsonSuccess({ summary: null, suggestedHref: null });

  // AI features turned off for the workspace (settings.data.aiEnabled).
  const aiOff = await aiOffResponse(orgId);
  if (aiOff) return aiOff;

  const resolved = await getAnthropicForOrg(orgId);
  const ai = resolved.client;
  const model = modelFor(resolved, "claude-haiku-4-5");

  const hitList = rawHits
    .map((h, i) =>
      `${i + 1}. [${h.type || "?"}] ${h.title}${h.subtitle ? ` — ${h.subtitle}` : ""} → ${h.href}`,
    )
    .join("\n");

  // System prompt is terse on purpose — synthesis, not explanation.
  // The "one sentence" constraint pushes the model to pick a single
  // best answer instead of listing all results.
  const completion = await ai.messages.create({
    model,
    max_tokens: 200,
    system:
      "You synthesize search results from a workplace product (WorkwrK). " +
      "Given a user query and the top hits, return ONE short sentence (≤ 24 words) " +
      "that names the single most likely match or summarizes the result group. " +
      "If one hit is clearly the answer, end with ` >>> <number>` (1-indexed) " +
      "so the UI can deep-link. If nothing matches, say so plainly.",
    messages: [
      {
        role: "user",
        content: `Query: ${query}\n\nTop hits:\n${hitList}`,
      },
    ],
  });

  // Anthropic SDK returns content as a block array; the first text
  // block carries our answer.
  const block = completion.content.find((c) => c.type === "text");
  const raw = block && block.type === "text" ? block.text.trim() : "";

  // Extract optional `>>> N` pointer to the chosen hit.
  let suggestedHref: string | null = null;
  let summary = raw;
  const m = raw.match(/\s*>>>\s*(\d+)\s*$/);
  if (m) {
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < rawHits.length) {
      suggestedHref = rawHits[idx]?.href || null;
    }
    summary = raw.replace(/\s*>>>\s*\d+\s*$/, "").trim();
  }

  return jsonSuccess({
    summary: summary || "Couldn't summarise — showing raw hits.",
    suggestedHref,
  });
}
