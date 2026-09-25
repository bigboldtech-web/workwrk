// PATCH  /api/boards/[id]/views/[viewId]: rename, re-order, re-config, and
//        pin or unpin the view as the List's default ({ isDefault })
// DELETE /api/boards/[id]/views/[viewId]: remove (cannot delete the last
//        view; the UI hides that case)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { getSpaceForReader } from "@/lib/space";
import { canContributeBoard, canEditBoard } from "@/lib/board";
import { canSaveView, canManageView } from "@/lib/work/view-visibility";
import {
  carryPinnedDefault,
  countsAsPinnedDefault,
  readPinnedDefault,
  withPinnedDefault,
  withoutPinnedDefault,
  PIN_DENIED,
  PIN_PRIVATE_DENIED,
  PINNED_PRIVATE_DENIED,
  UNPIN_STALE,
} from "@/lib/work/default-view";
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
  // The body is read before the save gate so a refused PIN answers with the
  // pin's own sentence rather than the generic one; every write still passes
  // canSaveView below before anything is written.
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // PIN AND UNPIN NEED CAN EDIT ON THE LIST (the contribute ladder), with no
  // owner exception. A pin changes what EVERYONE on the List opens first, so
  // it is a List-wide control. Decided on the worst case (founder,
  // 2026-09-25: plan by the worst case of every situation): with the old
  // "Set as default" gate, a person whose access was lowered on purpose
  // could still re-point the whole List at their own view, and nobody else
  // could tell why the List opened there. With this gate the worst case is
  // small: that person keeps their view and can still open it by its link.
  // They lose only a control over other people. The pin's own sentence
  // answers a refusal, ahead of the generic save refusal below.
  if (parsed.data.isDefault !== undefined && !gate.canContribute) {
    return NextResponse.json({ error: PIN_DENIED }, { status: 403 });
  }
  if (!canSaveView(gate.view, c.userId, gate.canContribute)) {
    return NextResponse.json({ error: SAVE_DENIED }, { status: 403 });
  }
  // A private view cannot be the default of a Space List: the rest of the
  // List cannot see it, so their first tab and the bare URL would disagree
  // with the owner's. The EFFECTIVE privacy is what counts (the body may flip
  // it in the same request), and it is read again on the locked row below.
  // A space-less List (the Personal list) has one reader, so it is exempt.
  const spaceList = !!gate.view.board.spaceId;
  const makesPrivate = parsed.data.isShared === false;
  if (
    parsed.data.isDefault === true &&
    spaceList &&
    !((parsed.data.isShared ?? gate.view.isShared) || gate.view.ownerId === null)
  ) {
    return NextResponse.json({ error: PIN_PRIVATE_DENIED }, { status: 409 });
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

  const data: Record<string, unknown> = { ...parsed.data };
  // configPatch is not a column: it is merged into config on the locked row.
  delete data.configPatch;
  // A pin is written by the pin branch alone, so no config or configPatch the
  // client sends may carry one in (or out): the stored mark is carried below.
  if (parsed.data.config !== undefined) data.config = withoutPinnedDefault(normalise(parsed.data.config)) as object;
  const configPatch = parsed.data.configPatch ? withoutPinnedDefault(parsed.data.configPatch) : undefined;

  type Refusal = { status: number; error: string };
  type LockedRow = { config: unknown; isShared: boolean; ownerId: string | null; isDefault: boolean; type: string };
  const lockedRow = async (tx: Prisma.TransactionClient): Promise<LockedRow | null> => {
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT config, "isShared", "ownerId", "isDefault", type::text AS type
      FROM "View" WHERE id = ${viewId} FOR UPDATE`;
    return rows[0] ?? null;
  };
  // The config the write is based on: the one sent, else the stored one,
  // with a configPatch merged on top (a null in the patch deletes that key).
  const composeConfig = (row: LockedRow): unknown => {
    const base = parsed.data.config !== undefined ? data.config : row.config;
    return configPatch ? mergeJsonObject(base, normalise(configPatch, true)) : base;
  };
  // ONE advisory lock per List serialises every write that can change which
  // view is the default. Under READ COMMITTED an UPDATE re-checks only the
  // rows that matched its first snapshot, so two concurrent pins could each
  // clear the old default and both mark themselves. $executeRaw, not
  // $queryRaw: pg_advisory_xact_lock returns void, which the query
  // deserializer refuses.
  const defaultLock = (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`view-default:${id}`}))`;
  // Every other view of the List loses the default flag AND the mark, so
  // neither a stale flag nor a leftover mark can resolve as a second default.
  const clearOthers = (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`
      UPDATE "View" SET "isDefault" = false,
        "config" = CASE WHEN jsonb_typeof("config") = 'object' THEN "config" - 'pinned' ELSE "config" END,
        "updatedAt" = NOW()
      WHERE "boardId" = ${id} AND "id" <> ${viewId}
        AND ("isDefault" = true OR ("config" -> 'pinned') IS NOT NULL)`;

  let refusal: Refusal | null = null;
  if (parsed.data.isDefault) {
    // PIN: this view becomes the List's default, marked with who and when.
    refusal = await prisma.$transaction(async (tx): Promise<Refusal | null> => {
      await defaultLock(tx);
      const row = await lockedRow(tx);
      if (!row) return { status: 404, error: "Not found" };
      if (spaceList && !((parsed.data.isShared ?? row.isShared) || row.ownerId === null)) {
        return { status: 409, error: PIN_PRIVATE_DENIED };
      }
      await clearOthers(tx);
      data.config = withPinnedDefault(composeConfig(row), { byId: c.userId, at: new Date().toISOString() }) as object;
      await tx.view.update({ where: { id: viewId }, data });
      return null;
    });
  } else if (parsed.data.isDefault === false || makesPrivate || parsed.data.config !== undefined || configPatch) {
    // UNPIN, MAKE PRIVATE, or a CONFIG WRITE. Every renderer PATCHes the
    // config it mounted with (board-canvas, board-table-view, calendar,
    // gantt, doc, form, chart, pivot, workload, whiteboard), so a config
    // write goes through the locked row and carries the STORED mark: without
    // that, a tab opened before a pin would drop it and a tab opened before
    // an unpin would bring it back. The row lock also serialises a config
    // write with a pin's sibling UPDATE.
    refusal = await prisma.$transaction(async (tx): Promise<Refusal | null> => {
      if (parsed.data.isDefault === false || makesPrivate) await defaultLock(tx);
      const row = await lockedRow(tx);
      if (!row) return { status: 404, error: "Not found" };
      const nextConfig =
        parsed.data.config !== undefined || configPatch ? carryPinnedDefault(composeConfig(row), row.config) : row.config;
      // The pinned default cannot go private (review #31), judged on the view
      // as this write leaves it. An ownerless legacy row stays visible to
      // everyone whatever its flag says, so it is not refused.
      if (makesPrivate && spaceList && parsed.data.isDefault !== false && row.ownerId !== null && row.isDefault) {
        // Whether an unmarked plain Board is a pin depends on the List's
        // other Boards, so the siblings are read under the same lock.
        const siblings = await tx.view.findMany({
          where: { boardId: id },
          select: { id: true, isDefault: true, type: true, config: true, isShared: true, ownerId: true, displayOrder: true },
        });
        const self = siblings.find((v) => v.id === viewId);
        const leaving = {
          id: viewId,
          isDefault: row.isDefault,
          type: parsed.data.type ?? row.type,
          config: nextConfig,
          isShared: row.isShared,
          ownerId: row.ownerId,
          displayOrder: self?.displayOrder ?? 0,
        };
        const all = [...siblings.filter((v) => v.id !== viewId), leaving];
        if (countsAsPinnedDefault(leaving, all)) return { status: 409, error: PINNED_PRIVATE_DENIED };
      }
      if (parsed.data.isDefault === false && !row.isDefault && readPinnedDefault(row.config) === null) {
        // A STALE UNPIN. The strip is not realtime: a tab that still shows
        // this view as the pin may be unpinning after someone else pinned
        // another view, which already cleared this one. Sweeping the List now
        // would erase that newer pin, so the write is refused instead.
        return { status: 409, error: UNPIN_STALE };
      }
      if (parsed.data.isDefault === false) {
        // Unpin clears the WHOLE List, so no pin a race or a legacy row left
        // behind can surface as the default once this one is gone.
        await clearOthers(tx);
        data.config = withoutPinnedDefault(composeConfig(row)) as object;
      } else if (parsed.data.config !== undefined || configPatch) {
        data.config = nextConfig as object;
      }
      await tx.view.update({ where: { id: viewId }, data });
      return null;
    });
  } else {
    await prisma.view.update({ where: { id: viewId }, data });
  }
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
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
