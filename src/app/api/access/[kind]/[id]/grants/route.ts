// POST   /api/access/:kind/:id/grants  { userId, role, expected?, mode? }
// DELETE /api/access/:kind/:id/grants?userId=<id>&expected=<role or none>
//
// Give one person a role on one node, change it, or take it away: the Manage
// access dialog's only writes. Both go through src/lib/access/grants.ts, the
// one writer of person grants, inside one transaction with its activity row.
//
// `expected` is the role the dialog last showed for that person (null or
// "none" for nobody). When the stored row says otherwise, someone else
// changed it in the meantime and the answer is 409 conflict with the fresh
// panel, so the dialog can show what is true now and keep the person's input
// for a real Retry. A removal of a row that is not there is a 200 with
// noChange, never an error.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  GRANT_ERROR_MESSAGE,
  isAccessNodeKind,
  isObjectShareKind,
  type GrantErrorBody,
  type PanelRole,
} from "@/lib/access/access-panel";
import { objectShareCtxFromSession, objectShareOn, removeObjectGrant, setObjectGrant } from "@/lib/access/object-share";
import { nodeCtxFromSession } from "@/lib/access/node-access";
import { GrantError, removeNodeGrant, setNodeGrant } from "@/lib/access/grants";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// "ASSIGNED" is the List ladder's Can edit assigned tasks (founder decision 3);
// planGrant refuses it, like every role, on a kind that does not offer it.
const ROLE = z.enum(["OWNER", "FULL", "EDIT", "ASSIGNED", "COMMENT", "VIEW"]);

const postSchema = z.object({
  userId: z.string().min(1).max(64),
  role: ROLE,
  expected: ROLE.nullable().optional(),
  mode: z.enum(["set", "raise"]).optional(),
});

function refusal(error: GrantErrorBody["error"], status: number, extra: Partial<GrantErrorBody> = {}): NextResponse {
  const body: GrantErrorBody = { error, message: GRANT_ERROR_MESSAGE[error], ...extra };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function failure(err: unknown, where: string): NextResponse {
  if (err instanceof GrantError) {
    return refusal(err.code, err.status, err.code === "conflict" || err.code === "last_full" ? { panel: err.panel } : {});
  }
  const raw = err instanceof Error ? err.message : String(err);
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  console.error(`[access] ${where} failed: ${raw}`);
  return refusal("server_error", 500, { detail: (lines[lines.length - 1] ?? raw).slice(0, 300) });
}

type Params = { params: Promise<{ kind: string; id: string }> };

export async function POST(req: Request, { params }: Params) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { kind, id } = await params;
  // An SOP folder, a tool, a goal or a team: only while ACCESS_V2_TABLES is on (object-share).
  if (isObjectShareKind(kind) && id) {
    if (!objectShareOn()) return refusal("not_found", 404);
    const octx = await objectShareCtxFromSession();
    if (!octx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const body = postSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) return refusal("invalid_body", 400);
    try {
      return NextResponse.json(await setObjectGrant(octx, kind, id, body.data), { headers: NO_STORE });
    } catch (err) {
      return failure(err, `grant on ${kind} ${id}`);
    }
  }
  if (!isAccessNodeKind(kind) || !id) return refusal("invalid_body", 400);
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refusal("invalid_body", 400);
  try {
    const result = await setNodeGrant(ctx, { kind, id }, parsed.data, "dialog");
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return failure(err, `grant on ${kind} ${id}`);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { kind, id } = await params;
  const objectKind = isObjectShareKind(kind) ? kind : null;
  if (objectKind && !objectShareOn()) return refusal("not_found", 404);
  if ((!objectKind && !isAccessNodeKind(kind)) || !id) return refusal("invalid_body", 400);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return refusal("invalid_body", 400);
  const raw = url.searchParams.get("expected");
  let expected: PanelRole | null | undefined;
  if (raw === null) expected = undefined;
  else if (raw === "none" || raw === "") expected = null;
  else {
    const parsed = ROLE.safeParse(raw);
    if (!parsed.success) return refusal("invalid_body", 400);
    expected = parsed.data;
  }
  if (objectKind) {
    const octx = await objectShareCtxFromSession();
    if (!octx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    try {
      return NextResponse.json(await removeObjectGrant(octx, objectKind, id, { userId, expected }), { headers: NO_STORE });
    } catch (err) {
      return failure(err, `removal on ${kind} ${id}`);
    }
  }
  if (!isAccessNodeKind(kind)) return refusal("invalid_body", 400);
  try {
    const result = await removeNodeGrant(ctx, { kind, id }, { userId, expected }, "dialog");
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return failure(err, `removal on ${kind} ${id}`);
  }
}
