// GET   /api/org/preferences — read the org's defaults + locked keys
// PATCH /api/org/preferences — update defaults / locked keys (org admin only)
//
// "Both" per Decision D5 — org admin sets defaults and can lock keys
// against per-user override.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { getOrgPreferenceRow, setOrgPreference } from "@/lib/preferences";

const ORG_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function GET() {
  const c = await ctx();
  if ("error" in c) return c.error;
  const row = await getOrgPreferenceRow(c.organizationId);
  return NextResponse.json({ preference: row });
}

const patchSchema = z.object({
  sidebarDefault: z.object({
    pinned: z.array(z.string()).optional(),
    hidden: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
    iconsOnly: z.boolean().optional(),
    sectionsOrder: z.array(z.string()).optional(),
  }).optional(),
  homeDefault: z.object({
    cards: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
  }).optional(),
  themeDefault: z.object({
    appearance: z.enum(["LIGHT", "DARK", "AUTO"]).optional(),
    accent: z.string().max(40).optional(),
  }).optional(),
  densityDefault: z.enum(["compact", "cozy"]).optional(),
  lockedKeys: z.array(z.string().max(80)).optional(),
});

export async function PATCH(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ORG_ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Org admin access required" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const updated = await setOrgPreference(c.organizationId, parsed.data);
  return NextResponse.json({ preference: updated });
}
