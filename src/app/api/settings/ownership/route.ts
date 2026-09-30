import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { transferOwnership } from "@/lib/access/membership";
import { issueTokenVersionProof } from "@/lib/session-proof";

// POST /api/settings/ownership: Identity & culture > Danger zone > Transfer
// ownership (settings-architecture 5.2). Only a real Owner may do it, with
// or without SETTINGS_OWNER_SPLIT: an Admin never writes the Owner role
// (settings-architecture 9.2a, orgRole "write, never to or from Owner").
//
// Body { userId, removeMe }. The target becomes an Owner; with removeMe the
// caller becomes an Admin in the same transaction, and never before the new
// Owner exists, so the workspace is never without one (the last-Owner guard).
// The caller's own role change bumps their tokenVersion and returns the
// signed proof, so their session adopts it and stays signed in
// (src/lib/session-proof.ts); the promoted person keeps their sessions and
// picks the role up within five minutes (the jwt revalidation), the same
// decision the Staff console's Set Owner made: a promotion never signs
// anyone out.

const bodySchema = z.strictObject({
  userId: z.string().min(1).max(64),
  removeMe: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!su?.id || !su.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return NextResponse.json({ error: fresh.error, code: fresh.code }, { status: fresh.status });
  if (!fresh.owner) {
    return NextResponse.json({ error: "Only a workspace Owner can transfer ownership" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { userId, removeMe }" }, { status: 400 });

  const result = await transferOwnership(prisma, {
    organizationId: su.organizationId,
    actorId: su.id,
    targetId: parsed.data.userId,
    removeMe: parsed.data.removeMe === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  logAuditEvent({
    type: "org_role.changed",
    actorId: su.id,
    organizationId: su.organizationId,
    description: `Made ${result.targetName} an Owner${result.selfDemoted ? " and stepped down to Admin" : ""}`,
    targetType: "user",
    targetId: result.targetId,
    severity: "critical",
    oldValue: { role: result.targetBefore },
    newValue: { role: "OWNER" },
    metadata: { selfDemoted: result.selfDemoted },
  });
  // Each implicit Owner written as an explicit one gets its own row: their
  // effective role did not change, but the stored one did.
  for (const f of result.frozen) {
    logAuditEvent({
      type: "org_role.changed",
      actorId: su.id,
      organizationId: su.organizationId,
      description: `Kept ${f.name} an Owner while ownership moved (stored as an explicit Owner)`,
      targetType: "user",
      targetId: f.id,
      severity: "warning",
      oldValue: { role: "OWNER", level: "COMPANY_ADMIN" },
      newValue: { role: "OWNER", level: "SUPER_ADMIN" },
      metadata: { ownershipTransfer: true },
    });
  }

  const proof = result.selfVersion ? issueTokenVersionProof(su.id, result.selfVersion.from, result.selfVersion.to) : null;
  return NextResponse.json({ ok: true, tokenVersionProof: proof });
}
