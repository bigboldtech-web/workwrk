// GET /api/me/policies: the policies the current user still has to
// acknowledge, for the "Policies to acknowledge" section on /today. The same
// rule as the sidebar badge and the /policies Needs view (lib/policies-to-ack).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listPoliciesToAck } from "@/lib/policies-to-ack";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await listPoliciesToAck(u.id, u.organizationId);
  return NextResponse.json({
    policies: rows.map((a) => ({
      assignmentId: a.assignmentId,
      policyId: a.policyId,
      title: a.title,
      mandatory: a.mandatory,
      dueDate: a.dueDate,
      status: a.status,
    })),
  });
}
