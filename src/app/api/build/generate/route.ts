// POST /api/build/generate
//
// Body: { prompt }
//
// Sends the prompt to Claude with a strict JSON-only schema-generator
// prompt. Returns the generated app structure WITHOUT persisting it —
// the user reviews/edits + then POSTs to /api/build/apps to save.

import { NextResponse } from "next/server";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const MODEL = "claude-sonnet-4-6";

const inputSchema = z.object({
  prompt: z.string().min(8).max(2000),
});

const SYSTEM_PROMPT = `You generate mini-app schemas for WorkwrK Build (a Vibe-style "describe an app, get an app" generator inside a Work OS).

Given a prompt, return STRICT JSON (no markdown, no commentary) with this shape:

{
  "name": "Short app name (≤ 40 chars)",
  "slug": "kebab-case-slug",
  "description": "1-sentence summary",
  "iconKey": "Lucide icon name — pick one that fits (e.g. ClipboardList, Receipt, Map, TrendingUp, Bug, Sparkles)",
  "hue": "violet | blue | green | amber | pink | teal | sky | rose | lime | slate",
  "fields": [
    {
      "key": "snake_case_machine_name",
      "label": "Human label",
      "fieldType": "TEXT | TEXTAREA | NUMBER | DATE | CHECKBOX | SELECT | MULTI_SELECT | URL | EMAIL",
      "options": { "choices": [{ "value": "a", "label": "A" }, ...] }   // ONLY for SELECT/MULTI_SELECT
    }
  ],
  "sampleRows": [
    { "field_key_1": "value", "field_key_2": "value", ... }
    // 3 realistic sample rows so the user immediately sees what the app looks like populated
  ]
}

Rules:
- 4-8 fields is the sweet spot. Don't generate kitchen-sink schemas.
- The first field should be a TEXT field that acts as the "title" of each row (name, subject, etc.).
- Include at least one SELECT field (status, category, priority — whichever fits).
- sampleRows MUST use the field keys exactly. Don't invent extra keys.
- iconKey must be a real Lucide React icon name.
- Output ONLY the JSON, no surrounding text.`;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "no organization" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const resolved = await getAnthropicForOrg(user.organizationId);
  const model = modelFor(resolved, MODEL);

  try {
    const result = await resolved.client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: parsed.data.prompt }],
    });

    const text = result.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n")
      .trim();

    let generated: unknown = null;
    try {
      generated = JSON.parse(text);
    } catch {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try { generated = JSON.parse(text.slice(first, last + 1)); } catch { /* give up */ }
      }
    }

    return NextResponse.json({
      app: generated,
      rawText: generated ? null : text,
      tokensIn: result.usage?.input_tokens ?? 0,
      tokensOut: result.usage?.output_tokens ?? 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Claude request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
