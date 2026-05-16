// IdentityProvider config — list (org admin only) and upsert. SCIM
// runs independently of SAML; they share the settings page but
// nothing else. SAML real cryptographic verification is gated on
// installing `samlify` — for now this endpoint just stores the
// config so the IT-side onboarding form is ready.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const providers = await prisma.identityProvider.findMany({
    where: { organizationId: getOrgId(session) },
  });
  return jsonSuccess(providers);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();

  const type = typeof body.type === "string" ? body.type : "SAML";
  if (!["SAML", "OIDC"].includes(type)) return jsonError("Invalid type");

  const data = {
    issuer: typeof body.issuer === "string" ? body.issuer.trim() || null : null,
    ssoUrl: typeof body.ssoUrl === "string" ? body.ssoUrl.trim() || null : null,
    sloUrl: typeof body.sloUrl === "string" ? body.sloUrl.trim() || null : null,
    certificate: typeof body.certificate === "string" ? body.certificate.trim() || null : null,
    enabled: !!body.enabled,
    jitProvision: body.jitProvision !== false,
    attributeMap: body.attributeMap ?? undefined,
  };

  // To enable, the four SAML fields must all be set. We don't crypto-
  // verify here — that's `samlify`'s job once installed. We just stop
  // an admin from accidentally turning on a half-configured provider.
  if (data.enabled && type === "SAML") {
    if (!data.issuer || !data.ssoUrl || !data.certificate) {
      return jsonError(
        "Cannot enable SAML without issuer, ssoUrl, and certificate",
        409,
      );
    }
  }

  const existing = await prisma.identityProvider.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: type as never } },
  });

  const provider = await prisma.identityProvider.upsert({
    where: { organizationId_type: { organizationId: orgId, type: type as never } },
    update: data,
    create: { organizationId: orgId, type: type as never, ...data },
  });

  const wasEnabled = existing?.enabled === true;
  const isEnabled = provider.enabled === true;
  const enablementChanged = wasEnabled !== isEnabled;

  logAuditEvent({
    type: existing ? "idp_updated" : "idp_created",
    actorId: (session.user as { id: string }).id,
    organizationId: orgId,
    description: existing
      ? `Updated ${type} identity provider${enablementChanged ? ` (${isEnabled ? "enabled" : "disabled"})` : ""}`
      : `Created ${type} identity provider${isEnabled ? " (enabled)" : ""}`,
    targetId: provider.id,
    targetType: "identity_provider",
    metadata: { type, enabled: isEnabled, jitProvision: provider.jitProvision, issuer: provider.issuer },
    severity: enablementChanged || isEnabled ? "critical" : "warning",
  });

  return jsonSuccess(provider);
}
