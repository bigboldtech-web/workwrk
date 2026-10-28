import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { applyRoleChange, roleChangeSentence } from "@/lib/access/membership";
import { rolesBusyAnswer } from "@/lib/access/org-roles-busy";
import { freshActorRefusal, freshWorkspaceActor, sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { afterRoleChanges } from "@/lib/access/role-change-after";

// POST /api/settings/members/bulk: change several people's role in ONE
// confirmed step (carried from Phase 9). Owner and Admin. Each person goes
// through the same planner as the drawer (src/lib/access/membership.ts), so
// every guard holds per person, and each change writes its OWN
// org_role.changed row. People the planner refuses are reported, never
// silently skipped; the rest still change. Everyone made an agent account
// has their AI teammate connections and browsers ended after the changes,
// as the drawer's change does (role-change-after.ts, docs-found fixes
// batch 5).
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
  // The actor as the database has them now (a demoted Admin is refused at
  // once), and again per person under the role lock inside applyRoleChange.
  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return freshActorRefusal(fresh);
  if (!fresh.admin) return NextResponse.json({ error: "Only Owners and Admins change roles" }, { status: 403 });
  const actorIsOwner = fresh.owner;
  const results: { id: string; ok: boolean; error?: string; code?: string; changed?: boolean }[] = [];
  const applied: Array<{ userId: string; change: { changed: boolean; after: { level: string; role: "OWNER" | "ADMIN" | "MEMBER" } } }> = [];
  for (const id of [...new Set(parsed.data.ids)]) {
    if (id === su.id) { results.push({ id, ok: false, error: "Change your own role from your row, one at a time" }); continue; }
    const r = await applyRoleChange(prisma, {
      organizationId: su.organizationId,
      actorId: su.id,
      actorIsAdmin: true,
      actorIsOwner,
      targetId: id,
      next: { role: parsed.data.role, tier: parsed.data.tier ?? null },
    }).catch((e: unknown) => {
      // The role lock was busy: this person is reported, nothing of theirs
      // changed, and the rest still change (membership.ts lockOrgRoles).
      const busy = rolesBusyAnswer(e);
      if (busy) return { ok: false as const, status: busy.status, error: busy.error, code: busy.code };
      throw e;
    });
    // A person with reports is never made an Agent (membership.ts rule 6):
    // refused and named with its code, and the rest still change.
    if (!r.ok) { results.push({ id, ok: false, error: r.error, ...(r.code ? { code: r.code } : {}) }); continue; }
    results.push({ id, ok: true, changed: r.changed });
    applied.push({ userId: id, change: r });
    if (r.changed) {
      void logActivity({
        type: "org_role.changed",
        actorId: su.id,
        organizationId: su.organizationId,
        description: `${roleChangeSentence(r.targetName, r)} (bulk change)`,
        targetId: id,
        targetType: "user",
        severity: "warning",
        oldValue: { role: r.before.role, level: r.before.level },
        newValue: { role: r.after.role, level: r.after.level },
        metadata: { bulk: true, tokenVersionBumped: r.bumped },
      });
    }
  }
  // After every change committed, never failing the request (PATCH's path).
  await afterRoleChanges(su.organizationId, applied, su.id);
  return NextResponse.json({ results, changed: results.filter((x) => x.ok && x.changed).length, refused: results.filter((x) => !x.ok).length });
}
