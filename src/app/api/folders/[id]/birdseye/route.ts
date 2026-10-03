// GET /api/folders/[id]/birdseye: the Bird's eye view of one Folder, its
// Lists and the Lists of every Folder below it. The same requests as a
// Space's (GET /api/spaces/[id]/birdseye):
//
//   (no list or focus)                        overview
//   ?list=<boardId>&after=<cursor>            the next 50 of one overview column
//   ?focus=<boardId>                          one List's statuses as columns
//   ?focus=<boardId>&status=<v>&after=<c>     the next 50 of one focus column
//   ?q=<search>&closed=hide                   title search and Hide closed
//
// ONE gate, the Folder page's own (folderForViewer: Can view or higher on the
// Folder), then ONE predicate for the Lists: readableListsInFolder, the one
// resolver's tree cut to this Folder. A viewer who only passes through the
// Folder gets 404 here, as its page shows them the path view and no tabs.
// The answer for those Lists is src/lib/work/birdseye-answer.server.ts.
//
// This file never reads the legacy access signal: the session unwrap is the
// item routes' itemCtx and the Folder gate lives in src/lib/space.ts.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { folderForViewer, readableListsInFolder } from "@/lib/space";
import { parseBirdseyeQuery } from "@/lib/work/birdseye";
import { answerBirdseye, birdseyeAnswer as answer } from "@/lib/work/birdseye-answer.server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const c = await itemCtx();
  if ("error" in c) {
    c.error.headers.set("Cache-Control", "no-store");
    return c.error;
  }
  const { id } = await params;
  try {
    const folder = await folderForViewer(c, id);
    if (!folder) return answer({ error: "Not found" }, 404);

    const query = parseBirdseyeQuery(new URL(req.url).searchParams);
    if ("error" in query) return answer({ error: "bad_query" }, 400);

    const { lists: rows } = await readableListsInFolder(folder, c, { includeSettings: true });
    return await answerBirdseye(query, c, rows);
  } catch (err) {
    console.error(`[birdseye] GET /api/folders/${id}/birdseye failed:`, err);
    return answer({ error: "Couldn't load the bird's eye view." }, 500);
  }
}
