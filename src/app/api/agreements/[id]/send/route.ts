import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { documentSignTemplate } from "@/lib/email-templates";

// POST: send the agreement to its parties for signature. Marks SENT, sets each
// not-yet-signed party to PENDING, and emails each their /sign/[token] link.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const agreement = await prisma.agreement.findFirst({ where: { id, organizationId: orgId }, include: { parties: true } });
  if (!agreement) return jsonError("Not found", 404);
  if (agreement.parties.length === 0) return jsonError("Add at least one party before sending");
  const missing = agreement.parties.filter((p) => !p.email || !p.email.trim());
  if (missing.length > 0) return jsonError(`Add an email for: ${missing.map((p) => p.name).join(", ")}`);

  await prisma.agreement.update({ where: { id }, data: { status: "SENT" } });
  await prisma.agreementParty.updateMany({ where: { agreementId: id, status: { not: "SIGNED" } }, data: { status: "PENDING" } });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const links: { partyId: string; name: string; email: string; link: string }[] = [];
  for (const p of agreement.parties) {
    const link = `${baseUrl}/sign/${p.token}`;
    links.push({ partyId: p.id, name: p.name, email: p.email, link });
    if (p.status === "SIGNED") continue;
    const { subject, html } = documentSignTemplate({ documentTitle: agreement.title, signerName: p.name, signLink: link });
    try {
      await sendEmail({
        to: p.email,
        subject,
        html,
        template: "document-sign",
        variables: { documentTitle: agreement.title },
        organizationId: orgId,
        userId: p.userId || undefined,
        category: "agreement",
      });
    } catch (e) {
      console.error("[Agreement] send email failed:", e);
    }
  }

  return jsonSuccess({ status: "SENT", links });
}
