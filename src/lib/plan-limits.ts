import { prisma } from "./prisma";

export const PLAN_LIMITS: Record<string, { users: number; sops: number; ai: number }> = {
  STARTER: { users: 10, sops: 3, ai: 50 },
  GROWTH: { users: 50, sops: 20, ai: 500 },
  SCALE: { users: 200, sops: 100, ai: 2000 },
  ENTERPRISE: { users: 99999, sops: 99999, ai: 99999 },
};

type LimitType = "users" | "sops" | "ai";

const COUNT_FIELD: Record<LimitType, string> = {
  users: "users",
  sops: "sops",
  ai: "aiQueries",
};

/**
 * Check if the organisation has exceeded its plan limit for a given resource.
 * Returns { allowed: true } or { allowed: false, message, limit, current }.
 */
export async function checkPlanLimit(
  orgId: string,
  type: LimitType
): Promise<{ allowed: true } | { allowed: false; message: string; limit: number; current: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      plan: true,
      _count: { select: { users: true, sops: true, aiQueries: true } },
    },
  });

  if (!org) return { allowed: false, message: "Organization not found", limit: 0, current: 0 };

  const plan = org.plan || "STARTER";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.STARTER;
  const limit = limits[type];
  const current = org._count[COUNT_FIELD[type] as keyof typeof org._count];

  if (current >= limit) {
    const labels: Record<LimitType, string> = {
      users: "team members",
      sops: "SOPs",
      ai: "AI queries",
    };
    return {
      allowed: false,
      message: `You've reached your ${plan} plan limit of ${limit} ${labels[type]}. Please upgrade your plan to continue.`,
      limit,
      current,
    };
  }

  return { allowed: true };
}
