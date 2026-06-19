import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// POST: save this agreement as a reusable template (clones content, fields,
// category, and party roles — without emails/signing state).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const src = await prisma.agreement.findFirst({
    where: { id, organizationId: orgId },
    include: { parties: { orderBy: { order: "asc" } } },
  });
  if (!src) return jsonError("Not found", 404);

  const tpl = await prisma.agreement.create({
    data: {
      organizationId: orgId,
      title: `${src.title} (template)`,
      content: src.content,
      sourceType: src.sourceType,
      pdfUrl: src.pdfUrl,
      fields: src.fields as object,
      category: src.category,
      isTemplate: true,
      createdById: getUserId(session),
      parties: {
        create: src.parties.map((p, i) => ({ name: p.name, email: "", role: p.role, order: i, token: crypto.randomBytes(16).toString("hex") })),
      },
    },
  });
  return jsonSuccess(tpl, 201);
}
