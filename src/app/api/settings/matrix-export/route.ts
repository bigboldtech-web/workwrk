import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";

// GET /api/settings/matrix-export?id=: the one-time download of the retired
// permissions grid (settings spec Data > Export, access 9): the matrix the
// org had stored, exactly as it was written into its access.matrix_retired
// audit row, as a JSON file. Owner only (every Admin until the split).
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await sessionMayManageOwnerPage(session))) return NextResponse.json({ error: "Only workspace Owners can download this" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const row = await prisma.activityLog.findFirst({
    where: { id, organizationId: orgId, type: "access.matrix_retired" },
    select: { createdAt: true, oldValue: true, metadata: true },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = JSON.stringify({ retiredAt: row.createdAt.toISOString(), permissions: row.oldValue ?? null, note: (row.metadata as { note?: string } | null)?.note ?? null }, null, 2);
  return new Response(body, {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="previous-permissions-grid.json"`, "Cache-Control": "no-store" },
  });
}
