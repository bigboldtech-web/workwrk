import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { partySendErrors, partiesToNotify } from "@/lib/contracts";
import { mailSigningLink, signLinkFor } from "@/lib/contract-notify";
import { CONTRACT_MIGRATION_MESSAGE, isMissingContractColumnError } from "@/lib/contract-columns";

/**
 * POST /api/agreements/[id]/send { signingOrder?, message? } (spec-process
 * section 2 `/agreements/[id]`, the Send modal): marks the contract SENT,
 * stamps `sentAt`, remembers the order and the note, sets every unsigned
 * party to PENDING and emails each party its /sign/[token] link. With the
 * signing order on, only the first party is emailed; the next one gets
 * theirs when the previous signs (public sign route). Every party needs a
 * name and a valid, unique email first, and the answer names which one
 * does not.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const signingOrder = body.signingOrder === true;
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 2000) : null;

  let agreement;
  try {
    agreement = await prisma.agreement.findFirst({ where: { id, organizationId: orgId }, include: { parties: { orderBy: { order: "asc" } } } });
  } catch (e) {
    // Send writes sentAt / signingOrder / sendMessage, so without the
    // columns it cannot run: a named 503, never a bare 500.
    if (isMissingContractColumnError(e)) return jsonError(CONTRACT_MIGRATION_MESSAGE, 503);
    throw e;
  }
  if (!agreement) return jsonError("Not found", 404);
  if (agreement.isTemplate) return jsonError("A template is not sent. Use it to create a contract first.", 409);
  if (agreement.status === "VOIDED") return jsonError("This contract was voided.", 409);
  if (agreement.status === "COMPLETED") return jsonError("Everyone has already signed.", 409);
  if (agreement.parties.length === 0) return jsonError("Add at least one party before sending");
  const errors = partySendErrors(agreement.parties.map((p) => ({ id: p.id, name: p.name, email: p.email, status: p.status, order: p.order })));
  if (Object.keys(errors).length) return jsonError(`Every party needs a name and a valid email: ${Object.values(errors)[0]}`);

  await prisma.agreement.update({ where: { id }, data: { status: agreement.status === "PARTIALLY_SIGNED" ? "PARTIALLY_SIGNED" : "SENT", sentAt: agreement.sentAt ?? new Date(), signingOrder, sendMessage: message } });
  await prisma.agreementParty.updateMany({ where: { agreementId: id, status: { notIn: ["SIGNED", "DECLINED"] } }, data: { status: "PENDING" } });

  const toNotify = new Set(partiesToNotify(agreement.parties.map((p) => ({ id: p.id, name: p.name, email: p.email, status: p.status, order: p.order })), signingOrder).map((p) => p.id));
  const links: { partyId: string; name: string; email: string; link: string; emailed: boolean }[] = [];
  for (const p of agreement.parties) {
    const link = signLinkFor(p.token);
    let emailed = false;
    if (toNotify.has(p.id)) emailed = await mailSigningLink({ orgId, agreementId: id, title: agreement.title, party: { id: p.id, name: p.name, email: p.email, token: p.token, userId: p.userId }, message });
    links.push({ partyId: p.id, name: p.name, email: p.email, link, emailed });
  }
  return jsonSuccess({ status: "SENT", links, notified: links.filter((l) => l.emailed).length });
}
