import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isOrgAdmin, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { hasFeature } from "@/lib/enterprise-features";

/**
 * /api/organization/branding
 *
 * GET   — current branding (logo, displayName, primaryColor). Always
 *         readable; clients use it to render the sidebar wordmark
 *         even when white-label is off (they'll just see WorkwrK
 *         defaults).
 * PATCH — update branding. Requires:
 *           · org admin (COMPANY_ADMIN / SUPER_ADMIN)
 *           · the `whiteLabel` Enterprise feature flag enabled.
 *         Otherwise the change is rejected with 403.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, logo: true, settings: true },
  });
  if (!org) return jsonSuccess({ name: null, logo: null, displayName: null, primaryColor: null });

  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const branding = (settings.branding ?? {}) as Record<string, unknown>;
  const wl = await hasFeature(orgId, "whiteLabel");

  return jsonSuccess({
    name: org.name,
    logo: org.logo,
    // displayName + primaryColor are only honoured when white-label is on;
    // we still echo them so admins can preview before flipping the flag.
    displayName: typeof branding.displayName === "string" ? branding.displayName : null,
    primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : null,
    whiteLabelEnabled: wl.enabled,
  }, 200, LOOKUP_CACHE_HEADERS);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can edit branding", 403);

  const orgId = getOrgId(session);
  const wl = await hasFeature(orgId, "whiteLabel");
  if (!wl.enabled) {
    return jsonError(
      wl.reason === "not_enterprise"
        ? "White-label requires the Enterprise plan. Contact WorkwrK to upgrade."
        : "White-label isn't enabled for your org. Ask WorkwrK to turn it on.",
      403,
    );
  }

  const body = await req.json();
  const data: { logo?: string | null; settings?: Record<string, unknown> } = {};

  if ("logo" in body) {
    if (body.logo === null || typeof body.logo === "string") data.logo = body.logo;
  }

  if ("displayName" in body || "primaryColor" in body) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const branding = (settings.branding ?? {}) as Record<string, unknown>;
    if ("displayName" in body) {
      const v = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 60) : null;
      branding.displayName = v || null;
    }
    if ("primaryColor" in body) {
      const v = typeof body.primaryColor === "string" ? body.primaryColor.trim() : null;
      if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) return jsonError("Use a 6-digit hex color, e.g. #d4ff2e");
      branding.primaryColor = v || null;
    }
    data.settings = { ...settings, branding };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: data as Parameters<typeof prisma.organization.update>[0]["data"],
  });

  return jsonSuccess({ ok: true });
}
