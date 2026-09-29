// The org's custom profile fields (decided addition c).
//
//   GET  every Member (never a Guest): the definitions, in order, and
//        whether the viewer may edit them.
//   PUT  Owner, Admin and the People team: the whole list, validated by
//        validateProfileFieldDefs. Removing a field never deletes anyone's
//        value (the record only stops showing it).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPeopleAdmin, peopleCtx } from "@/lib/people/person-access.server";
import { readProfileFieldDefs, validateProfileFieldDefs } from "@/lib/people/profile-fields";
import { settingsKey, writeOrgSettingsKeys } from "@/lib/org-settings-write";
import { logActivity } from "@/lib/activity";

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET() {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { settings: true } });
  return NextResponse.json(
    { fields: readProfileFieldDefs(org?.settings), canEdit: isPeopleAdmin(ctx) && !ctx.isAgent },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  if (!isPeopleAdmin(ctx) || ctx.isAgent) return err(403, "Owners, Admins and the People team define profile fields.");
  const body = (await req.json().catch(() => null)) as { fields?: unknown } | null;
  const v = validateProfileFieldDefs(body?.fields);
  if (!v.ok) return err(400, v.error);
  const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { settings: true } });
  // The "people" key is merged inside, never replaced wholesale.
  const people = settingsKey(org?.settings, "people");
  await writeOrgSettingsKeys(ctx.organizationId, { people: { ...people, profileFields: v.value } });
  void logActivity({
    type: "profile_fields_changed",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Updated the profile fields (${v.value.length})`,
    targetType: "organization",
    targetId: ctx.organizationId,
  });
  return NextResponse.json({ fields: v.value });
}
