// GET /api/build/apps/[slug]: load the app and its rows. An archived app
//   opens too (read only), so Show archived leads somewhere and it can be
//   restored.
// PATCH: rename, change the description, archive ({ status: "ARCHIVED" }) or
//   restore ({ status: "PUBLISHED" }) an app, or replace its field list
//   ({ fields }, the Edit fields modal). Rows are never touched by a field
//   change: a row keeps every value it holds under the old keys, so a field
//   removed by mistake comes back with its values when it is added again
//   under the same key.
// DELETE: to Trash (spec-tools-misc 2.12), a TrashItem snapshot with its
//   rows, restorable for the retention window. Archiving is the PATCH above.
// GET: Owner and Admin over the org's apps; a Member over the org's live apps
// and their own (the Member exception, src/lib/build/gate.ts). PATCH and
// DELETE: Owner and Admin, or the app's creator; anyone else gets 403.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAppScope, canManageBuildApp, requireBuildViewer } from "@/lib/build/gate";
import { moveToTrash } from "@/lib/trash";
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

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key"),
  label: z.string().trim().min(1).max(80),
  fieldType: z.enum(["TEXT", "TEXTAREA", "NUMBER", "DATE", "CHECKBOX", "SELECT", "MULTI_SELECT", "URL", "EMAIL"]),
  options: z.unknown().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  // Archive, or restore an archived app. Delete (to Trash) is DELETE.
  status: z.enum(["PUBLISHED", "ARCHIVED"]).optional(),
  fields: z.array(fieldSchema).min(1).max(20).optional(),
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
  if (parsed.data.fields && new Set(parsed.data.fields.map((f) => f.key)).size !== parsed.data.fields.length) {
    return NextResponse.json({ error: "Two fields share a key." }, { status: 400 });
  }

  const existingSchema = existing.schema && typeof existing.schema === "object" && !Array.isArray(existing.schema)
    ? (existing.schema as Record<string, unknown>)
    : {};
  const app = await prisma.app.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.fields ? { schema: { ...existingSchema, fields: parsed.data.fields } as object } : {}),
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
  const actor = await prisma.user.findUnique({ where: { id: c.userId }, select: { firstName: true, lastName: true } });
  const userName = [actor?.firstName, actor?.lastName].filter(Boolean).join(" ") || null;
  await moveToTrash("app", existing.id, { organizationId: c.orgId, userId: c.userId, userName });
  return NextResponse.json({ ok: true, trashed: true });
}
