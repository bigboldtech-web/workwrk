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

  // Create shares, skip duplicates
  let created = 0;
  for (const userId of userIds) {
    try {
      await prisma.toolShare.create({ data: { toolId, userId, sharedBy } });
      // Notify the user
      await prisma.notification.create({
        data: { userId, type: "tool_shared", title: `Tool shared: ${tool.name}`, message: `You now have access to ${tool.name}. Check your Tools section.`, link: "/tools" },
      });
      created++;
    } catch {} // Skip duplicates
  }

  return jsonSuccess({ shared: created });
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
