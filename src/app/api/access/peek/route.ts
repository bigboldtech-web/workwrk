// GET /api/access/peek?kind=&id= (access-model-spec 5.3, Phase 8 stage E):
// the LockedPage payload, { kind, name, owner: { name } } and nothing else,
// for a node the viewer can see or is on the way to. Every other case is a
// 404 with the body a missing id gets. Guests never peek.

import { NextResponse } from "next/server";
import { isAccessNodeKind } from "@/lib/access/access-panel";
import { nodeCtxFromSession } from "@/lib/access/node-access";
import { peekNode } from "@/lib/access/check-access";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!isAccessNodeKind(kind) || !id || id.length > 80) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const p = await peekNode(ctx, { kind, id });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(p, { headers: NO_STORE });
}
