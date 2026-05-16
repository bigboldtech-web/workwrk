import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity, logAuditEvent } from "@/lib/activity";

// GET: List tools — admins see all, employees see only shared with them
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as any).accessLevel;
  const isAdmin = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "HR"].includes(accessLevel);

  if (isAdmin) {
    // Admins see all tools with share info
    const tools = await prisma.tool.findMany({
      where: { organizationId: orgId },
      include: { shares: { select: { userId: true, sharedAt: true } } },
      orderBy: { createdAt: "desc" },
    });
    return jsonSuccess(tools);
  }

  // Employees see only tools shared with them — credentials included
  const shares = await prisma.toolShare.findMany({
    where: { userId },
    include: {
      tool: {
        select: { id: true, name: true, description: true, url: true, icon: true, category: true, credentials: true },
      },
    },
    orderBy: { sharedAt: "desc" },
  });

  return jsonSuccess(shares.map((s) => ({ ...s.tool, sharedAt: s.sharedAt })));
}

// POST: Add a new tool (admin only)
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { name, description, url, icon, category, credentials } = body;

  if (!name?.trim()) return jsonError("Tool name is required");

  const tool = await prisma.tool.create({
    data: {
      name: name.trim(),
      description: description || null,
      url: url || null,
      icon: icon || null,
      category: category || null,
      credentials: credentials || undefined,
      addedBy: userId,
      organizationId: orgId,
    },
  });

  // Tools with shared credentials are a security surface — admins
  // need to be able to trace who added what and when.
  const hasCredentials = credentials !== undefined && credentials !== null;
  if (hasCredentials) {
    logAuditEvent({
      type: "tool_created",
      actorId: userId,
      organizationId: orgId,
      description: `Added tool "${tool.name}" with shared credentials`,
      targetId: tool.id,
      targetType: "tool",
      metadata: { url: tool.url ?? null, category: tool.category ?? null, hasCredentials: true },
    });
  } else {
    logActivity({
      type: "tool_created",
      actorId: userId,
      organizationId: orgId,
      description: `Added tool "${tool.name}"`,
      targetId: tool.id,
      targetType: "tool",
    });
  }

  return jsonSuccess(tool, 201);
}
