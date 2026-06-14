import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { setFeature, type EnterpriseFeature } from "@/lib/enterprise-features";

/**
 * Admin → company detail. Platform staff only.
 *
 * GET    → org metadata + counts + current Enterprise feature flags.
 * PATCH  → toggle a single feature flag (body: { feature, enabled })
 *          OR change the plan (body: { plan }).
 */

const VALID_FEATURES = new Set<EnterpriseFeature>(["byok", "whiteLabel", "customDomain"]);
const VALID_PLANS = new Set(["STARTER", "GROWTH", "SCALE", "ENTERPRISE"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const { id } = await params;
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true, name: true, slug: true, domain: true, logo: true,
      plan: true, status: true, settings: true, createdAt: true,
      _count: {
        select: {
          users: true, sops: true, kras: true, tasks: true, kpis: true,
        },
      },
    },
  });
  if (!org) return jsonError("Org not found", 404);

  // Surface flags clearly for the admin UI.
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const features = (settings.features ?? {}) as Record<string, boolean>;
  return jsonSuccess({
    ...org,
    features: {
      byok: !!features.byok,
      whiteLabel: !!features.whiteLabel,
      customDomain: !!features.customDomain,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  // Plan change
  if (typeof body?.plan === "string") {
    if (!VALID_PLANS.has(body.plan)) return jsonError("Invalid plan");
    await prisma.organization.update({
      where: { id },
      data: { plan: body.plan },
    });
  }

  // Feature toggle
  if (typeof body?.feature === "string") {
    if (!VALID_FEATURES.has(body.feature as EnterpriseFeature)) return jsonError("Unknown feature");
    if (typeof body?.enabled !== "boolean") return jsonError("`enabled` must be a boolean");
    await setFeature(id, body.feature as EnterpriseFeature, body.enabled);
  }

  // Status change
  if (typeof body?.status === "string") {
    const VALID_STATUS = new Set(["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"]);
    if (!VALID_STATUS.has(body.status)) return jsonError("Invalid status");
    await prisma.organization.update({
      where: { id },
      data: { status: body.status as "ACTIVE" | "TRIAL" | "SUSPENDED" | "CANCELLED" },
    });
  }

  return jsonSuccess({ ok: true });
}
