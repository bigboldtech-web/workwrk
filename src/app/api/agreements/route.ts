import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: list agreements for the org (manager-gated).
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const agreements = await prisma.agreement.findMany({
    where: { organizationId: getOrgId(session) },
    orderBy: { updatedAt: "desc" },
    include: { parties: { select: { id: true, status: true } } },
  });

  return jsonSuccess(
    agreements.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      partyCount: a.parties.length,
      signedCount: a.parties.filter((p) => p.status === "SIGNED").length,
    })),
  );
}

// POST: create a draft agreement.
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => ({}));
  const agreement = await prisma.agreement.create({
    data: {
      organizationId: getOrgId(session),
      title: (typeof body.title === "string" && body.title.trim()) || "Untitled agreement",
      content: typeof body.content === "string" ? body.content : "",
      sourceType: body.sourceType === "pdf" ? "pdf" : "blocknote",
      pdfUrl: typeof body.pdfUrl === "string" ? body.pdfUrl : null,
      createdById: getUserId(session),
    },
  });
  return jsonSuccess(agreement, 201);
}
