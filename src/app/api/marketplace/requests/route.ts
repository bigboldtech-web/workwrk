// POST /api/marketplace/requests { text, notify? }  "Suggest an app"
// GET  /api/marketplace/requests                    Owner and Admin: the
//      suggestions and their count, for Settings > Apps and modules
//
// Every Member may suggest (app key store). A release deployed before the
// AppSuggestion table exists answers a named 503 on write and an empty list
// on read.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";

const bodySchema = z.object({
  text: z.string().trim().min(3, "Say a little more").max(2000),
  // Stored for a later "tell me when it exists" mail. Nothing sends that mail
  // yet, so the dialogs no longer offer the switch and the default is false:
  // no row claims an opt-in the person was never asked for.
  notify: z.boolean().optional(),
});

function tableMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /does not exist|42P01|P2021/.test(msg);
}

export async function POST(req: Request) {
  const gate = await requireApp("store");
  if ("error" in gate) return gate.error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body", issues: parsed.error.issues }, { status: 400 });
  try {
    const row = await prisma.appSuggestion.create({
      data: { organizationId: gate.viewer.organizationId, userId: gate.viewer.userId, text: parsed.data.text, notify: parsed.data.notify ?? false },
      select: { id: true, createdAt: true },
    });
    return NextResponse.json({ suggestion: row }, { status: 201 });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ error: "Suggestions are not available yet. Try again after the update." }, { status: 503 });
    throw e;
  }
}

export async function GET() {
  const gate = await requireApp("store");
  if ("error" in gate) return gate.error;
  if (!isOwnerOrAdmin(gate.viewer)) return NextResponse.json({ error: "Only workspace Owners and Admins can read suggestions." }, { status: 403 });
  try {
    const [rows, total] = await Promise.all([
      prisma.appSuggestion.findMany({
        where: { organizationId: gate.viewer.organizationId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, text: true, userId: true, createdAt: true },
      }),
      prisma.appSuggestion.count({ where: { organizationId: gate.viewer.organizationId } }),
    ]);
    return NextResponse.json({ suggestions: rows, total });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ suggestions: [], total: 0 });
    throw e;
  }
}
