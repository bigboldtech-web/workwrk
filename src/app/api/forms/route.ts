// GET  /api/forms              list forms in this org (with submission counts)
// POST /api/forms              create a form { name, fields?, isPublic?, targetBoardId? }

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const forms = await prisma.formDefinition.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { submissions: true } },
    },
  });

  // Decorate with submissionCount at top level so block embed can read it directly.
  return jsonSuccess(forms.map((f: typeof forms[number]) => ({ ...f, submissionCount: f._count.submissions })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const description = typeof body.description === "string" ? body.description.slice(0, 2000) : null;
  const fields = Array.isArray(body.fields) ? body.fields : [];
  const isPublic = body.isPublic === true;
  const targetBoardId = typeof body.targetBoardId === "string" && body.targetBoardId ? body.targetBoardId : null;
  const targetTableId = typeof body.targetTableId === "string" && body.targetTableId ? body.targetTableId : null;

  if (!name) return jsonError("name required");

  const form = await prisma.formDefinition.create({
    data: { organizationId: orgId, name, description, fields, isPublic, targetBoardId, targetTableId, createdById: userId },
  });

  return jsonSuccess(form, 201);
}
