// GET /api/spaces/[id]/tasks/export.csv: the Space List tab's Export.
//
// Every task the tab's filters match (?sort, ?status, ?owner, ?due, read by
// the same rules as the page, src/lib/work/space-tasks.ts), in the tab's
// order, from the Lists of this Space the viewer can read
// (readableListsInSpace, the one predicate every Space tab uses). The tab
// shows at most 200; the export used to be built in the browser from those
// same 200 rows, so a Space of 2,000 tasks exported 200 and said nothing.
// It reads them all now, up to MAX_ROWS, and a file cut at that ceiling says
// so in its last line rather than passing for the whole Space.
//
// Never for a Guest, an Agent or an acting-as session (access section 9's
// export rule): an export is the one action that takes data out of the
// product.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";
import { itemCtx } from "@/lib/item-gate";
import { spaceForViewer } from "@/lib/list-links-server";
import { readableListsInSpace } from "@/lib/space";
import { prisma } from "@/lib/prisma";
import { csvCell } from "@/lib/trash-view";
import { csvExportCell } from "@/lib/csv";
import { getBoardStatuses, makeStatusLookup } from "@/lib/board-items-shared";
import { parseSpaceListQuery, spaceTasksOrder, spaceTasksWhere } from "@/lib/work/space-tasks";

export const dynamic = "force-dynamic";

const PAGE = 1000;
const MAX_ROWS = 20_000;

/** "IN_REVIEW" -> "In review": a status its List does not declare, made readable. */
function prettyStatus(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
    if (viewer.orgRole === "GUEST" || viewer.isAgent || viewer.actingAs) {
      return jsonError("Exports are not available to guests, agents, or while acting as somebody else.", 403);
    }
    const c = await itemCtx();
    if ("error" in c) return c.error;
    const { id } = await params;
    const space = await spaceForViewer(c, id);
    if (!space) return jsonError("Not found", 404);

    const { lists } = await readableListsInSpace(space.id, c);
    const { sort, filters } = parseSpaceListQuery(new URL(req.url).searchParams);
    // Each row's status in its own List's words, as the tab prints it.
    const statusesOf = new Map(lists.map((l) => [l.id, makeStatusLookup(getBoardStatuses(l))] as const));

    const lines = [["Title", "Status", "List", "Owner", "Updated"].map(csvCell).join(",")];
    let n = 0;
    let cursor: string | null = null;
    let cut = false;
    if (lists.length > 0) {
      const where = spaceTasksWhere(lists.map((l) => l.id), filters);
      const orderBy = spaceTasksOrder(sort);
      const ownerNames = new Map<string, string>();
      const readPage = (after: string | null) =>
        prisma.item.findMany({
          where,
          orderBy,
          take: PAGE,
          ...(after ? { cursor: { id: after }, skip: 1 } : {}),
          select: { id: true, title: true, status: true, ownerId: true, updatedAt: true, boardId: true, board: { select: { name: true } } },
        });
      for (;;) {
        const rows = await readPage(cursor);
        const unknown = [...new Set(rows.map((r) => r.ownerId).filter((o): o is string => !!o && !ownerNames.has(o)))];
        if (unknown.length) {
          const people = await prisma.user.findMany({
            where: { id: { in: unknown }, organizationId: c.organizationId },
            select: { id: true, firstName: true, lastName: true, email: true },
          });
          for (const p of people) ownerNames.set(p.id, [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email);
        }
        for (const r of rows) {
          if (n >= MAX_ROWS) {
            cut = true;
            break;
          }
          const status = r.status ? statusesOf.get(r.boardId)?.[r.status]?.label ?? prettyStatus(r.status) : "";
          lines.push(
            // Titles, List names and people's names are other people's text:
            // a cell starting with = + - @ would run as a formula in Excel,
            // so it goes out as text (csvExportCell, the table exports' rule).
            [r.title, status, r.board?.name ?? "", r.ownerId ? ownerNames.get(r.ownerId) ?? "" : "", r.updatedAt.toISOString()]
              .map((v) => csvCell(csvExportCell(v)))
              .join(","),
          );
          n += 1;
        }
        if (cut || rows.length < PAGE) break;
        cursor = rows[rows.length - 1].id;
      }
    }
    if (cut) lines.push(csvCell(`Cut at ${MAX_ROWS.toLocaleString("en-US")} tasks. Filter the List tab to export the rest.`));

    const day = new Date().toISOString().slice(0, 10);
    return new Response(`${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${space.slug.replace(/[^a-zA-Z0-9_-]/g, "-")}-tasks-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
