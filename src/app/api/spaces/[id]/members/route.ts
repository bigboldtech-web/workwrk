// GET    /api/spaces/[id]/members        — list members
// POST   /api/spaces/[id]/members        — add/upsert member { userId, role }
// DELETE /api/spaces/[id]/members?userId — remove member
//
// The URLs and shapes are kept for their callers (GET { members }, POST 201
// { member }, DELETE { ok: true }). Every write goes through the one grant
// writer, src/lib/access/grants.ts, so it is transactional, recorded as
// access activity, notifies the person, refuses someone outside the org and
// never removes the last active Full holder of a Space (409 last_full). The
// role is written through unchanged, so an OWNER write still works.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { listSpaceMembers } from "@/lib/space";
import { nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { GrantError, removeNodeGrant, setNodeGrant } from "@/lib/access/grants";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { node: nodeCtxFromLevel(u.id, u.organizationId, u.accessLevel) };
}

function grantFailure(err: unknown): NextResponse {
  if (err instanceof GrantError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to change members" }, { status: 400 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // Can view on the Space itself: a path container is not a role, and its
  // member list is exactly what a path must never show.
  const d = await nodeRole(c.node, { kind: "space", id });
  if (!roleAtLeast(d.role, "VIEW")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const members = await listSpaceMembers(id);
  return NextResponse.json({ members });
}

const addSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]).default("MEMBER"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    await setNodeGrant(c.node, { kind: "space", id }, { userId: parsed.data.userId, memberRole: parsed.data.role }, "members-route");
    const member = await prisma.spaceMember.findUnique({ where: { spaceId_userId: { spaceId: id, userId: parsed.data.userId } } });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return grantFailure(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId query param required" }, { status: 400 });
  try {
    await removeNodeGrant(c.node, { kind: "space", id }, { userId }, "members-route");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return grantFailure(err);
  }
}
