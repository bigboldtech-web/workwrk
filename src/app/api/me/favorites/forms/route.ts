// GET    /api/me/favorites/forms            hydrated starred FormDefinition list
// POST   /api/me/favorites/forms { formId, on }   toggle
// DELETE /api/me/favorites/forms?formId=    un-star (the same write as on:false)
//
// Phase 5 (Data): the form twin of /api/me/favorites/tables, which is what
// the deleted FormsSidebar's "Star a Form to see it here" card promised and
// could never deliver. Stored under UserPreference home.favoriteFormIds.
// Forms carry no Space of their own and the access engine is inert, so every
// form in the viewer's org is readable (the same set GET /api/forms lists).

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserHomeKey } from "@/lib/preferences";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";

type SessionUser = { id?: string; organizationId?: string; guest?: boolean };

async function currentIds(u: Required<SessionUser>): Promise<string[]> {
  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const raw = (effective?.home as { favoriteFormIds?: unknown } | undefined)?.favoriteFormIds;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

async function sessionUser(): Promise<Required<SessionUser> | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as SessionUser | undefined;
  if (!u?.id || !u.organizationId) return null;
  const viewer = await viewerFromSession().catch(() => null);
  return { id: u.id, organizationId: u.organizationId, guest: viewer?.orgRole === "GUEST" };
}

/** The forms this person may read: the org's, or for a Guest only the ones
 *  they made (the same scope as GET /api/forms). */
function formScope(u: Required<SessionUser>) {
  return u.guest
    ? { organizationId: u.organizationId, createdById: u.id }
    : { organizationId: u.organizationId };
}

export async function GET() {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ids = await currentIds(u);
  if (ids.length === 0) return NextResponse.json({ forms: [] });
  const rows = await prisma.formDefinition.findMany({
    where: { ...formScope(u), id: { in: ids } },
    select: { id: true, name: true, description: true },
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ forms: rows });
}

const bodySchema = z.object({ formId: z.string().min(1), on: z.boolean() });

async function write(u: Required<SessionUser>, formId: string, on: boolean) {
  const set = new Set(await currentIds(u));
  if (on) {
    // Only a form in the viewer's own org can be starred: an id from another
    // tenant would sit in the preference as a probe with no row behind it.
    const form = await prisma.formDefinition.findFirst({ where: { id: formId, ...formScope(u) }, select: { id: true } });
    if (!form) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Most recently starred first (the FAVORITES section's order).
    set.delete(formId);
    const next = [formId, ...set];
    await setUserHomeKey(u.id, "favoriteFormIds", next);
    return NextResponse.json({ favoriteFormIds: next });
  }
  set.delete(formId);
  await setUserHomeKey(u.id, "favoriteFormIds", Array.from(set));
  return NextResponse.json({ favoriteFormIds: Array.from(set) });
}

export async function POST(req: Request) {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  return write(u, parsed.data.formId, parsed.data.on);
}

export async function DELETE(req: Request) {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const formId = new URL(req.url).searchParams.get("formId")?.trim();
  if (!formId) return NextResponse.json({ error: "formId required" }, { status: 400 });
  return write(u, formId, false);
}
