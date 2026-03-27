import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// GET: Get single assignment with full SOP content
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;

  const assignment = await prisma.sOPAssignment.findFirst({
    where: { id, sop: { organizationId: getOrgId(session) } },
    include: {
      sop: true,
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  if (!assignment) return jsonError("Assignment not found", 404);

  return jsonSuccess(assignment);
}

// PUT: Update assignment (dueDate, mandatory)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const body = await req.json();
  const { dueDate, mandatory } = body;

  const assignment = await prisma.sOPAssignment.findFirst({
    where: { id, sop: { organizationId: getOrgId(session) } },
  });
  if (!assignment) return jsonError("Assignment not found", 404);

  const updated = await prisma.sOPAssignment.update({
    where: { id },
    data: {
      dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : undefined,
      mandatory: mandatory ?? undefined,
    },
  });

  return jsonSuccess(updated);
}

// DELETE: Remove assignment
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;

  const assignment = await prisma.sOPAssignment.findFirst({
    where: { id, sop: { organizationId: getOrgId(session) } },
  });
  if (!assignment) return jsonError("Assignment not found", 404);

  await prisma.sOPAssignment.delete({ where: { id } });

  return jsonSuccess({ message: "Assignment removed" });
}
