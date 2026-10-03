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
// the same answer every other Space tab and the header count use. The answer
// for those Lists is src/lib/work/birdseye-answer.server.ts, shared with the
// Folder's Bird's eye (GET /api/folders/[id]/birdseye): a List outside the set
// is never a column, a chip or a count, and asking for one by id answers
// `list_not_found` whether it exists or not.
//
// This file never reads the legacy access signal: the session unwrap is the
// item routes' itemCtx and the Space gate is spaceForViewer, both on files the
// access allow-list already carries.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { readableListsInSpace } from "@/lib/space";
import { spaceForViewer } from "@/lib/list-links-server";
import { parseBirdseyeQuery } from "@/lib/work/birdseye";
import { answerBirdseye, birdseyeAnswer as answer } from "@/lib/work/birdseye-answer.server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
    return await answerBirdseye(query, c, rows);
  } catch (err) {
    console.error(`[birdseye] GET /api/spaces/${id}/birdseye failed:`, err);
    return answer({ error: "Couldn't load the bird's eye view." }, 500);
  }
}
