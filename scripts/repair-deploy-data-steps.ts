// Undo what two data scripts did when the deploy re-ran them on every
// release (removed from .github/workflows/deploy.yml in Batch 11):
//
//   1. migrate-public-sop-links.ts switched Public links back to "View only"
//      in workspaces whose Admin had turned them Off. Here: every workspace
//      whose last access change by a person (settings.updated.access naming
//      publicLinks) was later overridden by the script's own
//      access.settings.migrated row, and that still reads "view", goes back to
//      Off, with an audit row that says why.
//   2. migrate-legacy-tasks.ts turned Google Calendar events synced between
//      deploys into open tasks on people's Personal lists. Here: every Item
//      made from a GCAL Task (metadata.legacyTaskId) that nobody has touched
//      since (no update or comment, not edited after it was made) goes to
//      Trash, where it can be restored for the workspace's Trash window.
//      Anything someone worked on stays.
//
// RUN IT ON THE SERVER, by the founder, from the app's directory with its
// environment loaded (set -a && . ./.env && set +a):
//
//   DIRECT_URL= npx tsx scripts/repair-deploy-data-steps.ts           # counts only
//   DIRECT_URL= npx tsx scripts/repair-deploy-data-steps.ts --write   # repairs
//
// It prints the database, then counts and workspace ids only.

import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { moveToTrash } from "../src/lib/trash";

const prisma = scriptPrisma();

async function main() {
  const write = process.argv.includes("--write");
  console.log(`Database: ${databaseLabel()}${write ? "" : " (dry run: nothing is changed)"}`);

  // 1. Public links switched back on.
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

  // 2. Calendar events made into tasks.
  const items = await prisma.$queryRaw<{ id: string; organizationId: string }[]>`
    SELECT i."id", i."organizationId"
      FROM "Item" i
      JOIN "Task" t ON t."id" = i."metadata"->>'legacyTaskId'
     WHERE t."externalSource" = 'GCAL'
       AND i."archivedAt" IS NULL
       AND i."updatedAt" <= i."createdAt" + interval '5 minutes'
       AND NOT EXISTS (SELECT 1 FROM "ItemUpdate" u WHERE u."entityId" = i."id")`;
  const byOrg = new Map<string, string[]>();
  for (const it of items) byOrg.set(it.organizationId, [...(byOrg.get(it.organizationId) ?? []), it.id]);
  let trashed = 0;
  for (const [organizationId, ids] of byOrg) {
    console.log(`Calendar events made into tasks: ${ids.length} in ${organizationId}`);
    if (!write) continue;
    for (const id of ids) {
      if (await moveToTrash("item", id, { organizationId, userId: null, userName: "WorkwrK" }).catch(() => false)) trashed += 1;
    }
  }
  console.log(`Calendar tasks: ${write ? `${trashed} moved to Trash` : `${items.length} would go to Trash`} (anything someone worked on stays)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
