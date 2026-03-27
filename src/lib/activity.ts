import { prisma } from "@/lib/prisma";

interface LogActivityParams {
  type: string;
  actorId: string;
  organizationId: string;
  description: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, any>;
}

export async function logActivity({
  type,
  actorId,
  organizationId,
  description,
  targetId,
  targetType,
  metadata,
}: LogActivityParams) {
  try {
    await prisma.activityLog.create({
      data: {
        type,
        actorId,
        organizationId,
        description,
        targetId,
        targetType,
        metadata: metadata || undefined,
      },
    });
  } catch (err) {
    // Don't let activity logging failures break the main flow
    console.error("Failed to log activity:", err);
  }
}
