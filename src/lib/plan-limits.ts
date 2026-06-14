import { prisma } from "./prisma";
import { PLAN_LIMITS } from "./plan-limits-data";

// Re-export so existing server callers `import { PLAN_LIMITS } from
// "@/lib/plan-limits"` keep working. The data itself lives in the pure
// plan-limits-data.ts so Client Components can import it without pg.
export { PLAN_LIMITS };

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
