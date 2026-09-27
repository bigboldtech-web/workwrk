// POST /api/build/apps/[slug]/rows, append a row (it gets a stable __id)
// PATCH { id | index, row } update one row; { ids[], row } several in one request
// DELETE { id | index } delete one row; { ids[] } several in one request
//
// ROW IDENTITY (spec-tools-misc 2.4). A row used to be addressed only by its
// position, so two people editing at once could change each other's rows.
// Every row appended now carries a `__id`; rows written before this have
// none and are still reachable by index (their id on screen is the index),
// and the first PATCH that touches such a row gives it an id.
//
// Rows are stored inline in App.ui.rows JSON. This keeps the build
// flow simple (no separate row table); the tradeoff is row counts are
// bounded by JSON document size. For Vibe-style apps that's fine
// the goal is fast iteration, not 100k-row production scale.
//
// NO LOST UPDATES. Every write reads App.ui, changes one row and writes the
// whole JSON back, so two writes racing (the page's bulk edit fires one
// PATCH per selected row in parallel; two quick cell edits do the same)
// used to each answer 200 while only the last one survived. Each write now
// runs in a transaction that takes the App row's lock (SELECT ... FOR
// UPDATE) and reads ui AFTER the lock, so concurrent writes queue on the
// row and every one of them lands.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAppScope, requireBuildViewer } from "@/lib/build/gate";
import { z } from "zod";

async function ctxAndApp(slug: string) {
  // Owner and Admin, or a Member of an org with live apps (requireBuildViewer,
  // the Member exception: rows stay usable by the people who used them
  // before). An archived app is read only until it is restored.
  const c = await requireBuildViewer();
  if ("error" in c) return { error: c.error };
  const app = await prisma.app.findFirst({
    where: { ...buildAppScope(c), slug, status: { not: "ARCHIVED" } },
    select: { id: true },
  });
  if (!app) return { error: NextResponse.json({ error: "app not found" }, { status: 404 }) };
  return { userId: c.userId, app };
}

type RowsResult = { ok: true; rows: Record<string, unknown>[]; body: Record<string, unknown> } | { ok: false; status: number; error: string };

/**
 * Lock the app row, re-read its ui, apply `change` to the fresh rows and
 * write them back, all inside one transaction.
 */
async function mutateRows(
  appId: string,
  change: (rows: Record<string, unknown>[]) => RowsResult,
): Promise<NextResponse> {
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "App" WHERE id = ${appId} FOR UPDATE`;
    const fresh = await tx.app.findUnique({ where: { id: appId }, select: { ui: true, status: true } });
    if (!fresh || fresh.status === "ARCHIVED") return { ok: false as const, status: 404, error: "app not found" };
    const result = change(rowsFromUi(fresh.ui));
    if (!result.ok) return result;
    await tx.app.update({
      where: { id: appId },
      data: { ui: { ...((fresh.ui as object) ?? {}), rows: result.rows } as object },
    });
    return result;
  });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out.body);
}

function rowsFromUi(ui: unknown): Record<string, unknown>[] {
  if (!ui || typeof ui !== "object") return [];
  const obj = ui as Record<string, unknown>;
  const r = obj.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function newRowId(): string {
  return `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The index of the row a client named, by id or by position. */
function locate(rows: Record<string, unknown>[], ref: { id?: string; index?: number }): number {
  if (ref.id !== undefined) {
    const byId = rows.findIndex((r) => r.__id === ref.id);
    if (byId >= 0) return byId;
    // A legacy row's id on screen is its index.
    const n = Number(ref.id);
    if (/^\d+$/.test(ref.id) && n < rows.length && rows[n].__id === undefined) return n;
    return -1;
  }
  return ref.index !== undefined && ref.index < rows.length ? ref.index : -1;
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

  return mutateRows(c.app.id, (rows) => {
    // Soft cap: refuse to store > 500 rows in the JSON blob. Past that
    // the app should graduate to a real Board.
    if (rows.length + 1 > 500) {
      return { ok: false, status: 413, error: "Row limit reached (500). Promote this app to a real board to keep adding rows." };
    }
    const id = newRowId();
    rows.push({ ...parsed.data.row, __id: id, __createdAt: new Date().toISOString(), __createdById: c.userId });
    return { ok: true, rows, body: { ok: true, rowCount: rows.length, id } };
  });
}

const updateSchema = z.object({
  id: z.string().min(1).optional(),
  index: z.number().int().min(0).optional(),
  ids: z.array(z.string().min(1)).min(1).max(500).optional(),
  row: z.record(z.string(), z.unknown()),
}).refine((b) => b.id !== undefined || b.index !== undefined || b.ids !== undefined, { message: "name a row" });

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctxAndApp(slug);
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { row, ids } = parsed.data;
  // The system fields are the server's.
  delete row.__id; delete row.__createdAt; delete row.__createdById;

  return mutateRows(c.app.id, (rows) => {
    // A repeated id is one row, not one row and one failure.
    const refs = ids ? [...new Set(ids)].map((id) => ({ id })) : [{ id: parsed.data.id, index: parsed.data.index }];
    const stamp = new Date().toISOString();
    let changed = 0;
    for (const ref of refs) {
      const i = locate(rows, ref);
      if (i < 0) { if (!ids) return { ok: false, status: 400, error: "row not found" }; continue; }
      rows[i] = { ...rows[i], ...row, __id: (rows[i].__id as string | undefined) ?? newRowId(), __updatedAt: stamp };
      changed++;
    }
    return { ok: true, rows, body: { ok: true, changed, failed: refs.length - changed } };
  });
}

const deleteSchema = z.object({
  id: z.string().min(1).optional(),
  index: z.number().int().min(0).optional(),
  ids: z.array(z.string().min(1)).min(1).max(500).optional(),
}).refine((b) => b.id !== undefined || b.index !== undefined || b.ids !== undefined, { message: "name a row" });

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctxAndApp(slug);
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { ids } = parsed.data;

  return mutateRows(c.app.id, (rows) => {
    // A repeated id is one row, not one row and one failure.
    const refs = ids ? [...new Set(ids)].map((id) => ({ id })) : [{ id: parsed.data.id, index: parsed.data.index }];
    // Resolve every index first, then splice from the highest down, so one
    // delete never shifts the next.
    const idx = refs.map((ref) => locate(rows, ref));
    if (!ids && idx[0] < 0) return { ok: false, status: 400, error: "row not found" };
    const found = [...new Set(idx.filter((i) => i >= 0))].sort((a, b) => b - a);
    for (const i of found) rows.splice(i, 1);
    return { ok: true, rows, body: { ok: true, deleted: found.length, failed: refs.length - found.length } };
  });
}
