// GET   /api/preferences — effective preferences (org defaults + user override - locked)
// PATCH /api/preferences — patch the user's UserPreference row
//
// The PATCH schema lives in src/lib/preferences-schema.ts (strict at every
// level, widening only; settings-architecture.md section 9.3). A stray key is
// a 400 naming it, never a silent strip.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserPreference, getUserPreferenceRow } from "@/lib/preferences";
import { describeIssues, preferencesPatchSchema, stripOrgOnlyKeys } from "@/lib/preferences-schema";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, organizationId: u.organizationId };
}

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const raw = url.searchParams.get("raw") === "1";
  if (raw) {
    const row = await getUserPreferenceRow(c.userId);
    return NextResponse.json({ preference: row });
  }
  const effective = await getEffectivePreferences(c.userId, c.organizationId);
  return NextResponse.json({ effective });
}

export async function PATCH(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = preferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    const issues = describeIssues(parsed.error.issues);
    return NextResponse.json(
      { error: `Invalid body: ${issues.map((i) => i.path).join(", ")}`, issues },
      { status: 400 },
    );
  }
  await setUserPreference(c.userId, stripOrgOnlyKeys(parsed.data));
  const effective = await getEffectivePreferences(c.userId, c.organizationId);
  return NextResponse.json({ effective });
}
