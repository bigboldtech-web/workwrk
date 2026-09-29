// GET /api/build/apps: this org's apps.
//   ?includeArchived=1  archived apps too (the Display menu's Show archived)
//   ?q=                 name or description contains
// POST /api/build/apps: save an app (after the New app modal's preview).
// GET: Owner and Admin over the org; a Member over the org's live apps and
// their own (the Member exception, src/lib/build/gate.ts). POST: Owner and Admin.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAppScope, canManageBuildApp, requireBuild, requireBuildViewer } from "@/lib/build/gate";
import { z } from "zod";

async function ctx() {
  return requireBuild();
}

export async function GET(req: Request) {
  const c = await requireBuildViewer();
  if ("error" in c) return c.error;
  const sp = new URL(req.url).searchParams;
  const includeArchived = sp.get("includeArchived") === "1";
  const q = (sp.get("q") ?? "").trim().slice(0, 200);

  const apps = await prisma.app.findMany({
    where: {
      ...buildAppScope(c),
      ...(includeArchived ? {} : { status: { not: "ARCHIVED" as const } }),
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { description: { contains: q, mode: "insensitive" as const } }] }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      iconKey: true,
      hue: true,
      status: true,
      ui: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  // The row count, not the rows: the list never ships every app's data.
  return NextResponse.json({
    // Whether New app and Generate render: POST and /generate are Owner and Admin.
    canCreate: c.admin,
    apps: apps.map(({ ui, createdById, ...a }) => {
      const rows = ui && typeof ui === "object" && Array.isArray((ui as { rows?: unknown }).rows) ? ((ui as { rows: unknown[] }).rows.length) : 0;
      return { ...a, rowCount: rows, canManage: canManageBuildApp(c, { createdById }) };
    }),
  });
}

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key"),
  label: z.string().min(1).max(80),
  fieldType: z.enum(["TEXT", "TEXTAREA", "NUMBER", "DATE", "CHECKBOX", "SELECT", "MULTI_SELECT", "URL", "EMAIL"]),
  options: z.unknown().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case"),
  description: z.string().max(400).optional(),
  iconKey: z.string().max(40).optional(),
  hue: z.string().max(20).optional(),
  prompt: z.string().max(2000).optional(),
  fields: z.array(fieldSchema).min(1).max(20),
  sampleRows: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });

  try {
    const app = await prisma.app.create({
      data: {
        organizationId: c.orgId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description,
        iconKey: parsed.data.iconKey,
        hue: parsed.data.hue,
        prompt: parsed.data.prompt,
        schema: { fields: parsed.data.fields } as object,
        // sampleRows seeded into ui.rows so the new app is populated.
        ui: { rows: parsed.data.sampleRows ?? [] } as object,
        status: "PUBLISHED",
        createdById: c.userId,
      },
      select: { id: true, slug: true, name: true, status: true },
    });
    return NextResponse.json({ app });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return NextResponse.json({ error: "slug already exists" }, { status: 409 });
    }
    throw e;
  }
}
