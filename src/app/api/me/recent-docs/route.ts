// GET  /api/me/recent-docs — raw recently-viewed doc ids + timestamps
// POST /api/me/recent-docs { docId } — record a view (MRU, cap 20)
//
// Mirror of /api/me/favorites/docs, riding the same UserPreference.home
// JSON column (HomePref.recentDocViews). GET returns raw ids + ISO
// timestamps only — the Docs hub already holds full rows from /api/docs,
// so no hydration here.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserPreference } from "@/lib/preferences";

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const views = Array.isArray(effective?.home?.recentDocViews)
    ? effective.home.recentDocViews
    : [];
  return NextResponse.json({ views });
}

const bodySchema = z.object({
  docId: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const current = Array.isArray(effective?.home?.recentDocViews)
    ? effective.home.recentDocViews
    : [];
  const next = [
    { id: parsed.data.docId, at: new Date().toISOString() },
    ...current.filter((v) => v.id !== parsed.data.docId),
  ].slice(0, 20);
  await setUserPreference(u.id, {
    home: { ...(effective?.home ?? {}), recentDocViews: next },
  });
  return NextResponse.json({ views: next });
}
