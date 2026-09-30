/**
 * The one-time report before the Apps hides and floors become real gates
 * (settings-architecture S7, Phase 8 stage F). DRY RUN ONLY: it reads and
 * writes nothing but its own report.
 *
 * For every workspace that hides an app or sets a minimum role on one
 * (OrgPreference.sidebarDefault.apps), it lists each such app and, per rule:
 *
 *   today    who does not see it in their rail (the display tiers)
 *   engine   who the engine's rule 2 refuses once ACCESS_V2_RESOLVER is on
 *   change   the people whose answer moves at the flip, by name: "loses"
 *            (sees it today, refused under the engine; the People team and
 *            reports replace the rung) and "gains" (the other way)
 *
 * Read it together with a week of `access.app_gate.would_deny` audit rows
 * (SETTINGS_GATE_LOG_ONLY=true) before turning the resolver on.
 *
 *     DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *       npx tsx scripts/report-app-floors.ts [--org <id>] [--out report.json]
 *
 * Refuses a database that is not on this machine unless --allow-remote.
 */

import { writeFileSync } from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { parseAccessSettings, parseOrgAppsConfig } from "../src/lib/access/settings";
import { orgRoleOf } from "../src/lib/access/org-role";
import { tiersOfLevel } from "../src/lib/access/viewer-tiers";
import { keepsApp, type ImpactPerson } from "../src/lib/access/app-floor-impact";
import { APP_ACCESS_BY_KEY } from "../src/lib/app-access";

const args = process.argv.slice(2);
const argOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? null : null);
const ONLY_ORG = argOf("--org");
const OUT = argOf("--out");

const label = databaseLabel();
if (!args.includes("--allow-remote") && !/^(localhost|127\.0\.0\.1)(:|\/)/.test(label)) {
  console.error(`Refusing ${label}: not a local database. Pass --allow-remote to read it.`);
  process.exit(2);
}
const prisma = scriptPrisma();

type AppRow = {
  app: string;
  label: string;
  hidden: boolean;
  floor: string | null;
  people: number;
  todayWithout: number;
  engineWithout: number;
  loses: string[];
  gains: string[];
};

async function main() {
  const prefs = await prisma.orgPreference.findMany({
    where: ONLY_ORG ? { organizationId: ONLY_ORG } : {},
    select: { organizationId: true, sidebarDefault: true, organization: { select: { name: true, settings: true } } },
  });
  const report: { database: string; generatedAt: string; workspaces: { id: string; name: string; apps: AppRow[] }[] } = {
    database: label,
    generatedAt: new Date().toISOString(),
    workspaces: [],
  };
  for (const pref of prefs) {
    const sidebar = pref.sidebarDefault && typeof pref.sidebarDefault === "object" && !Array.isArray(pref.sidebarDefault) ? (pref.sidebarDefault as Record<string, unknown>) : {};
    const cfg = parseOrgAppsConfig(sidebar.apps);
    const keys = new Set<string>([...(cfg.hidden ?? []), ...Object.keys(cfg.minAccess ?? {})]);
    const rows = [...keys].filter((k) => APP_ACCESS_BY_KEY[k] && !APP_ACCESS_BY_KEY[k].alwaysPinned);
    if (rows.length === 0) continue;
    const orgId = pref.organizationId;
    const [users, dotted] = await Promise.all([
      prisma.user.findMany({ where: { organizationId: orgId, deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true, managerId: true } }),
      prisma.userDottedLine.findMany({ where: { user: { organizationId: orgId } }, select: { managerId: true } }),
    ]);
    const access = parseAccessSettings((pref.organization.settings as Record<string, unknown> | null)?.access);
    const hr = users.filter((u) => u.accessLevel === "HR").map((u) => u.id);
    const peopleTeam = new Set(access.peopleTeamUserIds.length > 0 ? access.peopleTeamUserIds : hr);
    const managers = new Set<string>([...users.map((u) => u.managerId).filter((m): m is string => !!m), ...dotted.map((d) => d.managerId)]);
    const people: ImpactPerson[] = users.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id,
      orgRole: orgRoleOf({ accessLevel: u.accessLevel }),
      peopleTeam: peopleTeam.has(u.id),
      hasReports: managers.has(u.id),
      tiers: tiersOfLevel(u.accessLevel),
    }));
    const apps: AppRow[] = rows.map((app) => {
      const v = { hidden: (cfg.hidden ?? []).includes(app), floor: (cfg.minAccess?.[app] ?? null) as "manager" | "hr-admin" | "org-admin" | null };
      const today = people.filter((p) => !keepsApp(p, v, "legacy"));
      const engine = people.filter((p) => !keepsApp(p, v, "engine"));
      return {
        app,
        label: APP_ACCESS_BY_KEY[app].label,
        hidden: v.hidden,
        floor: v.floor,
        people: people.length,
        todayWithout: today.length,
        engineWithout: engine.length,
        loses: people.filter((p) => keepsApp(p, v, "legacy") && !keepsApp(p, v, "engine")).map((p) => p.name),
        gains: people.filter((p) => !keepsApp(p, v, "legacy") && keepsApp(p, v, "engine")).map((p) => p.name),
      };
    });
    report.workspaces.push({ id: orgId, name: pref.organization.name, apps });
  }

  console.log(`App hides and floors (dry run) on ${label}: ${report.workspaces.length} workspace(s) with a hide or a floor.`);
  for (const w of report.workspaces) {
    console.log(`\n${w.name} (${w.id})`);
    for (const a of w.apps) {
      const what = a.hidden ? "hidden" : `minimum ${a.floor}`;
      console.log(`  ${a.label} [${what}]: today ${a.todayWithout} of ${a.people} do not see it; under the engine ${a.engineWithout} are refused`);
      if (a.loses.length) console.log(`    loses at the flip: ${a.loses.join(", ")}`);
      if (a.gains.length) console.log(`    gains at the flip: ${a.gains.join(", ")}`);
    }
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${OUT}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
