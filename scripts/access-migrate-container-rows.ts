/**
 * access-migrate-container-rows.ts: access-model-spec section 10 step 7
 * (Phase 8 stage E).
 *
 * Copies every SpaceMember, FolderMember and BoardMember row, and every USER
 * row of GoalAssignee, into "AccessGrant" (objectType SPACE, FOLDER, LIST,
 * GOAL; role as stored; a goal audience row as Can view). THE OLD TABLES ARE
 * NEVER WRITTEN: they stay the store every reader uses. Department, Role and
 * Tag audiences of a goal stay in GoalAssignee (the AccessGrant subject is a
 * User by foreign key until the step 8 file replaces it); the report counts
 * them.
 *
 * DRY RUN BY DEFAULT: prints, per workspace and type, member rows, copies
 * there, and what a write would insert, re-role and delete.
 *   --write    apply the diff per workspace in one transaction, with the
 *              row-count assertion (copies equal member rows, per type);
 *              a failed assertion rolls that workspace back
 *   --verify   the drift report alone (exit 1 on any drift): run it before
 *              any reader is ever pointed at the copies
 *
 * The copies are a snapshot: member rows written after a --write are not
 * copied until the next run (see container-copy-plan.ts for why the loader
 * does not read them in this release).
 *
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/access-migrate-container-rows.ts [--org <id>] [--out report.json] [--write | --verify]
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { copyAssertions, diffContainerCopies, GOAL_COPY_ROLE, type CopyObjectType, type CopyRow, type MemberRow } from "../src/lib/access/container-copy-plan";

const prisma = scriptPrisma();
const args = process.argv.slice(2);
const argOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? null : null);
const ONLY_ORG = argOf("--org");
const OUT = argOf("--out");
const WRITE = args.includes("--write");
const VERIFY = args.includes("--verify");

async function memberRows(organizationId: string): Promise<{ rows: MemberRow[]; goalGroupRows: number }> {
  const [sm, fm, bm, ga, groups] = await Promise.all([
    prisma.spaceMember.findMany({ where: { space: { organizationId } }, select: { spaceId: true, userId: true, role: true, createdAt: true } }),
    prisma.folderMember.findMany({ where: { folder: { organizationId } }, select: { folderId: true, userId: true, role: true, createdAt: true } }),
    prisma.boardMember.findMany({ where: { board: { organizationId } }, select: { boardId: true, userId: true, role: true, createdAt: true } }),
    prisma.goalAssignee.findMany({ where: { okr: { organizationId }, userId: { not: null } }, select: { okrId: true, userId: true, createdAt: true } }),
    prisma.goalAssignee.count({ where: { okr: { organizationId }, userId: null } }),
  ]);
  return {
    rows: [
      ...sm.map((r) => ({ objectType: "SPACE" as const, objectId: r.spaceId, userId: r.userId, role: r.role, createdAt: r.createdAt })),
      ...fm.map((r) => ({ objectType: "FOLDER" as const, objectId: r.folderId, userId: r.userId, role: r.role, createdAt: r.createdAt })),
      ...bm.map((r) => ({ objectType: "LIST" as const, objectId: r.boardId, userId: r.userId, role: r.role, createdAt: r.createdAt })),
      ...ga.map((r) => ({ objectType: "GOAL" as const, objectId: r.okrId, userId: r.userId as string, role: GOAL_COPY_ROLE, createdAt: r.createdAt })),
    ],
    goalGroupRows: groups,
  };
}

async function copyRows(organizationId: string, db: { $queryRaw: typeof prisma.$queryRaw } = prisma): Promise<CopyRow[]> {
  return db.$queryRaw<CopyRow[]>`
    SELECT "id", "objectType", "objectId", "subjectId", "role"::text AS "role"
    FROM "AccessGrant"
    WHERE "organizationId" = ${organizationId} AND "subjectType" = 'USER' AND "objectType" IN ('SPACE', 'FOLDER', 'LIST', 'GOAL')`;
}

function countBy<T extends { objectType: CopyObjectType }>(rows: readonly T[]): Record<CopyObjectType, number> {
  const out: Record<CopyObjectType, number> = { SPACE: 0, FOLDER: 0, LIST: 0, GOAL: 0 };
  for (const r of rows) out[r.objectType]++;
  return out;
}

async function main() {
  console.log(`access-migrate-container-rows   database: ${databaseLabel()}   mode: ${WRITE ? "WRITE" : VERIFY ? "verify" : "dry run"}`);
  const orgs = ONLY_ORG ? [{ id: ONLY_ORG, name: ONLY_ORG }] : await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  const report: Record<string, unknown>[] = [];
  let drift = 0;
  let failed = 0;
  for (const o of orgs) {
    const { rows, goalGroupRows } = await memberRows(o.id);
    const copies = await copyRows(o.id);
    const diff = diffContainerCopies(rows, copies);
    const members = countBy(rows);
    const entry: Record<string, unknown> = {
      organizationId: o.id,
      name: o.name,
      members,
      copies: countBy(copies),
      insert: diff.insert.length,
      update: diff.update.length,
      remove: diff.remove.length,
      equal: diff.equal,
      goalGroupRowsKept: goalGroupRows,
    };
    const changes = diff.insert.length + diff.update.length + diff.remove.length;
    drift += changes;
    if (rows.length || copies.length) {
      console.log(`${o.name} (${o.id}): members ${JSON.stringify(members)}  insert ${diff.insert.length}  re-role ${diff.update.length}  delete ${diff.remove.length}  equal ${diff.equal}  goal group rows kept in GoalAssignee ${goalGroupRows}`);
    }
    if (WRITE && changes > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          const now = new Date();
          for (const m of diff.insert) {
            await tx.$executeRaw`
              INSERT INTO "AccessGrant" ("id", "organizationId", "objectType", "objectId", "subjectType", "subjectId", "role", "objectRole", "createdAt", "updatedAt")
              VALUES (${randomUUID()}, ${o.id}, ${m.objectType}, ${m.objectId}, 'USER', ${m.userId}, ${m.role}::"SpaceRole", ${m.objectType === "GOAL" ? "VIEW" : null}, ${m.createdAt}, ${now})
              ON CONFLICT ("objectType", "objectId", "subjectType", "subjectId") DO UPDATE SET "role" = EXCLUDED."role", "updatedAt" = EXCLUDED."updatedAt"`;
          }
          for (const u of diff.update) {
            await tx.$executeRaw`UPDATE "AccessGrant" SET "role" = ${u.role}::"SpaceRole", "updatedAt" = ${now} WHERE "id" = ${u.id}`;
          }
          if (diff.remove.length) {
            await tx.$executeRaw`DELETE FROM "AccessGrant" WHERE "id" = ANY(${diff.remove.map((r) => r.id)}::text[])`;
          }
          const after = await copyRows(o.id, tx);
          const problems = copyAssertions(members, countBy(after));
          if (problems.length) throw new Error(`assertion failed: ${problems.join("; ")}`);
        });
        entry.written = true;
        console.log("  WRITTEN (one transaction; copies equal member rows per type)");
      } catch (err) {
        failed++;
        entry.written = false;
        entry.error = err instanceof Error ? err.message : String(err);
        console.log(`  NOT WRITTEN: ${entry.error}`);
      }
    }
    report.push(entry);
  }
  console.log(`\nworkspaces: ${orgs.length}   rows to change: ${drift}${WRITE ? `   failed workspaces: ${failed}` : ""}`);
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), database: databaseLabel(), mode: WRITE ? "write" : VERIFY ? "verify" : "dry-run", report }, null, 2));
    console.log(`report written to ${OUT}`);
  }
  await prisma.$disconnect();
  if ((VERIFY && drift > 0) || failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
