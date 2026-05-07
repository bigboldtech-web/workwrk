/**
 * One-shot fix for orgs that came in via the broken setup wizard
 * (which wrote `goals` / `onboarding` instead of `kra-kpi` / `checkins`).
 * Affected orgs lose Onboarding and KRA & KPIs from the sidebar.
 *
 * Run on staging first:
 *   DATABASE_URL=... npx tsx scripts/normalize-enabled-modules.ts --dry-run
 *
 * Then apply:
 *   DATABASE_URL=... npx tsx scripts/normalize-enabled-modules.ts
 *
 * Idempotent: re-running after success is a no-op.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import { normalizeEnabledModules } from "../src/lib/module-keys";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, slug: true, settings: true },
  });

  let touched = 0;
  for (const org of orgs) {
    const settings = (org.settings ?? {}) as Record<string, unknown>;
    const before = settings.enabledModules;
    if (!Array.isArray(before)) continue;

    const after = normalizeEnabledModules(before);
    const changed =
      before.length !== after.length ||
      before.some((v, i) => v !== after[i]);

    if (!changed) continue;
    touched++;

    console.log(`org ${org.slug ?? org.id} ("${org.name}")`);
    console.log(`  before: ${JSON.stringify(before)}`);
    console.log(`  after:  ${JSON.stringify(after)}`);

    if (dryRun) continue;

    await prisma.organization.update({
      where: { id: org.id },
      data: { settings: { ...settings, enabledModules: after } },
    });
  }

  console.log(`\n${touched}/${orgs.length} org(s) ${dryRun ? "would be" : "were"} updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
