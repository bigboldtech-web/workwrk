// Undo what a data script did when the deploy re-ran it on every release
// (removed from .github/workflows/deploy.yml in Batch 11):
// migrate-public-sop-links.ts switched Public links back to "View only" in
// workspaces whose Admin had turned them Off. Here: every workspace whose
// last access change by a person (settings.updated.access naming
// publicLinks) was later overridden by the script's own
// access.settings.migrated row, and that still reads "view", goes back to
// Off, with an audit row that says why.
//
// The other re-run script, migrate-legacy-tasks.ts, also turned Google
// Calendar events synced between deploys into tasks. Those are left as they
// are, on purpose: each is an ordinary task now, and no query can tell one
// nobody wanted from one someone has logged time on or planned around, so
// people remove the ones they do not want (Trash keeps them restorable).
//
// RUN IT ON THE SERVER, by the founder, from the app's directory with its
// environment loaded (set -a && . ./.env && set +a):
//
//   DIRECT_URL= npx tsx scripts/repair-deploy-data-steps.ts           # counts only
//   DIRECT_URL= npx tsx scripts/repair-deploy-data-steps.ts --write   # repairs
//
// It prints the database, then counts and workspace ids only.

import { databaseLabel, scriptPrisma } from "./lib/script-prisma";

const prisma = scriptPrisma();

async function main() {
  const write = process.argv.includes("--write");
  console.log(`Database: ${databaseLabel()}${write ? "" : " (dry run: nothing is changed)"}`);

  // Public links switched back on.
  const reflipped = await prisma.$queryRaw<{ organizationId: string }[]>`
    SELECT DISTINCT m."organizationId"
      FROM "ActivityLog" m
     WHERE m."type" = 'access.settings.migrated'
       AND EXISTS (
             SELECT 1 FROM "ActivityLog" u
              WHERE u."organizationId" = m."organizationId"
                AND u."type" = 'settings.updated.access'
                AND u."metadata"->'keys' ? 'publicLinks'
                AND u."createdAt" < m."createdAt"
           )
       AND NOT EXISTS (
             SELECT 1 FROM "ActivityLog" later
              WHERE later."organizationId" = m."organizationId"
                AND later."type" = 'settings.updated.access'
                AND later."metadata"->'keys' ? 'publicLinks'
                AND later."createdAt" > m."createdAt"
           )`;
  let restored = 0;
  for (const { organizationId } of reflipped) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    const settings = (org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? org.settings : {}) as Record<string, unknown>;
    const access = (settings.access && typeof settings.access === "object" ? settings.access : {}) as Record<string, unknown>;
    if (access.publicLinks !== "view") continue;
    console.log(`Public links back to Off: ${organizationId}`);
    if (!write) continue;
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { settings: { ...settings, access: { ...access, publicLinks: "off" } } as object },
      });
      await tx.activityLog.create({
        data: {
          organizationId,
          actorId: null,
          actorType: "system",
          actorLabel: "WorkwrK",
          type: "access.settings.restored",
          targetType: "organization",
          targetId: organizationId,
          description: "Public links set back to Off: a release had turned them on again after an Admin turned them off.",
          metadata: { key: "publicLinks", from: "view", to: "off" },
        },
      });
    });
    restored += 1;
  }
  console.log(`Public links: ${write ? `${restored} workspaces set back to Off` : "workspaces listed above would go back to Off"}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
