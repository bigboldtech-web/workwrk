import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Field = { id: string; type: string; partyId: string; x: number; y: number; w: number; h: number; label?: string; required?: boolean };

// GET: fetch the document + this party's fields by token (no auth).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const party = await prisma.agreementParty.findUnique({ where: { token }, include: { agreement: true } });
  if (!party) return NextResponse.json({ error: "Not found or link expired" }, { status: 404 });

  const ag = party.agreement;
  const allFields: Field[] = Array.isArray(ag.fields) ? (ag.fields as unknown as Field[]) : [];
  return NextResponse.json({
    title: ag.title,
    content: ag.content,
    sourceType: ag.sourceType,
    pdfUrl: ag.pdfUrl,
    status: ag.status,
    party: { id: party.id, name: party.name, email: party.email, role: party.role, status: party.status },
    fields: allFields,
    myFields: allFields.filter((f) => f.partyId === party.id),
    values: party.values || {},
  });
}

// PATCH: submit this party's field values + signature (no auth). Marks SIGNED.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const party = await prisma.agreementParty.findUnique({ where: { token }, include: { agreement: { select: { id: true, fields: true } } } });
  if (!party) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (party.status === "SIGNED") return NextResponse.json({ error: "Already signed" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const values: Record<string, string> = body.values || {};

  const allFields: Field[] = Array.isArray(party.agreement.fields) ? (party.agreement.fields as unknown as Field[]) : [];
  const myFields = allFields.filter((f) => f.partyId === party.id);
  for (const f of myFields) {
    const v = values[f.id];
    const required = f.type === "signature" || f.type === "initials" || f.required;
    if (required && (!v || (typeof v === "string" && !v.trim()))) {
      return NextResponse.json({ error: "Please complete all required fields." }, { status: 400 });
    }
  }

  const { ipAddress } = getRequestContext(req);
  await prisma.agreementParty.update({
    where: { token },
    data: { values, status: "SIGNED", signedAt: new Date(), ipAddress },
  });

  // Roll up the envelope status.
  const parties = await prisma.agreementParty.findMany({ where: { agreementId: party.agreement.id }, select: { status: true } });
  const allSigned = parties.every((p) => p.status === "SIGNED");
  await prisma.agreement.update({
    where: { id: party.agreement.id },
    data: { status: allSigned ? "COMPLETED" : "PARTIALLY_SIGNED" },
  });

  return NextResponse.json({ ok: true, status: "SIGNED", completed: allSigned });
}
