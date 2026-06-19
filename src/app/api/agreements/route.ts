import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

function token() { return crypto.randomBytes(16).toString("hex"); }

// GET: list agreements (or ?templates=1 for reusable templates), manager-gated.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const wantTemplates = new URL(req.url).searchParams.get("templates") === "1";
  const agreements = await prisma.agreement.findMany({
    where: { organizationId: getOrgId(session), isTemplate: wantTemplates },
    orderBy: { updatedAt: "desc" },
    include: { parties: { select: { id: true, status: true } } },
  });

  return jsonSuccess(
    agreements.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      category: a.category,
      isTemplate: a.isTemplate,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      partyCount: a.parties.length,
      signedCount: a.parties.filter((p) => p.status === "SIGNED").length,
    })),
  );
}

// POST: create an agreement.
//   { title?, content?, sourceType?, pdfUrl?, category?, isTemplate?, fromTemplateId? }
// A normal live agreement is seeded with two parties (company + counterparty).
// fromTemplateId clones a template's content/fields/category/party roles.
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));

  // ── Create from a template ──
  if (typeof body.fromTemplateId === "string" && body.fromTemplateId) {
    const tpl = await prisma.agreement.findFirst({
      where: { id: body.fromTemplateId, organizationId: orgId, isTemplate: true },
      include: { parties: { orderBy: { order: "asc" } } },
    });
    if (!tpl) return jsonError("Template not found", 404);
    const created = await prisma.agreement.create({
      data: {
        organizationId: orgId,
        title: (typeof body.title === "string" && body.title.trim()) || tpl.title.replace(/\s*\(template\)\s*$/i, ""),
        content: tpl.content,
        sourceType: tpl.sourceType,
        pdfUrl: tpl.pdfUrl,
        fields: tpl.fields as object,
        category: tpl.category,
        createdById: getUserId(session),
        parties: {
          create: tpl.parties.map((p, i) => ({ name: p.name, email: "", role: p.role, order: i, token: token() })),
        },
      },
    });
    return jsonSuccess(created, 201);
  }

  const isTemplate = body.isTemplate === true;
  const sourceType = body.sourceType === "pdf" ? "pdf" : "blocknote";
  const created = await prisma.agreement.create({
    data: {
      organizationId: orgId,
      title: (typeof body.title === "string" && body.title.trim()) || (isTemplate ? "Untitled template" : "Untitled agreement"),
      content: typeof body.content === "string" ? body.content : "",
      sourceType,
      pdfUrl: typeof body.pdfUrl === "string" ? body.pdfUrl : null,
      category: typeof body.category === "string" ? body.category : null,
      isTemplate,
      createdById: getUserId(session),
      // Live agreements start with the two standard parties.
      parties: isTemplate ? undefined : {
        create: [
          { name: "1st Party", email: "", role: "COMPANY", order: 0, token: token() },
          { name: "2nd Party", email: "", role: "SIGNER", order: 1, token: token() },
        ],
      },
    },
  });
  return jsonSuccess(created, 201);
}
