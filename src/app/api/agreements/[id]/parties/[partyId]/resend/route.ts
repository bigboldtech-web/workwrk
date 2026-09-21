import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { mailSigningLink, signLinkFor } from "@/lib/contract-notify";

/**
 * POST /api/agreements/[id]/parties/[partyId]/resend (spec-process section
 * 2 `/agreements/[id]`, the Parties card's Resend): one more email with the
 * party's signing link. Only while the contract is out for signature and
 * the party has not signed or declined.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; partyId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id, partyId } = await params;
  const orgId = getOrgId(session);
  const party = await prisma.agreementParty.findFirst({
    where: { id: partyId, agreementId: id, agreement: { organizationId: orgId } },
    include: { agreement: { select: { id: true, title: true, status: true, sendMessage: true } } },
  });
  if (!party) return jsonError("Not found", 404);
  if (party.agreement.status !== "SENT" && party.agreement.status !== "PARTIALLY_SIGNED") return jsonError("Send the contract first.", 409);
  if (party.status === "SIGNED") return jsonError("This party has already signed.", 409);
  if (party.status === "DECLINED") return jsonError("This party declined. Void the contract and send a new one.", 409);
  if (!party.email.trim()) return jsonError("This party has no email. Copy their signing link instead.", 400);
  const sent = await mailSigningLink({ orgId, agreementId: id, title: party.agreement.title, party: { id: party.id, name: party.name, email: party.email, token: party.token, userId: party.userId }, message: party.agreement.sendMessage, reminder: true });
  if (!sent) return jsonError("Couldn't send the email", 500);
  return jsonSuccess({ resent: true, link: signLinkFor(party.token) });
}
