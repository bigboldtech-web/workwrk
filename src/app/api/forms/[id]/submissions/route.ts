// GET  /api/forms/[id]/submissions   list submissions for a form (org member only)
// POST /api/forms/[id]/submissions   submit; org members always; anonymous only when isPublic

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!form) return jsonError("not found", 404);

  const subs = await prisma.formSubmission.findMany({
    where: { formId: id, organizationId: orgId },
    orderBy: { submittedAt: "desc" },
    take: 500,
  });

  return jsonSuccess(subs);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data = typeof body.data === "object" && body.data !== null ? body.data : {};

  // Try to read session — if signed in, use orgId from session. If
  // the form is public, allow anonymous submission and read the form
  // first to discover its orgId.
  const session = await getServerSession(authOptions);
  const userId = session?.user ? (session.user as { id?: string }).id ?? null : null;

  const form = await prisma.formDefinition.findUnique({ where: { id } });
  if (!form) return jsonError("not found", 404);

  // Auth gate: signed-in users must belong to the form's org; if
  // unsigned-in, only allowed when isPublic.
  if (!userId) {
    if (!form.isPublic) return jsonError("not authorised", 401);
  } else {
    if (session && (session.user as { organizationId?: string }).organizationId !== form.organizationId) {
      return jsonError("not authorised", 403);
    }
  }

  const sub = await prisma.formSubmission.create({
    data: {
      organizationId: form.organizationId,
      formId: id,
      data,
      submittedById: userId,
    },
  });

  return jsonSuccess(sub, 201);
}
