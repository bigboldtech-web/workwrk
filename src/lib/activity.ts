import { prisma } from "@/lib/prisma";

interface LogActivityParams {
  type: string;
  actorId: string;
  organizationId: string;
  description: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
  oldValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  severity?: "info" | "warning" | "critical";
}

export async function logActivity({
  type,
  actorId,
  organizationId,
  description,
  targetId,
  targetType,
  metadata,
  ipAddress,
  userAgent,
  oldValue,
  newValue,
  severity = "info",
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
        ipAddress,
        userAgent,
        oldValue: oldValue || undefined,
        newValue: newValue || undefined,
        severity,
      },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

// Shorthand for security-critical events
export async function logAuditEvent(params: Omit<LogActivityParams, "severity"> & { severity?: "warning" | "critical" }) {
  return logActivity({ ...params, severity: params.severity || "warning" });
}
