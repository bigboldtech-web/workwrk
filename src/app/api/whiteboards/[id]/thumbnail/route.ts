// POST /api/whiteboards/[id]/thumbnail { dataUrl }
//
// The canvas editor posts a rendered PNG after a save so the gallery has a
// real preview (spec-docs-knowledge section 2, /canvas/[id] Data). A separate
// route from the scene PATCH on purpose: a thumbnail is presentation, and it
// must never ride the save path or touch `updatedAt`'s meaning for the 409
// precondition. Same read gate as the scene; a bad payload is a 400, never a
// silent skip.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { getSpaceForReader } from "@/lib/space";

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
  if (existing.spaceId && !(await getSpaceForReader(existing.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await prisma.whiteboard.update({ where: { id }, data: { thumbnail: parsed.data.dataUrl } });
  return NextResponse.json({ ok: true });
}
