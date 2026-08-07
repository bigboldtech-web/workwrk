import { prisma } from "@/lib/prisma";

/**
 * Usage metering — 1 AutomationUsage row per executed action, summed
 * per calendar month against the org's plan limit.
 *
 * Limit source: `Organization.settings.automationLimit` (Json), default
 * 1000 actions/month. When the limit is reached the engine blocks new
 * runs (run FAILED with an explanatory error) and org admins get one
 * Inbox notification per month — not one per blocked run.
 */

export const DEFAULT_MONTHLY_LIMIT = 1000;

export function monthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getMonthlyLimit(organizationId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const raw = settings.automationLimit;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_MONTHLY_LIMIT;
}

export async function getMonthlyUsage(organizationId: string): Promise<number> {
  const agg = await prisma.automationUsage.aggregate({
    where: { organizationId, usageDate: { gte: monthStart() } },
    _sum: { usageCount: true },
  });
  return agg._sum.usageCount ?? 0;
}

export interface UsageState {
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
}

export async function getUsageState(organizationId: string): Promise<UsageState> {
  const [used, limit] = await Promise.all([
    getMonthlyUsage(organizationId),
    getMonthlyLimit(organizationId),
  ]);
  return { used, limit, remaining: Math.max(0, limit - used), blocked: used >= limit };
}

/** Meter one executed action. Never throws. */
export async function recordUsage(input: {
  organizationId: string;
  workflowId: string;
  runId: string;
  actionKey: string;
  userId?: string | null;
  boardId?: string | null;
  moduleName?: string | null;
}): Promise<void> {
  try {
    await prisma.automationUsage.create({
      data: {
        organizationId: input.organizationId,
        workflowId: input.workflowId,
        runId: input.runId,
        actionKey: input.actionKey,
        userId: input.userId ?? null,
        boardId: input.boardId ?? null,
        moduleName: input.moduleName ?? null,
        usageCount: 1,
        usageDate: new Date(),
      },
    });
  } catch {
    // Metering must never break a run.
  }
}

/**
 * Notify org admins that the monthly limit blocked a run — at most one
 * notification per admin per calendar month. Never throws.
 */
export async function notifyLimitExceeded(organizationId: string, limit: number): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
      },
      select: { id: true },
    });
    if (admins.length === 0) return;
    const alreadyNotified = await prisma.notification.findFirst({
      where: {
        userId: { in: admins.map((a) => a.id) },
        type: "automation_limit",
        createdAt: { gte: monthStart() },
      },
      select: { id: true },
    });
    if (alreadyNotified) return;
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: "automation_limit",
        title: "Automation limit reached",
        message: `Your workspace used all ${limit} automation actions for this month. Automations are paused until the limit resets or is raised.`,
        link: "/automation/usage",
      })),
    });
  } catch {
    // Best-effort.
  }
}
