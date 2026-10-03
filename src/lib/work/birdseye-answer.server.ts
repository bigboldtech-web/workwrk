// The Bird's eye answer, shared by its two doors:
//
//   GET /api/spaces/[id]/birdseye    a Space's Lists
//   GET /api/folders/[id]/birdseye   one Folder's Lists, and its sub-folders'
//
// EACH DOOR DECIDES ONE THING, the readable Lists of its scope, from the one
// resolver's tree (readableListsInSpace, readableListsInFolder in
// src/lib/space.ts). Everything after that is here and the same for both:
// a List outside that set is never a column, a chip or a count, and asking
// for one by id answers `list_not_found` whether it exists or not, so the
// answer names nothing. The tasks linked into those Lists come through the
// List's own projection (birdseye-linked.server.ts), and every task read
// after that is src/lib/work/birdseye-server.ts, which reads no access.
//
// This file never reads the legacy access signal: the viewer is the item
// routes' itemCtx, handed in by the door.

import { NextResponse } from "next/server";
import type { itemCtx } from "@/lib/item-gate";
import type { SpaceListRow } from "@/lib/space";
import { readListDefaults } from "@/lib/list-comfort";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { newTaskStatus, type BirdseyeBody, type BirdseyeList, type BirdseyeQuery } from "@/lib/work/birdseye";
import { loadFocus, loadFocusPage, loadListPage, loadOverview, type ListCounts, type LoaderList } from "@/lib/work/birdseye-server";
import { linkedCardsFor, type LinkedList } from "@/lib/work/birdseye-linked.server";

export type BirdseyeViewer = Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Every Bird's eye answer, the refusals included, is never cacheable. */
export function birdseyeAnswer(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * The status a List's own "new task" doors default to, when it stores one.
 * Phase 5b's List comfort keeps a List's new-task defaults at
 * Board.settings.defaults, so "+ New task" reads the status from exactly
 * there; a List that stores none creates in its first status.
 */
function storedDefaultStatus(settings: unknown): string | null {
  return readListDefaults(settings).status ?? null;
}

/** The answer for one parsed query over the readable Lists `rows`, in their order. */
export async function answerBirdseye(query: BirdseyeQuery, c: BirdseyeViewer, rows: readonly SpaceListRow[]): Promise<NextResponse> {
  const filters = { q: query.q, hideClosed: query.hideClosed };
  const loaderLists: LoaderList[] = rows.map((r) => ({ id: r.id, statuses: getBoardStatuses(r) }));
  const byId = new Map(loaderLists.map((l) => [l.id, l]));
  // The tasks linked into these Lists, through the List's own projection
  // (the one place that decides a linked row), for the loader to merge.
  const linkedLists: LinkedList[] = rows.map((r) => ({ id: r.id, statuses: byId.get(r.id)?.statuses ?? getBoardStatuses(r), canContribute: r.canContribute }));
  const linkedFor = (only?: string) => linkedCardsFor(only ? linkedLists.filter((l) => l.id === only) : linkedLists, c, filters);

  const summarize = (counts: Record<string, ListCounts>, capped: ReadonlySet<string> = new Set()): BirdseyeList[] =>
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
        ...(capped.has(r.id) ? { linkedCapped: true } : {}),
      };
    });

  if (query.mode === "overview") {
    const linked = await linkedFor();
    const { counts, columns } = await loadOverview(loaderLists, filters, c.organizationId, linked.byList);
    const body: BirdseyeBody = { mode: "overview", lists: summarize(counts, linked.capped), columns };
    return birdseyeAnswer(body);
  }

  // Every other mode names a List, and it must be one of the readable set.
  const list = byId.get(query.boardId);
  if (!list) return birdseyeAnswer({ error: "list_not_found" }, 404);

  if (query.mode === "list-page") {
    const linked = await linkedFor(list.id);
    const pageBody = await loadListPage(list, filters, query.cursor, c.organizationId, linked.byList.get(list.id));
    const body: BirdseyeBody = { mode: "list-page", boardId: list.id, ...pageBody };
    return birdseyeAnswer(body);
  }
  if (query.mode === "focus") {
    const linked = await linkedFor();
    const { counts, columns } = await loadFocus(loaderLists, list, filters, c.organizationId, linked.byList);
    const body: BirdseyeBody = { mode: "focus", lists: summarize(counts, linked.capped), focus: { boardId: list.id, columns } };
    return birdseyeAnswer(body);
  }
  const linked = await linkedFor(list.id);
  const pageBody = await loadFocusPage(list, query.status, filters, query.cursor, c.organizationId, linked.byList.get(list.id));
  const body: BirdseyeBody = { mode: "focus-page", boardId: list.id, status: query.status, ...pageBody };
  return birdseyeAnswer(body);
}
