import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

function token() { return crypto.randomBytes(16).toString("hex"); }

// GET: list contracts. ?view=templates | trash (default = live contracts).
// Manager-gated. Lazily purges trash items older than 60 days.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const view = sp.get("view") === "templates" ? "templates" : sp.get("view") === "trash" ? "trash" : "live";

  // Auto-purge: archived > 60 days ago is permanently deleted.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await prisma.agreement.deleteMany({ where: { organizationId: orgId, archivedAt: { lt: cutoff } } });

  const where =
    view === "trash" ? { organizationId: orgId, archivedAt: { not: null } } :
    view === "templates" ? { organizationId: orgId, isTemplate: true, archivedAt: null } :
    { organizationId: orgId, isTemplate: false, archivedAt: null };

  const agreements = await prisma.agreement.findMany({
    where, orderBy: { updatedAt: "desc" },
    include: { parties: { select: { id: true, status: true } } },
  });

  return jsonSuccess(
    agreements.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      category: a.category,
      isTemplate: a.isTemplate,
      archivedAt: a.archivedAt,
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
      // Start with the two standard parties (company + counterparty).
      parties: {
        create: [
          { name: "1st Party", email: "", role: "COMPANY", order: 0, token: token() },
          { name: "2nd Party", email: "", role: "SIGNER", order: 1, token: token() },
        ],
      },
    },
  });
  return jsonSuccess(created, 201);
}
