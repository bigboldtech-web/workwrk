import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { applyCompanyPatch, validateCompanyPatch } from "@/lib/admin/company-patch";
import { requestIp, staffActorFromSession } from "@/lib/staff-audit";

/**
 * Staff console → one company. Platform staff only.
 *
 * GET    → company metadata + counts + current Enterprise add-on flags.
 * PATCH  → change the plan (body: { plan }), the status (body: { status })
 *          or one add-on (body: { feature, enabled }). Every branch runs in
 *          one transaction with its StaffAction row (src/lib/admin/company-patch.ts);
 *          SUSPENDED and CANCELLED also revoke every member's live session.
 */

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
  if (!org) return jsonError("Company not found", 404);

  // Surface flags clearly for the console.
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
  const body = await req.json().catch(() => ({}));
  const validated = validateCompanyPatch(body);
  if (!validated.ok) return jsonError(validated.error);

  const result = await applyCompanyPatch({
    id,
    patch: validated.patch,
    actor: staffActorFromSession(session),
    ip: requestIp(req),
  });
  if (!result.ok) return jsonError(result.error, result.status);

  return jsonSuccess({ ok: true, changed: result.changed, signedOut: result.signedOut, company: result.company });
}
