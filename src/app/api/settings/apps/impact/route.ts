// POST /api/settings/apps/impact { app, hidden, floor }: who a hide or a
// minimum-role change would take this app away from, before it is saved
// (settings-architecture 5.3, S7). Reads only; the Apps page rule (Owner or
// Admin, the actor re-read). The count is by the rule in force: the engine's
// rule 2 once the app gates enforce (flags.ts appGatesEnforce), the rail's
// display tiers otherwise, and only people who have the app today are named
// (the catalog baseline and, under the engine, its APP_RULES audience).

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOrgId, getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { appGatesEnforce } from "@/lib/access/flags";
import { APP_RULES } from "@/lib/access/settings";
import type { AppKey } from "@/lib/access/types";
import { parseOrgAppsConfig } from "@/lib/rail-apps";
import { appAccessImpact, impactSentence, type AppVisibility } from "@/lib/access/app-floor-impact";

const TIERS = ["manager", "hr-admin", "org-admin"] as const;
const isTier = (v: unknown): v is (typeof TIERS)[number] => typeof v === "string" && (TIERS as readonly string[]).includes(v);
import { loadImpactPeople } from "@/lib/access/app-floor-impact.server";
import { APP_ACCESS_BY_KEY } from "@/lib/app-access";

const bodySchema = z.strictObject({
  app: z.string().min(1).max(40),
  hidden: z.boolean(),
  floor: z.enum(["manager", "hr-admin", "org-admin"]).nullable(),
});

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "apps");
  if (!writeGate.ok) return writeGate.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid body", 400);
  }
  const { app, hidden, floor } = parsed.data;
  const entry = APP_ACCESS_BY_KEY[app];
  if (!entry) return jsonError(`Unknown app: ${app}`, 400);
  if (entry.alwaysPinned) return jsonSuccess({ app, count: 0, names: [], sentence: impactSentence(0, entry.label) });

  const orgId = getOrgId(session);
  const pref = await prisma.orgPreference.findUnique({ where: { organizationId: orgId }, select: { sidebarDefault: true } });
  const sidebar = pref?.sidebarDefault && typeof pref.sidebarDefault === "object" && !Array.isArray(pref.sidebarDefault) ? (pref.sidebarDefault as Record<string, unknown>) : {};
  const cfg = parseOrgAppsConfig(sidebar.apps);
  const stored = cfg.minAccess?.[app];
  const before: AppVisibility = { hidden: (cfg.hidden ?? []).includes(app), floor: isTier(stored) ? stored : null };
  const rule = appGatesEnforce() ? "engine" : "legacy";
  const appKey = app in APP_RULES ? (app as AppKey) : null;
  const baseline = { requiredAccess: isTier(entry.requiredAccess) ? entry.requiredAccess : null, appKey };
  const people = await loadImpactPeople(orgId, appKey);
  const losing = appAccessImpact(people, before, { hidden, floor }, rule, baseline);
  return jsonSuccess({
    app,
    count: losing.length,
    names: losing.slice(0, 5).map((p) => p.name),
    sentence: impactSentence(losing.length, entry.label),
    rule,
  });
}
