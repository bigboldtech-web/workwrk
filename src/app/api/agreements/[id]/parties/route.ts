import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// POST: add a party (recipient) to an agreement. Generates a public sign token.
//   { name, email, role?, userId?, order? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const agreement = await prisma.agreement.findFirst({ where: { id, organizationId: getOrgId(session) }, select: { id: true } });
  if (!agreement) return jsonError("Not found", 404);

  const body = await req.json();
  const count = await prisma.agreementParty.count({ where: { agreementId: id } });
  // A party can be created as a placeholder ("Nth Party") and have its email
  // filled in later — email is validated at send time, not here.
  const name = (typeof body.name === "string" && body.name.trim()) || `${count + 1}th Party`;
  const email = typeof body.email === "string" ? body.email.trim() : "";

  const party = await prisma.agreementParty.create({
    data: {
      agreementId: id,
      name,
      email,
      role: typeof body.role === "string" ? body.role : "SIGNER",
      userId: typeof body.userId === "string" ? body.userId : null,
      order: typeof body.order === "number" ? body.order : count,
      token: crypto.randomBytes(16).toString("hex"),
    },
  });
  return jsonSuccess(party, 201);
}

// PATCH: update a party's name / email / role. { partyId, name?, email?, role? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const body = await req.json();
  const partyId = typeof body.partyId === "string" ? body.partyId : "";
  if (!partyId) return jsonError("partyId required");
  const party = await prisma.agreementParty.findFirst({
    where: { id: partyId, agreementId: id, agreement: { organizationId: getOrgId(session) } },
    select: { id: true },
  });
  if (!party) return jsonError("Not found", 404);

  const data: { name?: string; email?: string; role?: string } = {};
  if (typeof body.name === "string") data.name = body.name.trim() || "Party";
  if (typeof body.email === "string") data.email = body.email.trim();
  if (typeof body.role === "string") data.role = body.role;
  const updated = await prisma.agreementParty.update({ where: { id: partyId }, data });
  return jsonSuccess(updated);
}

// DELETE: remove a party. ?partyId=
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const partyId = new URL(req.url).searchParams.get("partyId");
  if (!partyId) return jsonError("partyId required");
  const party = await prisma.agreementParty.findFirst({
    where: { id: partyId, agreementId: id, agreement: { organizationId: getOrgId(session) } },
    select: { id: true },
  });
  if (!party) return jsonError("Not found", 404);
  await prisma.agreementParty.delete({ where: { id: partyId } });
  return jsonSuccess({ deleted: true });
}
