import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// POST: Share tool with users
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id: toolId } = await params;
  const sharedBy = getUserId(session);
  const { userIds } = await req.json();

  if (!Array.isArray(userIds) || userIds.length === 0) return jsonError("userIds required");

  const tool = await prisma.tool.findFirst({ where: { id: toolId, organizationId: getOrgId(session) } });
  if (!tool) return jsonError("Tool not found", 404);

  // Filter out users who already have a share, then batch-insert the rest.
  const existing = await prisma.toolShare.findMany({
    where: { toolId, userId: { in: userIds as string[] } },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((e) => e.userId));
  const newIds = (userIds as string[]).filter((id) => !existingIds.has(id));

  if (newIds.length === 0) return jsonSuccess({ shared: 0 });

  await Promise.all([
    prisma.toolShare.createMany({
      data: newIds.map((userId) => ({ toolId, userId, sharedBy })),
      skipDuplicates: true,
    }),
    prisma.notification.createMany({
      data: newIds.map((userId) => ({
        userId,
        type: "tool_shared",
        title: `Tool shared: ${tool.name}`,
        message: `You now have access to ${tool.name}. Check your Tools section.`,
        link: "/tools",
      })),
    }),
  ]);

  return jsonSuccess({ shared: newIds.length });
}

// DELETE: Revoke tool access
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id: toolId } = await params;
  const { userId } = await req.json();

  if (!userId) return jsonError("userId required");

  await prisma.toolShare.deleteMany({ where: { toolId, userId } });
  return jsonSuccess({ message: "Access revoked" });
}
