// GET /api/spaces/[id]/birdseye: the Bird's eye view of one Space.
//
//   (no list or focus)                        overview: every readable List as a
//                                             column, its first 50 top-level tasks
//   ?list=<boardId>&after=<cursor>            the next 50 of one overview column
//   ?focus=<boardId>                          one List's statuses as columns
//   ?focus=<boardId>&status=<v>&after=<c>     the next 50 of one focus column
//   ?q=<search>&closed=hide                   on every request: title search and
//                                             Hide closed (done or closed statuses)
//
// ONE gate, the Space's, then ONE predicate for the Lists: readableListsInSpace,
// the same answer every other Space tab and the header count use. A List
// outside that set is never a column, a chip or a count, and asking for one by
// id answers `list_not_found` whether it exists or not, so the answer names
// nothing. Every task read after that is src/lib/work/birdseye-server.ts,
// which reads no access at all.
//
// This file never reads the legacy access signal: the session unwrap is the
// item routes' itemCtx and the Space gate is spaceForViewer, both on files the
// access allow-list already carries.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { readableListsInSpace } from "@/lib/space";
import { spaceForViewer } from "@/lib/list-links-server";
import { readListDefaults } from "@/lib/list-comfort";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { newTaskStatus, parseBirdseyeQuery, type BirdseyeBody, type BirdseyeList } from "@/lib/work/birdseye";
import { loadFocus, loadFocusPage, loadListPage, loadOverview, type ListCounts, type LoaderList } from "@/lib/work/birdseye-server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function answer(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * The status a List's own "new task" doors default to, when it stores one.
 * Phase 5b's List comfort (on main) keeps a List's new-task defaults at
 * Board.settings.defaults, so "+ New task" reads the status from exactly
 * there and honours it the day the two branches meet. Nothing on this branch
 * writes it yet, so today every List creates in its first status.
 */
function storedDefaultStatus(settings: unknown): string | null {
  return readListDefaults(settings).status ?? null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) {
    // The shared 401 carries no cache header of its own; this route's
    // answers are never cacheable, the refusal included.
    c.error.headers.set("Cache-Control", "no-store");
    return c.error;
  }
  const { id } = await params;
  try {
    const space = await spaceForViewer(c, id);
    if (!space) return answer({ error: "Not found" }, 404);

    const query = parseBirdseyeQuery(new URL(req.url).searchParams);
    if ("error" in query) return answer({ error: "bad_query" }, 400);

    const { lists: rows } = await readableListsInSpace(space.id, c, { includeSettings: true });
    const filters = { q: query.q, hideClosed: query.hideClosed };
    const loaderLists: LoaderList[] = rows.map((r) => ({ id: r.id, statuses: getBoardStatuses(r) }));
    const byId = new Map(loaderLists.map((l) => [l.id, l]));

    const summarize = (counts: Record<string, ListCounts>): BirdseyeList[] =>
      rows.map((r) => {
        const statuses = byId.get(r.id)?.statuses ?? getBoardStatuses(r);
        const own = counts[r.id];
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          icon: r.icon,
          color: r.color,
          statuses,
          canContribute: r.canContribute,
          newTaskStatus: newTaskStatus(statuses, storedDefaultStatus(r.settings)),
          total: own?.total ?? 0,
          statusCounts: own?.statusCounts ?? {},
        };
      });

    if (query.mode === "overview") {
      const { counts, columns } = await loadOverview(loaderLists, filters, c.organizationId);
      const body: BirdseyeBody = { mode: "overview", lists: summarize(counts), columns };
      return answer(body);
    }

    // Every other mode names a List, and it must be one of the readable set.
    const list = byId.get(query.boardId);
    if (!list) return answer({ error: "list_not_found" }, 404);

    if (query.mode === "list-page") {
      const pageBody = await loadListPage(list, filters, query.cursor, c.organizationId);
      const body: BirdseyeBody = { mode: "list-page", boardId: list.id, ...pageBody };
      return answer(body);
    }
    if (query.mode === "focus") {
      const { counts, columns } = await loadFocus(loaderLists, list, filters, c.organizationId);
      const body: BirdseyeBody = { mode: "focus", lists: summarize(counts), focus: { boardId: list.id, columns } };
      return answer(body);
    }
    const pageBody = await loadFocusPage(list, query.status, filters, query.cursor, c.organizationId);
    const body: BirdseyeBody = { mode: "focus-page", boardId: list.id, status: query.status, ...pageBody };
    return answer(body);
  } catch (err) {
    console.error(`[birdseye] GET /api/spaces/${id}/birdseye failed:`, err);
    return answer({ error: "Couldn't load the bird's eye view." }, 500);
  }
}
