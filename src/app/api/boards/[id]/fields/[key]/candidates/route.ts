// GET /api/boards/[id]/fields/[key]/candidates?q=&cursor=&limit=&item=
//
// Phase 5b: the tasks a connect column on List [id] can point at, for its
// picker. The scope is the field's target Lists THE CALLER can read, their
// own tasks and the tasks linked into them (resolveListScope), live and not
// system items, never the task being edited (`item`). A target the caller
// cannot read contributes nothing and is never named; each candidate is
// labelled with the readable target through which it is in scope.
//
// It answers exactly what a save would accept (list-connect-server.ts
// resolveConnectIds applies the same rule), so the picker can never offer a
// task the write refuses.

import { NextResponse } from "next/server";
import { getBoardStatuses, isDoneStatus, makeStatusLookup } from "@/lib/board-items-shared";
import { parseBoardSchema } from "@/lib/field-catalog";
import { itemCtx, itemServerError } from "@/lib/item-gate";
import { isConnectField, connectTargets } from "@/lib/list-connect";
import { contextBoardFor } from "@/lib/list-links";
import { boardForViewer, listReader, resolveListScope } from "@/lib/list-links-server";
import { prisma } from "@/lib/prisma";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

export async function GET(req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id, key } = await params;
  if (!(await boardForViewer(c, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const board = await prisma.board.findFirst({ where: { id, organizationId: c.organizationId }, select: { schema: true } });
    const field = parseBoardSchema(board?.schema).fields.find((f) => f.key === key);
    if (!field || !isConnectField(field)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") ?? "").trim().slice(0, 200);
    const cursor = sp.get("cursor");
    const exclude = sp.get("item");
    const limitRaw = parseInt(sp.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, limitRaw)) : DEFAULT_LIMIT;

    const reader = listReader(c);
    const scope = await resolveListScope(c, connectTargets(field), reader);
    if (scope.lists.length === 0) return NextResponse.json({ items: [], nextCursor: null });
    const scopeIds = new Set(scope.lists.map((l) => l.id));
    const nameOf = new Map(scope.lists.map((l) => [l.id, l.name] as const));

    const rows = await prisma.item.findMany({
      where: {
        AND: [
          scope.where,
          {
            organizationId: c.organizationId,
            archivedAt: null,
            ...NOT_SYSTEM_ITEMS,
            ...(exclude ? { id: { not: exclude } } : {}),
            ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
          },
        ],
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, title: true, status: true, boardId: true, board: { select: { statuses: true } } },
    });
    const page = rows.slice(0, limit);
    const items = page
      .map((r) => {
        const ctx = contextBoardFor(r.boardId, scope.listsByItem.get(r.id) ?? [], scopeIds);
        if (!ctx) return null;
        const statuses = getBoardStatuses(r.board);
        const opt = r.status ? makeStatusLookup(statuses)[r.status] : undefined;
        return {
          id: r.id,
          title: r.title,
          statusLabel: r.status ? opt?.label ?? r.status : null,
          statusColor: opt?.color ?? null,
          done: isDoneStatus(statuses, r.status),
          list: { id: ctx.boardId, name: nameOf.get(ctx.boardId) ?? "" },
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    return NextResponse.json(
      { items, nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return itemServerError(err, `GET /api/boards/${id}/fields/${key}/candidates`);
  }
}
