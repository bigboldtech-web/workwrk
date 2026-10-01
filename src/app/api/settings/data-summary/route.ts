import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionIsWorkspaceAdmin, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";

// GET /api/settings/data-summary: what Workspace settings > Data needs beyond
// the settings blob, in one read (Owner and Admin, like the page):
//   legacy         how many PurchaseOrder and Invoice rows the org holds (the
//                  two Legacy export rows render only when there are some)
//   recentExports  the last 20 exports (data.exported, and the older
//                  tenant_export and csv_exported rows so history is kept)
//   matrixRetired  the one access.matrix_retired row, when the permissions
//                  grid has been retired and its copy is downloadable
//   canPurge       the retention rows are Owner rows (every Admin until the
//                  Owner and Admin split is approved)

const EXPORT_TYPES = ["data.exported", "tenant_export", "csv_exported"];

export async function GET() {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sessionIsWorkspaceAdmin(session)) return NextResponse.json({ error: "no_access", page: "data" }, { status: 403 });

  const [purchaseOrders, invoices, exports, matrix, canPurge] = await Promise.all([
    prisma.purchaseOrder.count({ where: { organizationId: orgId } }).catch(() => 0),
    prisma.invoice.count({ where: { organizationId: orgId } }).catch(() => 0),
    prisma.activityLog.findMany({
      where: { organizationId: orgId, type: { in: EXPORT_TYPES } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, description: true, metadata: true, actorLabel: true, actor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.activityLog.findFirst({ where: { organizationId: orgId, type: "access.matrix_retired" }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } }),
    sessionMayManageOwnerPage(session),
  ]);

  return NextResponse.json(
    {
      legacy: { purchaseOrders, invoices },
      recentExports: exports.map((e) => ({
        id: e.id,
        when: e.createdAt.toISOString(),
        who: e.actor ? `${e.actor.firstName} ${e.actor.lastName}`.trim() : e.actorLabel ?? "System",
        // Older rows were written "1 skill rows" / "(1 rows)": read in the singular.
        what: e.description.replace(/\b1 (\w+ )?rows\b/g, (_m, w: string | undefined) => `1 ${w ?? ""}row`),
        kind: (e.metadata as { kind?: string } | null)?.kind ?? null,
      })),
      matrixRetired: matrix ? { id: matrix.id, at: matrix.createdAt.toISOString() } : null,
      canPurge,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
