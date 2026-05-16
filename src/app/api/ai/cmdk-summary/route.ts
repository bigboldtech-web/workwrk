import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";

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
 *   • hits[] capped at 24 — anything longer is truncated server-side
 *   • response capped at ~180 tokens to keep latency tight
 *   • obeys the org's plan AI quota and BYOK if configured
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const rawHits = Array.isArray(body?.hits) ? body.hits.slice(0, 24) : [];
  if (!query) return jsonError("query is required");

  const orgId = getOrgId(session);
  const planCheck = await checkPlanLimit(orgId, "ai");
  if (!planCheck.allowed) return jsonError(planCheck.message, 403);

  if (rawHits.length === 0) {
    return jsonSuccess({
      summary: "No matches yet — try a person's name, an SOP title, or an entity code.",
      suggestedHref: null,
    });
  }

  const resolved = await getAnthropicForOrg(orgId);
  const ai = resolved.client;
  const model = modelFor(resolved);

  const hitList = rawHits
    .map((h: { title?: string; subtitle?: string; type?: string; href?: string }, i: number) =>
      `${i + 1}. [${h.type ?? "?"}] ${h.title ?? ""}${h.subtitle ? ` — ${h.subtitle}` : ""} → ${h.href ?? ""}`,
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
      suggestedHref = rawHits[idx]?.href ?? null;
    }
    summary = raw.replace(/\s*>>>\s*\d+\s*$/, "").trim();
  }

  return jsonSuccess({
    summary: summary || "Couldn't summarise — showing raw hits.",
    suggestedHref,
  });
}
