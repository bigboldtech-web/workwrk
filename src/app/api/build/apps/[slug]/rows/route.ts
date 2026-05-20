// POST /api/build/apps/[slug]/rows — append a row
// PATCH — update a row by index
// DELETE — delete a row by index
//
// Rows are stored inline in App.ui.rows JSON. This keeps the build
// flow simple (no separate row table); the tradeoff is row counts are
// bounded by JSON document size. For Vibe-style apps that's fine —
// the goal is fast iteration, not 100k-row production scale.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctxAndApp(slug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };

  const app = await prisma.app.findFirst({
    where: { organizationId: user.organizationId, slug, status: { not: "ARCHIVED" } },
  });
  if (!app) return { error: NextResponse.json({ error: "app not found" }, { status: 404 }) };
  return { userId, app };
}

function rowsFromUi(ui: unknown): Record<string, unknown>[] {
  if (!ui || typeof ui !== "object") return [];
  const obj = ui as Record<string, unknown>;
  const r = obj.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

const appendSchema = z.object({
  row: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctxAndApp(slug);
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = appendSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const rows = rowsFromUi(c.app.ui);
  rows.push({ ...parsed.data.row, __createdAt: new Date().toISOString(), __createdById: c.userId });
  // Soft cap: refuse to store > 500 rows in the JSON blob. Past that
  // the app should graduate to a real Board.
  if (rows.length > 500) {
    return NextResponse.json({ error: "Row limit reached (500). Promote this app to a real board to keep adding rows." }, { status: 413 });
  }

  await prisma.app.update({
    where: { id: c.app.id },
    data: { ui: { ...((c.app.ui as object) ?? {}), rows } as object },
  });
  return NextResponse.json({ ok: true, rowCount: rows.length });
}

const updateSchema = z.object({
  index: z.number().int().min(0),
  row: z.record(z.string(), z.unknown()),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctxAndApp(slug);
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const rows = rowsFromUi(c.app.ui);
  if (parsed.data.index >= rows.length) return NextResponse.json({ error: "index out of range" }, { status: 400 });

  rows[parsed.data.index] = { ...rows[parsed.data.index], ...parsed.data.row, __updatedAt: new Date().toISOString() };
  await prisma.app.update({
    where: { id: c.app.id },
    data: { ui: { ...((c.app.ui as object) ?? {}), rows } as object },
  });
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ index: z.number().int().min(0) });

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctxAndApp(slug);
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const rows = rowsFromUi(c.app.ui);
  if (parsed.data.index >= rows.length) return NextResponse.json({ error: "index out of range" }, { status: 400 });
  rows.splice(parsed.data.index, 1);
  await prisma.app.update({
    where: { id: c.app.id },
    data: { ui: { ...((c.app.ui as object) ?? {}), rows } as object },
  });
  return NextResponse.json({ ok: true });
}
