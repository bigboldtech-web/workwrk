// GET /api/move/destinations?kind=folder|list|canvas|table|doc|space&id=<id>
// GET /api/move/destinations?create=folder|list|doc|canvas|table
//
// The places a move of this node would land, for the person asking: the
// placement rule's P5 (node-rules), built by node-placement moveDestinations
// from the same verdict every move route asks (moveVerdict per place, in one
// world). The Move dialog and the row menus list exactly these, so nothing is
// offered that the write would refuse: Full access on the node and where it
// is now, Can edit where it goes, and for a Folder Full access on everything
// it carries. A Folder reached through a grant inside a Space the person only
// passes through is listed under that Space, which is then a header and not
// itself a destination. Nothing the person can neither open nor pass through
// is named.
//
// { root: { pickable, current } | null, spaces: [{ id, name, slug, icon,
//   color, pickable, current, folders: [{ id, name, parentFolderId, icon,
//   color, pickable, current }] }], refusal? }. 404 when the node is not
// theirs to see.
//
// kind=space: the parents spaces/[id]/move accepts (space.ts
// spaceNestDestinations, the same spaceNestVerdict): { top: { pickable,
// current }, spaces: [{ id, name, slug, icon, color, pickable, current }],
// refusal? }.
//
// create=<kind>: the places the person may make that kind in (P1, Can edit or
// higher; node-placement createDestinations), in the move shape, for the
// create pickers: a Can view holder is offered nothing, a Can edit grantee of
// one Folder inside a Space they only pass through is offered that Folder.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { nodeCtxFromSession } from "@/lib/access/node-access";
import { createDestinations, moveDestinations } from "@/lib/access/node-placement";
import { spaceNestDestinations } from "@/lib/space";
import type { NodeRef, PlaceKind } from "@/lib/access/node-rules";

export const dynamic = "force-dynamic";

const KINDS = new Set(["folder", "list", "canvas", "table", "doc", "space"]);
const CREATE_KINDS = new Set<PlaceKind>(["folder", "list", "doc", "canvas", "table"]);
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const create = url.searchParams.get("create");
  if (create !== null) {
    if (!CREATE_KINDS.has(create as PlaceKind)) return NextResponse.json({ error: "create must be folder, list, doc, canvas or table" }, { status: 400 });
    return NextResponse.json(await createDestinations(ctx, create as PlaceKind), { headers: NO_STORE });
  }
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!KINDS.has(kind) || !id) return NextResponse.json({ error: "kind and id are required" }, { status: 400 });
  if (kind === "space") {
    if (ctx.denied) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const session = await getServerSession(authOptions);
    const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "EMPLOYEE";
    const nest = await spaceNestDestinations(id, { userId: ctx.userId, organizationId: ctx.organizationId, accessLevel });
    if (!nest) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(nest, { headers: NO_STORE });
  }
  const destinations = await moveDestinations(ctx, { kind, id } as NodeRef);
  if (!destinations) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(destinations, { headers: NO_STORE });
}
