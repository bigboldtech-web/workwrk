import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { applyRoleChange } from "@/lib/access/membership";
import { sessionIsWorkspaceAdmin, sessionIsWorkspaceOwner } from "@/lib/access/workspace-admin";

// POST /api/settings/members/bulk: change several people's role in ONE
// confirmed step (carried from Phase 9). Owner and Admin. Each person goes
// through the same planner as the drawer (src/lib/access/membership.ts), so
// every guard holds per person, and each change writes its OWN
// org_role.changed row. People the planner refuses are reported, never
// silently skipped; the rest still change.
const bodySchema = z.strictObject({
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  tier: z.string().max(32).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!su?.id || !su.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sessionIsWorkspaceAdmin(session)) return NextResponse.json({ error: "Only Owners and Admins change roles" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { ids, role, tier }" }, { status: 400 });
  const actorIsOwner = await sessionIsWorkspaceOwner(session);
  const results: { id: string; ok: boolean; error?: string; changed?: boolean }[] = [];
  for (const id of [...new Set(parsed.data.ids)]) {
    if (id === su.id) { results.push({ id, ok: false, error: "Change your own role from your row, one at a time" }); continue; }
    const r = await applyRoleChange(prisma, {
      organizationId: su.organizationId,
      actorId: su.id,
      actorIsAdmin: true,
      actorIsOwner,
      targetId: id,
      next: { role: parsed.data.role, tier: parsed.data.tier ?? null },
    });
    if (!r.ok) { results.push({ id, ok: false, error: r.error }); continue; }
    results.push({ id, ok: true, changed: r.changed });
    if (r.changed) {
      void logActivity({
        type: "org_role.changed",
        actorId: su.id,
        organizationId: su.organizationId,
        description: `Changed a role from ${r.before.role.toLowerCase()} to ${r.after.role.toLowerCase()} (bulk)`,
        targetId: id,
        targetType: "user",
        severity: "warning",
        oldValue: { role: r.before.role, level: r.before.level },
        newValue: { role: r.after.role, level: r.after.level },
        metadata: { bulk: true, tokenVersionBumped: r.bumped },
      });
    }
  }
  return NextResponse.json({ results, changed: results.filter((x) => x.ok && x.changed).length, refused: results.filter((x) => !x.ok).length });
}
