// POST /api/boards/[id]/fields/suggest — AI field-name suggestions.
//
// Given the List's name + its existing field labels, asks Claude for 4-5 new
// custom fields (label + best-fit type) — powers the "AI Suggestions" section
// in the Fields panel. Clones the forms/generate pattern. Fails soft: any AI
// error (no key, plan limit, bad JSON) returns { suggestions: [] } so the UI
// simply hides the section rather than erroring.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditBoard, getBoardForReader } from "@/lib/board";
import { getBoardFields } from "@/lib/board-fields";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { prisma } from "@/lib/prisma";

// Types the suggester may pick — the everyday, real-rendering ones.
const ALLOWED_TYPES = new Set([
  "TEXT", "LONG_TEXT", "NUMBER", "DATE", "DROPDOWN", "MULTI_SELECT",
  "CHECKBOX", "LABELS", "MONEY", "PERCENT", "RATING", "USER", "PEOPLE",
  "URL", "EMAIL", "PHONE",
]);

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const board = await getBoardForReader(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditBoard(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [existing, meta] = await Promise.all([
    getBoardFields(id),
    prisma.board.findUnique({ where: { id }, select: { name: true } }),
  ]);
  const existingLabels = existing.map((f) => f.label);
  const boardName = meta?.name ?? "Untitled list";

  try {
    const { client, preferredModel } = await getAnthropicForOrg(c.organizationId);
    const model = modelFor({ client, source: "shared", preferredModel }, "claude-haiku-4-5");

    const system = `You suggest useful custom FIELDS for a task list in a work-management tool (like ClickUp). Given the list's name and its existing fields, propose 4-5 NEW fields that would genuinely help this specific list. Output ONLY a JSON object — no prose, no markdown fences:
{ "suggestions": [ { "label": "string (≤40 chars)", "type": "TEXT"|"LONG_TEXT"|"NUMBER"|"DATE"|"DROPDOWN"|"MULTI_SELECT"|"CHECKBOX"|"LABELS"|"MONEY"|"PERCENT"|"RATING"|"USER"|"PEOPLE"|"URL"|"EMAIL"|"PHONE" } ] }
Choose the type that best fits each field. Never repeat an existing field. Use specific, plain-language labels.`;

    const msg = await client.messages.create({
      model,
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: `List name: ${boardName}\nExisting fields: ${existingLabels.join(", ") || "(none)"}` }],
    });

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ suggestions: [] });
    const parsed = JSON.parse(match[0]) as { suggestions?: unknown };

    const existingLower = new Set(existingLabels.map((l) => l.toLowerCase()));
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter((s): s is { label: string; type?: string } => !!s && typeof (s as { label?: unknown }).label === "string")
      .map((s) => ({
        label: String(s.label).slice(0, 40).trim(),
        type: s.type && ALLOWED_TYPES.has(String(s.type)) ? String(s.type) : "TEXT",
      }))
      .filter((s) => s.label && !existingLower.has(s.label.toLowerCase()))
      .slice(0, 5);

    return NextResponse.json({ suggestions });
  } catch {
    // No AI key / plan limit / model error → graceful empty; UI hides the section.
    return NextResponse.json({ suggestions: [] });
  }
}
