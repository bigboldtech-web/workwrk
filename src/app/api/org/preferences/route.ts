// GET   /api/org/preferences — read the org's defaults + locked keys
// PATCH /api/org/preferences — update defaults / locked keys (org admin only)
//
// "Both" per Decision D5 — org admin sets defaults and can lock keys
// against per-user override.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { partitionLockedKeys } from "@/lib/preferences-locks";
import { logAuditEvent } from "@/lib/activity";
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

// Strict at every level (settings-architecture 9.3): a stray key is a 400
// that names it, never a silent strip. lockedKeys accepts only the lockable
// dot-paths from src/lib/preferences-locks.ts, so a lock can never be a typo
// that silently locks nothing. A key the org ALREADY stores is carried
// through untouched even when it is not on today's list (an older per-card
// home.cards.<key> lock): the Appearance defaults card re-sends the whole
// stored set on every toggle, so refusing it would leave the org unable to
// change any lock, with no way in the UI to clear the stale key. Only a NEW
// unknown key is refused (checked in PATCH, where the stored row is known). densityDefault takes the three values the
// personal schema takes; "comfortable" (the design system's default, and
// what the Appearance defaults card offers) was refused before.
const patchSchema = z.strictObject({
  sidebarDefault: z.strictObject({
    pinned: z.array(z.string()).optional(),
    hidden: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
    iconsOnly: z.boolean().optional(),
    sectionsOrder: z.array(z.string()).optional(),
    // 2026-08-22 ACCESS system: the org rail config (src/lib/rail-apps.ts):
    // which apps every user's rail shows, in what order, with what tier
    // floors. Writes are strict (reads stay tolerant via parseOrgAppsConfig).
    // setOrgPreference shallow-merges sidebarDefault keys, so patching
    // { apps } preserves sibling keys and replaces the apps object whole.
    apps: z.strictObject({
      order: z.array(z.string()).optional(),
      hidden: z.array(z.string()).optional(),
      minAccess: z.record(z.string(), z.enum(["manager", "hr-admin", "org-admin"])).optional(),
    }).optional(),
  }).optional(),
  homeDefault: z.strictObject({
    cards: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
  }).optional(),
  themeDefault: z.strictObject({
    appearance: z.enum(["LIGHT", "DARK", "AUTO"]).optional(),
    accent: z.string().max(40).optional(),
  }).optional(),
  densityDefault: z.enum(["compact", "cozy", "comfortable"]).optional(),
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
    const first = parsed.error.issues[0];
    const where = first ? [...first.path].join(".") : "";
    const unknownKeys = first && first.code === "unrecognized_keys" ? (first as { keys?: string[] }).keys ?? [] : [];
    const named = unknownKeys.length > 0 ? `Unknown setting: ${[where, unknownKeys.join(", ")].filter(Boolean).join(".")}` : first ? `${where || "body"}: ${first.message}` : "Invalid body";
    return NextResponse.json({ error: named, issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.lockedKeys) {
    const { unknown } = partitionLockedKeys(parsed.data.lockedKeys);
    if (unknown.length > 0) {
      const stored = new Set((await getOrgPreferenceRow(c.organizationId))?.lockedKeys ?? []);
      const fresh = unknown.filter((k) => !stored.has(k));
      if (fresh.length > 0) {
        return NextResponse.json({ error: `lockedKeys: Not a lockable preference: ${fresh.join(", ")}` }, { status: 400 });
      }
    }
  }
  const updated = await setOrgPreference(c.organizationId, parsed.data);
  // Every org write is audited with the changed keys (settings-architecture 9.1).
  logAuditEvent({
    type: "settings.updated.org_preferences",
    actorId: c.userId,
    organizationId: c.organizationId,
    description: "Updated workspace defaults",
    targetType: "Organization",
    targetId: c.organizationId,
    metadata: { keys: Object.keys(parsed.data) },
  });
  return NextResponse.json({ preference: updated });
}
