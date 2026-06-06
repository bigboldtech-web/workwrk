// POST /api/docs/ai/write
//
// Generic-purpose AI text writer for the Notes block editor's "AI Write"
// block. Takes a free-form prompt + an intent ("tone") and returns a
// short prose block ready to drop into the doc. Uses the org's Claude
// key via `getAnthropicForOrg`, the same wiring as /docs/[id]/summarize.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";

const schema = z.object({
  prompt: z.string().min(2).max(4000),
  tone: z.enum(["expand", "summarise", "rewrite", "actions"]).default("expand"),
});

const SYSTEMS: Record<z.infer<typeof schema>["tone"], string> = {
  expand:
    "You are an AI writing partner inside a team notes app (WorkwrK). Turn the user's brief into a tight, well-organised 3–6 paragraph note. Use clear plain prose. No headings. No bullet points unless the user asks. Don't hedge or pad.",
  summarise:
    "You summarize content for a workspace notes app. Output 3–5 sentences capturing the essential points. Plain prose, no headings, no bullets.",
  rewrite:
    "You are a copy editor. Rewrite the user's text to be tighter, clearer, and more professional — same meaning, fewer words, no hedging. Plain prose. Match the user's voice. No commentary.",
  actions:
    "Extract concrete action items from the user's text. Output a bullet list of imperative phrases (one per line, starting with `- `). Each item begins with a verb. No commentary, no headings.",
};

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("invalid body", 400);
  const { prompt, tone } = parsed.data;

  const resolved = await getAnthropicForOrg(orgId);
  const model = modelFor(resolved, "claude-haiku-4-5");

  try {
    const msg = await resolved.client.messages.create({
      model,
      max_tokens: 800,
      system: SYSTEMS[tone],
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim();
    return jsonSuccess({ text, tone, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return jsonError(`AI request failed: ${message}`, 502);
  }
}
