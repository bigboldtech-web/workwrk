// POST /api/access/check (access-model-spec 5.2 and 6.1, Phase 8 stage E).
//
//   { targets: [{ kind, id }, ...] }        the viewer's own role on up to 50
//                                           nodes, one batch (a component
//                                           outside a gated page asks once)
//   { userId, target: { kind, id } }        Check access: what one person can
//                                           do there and why, for someone who
//                                           manages who has access to it
//
// Node kinds only (space, folder, list, doc, table, canvas, form), answered by
// node-access, the live resolver. A node the viewer cannot see answers "none"
// in the batch and 404 in Check access, never a hint that the id exists.

import { NextResponse } from "next/server";
import { z } from "zod";
import { issueKey } from "@/lib/zod-issue-key";
import { isAccessNodeKind, isObjectShareKind } from "@/lib/access/access-panel";
import { checkObjectAccess, objectShareCtxFromSession, objectShareOn } from "@/lib/access/object-share";
import { nodeCtxFromSession, nodeRoles } from "@/lib/access/node-access";
import { checkNodeAccess } from "@/lib/access/check-access";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const REF = z.object({ kind: z.string().min(1).max(20), id: z.string().min(1).max(80) }).strict();
const bodySchema = z.union([
  z.object({ targets: z.array(REF).min(1).max(50) }).strict(),
  z.object({ userId: z.string().min(1).max(64), target: REF }).strict(),
]);

export async function POST(req: Request) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const key = issueKey(parsed.error.issues[0]);
    return NextResponse.json({ error: "invalid_body", key }, { status: 400, headers: NO_STORE });
  }
  if ("targets" in parsed.data) {
    const refs = parsed.data.targets.filter((t) => isAccessNodeKind(t.kind)) as { kind: Parameters<typeof nodeRoles>[1][number]["kind"]; id: string }[];
    const decided = await nodeRoles(ctx, refs);
    const results = parsed.data.targets.map((t) => {
      const d = isAccessNodeKind(t.kind) ? decided.get(`${t.kind}:${t.id}`) : undefined;
      const role = d?.role ?? "none";
      return { kind: t.kind, id: t.id, role: role === "OWNER" ? "FULL" : role, allowed: role !== "none" };
    });
    return NextResponse.json({ results }, { headers: NO_STORE });
  }
  const { userId, target } = parsed.data;
  // An SOP folder, a tool, a goal or a team: answered by its own live rules,
  // only while ACCESS_V2_TABLES is on (object-share).
  let r: Awaited<ReturnType<typeof checkNodeAccess>>;
  if (isObjectShareKind(target.kind) && objectShareOn()) {
    const octx = await objectShareCtxFromSession();
    if (!octx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    r = await checkObjectAccess(octx, target.kind, target.id, userId);
  } else if (isAccessNodeKind(target.kind)) {
    r = await checkNodeAccess(ctx, { kind: target.kind, id: target.id }, userId);
  } else {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  if (r === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (r === "forbidden") return NextResponse.json({ error: "no_access", message: "Only people who manage who has access here can check someone else." }, { status: 403, headers: NO_STORE });
  if (r === "not_in_org") return NextResponse.json({ error: "not_in_org" }, { status: 400, headers: NO_STORE });
  return NextResponse.json(r, { headers: NO_STORE });
}
