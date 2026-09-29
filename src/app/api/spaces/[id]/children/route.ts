// GET /api/spaces/[id]/children: the Work sidebar's tree of one Space for
// this viewer, from the one resolver (src/lib/access/node-access.ts
// spaceTree, assembled by node-tree.ts).
//
// Returns (additive to the old shape, every old field kept):
//   {
//     spaceRole: "full" | "edit" | "view" | null   (null on a path Space)
//     access:    "member" | "path"
//     privateRule: "legacy" | "strict"
//     folders:     FolderNode[]  (every level, not two)
//     boards:      ListNode[]    (the Space's root Lists)
//     tables:      TableNode[]
//     docs:        DocNode[]     (SPACE docs, and docs given to the viewer
//                                 whose own parent does not show)
//     whiteboards: CanvasNode[]  (the Space's root canvases)
//   }
// FolderNode = { id, name, icon, color, position, visibility, ownerId, role,
// path, _count, boards, docs, whiteboards, childFolders }, where a PATH
// Folder (one the viewer only passes through on the way to what they were
// given) carries role, visibility and ownerId null, and holds only the
// branches that lead to a grant. _count counts rendered children only.
//
// 404 when the viewer holds neither a role on the Space nor a path through
// it, the same answer as a Space in another org.

import { NextResponse } from "next/server";
import { nodeCtxFromSession, spaceTree } from "@/lib/access/node-access";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const tree = await spaceTree(ctx, id);
    if (!tree) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(tree, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[spaces/children] ${id} failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server_error", message: "Could not load this Space." }, { status: 500 });
  }
}
