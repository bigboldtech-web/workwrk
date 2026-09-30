// PATCH /api/settings/members/scopes  { userId, scopes: ("billing" | "security")[] }
//
// The Admin scopes menu (access-model-spec 2.1 and 6.2, Phase 8 stage E): an
// Owner lets one Admin open Billing (the billing scope) or Security and API
// (the security scope). Only an Owner (the real Owner in every flag state,
// re-read from the database) sets scopes, and only on an Admin who is not an
// Owner (Owners hold both). Scopes are read by the access engine with
// ACCESS_V2_TABLES on; until then the Owner pages follow SETTINGS_OWNER_SPLIT
// alone, which the Members drawer says. Audited `org_role.scopes_changed`.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminScopeTarget, freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { issueKey } from "@/lib/zod-issue-key";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const bodySchema = z
  .object({
    userId: z.string().min(1).max(64),
    scopes: z.array(z.enum(["billing", "security"])).max(2),
  })
  .strict();

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const actor = await freshWorkspaceActor(session);
  if (!actor.ok) return NextResponse.json({ error: actor.error, code: actor.code }, { status: actor.status, headers: NO_STORE });
  if (!actor.owner) return NextResponse.json({ error: "owner_only", message: "Only an Owner gives an Admin a scope." }, { status: 403, headers: NO_STORE });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", key: issueKey(parsed.error.issues[0]) }, { status: 400, headers: NO_STORE });
  const { userId } = parsed.data;
  const scopes = [...new Set(parsed.data.scopes)].sort();
  const target = await adminScopeTarget(u.organizationId, userId);
  if (!target.ok) {
    return NextResponse.json(
      target.error === "not_an_admin" ? { error: "not_an_admin", message: "Scopes are for Admins; Owners already hold both." } : { error: target.error },
      { status: target.status, headers: NO_STORE },
    );
  }
  const before = target.scopes;
  if (JSON.stringify(before) === JSON.stringify(scopes)) return NextResponse.json({ ok: true, scopes, noChange: true }, { headers: NO_STORE });
  await prisma.user.update({ where: { id: target.id }, data: { adminScopes: scopes } });
  const name = target.name;
  await logActivity({
    organizationId: u.organizationId,
    actorId: u.id,
    type: "org_role.scopes_changed",
    targetType: "user",
    targetId: target.id,
    description: scopes.length ? `Gave ${name} the ${scopes.join(" and ")} scope${scopes.length > 1 ? "s" : ""}` : `Took every scope away from ${name}`,
    oldValue: { adminScopes: before },
    newValue: { adminScopes: scopes },
  }).catch(() => {});
  return NextResponse.json({ ok: true, scopes }, { headers: NO_STORE });
}
