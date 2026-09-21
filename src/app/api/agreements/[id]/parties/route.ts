import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { PARTY_ROLES } from "@/lib/contracts";

const SENT_LOCKED = "This contract has been sent for signature. Its parties are fixed; void it to withdraw it.";
const PARTY_LOCKED = "A party who has signed or declined cannot be changed.";

/**
 * POST /api/agreements/[id]/parties { name?, email?, role?, userId?, order? }
 * Adds a party. A party can start as a placeholder and get its email later;
 * emails are validated at Send. Picking a teammate (`userId`) fills the
 * name and email from the directory.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const agreement = await prisma.agreement.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true, isTemplate: true } });
  if (!agreement) return jsonError("Not found", 404);
  if (!agreement.isTemplate && agreement.status !== "DRAFT") return jsonError(SENT_LOCKED, 409);

  const body = await req.json().catch(() => ({}));
  const count = await prisma.agreementParty.count({ where: { agreementId: id } });
  let name = (typeof body.name === "string" && body.name.trim()) || "";
  let email = typeof body.email === "string" ? body.email.trim() : "";
  let userId: string | null = typeof body.userId === "string" ? body.userId : null;
  if (userId) {
    const u = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId }, select: { firstName: true, lastName: true, email: true } });
    if (!u) userId = null;
    else { name = name || `${u.firstName} ${u.lastName}`.trim(); email = email || u.email; }
  }
  if (!name) name = `${ordinal(count + 1)} Party`;

  const party = await prisma.agreementParty.create({
    data: {
      agreementId: id,
      name,
      email,
      role: typeof body.role === "string" && PARTY_ROLES.includes(body.role) ? body.role : "SIGNER",
      userId,
      order: typeof body.order === "number" ? body.order : count,
      token: crypto.randomBytes(16).toString("hex"),
    },
  });
  return jsonSuccess(party, 201);
}

/**
 * PATCH { partyId, name?, email?, role?, userId?, order? } or { order: [partyId, ...] }
 * to reorder every party at once.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));

  const agreement = await prisma.agreement.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true, isTemplate: true } });
  if (!agreement) return jsonError("Not found", 404);
  const draft = agreement.isTemplate || agreement.status === "DRAFT";

  if (Array.isArray(body.order)) {
    if (!draft) return jsonError(SENT_LOCKED, 409);
    const ids: string[] = body.order.filter((x: unknown): x is string => typeof x === "string");
    const rows = await prisma.agreementParty.findMany({ where: { agreementId: id, agreement: { organizationId: orgId } }, select: { id: true } });
    const known = new Set(rows.map((r) => r.id));
    await prisma.$transaction(ids.filter((pid) => known.has(pid)).map((pid, i) => prisma.agreementParty.update({ where: { id: pid }, data: { order: i } })));
    return jsonSuccess({ reordered: ids.length });
  }

  const partyId = typeof body.partyId === "string" ? body.partyId : "";
  if (!partyId) return jsonError("partyId required");
  const party = await prisma.agreementParty.findFirst({ where: { id: partyId, agreementId: id, agreement: { organizationId: orgId } }, select: { id: true, status: true } });
  if (!party) return jsonError("Not found", 404);
  // Once a party has signed or declined, their row is evidence: no rename, no
  // new email, no role change. A pending party on a sent contract may still
  // have a mistyped email corrected (Resend then reaches them); order and
  // role are fixed at Send.
  if (party.status === "SIGNED" || party.status === "DECLINED") return jsonError(PARTY_LOCKED, 409);
  if (!draft && (body.role !== undefined || body.order !== undefined || body.userId !== undefined)) return jsonError(SENT_LOCKED, 409);

  const data: { name?: string; email?: string; role?: string; userId?: string | null; order?: number } = {};
  if (typeof body.name === "string") data.name = body.name.trim() || "Party";
  if (typeof body.email === "string") data.email = body.email.trim();
  if (typeof body.role === "string" && PARTY_ROLES.includes(body.role)) data.role = body.role;
  if (body.userId === null) data.userId = null;
  if (typeof body.userId === "string") {
    const u = await prisma.user.findFirst({ where: { id: body.userId, organizationId: orgId }, select: { firstName: true, lastName: true, email: true } });
    if (u) { data.userId = body.userId; data.name = data.name ?? `${u.firstName} ${u.lastName}`.trim(); data.email = data.email ?? u.email; }
  }
  if (typeof body.order === "number") data.order = body.order;
  const updated = await prisma.agreementParty.update({ where: { id: partyId }, data });
  return jsonSuccess(updated);
}

/** DELETE ?partyId= : remove a party from a draft or template (the fields placed for it stay on the page until edited). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const partyId = new URL(req.url).searchParams.get("partyId");
  if (!partyId) return jsonError("partyId required");
  const party = await prisma.agreementParty.findFirst({ where: { id: partyId, agreementId: id, agreement: { organizationId: getOrgId(session) } }, select: { id: true, status: true, agreement: { select: { status: true, isTemplate: true } } } });
  if (!party) return jsonError("Not found", 404);
  if (party.status === "SIGNED") return jsonError("A party who has signed cannot be removed. Void the contract instead.", 409);
  if (!party.agreement.isTemplate && party.agreement.status !== "DRAFT") return jsonError(SENT_LOCKED, 409);
  await prisma.agreementParty.delete({ where: { id: partyId } });
  return jsonSuccess({ deleted: true });
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
