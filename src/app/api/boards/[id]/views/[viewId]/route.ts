// PATCH  /api/boards/[id]/views/[viewId] — rename / re-order / re-config
// DELETE /api/boards/[id]/views/[viewId] — remove (cannot delete the
//        last view; UI should disable that case)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { getSpaceForReader } from "@/lib/space";
import { canContributeBoard, canEditBoard } from "@/lib/board";
import { canSaveView, canManageView } from "@/lib/work/view-visibility";
import { prisma } from "@/lib/prisma";
import { mergeJsonObject, parseViewComfort } from "@/lib/list-comfort";
import type { Prisma } from "@/generated/prisma";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

async function loadGate(boardId: string, viewId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const view = await prisma.view.findUnique({
    where: { id: viewId },
    include: { board: { select: { spaceId: true, organizationId: true, id: true, ownerId: true } } },
  });
  // Saving a view and deleting a view are two different questions, so this
  // returns two flags and lets each handler ask its own. `canContribute` is
  // the CONTENT ladder (any non-guest Space or Board member): it replaces the
  // single `canEditSpace` read that used to gate both, which meant a Space
  // member who may create every task on a List still got a 403 when they
  // renamed a tab or saved a filter on it. `canManage` stays the management
  // ladder, because removing a SHARED view destroys other people's saved work.
  if (!view || view.boardId !== boardId || view.board.organizationId !== c.organizationId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  // A SPACE-LESS BOARD IS SOMEBODY'S OWN LIST. `!view.board.spaceId -> 404`
  // meant every rename, reorder and delete of a view on the Personal List
  // (/my-work/personal, which renders these very tabs) answered 404 and was
  // swallowed: the control was rendered and could not work.
  if (!view.board.spaceId) {
    if (view.board.ownerId !== c.userId) {
      return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    }
    return { view, canContribute: true, canManage: true };
  }
  const space = await getSpaceForReader(view.board.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  // spec-spaces-lists section 1 (Saved-view "…"): "Full access holders AND the
  // view's owner". The owner branch is why each gate is an OR and not just the
  // board check: a person who made a private view on a List they can read
  // could not rename or delete their OWN view.
  const [canContribute, canManage] = await Promise.all([
    canContributeBoard(view.board.id, c.userId, c.accessLevel),
    canEditBoard(view.board.id, c.userId, c.accessLevel),
  ]);
  return { view, canContribute, canManage };
}

/** The one sentence a refused caller gets, so the 403 is not a dead end. */
const SAVE_DENIED =
  "You can read this List but not change its views. Ask a List or Space admin for Can edit access.";
const DELETE_DENIED =
  "Deleting a shared view needs full access on this List. Ask a List or Space admin, or make the view private to yourself instead.";

const VIEW_TYPES = [
  "TABLE", "KANBAN", "GANTT", "CALENDAR", "TIMELINE", "CHART", "DOC", "FORM",
  "DASHBOARD", "MAP", "WORKLOAD", "WHITEBOARD", "FILE_GALLERY",
  "CARDS", "PIVOT", "HIERARCHY", "ACTIVITY",
] as const;

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  displayOrder: z.number().int().min(0).max(1_000_000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  // Phase 5b: a shallow merge over the STORED config (null deletes a key), on
  // the row read FOR UPDATE, so two tabs saving different keys (a filter here,
  // a pinned column there) stop clobbering each other. Wholesale `config`
  // keeps working unchanged.
  configPatch: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  /** The view-type switcher: a view is a named filter, its type is how it draws. */
  type: z.enum(VIEW_TYPES).optional(),
  /** The saved-view menu's "Private view / Shared view" toggle. */
  isShared: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; viewId: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, viewId } = await params;
  const gate = await loadGate(id, viewId, c);
  if ("error" in gate) return gate.error;
  if (!canSaveView(gate.view, c.userId, gate.canContribute)) {
    return NextResponse.json({ error: SAVE_DENIED }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // Pinned (frozen) columns and row height, per view, wherever they arrive:
  // normalised, and a wrong value is refused by name.
  const comfort: Record<string, unknown> = {};
  for (const blob of [parsed.data.config, parsed.data.configPatch]) {
    if (!blob) continue;
    const v = parseViewComfort(blob);
    if (!v.ok) return NextResponse.json({ error: "invalid_view_config", key: v.key }, { status: 400 });
    Object.assign(comfort, v.value);
  }
  // A whole config drops a nulled key; a patch keeps the null, which is how
  // mergeJsonObject knows to delete the stored one.
  const normalise = (cfg: Record<string, unknown>, keepNull = false) => {
    const out = { ...cfg };
    for (const [k, v] of Object.entries(comfort)) {
      if (!(k in cfg)) continue;
      if (v === null && !keepNull) delete out[k];
      else out[k] = v;
    }
    return out;
  };
  // Promoting a view to default? Demote the previous default in the same tx.
  const data: Record<string, unknown> = { ...parsed.data };
  // configPatch is not a column: it is merged into config on the locked row.
  delete data.configPatch;
  if (parsed.data.config !== undefined) data.config = normalise(parsed.data.config) as object;
  const configPatch = parsed.data.configPatch;
  const mergeConfigPatch = async (tx: Prisma.TransactionClient) => {
    if (!configPatch) return;
    const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT config FROM "View" WHERE id = ${viewId} FOR UPDATE`;
    const base = parsed.data.config !== undefined ? data.config : rows[0]?.config;
    data.config = mergeJsonObject(base, normalise(configPatch, true)) as object;
  };
  if (parsed.data.isDefault) {
    await prisma.$transaction(async (tx) => {
      await mergeConfigPatch(tx);
      await tx.view.updateMany({
        where: { boardId: id, isDefault: true, NOT: { id: viewId } },
        data: { isDefault: false },
      });
      await tx.view.update({ where: { id: viewId }, data });
    });
  } else if (configPatch) {
    await prisma.$transaction(async (tx) => {
      await mergeConfigPatch(tx);
      await tx.view.update({ where: { id: viewId }, data });
    });
  } else {
    await prisma.view.update({ where: { id: viewId }, data });
  }
  const updated = await prisma.view.findUnique({ where: { id: viewId } });
  return NextResponse.json({ view: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; viewId: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, viewId } = await params;
  const gate = await loadGate(id, viewId, c);
  if ("error" in gate) return gate.error;
  if (!canManageView(gate.view, c.userId, gate.canManage)) {
    return NextResponse.json({ error: DELETE_DENIED }, { status: 403 });
  }
  const total = await prisma.view.count({ where: { boardId: id } });
  if (total <= 1) {
    return NextResponse.json({ error: "Cannot delete the last view on a board" }, { status: 400 });
  }
  await prisma.view.delete({ where: { id: viewId } });
  return NextResponse.json({ ok: true });
}
