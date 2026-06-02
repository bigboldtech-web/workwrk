// GET   /api/preferences — effective preferences (org defaults + user override - locked)
// PATCH /api/preferences — patch the user's UserPreference row

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { getEffectivePreferences, setUserPreference, getUserPreferenceRow } from "@/lib/preferences";

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

const patchSchema = z.object({
  sidebar: z.object({
    pinned: z.array(z.string()).optional(),
    hidden: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
    iconsOnly: z.boolean().optional(),
    sectionsOrder: z.array(z.string()).optional(),
  }).optional(),
  home: z.object({
    cards: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
  }).optional(),
  theme: z.object({
    appearance: z.enum(["LIGHT", "DARK", "AUTO"]).optional(),
    accent: z.string().max(40).optional(),
  }).optional(),
  density: z.enum(["compact", "cozy"]).optional(),
});

export async function PATCH(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  await setUserPreference(c.userId, parsed.data);
  const effective = await getEffectivePreferences(c.userId, c.organizationId);
  return NextResponse.json({ effective });
}
