import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { freshMayManageOwnerPage, freshWorkspaceActor, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";

// POST /api/org/sign-out-everyone { confirm: "SIGN OUT" }: Workspace settings
// > Security > Danger zone. Bumps tokenVersion for EVERY person who belongs
// to this workspace (anchored here, or a member switched elsewhere), the
// caller included, so every session everywhere ends
// on its next check (at most five minutes, src/lib/auth.ts revalidation).
// No proof is returned: "Everyone, including you, signs in again." Owner
// page (every Admin until the Owner and Admin split).
const bodySchema = z.strictObject({ confirm: z.literal("SIGN OUT") });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!su?.id || !su.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await sessionMayManageOwnerPage(session, "security"))) return NextResponse.json({ error: "Only workspace Owners can sign everyone out" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Type SIGN OUT to confirm' }, { status: 400 });

  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return NextResponse.json({ error: fresh.error, code: fresh.code }, { status: fresh.status });
  if (!freshMayManageOwnerPage(fresh, "security")) return NextResponse.json({ error: "Only workspace Owners can sign everyone out" }, { status: 403 });

  // Everyone who belongs here: anchored in this workspace, AND everyone who
  // holds a membership here while switched into another one (they could
  // switch back in on the session they have). A tokenVersion ends every
  // session the account has, wherever it acts; that is the point of the
  // button after a breach.
  const members = await prisma.organizationMembership.findMany({
    where: { organizationId: su.organizationId, user: { organizationId: { not: su.organizationId } } },
    select: { userId: true },
  });
  const r = await prisma.user.updateMany({
    where: { OR: [{ organizationId: su.organizationId }, { id: { in: members.map((m) => m.userId) } }] },
    data: { tokenVersion: { increment: 1 } },
  });
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
