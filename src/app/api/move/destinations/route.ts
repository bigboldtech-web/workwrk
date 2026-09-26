// GET /api/move/destinations?kind=folder|list|canvas|table|doc&id=<id>
//
// The places a move of this node would land, for the person asking: the
// placement rule's P5 (node-rules), built by node-placement moveDestinations
// from the same verdict every move route asks (moveVerdict per place, in one
// world). The Move dialog and the row menus list exactly these, so nothing is
// offered that the write would refuse: Full access on the node and where it
// is now, Can edit where it goes. A Folder reached through a grant inside a
// Space the person only passes through is listed under that Space, which is
// then a header and not itself a destination. Nothing the person can neither
// open nor pass through is named.
//
// { root: { pickable, current } | null, spaces: [{ id, name, slug, icon,
//   color, pickable, current, folders: [{ id, name, parentFolderId, icon,
//   color, pickable, current }] }] }. 404 when the node is not theirs to see.

import { NextResponse } from "next/server";
import { nodeCtxFromSession } from "@/lib/access/node-access";
import { moveDestinations } from "@/lib/access/node-placement";
import type { NodeRef } from "@/lib/access/node-rules";

export const dynamic = "force-dynamic";

const KINDS = new Set(["folder", "list", "canvas", "table", "doc"]);

export async function GET(req: Request) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!KINDS.has(kind) || !id) return NextResponse.json({ error: "kind and id are required" }, { status: 400 });
  const destinations = await moveDestinations(ctx, { kind, id } as NodeRef);
  if (!destinations) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(destinations, { headers: { "Cache-Control": "no-store" } });
}
