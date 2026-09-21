import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";
import { envelopeStatusAfter, isRequiredField, nextPartyInOrder, sanitizeSignValues } from "@/lib/contracts";
import { mailSigningLink, notifySender } from "@/lib/contract-notify";
import { CONTRACT_MIGRATION_MESSAGE, isMissingContractColumnError } from "@/lib/contract-columns";

type Field = { id: string; type: string; partyId: string; x: number; y: number; w: number; h: number; label?: string; required?: boolean };

const GONE = NextResponse.json({ error: "This link is no longer available" }, { status: 404 });

/**
 * GET /api/public/sign/[token] (spec-process section 2 `/sign/[token]`): the
 * document, this party's fields and the org strip, by token, no session.
 * A voided or archived contract, or a contract that was never sent, answers
 * the public 404; a party who already signed or declined gets the past
 * tense instead. The first open stamps VIEWED.
 */
async function loadParty(token: string) {
  try {
    return await prisma.agreementParty.findUnique({ where: { token }, include: { agreement: { include: { parties: { orderBy: { order: "asc" } } } } } });
  } catch (e) {
    if (isMissingContractColumnError(e)) return "migration" as const;
    throw e;
  }
}
const NOT_READY = () => NextResponse.json({ error: CONTRACT_MIGRATION_MESSAGE }, { status: 503 });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return GONE;
  const party = await loadParty(token);
  if (party === "migration") return NOT_READY();
  if (!party) return GONE;
  const ag = party.agreement;
  if (ag.isTemplate || ag.archivedAt || ag.status === "VOIDED" || ag.status === "DRAFT") return GONE;
  const org = await prisma.organization.findUnique({ where: { id: ag.organizationId }, select: { name: true, logo: true } });

  if (party.status === "PENDING") {
    await prisma.agreementParty.update({ where: { id: party.id }, data: { status: "VIEWED", viewedAt: new Date() } });
    party.status = "VIEWED";
  }
  const sender = ag.createdById ? await prisma.user.findUnique({ where: { id: ag.createdById }, select: { firstName: true, lastName: true } }) : null;
  const allFields: Field[] = Array.isArray(ag.fields) ? (ag.fields as unknown as Field[]) : [];
  const next = ag.signingOrder ? nextPartyInOrder(ag.parties.map((p) => ({ id: p.id, name: p.name, email: p.email, status: p.status, order: p.order }))) : null;
  const myTurn = !ag.signingOrder || party.status === "SIGNED" || party.status === "DECLINED" || (next ? next.id === party.id : false);

  // Other parties' values, keyed by THEIR fields only (a stored value for a
  // field that is not theirs is never shown).
  const otherValues: Record<string, string> = {};
  for (const p of ag.parties) {
    if (p.id === party.id || p.status !== "SIGNED") continue;
    const own = new Set(allFields.filter((f) => f.partyId === p.id).map((f) => f.id));
    for (const [k, v] of Object.entries((p.values as Record<string, unknown>) || {})) if (own.has(k) && typeof v === "string") otherValues[k] = v;
  }

  return NextResponse.json({
    title: ag.title,
    content: ag.content,
    sourceType: ag.sourceType,
    pdfUrl: ag.pdfUrl,
    status: ag.status,
    org: { name: org?.name ?? "WorkwrK", logo: org?.logo ?? null },
    sender: sender ? { name: `${sender.firstName} ${sender.lastName}`.trim() } : null,
    party: { id: party.id, name: party.name, email: party.email, role: party.role, status: party.status, signedAt: party.signedAt, declinedAt: party.declinedAt },
    fields: allFields,
    myFields: allFields.filter((f) => f.partyId === party.id),
    values: party.values || {},
    otherValues,
    otherParties: ag.parties.filter((p) => p.id !== party.id).map((p) => ({ id: p.id, name: p.name, role: p.role, status: p.status })),
    myTurn,
    waitingFor: !myTurn && next ? next.name : null,
    completionEmail: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PATCH { action: "sign" | "decline", values?, reason? }: sign (every
 * required field filled; records values, signedAt and the IP) or decline
 * (records the moment and the optional reason). Either way the sender gets
 * an Inbox row; when everyone has signed the envelope completes and the
 * sender gets contract.completed; with a signing order the next party is
 * emailed their link.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const party = await loadParty(token);
  if (party === "migration") return NOT_READY();
  if (!party) return GONE;
  const ag = party.agreement;
  if (ag.isTemplate || ag.archivedAt || ag.status === "VOIDED" || ag.status === "DRAFT") return GONE;
  if (party.status === "SIGNED") return NextResponse.json({ error: "Already signed" }, { status: 409 });
  if (party.status === "DECLINED") return NextResponse.json({ error: "Already declined" }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const action = body.action === "decline" ? "decline" : "sign";
  const { ipAddress, userAgent } = getRequestContext(req);

  if (action === "decline") {
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;
    await prisma.agreementParty.update({ where: { token }, data: { status: "DECLINED", declinedAt: new Date(), declineReason: reason, ipAddress, userAgent } });
    await notifySender({ agreementId: ag.id, createdById: ag.createdById, kind: "contract.declined", title: ag.title, partyName: party.name, reason });
    return NextResponse.json({ ok: true, status: "DECLINED" });
  }

  if (ag.signingOrder) {
    const next = nextPartyInOrder(ag.parties.map((p) => ({ id: p.id, name: p.name, email: p.email, status: p.status, order: p.order })));
    if (next && next.id !== party.id) return NextResponse.json({ error: `It's ${next.name}'s turn to sign first.` }, { status: 409 });
  }

  // Only this party's own fields, only strings, each capped: the row is the
  // signed evidence and every key of it is echoed to the other parties.
  const allFields: Field[] = Array.isArray(ag.fields) ? (ag.fields as unknown as Field[]) : [];
  const myFields = allFields.filter((x) => x.partyId === party.id);
  const values = sanitizeSignValues(myFields, body.values);
  for (const f of myFields) {
    const v = values[f.id];
    if (isRequiredField(f) && (!v || !v.trim())) return NextResponse.json({ error: "Please complete all required fields." }, { status: 400 });
  }

  await prisma.agreementParty.update({ where: { token }, data: { values, status: "SIGNED", signedAt: new Date(), ipAddress, userAgent } });
  const parties = await prisma.agreementParty.findMany({ where: { agreementId: ag.id }, orderBy: { order: "asc" } });
  const status = envelopeStatusAfter(parties);
  await prisma.agreement.update({ where: { id: ag.id }, data: { status } });

  await notifySender({ agreementId: ag.id, createdById: ag.createdById, kind: "contract.signed", title: ag.title, partyName: party.name });
  if (status === "COMPLETED") await notifySender({ agreementId: ag.id, createdById: ag.createdById, kind: "contract.completed", title: ag.title, partyName: party.name });
  else if (ag.signingOrder) {
    const next = nextPartyInOrder(parties.map((p) => ({ id: p.id, name: p.name, email: p.email, status: p.status, order: p.order })));
    if (next) {
      const np = parties.find((p) => p.id === next.id)!;
      await mailSigningLink({ orgId: ag.organizationId, agreementId: ag.id, title: ag.title, party: { id: np.id, name: np.name, email: np.email, token: np.token, userId: np.userId }, message: ag.sendMessage });
    }
  }
  return NextResponse.json({ ok: true, status: "SIGNED", completed: status === "COMPLETED" });
}
