// GET /api/organization/culture — the company's mission + values, for EVERY
// member (not just admins). Powers the welcome/mission splash that greets the
// team on each app open. Reads the same data admins edit under
// Settings → Identity (org.settings.companyProfile). Read-only.

import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, logo: true, settings: true },
  });
  const settings = (org?.settings as { companyProfile?: { mission?: unknown; values?: unknown } } | null) ?? {};
  const profile = settings.companyProfile ?? {};

  const mission = typeof profile.mission === "string" ? profile.mission.trim() : "";
  const values = Array.isArray(profile.values)
    ? profile.values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
    : [];

  return jsonSuccess({ orgName: org?.name ?? "", logo: org?.logo ?? null, mission, values });
}
