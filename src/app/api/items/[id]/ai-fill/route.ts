// POST /api/items/[id]/ai-fill   { fieldKey, contextBoardId?, onlyIfEmpty? }
//
// Fill with AI (Batch 8, competitor-gap 18): one AI field on one task, filled
// now, as the caller. Fill empty rows on a column is this route once per row
// with `onlyIfEmpty`, so it never replaces a value that is there.
//
// The doors, in order: the `ai` app (401 signed out, 404 for a Guest, 403
// app_off when AI is off or the app is hidden), the workspace's opt-in
// ("AI fields in Lists", 403 ai_fields_off), then src/lib/ai-fields-server.ts:
// the task (edit), the List the value belongs to, the field, the daily cap
// (429 ai_daily_limit), the model, one write.
//
// Answers { value } (the stored AI value), or { skipped: "has_value" }; 409
// { error: "changed" } when the stored value is not the one the person saw.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { itemCtx, itemServerError } from "@/lib/item-gate";
import { fillAiField, orgAiFieldsState } from "@/lib/ai-fields-server";

const bodySchema = z.object({
  fieldKey: z.string().min(1).max(80),
  contextBoardId: z.string().min(1).max(64).nullable().optional(),
  onlyIfEmpty: z.boolean().optional(),
  // The value the person is looking at (null for an empty cell): the fill
  // replaces exactly that, or nothing.
  expect: z.unknown().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const app = await requireApp("ai");
  if ("error" in app) return app.error;
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  try {
    const org = await orgAiFieldsState(c.organizationId);
    if (!org.on) return NextResponse.json({ error: "ai_fields_off" }, { status: 403 });
    return await fillAiField({
      itemId: id,
      c,
      fieldKey: parsed.data.fieldKey,
      contextBoardId: parsed.data.contextBoardId ?? null,
      onlyIfEmpty: parsed.data.onlyIfEmpty === true,
      expect: parsed.data && "expect" in parsed.data ? { value: parsed.data.expect ?? null } : null,
      plan: org.plan,
      createdAt: org.createdAt,
    });
  } catch (err) {
    return itemServerError(err, `POST /api/items/${id}/ai-fill`);
  }
}
