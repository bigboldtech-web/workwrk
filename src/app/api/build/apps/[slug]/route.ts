// GET /api/build/apps/[slug]: load the app and its rows. An archived app
//   opens too (read only), so Show archived leads somewhere and it can be
//   restored.
// PATCH: rename, change the description, or restore ({ status: "PUBLISHED" }
//   on an archived app).
// DELETE: archive (status ARCHIVED), reversible with the PATCH above.
// GET: Owner and Admin over the org's apps; a Member over the org's live apps
// and their own (the Member exception, src/lib/build/gate.ts). PATCH and
// DELETE: Owner and Admin, or the app's creator; anyone else gets 403.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAppScope, canManageBuildApp, requireBuildViewer } from "@/lib/build/gate";
import { z } from "zod";

async function ctx() {
  return requireBuildViewer();
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;
  const app = await prisma.app.findFirst({
    where: { ...buildAppScope(c), slug },
  });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Whether Archive and Restore render: the PATCH and DELETE below answer 403 otherwise.
  return NextResponse.json({ app, canManage: canManageBuildApp(c, app) });
}

const MANAGE_DENIED = "Only the person who built this app, or an Admin, can change it.";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  // Restore an archived app. Archiving stays DELETE.
  status: z.literal("PUBLISHED").optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;
  const existing = await prisma.app.findFirst({ where: { ...buildAppScope(c), slug } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!canManageBuildApp(c, existing)) return NextResponse.json({ error: MANAGE_DENIED }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const app = await prisma.app.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    },
  });
  return NextResponse.json({ app });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;
  const existing = await prisma.app.findFirst({ where: { ...buildAppScope(c), slug } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!canManageBuildApp(c, existing)) return NextResponse.json({ error: MANAGE_DENIED }, { status: 403 });
  await prisma.app.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
  return NextResponse.json({ ok: true });
}
