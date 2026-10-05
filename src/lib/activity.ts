import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

type Json = Prisma.InputJsonValue;

interface LogActivityParams {
  type: string;
  /** Null for an action no person took (an API key, say: actorType and actorLabel then say who). */
  actorId: string | null;
  organizationId: string;
  description: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  severity?: "info" | "warning" | "critical";
  /** Who wrote it when not a person: "api_key" | "agent" | "system" | "scim" | "platform_staff". */
  actorType?: string;
  /** The name shown for a non-person actor ("API key wk_ab12"). */
  actorLabel?: string | null;
  /** The person a key or agent acted as. */
  actingForId?: string | null;
  /**
   * Collapse window (settings spec 1.8): a repeat of the same event by the
   * same actor on the same target and the same keys inside this many
   * milliseconds UPDATES the previous row (its new value and time) instead
   * of adding one, so a person nudging a number five times leaves one row.
   */
  collapseWithinMs?: number;
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
  actorType,
  actorLabel,
  actingForId,
  collapseWithinMs,
}: LogActivityParams) {
  try {
    if (collapseWithinMs && collapseWithinMs > 0) {
      const since = new Date(Date.now() - collapseWithinMs);
      const prev = await prisma.activityLog.findFirst({
        where: { organizationId, actorId, type, targetId: targetId ?? null, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { id: true, metadata: true },
      });
      const sameKeys = (a: unknown, b: unknown) =>
        JSON.stringify(((a as { keys?: unknown } | null)?.keys ?? null)) === JSON.stringify(((b as { keys?: unknown } | null)?.keys ?? null));
      if (prev && sameKeys(prev.metadata, metadata)) {
        await prisma.activityLog.update({
          where: { id: prev.id },
          data: { description, newValue: (newValue || undefined) as Json | undefined, metadata: (metadata || undefined) as Json | undefined, createdAt: new Date() },
        });
        return;
      }
    }
    await prisma.activityLog.create({
      data: {
        type,
        actorId,
        organizationId,
        description,
        targetId,
        targetType,
        metadata: (metadata || undefined) as Json | undefined,
        ipAddress,
        userAgent,
        oldValue: (oldValue || undefined) as Json | undefined,
        newValue: (newValue || undefined) as Json | undefined,
        severity,
        ...(actorType ? { actorType } : {}),
        ...(actorLabel ? { actorLabel } : {}),
        ...(actingForId ? { actingForId } : {}),
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
