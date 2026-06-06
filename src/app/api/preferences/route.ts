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
    // Phase 78 — favorite (starred) board IDs. Surfaced in the
    // board page header as a filled-star toggle.
    favoriteBoardIds: z.array(z.string()).optional(),
    // Phase 80 — favorite (starred) Space IDs.
    favoriteSpaceIds: z.array(z.string()).optional(),
    // Phase 15+ — favorite (starred) Doc/note IDs.
    favoriteDocIds: z.array(z.string()).optional(),
    // Phase 83 — favorite (starred) Folder IDs.
    favoriteFolderIds: z.array(z.string()).optional(),
    // Phase 84 — favorite (starred) Table IDs.
    favoriteTableIds: z.array(z.string()).optional(),
    // Phase 89 — favorite (starred) Whiteboard + File IDs.
    favoriteWhiteboardIds: z.array(z.string()).optional(),
    favoriteFileIds: z.array(z.string()).optional(),
    // My Tasks card layout — react-grid-layout per-breakpoint shape.
    taskCardLayout: z.record(z.string(), z.array(z.object({
      i: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    }))).optional(),
    taskCardsHidden: z.array(z.string()).optional(),
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
