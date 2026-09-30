import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";

// POST /api/org/sign-out-everyone { confirm: "SIGN OUT" }: Workspace settings
// > Security > Danger zone. Bumps tokenVersion for EVERY person whose home
// workspace this is, the caller included, so every session everywhere ends
// on its next check (at most five minutes, src/lib/auth.ts revalidation).
// No proof is returned: "Everyone, including you, signs in again." Owner
// page (every Admin until the Owner and Admin split).
const bodySchema = z.strictObject({ confirm: z.literal("SIGN OUT") });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!su?.id || !su.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await sessionMayManageOwnerPage(session))) return NextResponse.json({ error: "Only workspace Owners can sign everyone out" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Type SIGN OUT to confirm' }, { status: 400 });

  const r = await prisma.user.updateMany({ where: { organizationId: su.organizationId }, data: { tokenVersion: { increment: 1 } } });
  logAuditEvent({
    type: "security.sign_out_all",
    actorId: su.id,
    organizationId: su.organizationId,
    description: `Signed everyone out (${r.count} ${r.count === 1 ? "person" : "people"})`,
    targetType: "Organization",
    targetId: su.organizationId,
    severity: "critical",
    metadata: { people: r.count },
  });
  return NextResponse.json({ ok: true, signedOut: r.count });
}
