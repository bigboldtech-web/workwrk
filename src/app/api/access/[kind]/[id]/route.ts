// GET /api/access/:kind/:id: who can reach one node, for the Manage access
// dialog. The same panel for every kind (Space, Folder, List, Doc, Table,
// Canvas, Form): the direct grants, the access inherited from the Folders and
// Space above, the org-wide line, the admins line and the general access
// switches, all computed by the one resolver (src/lib/access/node-access.ts).
//
// 404 when the viewer holds no role on the node. A path container (a Space or
// Folder the viewer only passes through on the way to something they were
// given) is not a role, so its panel is a 404 too: its member list is exactly
// what a path must never show.

import { NextResponse } from "next/server";
import { GRANT_ERROR_MESSAGE, isAccessNodeKind, type GrantErrorBody } from "@/lib/access/access-panel";
import { accessPanel, nodeCtxFromSession } from "@/lib/access/node-access";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function refusal(error: GrantErrorBody["error"], status: number): NextResponse {
  const body: GrantErrorBody = { error, message: GRANT_ERROR_MESSAGE[error] };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { kind, id } = await params;
  if (!isAccessNodeKind(kind) || !id) return refusal("invalid_body", 400);
  try {
    const panel = await accessPanel(ctx, { kind, id });
    if (!panel) return refusal("not_found", 404);
    return NextResponse.json(panel, { headers: NO_STORE });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    console.error(`[access] panel for ${kind} ${id} failed: ${raw}`);
    const body: GrantErrorBody = { error: "server_error", message: "Could not load who has access.", detail: (lines[lines.length - 1] ?? raw).slice(0, 300) };
    return NextResponse.json(body, { status: 500, headers: NO_STORE });
  }
}
