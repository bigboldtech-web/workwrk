// POST /api/notetaker/process
//
// Body: { transcript, hint? }
//
// Sends the transcript to Claude with a structured extraction prompt.
// Returns:
//   { summary, decisions: string[], actionItems: [{title, assigneeName, deadlineDays?}],
//     attendees: [{name, email?}] }
//
// This is read-only — it does NOT persist anything. The user reviews
// the extraction in the UI, edits as needed, then POSTs to /save.

import { NextResponse } from "next/server";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const MODEL = "claude-sonnet-4-6";

const inputSchema = z.object({
  transcript: z.string().min(20).max(120000),
  hint: z.string().max(500).optional(),
});

const SYSTEM_PROMPT = `You extract structured meeting summaries from raw transcripts.

Given a transcript, return STRICT JSON with this shape (no markdown, no commentary, just the JSON):

{
  "title": "Short title for the meeting (≤ 60 chars)",
  "type": "DAILY_STANDUP | WEEKLY_REVIEW | ONE_ON_ONE | QUARTERLY_REVIEW | ANNUAL_PLANNING | ADHOC",
  "summary": "2-4 sentence summary of what happened",
  "decisions": ["Decision 1", "Decision 2", ...],
  "actionItems": [
    {
      "title": "What needs to be done",
      "assigneeName": "Who's doing it (use exactly the name as it appears in the transcript)",
      "assigneeEmail": "their email if mentioned, else null",
      "deadlineDays": 7 // null if no deadline mentioned, else integer days from now
    }
  ],
  "attendees": [
    { "name": "Full name", "email": "email@example.com if mentioned" }
  ]
}

Rules:
- decisions should be short, factual. Skip discussion that didn't resolve.
- actionItems must have an assigneeName. If the transcript doesn't say who, infer the most likely person from context, or default to "the team".
- If something was discussed but no decision made, skip it.
- Be conservative — don't invent decisions or owners that weren't really in the transcript.
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
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });

  const resolved = await getAnthropicForOrg(user.organizationId);
  const model = modelFor(resolved, MODEL);

  const userMessage = parsed.data.hint
    ? `Hint: ${parsed.data.hint}\n\n--- TRANSCRIPT ---\n${parsed.data.transcript}`
    : parsed.data.transcript;

  try {
    const result = await resolved.client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = result.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n")
      .trim();

    // The model usually returns clean JSON; if not, try to grab the
    // first {…} block. Be defensive — never throw if extraction fails;
    // just return the raw text so the user can see what came back.
    let extracted: unknown = null;
    try {
      extracted = JSON.parse(text);
    } catch {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          extracted = JSON.parse(text.slice(first, last + 1));
        } catch {
          // give up, return raw
        }
      }
    }

    return NextResponse.json({
      extraction: extracted,
      rawText: extracted ? null : text,
      tokensIn: result.usage?.input_tokens ?? 0,
      tokensOut: result.usage?.output_tokens ?? 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Claude request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
