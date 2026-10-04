// POST   /api/tools/[id]/share { userIds }: share a tool (Can view: the tool
//        and its saved login). Manage only. Every id must be a person in this
//        workspace; each new person is notified with a link to the tool.
// DELETE /api/tools/[id]/share { userId }: take it back. Manage only, and now
//        scoped to this workspace's tool (it had no org check).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { accessV2Tables } from "@/lib/access/flags";
import { canSeeTool, canShareTool, toolShareRole } from "@/lib/tools/tool-access";
import { requireTools } from "@/lib/tools/tool-server";

// Same rule as ../route.ts: a tool the viewer cannot see is "Not found" on
// every method, so the 403 below never confirms an unshared id exists. See
// is decided before manage; the copy is for a Can view holder only. A Full
// access share manages it too while ACCESS_V2_TABLES is on (tool-access.ts);
// these routes write Can view shares, as they always have.
async function manageable(id: string, v: Exclude<Awaited<ReturnType<typeof requireTools>>, { error: unknown }>) {
  const tool = await prisma.tool.findFirst({ where: { id, organizationId: v.orgId }, select: { id: true, name: true, addedBy: true } });
  if (!tool) return { error: jsonError("Not found", 404) };
  const share = await prisma.toolShare.findUnique({ where: { toolId_userId: { toolId: id, userId: v.userId } }, select: { id: true, role: true } });
  if (!canSeeTool(v, tool, Boolean(share))) return { error: jsonError("Not found", 404) };
  if (!canShareTool(v, tool, toolShareRole(share, accessV2Tables()))) return { error: jsonError("You can't share this tool. Ask whoever added it.", 403) };
  return { tool };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const { id: toolId } = await params;
  const m = await manageable(toolId, v);
  if ("error" in m) return m.error;

  const body = await req.json().catch(() => null);
  const userIds = Array.isArray(body?.userIds) ? (body.userIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  if (userIds.length === 0) return jsonError("userIds required");

  const inOrg = await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: v.orgId }, select: { id: true } });
  const valid = new Set(inOrg.map((u) => u.id));
  const existing = await prisma.toolShare.findMany({ where: { toolId, userId: { in: [...valid] } }, select: { userId: true } });
  const have = new Set(existing.map((e) => e.userId));
  const newIds = [...valid].filter((uid) => !have.has(uid));
  if (newIds.length === 0) return jsonSuccess({ shared: 0 });

  await Promise.all([
    prisma.toolShare.createMany({ data: newIds.map((userId) => ({ toolId, userId, sharedBy: v.userId })), skipDuplicates: true }),
    prisma.notification.createMany({
      data: newIds.map((userId) => ({
        userId,
        type: "tool_shared",
        title: `Tool shared: ${m.tool.name}`,
        message: `You can now see ${m.tool.name} and its saved login in Tools.`,
        link: `/tools?tool=${toolId}`,
      })),
    }),
  ]);
  return jsonSuccess({ shared: newIds.length });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const { id: toolId } = await params;
  const m = await manageable(toolId, v);
  if ("error" in m) return m.error;
  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : null;
  if (!userId) return jsonError("userId required");
  await prisma.toolShare.deleteMany({ where: { toolId, userId } });
  return jsonSuccess({ message: "Access removed" });
}
