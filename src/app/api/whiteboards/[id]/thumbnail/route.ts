// POST /api/whiteboards/[id]/thumbnail { dataUrl }
//
// The canvas editor posts a rendered PNG after a save so the gallery has a
// real preview (spec-docs-knowledge section 2, /canvas/[id] Data). A separate
// route from the scene PATCH on purpose: a thumbnail is presentation, and it
// must never ride the save path or touch `updatedAt`'s meaning for the 409
// precondition. A bad payload is a 400, never a silent skip.
//
// Pen test 2026-11-28 (V-17): prisma's @updatedAt bumped Whiteboard.updatedAt
// on this write, so the editor's next save carried a stale expectedUpdatedAt
// and got a 409, and every save after it too: every first-party canvas
// stopped saving seconds after its first edit. The thumbnail is written with
// a single-column UPDATE that leaves updatedAt alone, and it takes Can edit,
// as the scene does (a Can view holder replaced the gallery picture).

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { whiteboardReadable } from "@/lib/whiteboard-gate";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

const MAX_BYTES = 2_000_000;

// The smallest real PNG/JPEG/WebP is a few hundred bytes; a prefix with a
// handful of base64 characters after it is not a picture and would render as
// a broken image in the gallery, so it is refused rather than stored.
const MIN_PAYLOAD_CHARS = 200;
const schema = z.object({
  dataUrl: z.string().max(MAX_BYTES)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .refine((v) => v.length - v.indexOf(",") - 1 >= MIN_PAYLOAD_CHARS, "not an image"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const existing = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
    select: { id: true, spaceId: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const role = await whiteboardReadable(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), existing);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!roleAtLeast(role, "EDIT")) return NextResponse.json({ error: "read-only" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Never prisma.whiteboard.update here: its @updatedAt is the save's precondition.
  await prisma.$executeRaw`UPDATE "Whiteboard" SET "thumbnail" = ${parsed.data.dataUrl} WHERE "id" = ${id}`;
  return NextResponse.json({ ok: true });
}
