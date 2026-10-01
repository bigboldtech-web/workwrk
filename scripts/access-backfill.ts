/**
 * access-backfill.ts: access-model-spec section 10 step 4 (Phase 8 stage E).
 *
 * PRE-FLIGHT FIRST. Every run prints, per workspace, the G11 report: the
 * chosen Owner(s) (SUPER_ADMIN, else the earliest live COMPANY_ADMIN, the
 * rule the Staff console and SETTINGS_OWNER_SPLIT use), every SUPER_ADMIN,
 * every C-level, VP and Director whose report tree is not the whole
 * workspace (they lose org-wide people data unless made Admin or put on the
 * People team, spec 10.1), every Manager and Team lead with no reports (they
 * lose the Teams hub), every ADMIN-scope API key whose creator is not an
 * Owner or Admin, the C-level people who lose the settings write, and a
 * workspace whose stored access toggles read the two widening defaults.
 * The founder approves this report before any --write in production.
 *
 * DRY RUN BY DEFAULT. Without --write it changes nothing. With --write it runs
 * each workspace's plan (src/lib/access/backfill-plan.ts) in ONE transaction:
 * User.orgRole and isAgent, settings.access (only where absent, at today's
 * enforced values), the People team seeded with HR, restricted and findable,
 * ownerId where null, the USER-subject AccessGrant rows (SOPFolderAccess, and
 * G5's Full for the Space owner on Private Lists), the row-count assertions,
 * and one access.migrated activity row carrying the whole report. A failed
 * assertion rolls that workspace back and the script moves on to the next.
 * Nothing it writes is read while ACCESS_V2_TABLES is off.
 *
 * Usage:
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/access-backfill.ts [--org <id>] [--out report.json]
 *   ... --write        apply (after the pre-flight report is approved)
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { backfillAssertions, planOrgBackfill, type BackfillSnapshot, type OrgBackfillPlan } from "../src/lib/access/backfill-plan";

const prisma = scriptPrisma();

const args = process.argv.slice(2);
const argOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? null : null);
const ONLY_ORG = argOf("--org");
const OUT = argOf("--out");
const WRITE = args.includes("--write");

async function snapshot(organizationId: string): Promise<BackfillSnapshot> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, name: true, settings: true } });
  const [users, apiKeys, sopAccess, spaces, folders, boards, existing, standaloneDocs, whiteboards, tables] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, firstName: true, lastName: true, accessLevel: true, createdAt: true, managerId: true, orgRole: true, isAgent: true, status: true, deletedAt: true },
    }),
    prisma.apiKey.findMany({ where: { organizationId }, select: { id: true, name: true, scopes: true, createdById: true, revokedAt: true } }),
    prisma.sOPFolderAccess.findMany({ where: { folder: { organizationId } }, select: { folderId: true, userId: true, role: true } }),
    prisma.space.findMany({
      where: { organizationId },
      select: { id: true, visibility: true, ownerId: true, restricted: true, findable: true, members: { where: { role: "OWNER" }, select: { userId: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    }),
    prisma.folder.findMany({
      where: { organizationId },
      select: { id: true, visibility: true, ownerId: true, restricted: true, members: { where: { role: "OWNER" }, select: { userId: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    }),
    prisma.board.findMany({
      where: { organizationId },
      select: { id: true, visibility: true, ownerId: true, spaceId: true, restricted: true, members: { where: { role: "OWNER" }, select: { userId: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    }),
    prisma.$queryRaw<{ k: string }[]>`SELECT "objectType" || ':' || "objectId" || ':' || "subjectId" AS k FROM "AccessGrant" WHERE "organizationId" = ${organizationId}`,
    prisma.doc.count({ where: { organizationId, entityType: null, archivedAt: null } }),
    prisma.whiteboard.count({ where: { organizationId, archivedAt: null } }),
    prisma.dataTable.count({ where: { organizationId, spaceId: null } }),
  ]);
  return {
    organizationId,
    organizationName: org.name,
    settings: (org.settings as Record<string, unknown> | null) ?? null,
    users: users.map((u) => ({
      id: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.id,
      accessLevel: String(u.accessLevel),
      createdAt: u.createdAt,
      managerId: u.managerId,
      orgRole: u.orgRole,
      isAgent: u.isAgent,
      live: u.deletedAt === null && String(u.status) !== "INACTIVE",
    })),
    apiKeys: apiKeys.map((k) => ({ id: k.id, name: k.name, scopes: k.scopes.map(String), createdById: k.createdById, revoked: k.revokedAt !== null })),
    sopFolderAccess: sopAccess.map((r) => ({ folderId: r.folderId, userId: r.userId, role: r.role as "VIEWER" | "EDITOR" | "OWNER" })),
    spaces: spaces.map((sp) => ({ id: sp.id, visibility: String(sp.visibility), ownerId: sp.ownerId, ownerRowUserId: sp.members[0]?.userId ?? null, restricted: sp.restricted, findable: sp.findable })),
    folders: folders.map((f) => ({ id: f.id, visibility: String(f.visibility), ownerId: f.ownerId, ownerRowUserId: f.members[0]?.userId ?? null, restricted: f.restricted })),
    boards: boards.map((b) => ({ id: b.id, visibility: String(b.visibility), ownerId: b.ownerId, ownerRowUserId: b.members[0]?.userId ?? null, spaceId: b.spaceId, restricted: b.restricted })),
    orgVisibleStandaloneDocs: standaloneDocs,
    orgWideWhiteboards: whiteboards,
    unscopedTables: tables,
    existingGrantKeys: new Set(existing.map((r) => r.k)),
  };
}

function printPreflight(p: OrgBackfillPlan) {
  const f = p.preflight;
  console.log(`\n=== ${p.organizationName} (${p.organizationId})`);
  console.log(`  Owner(s): ${f.owners.map((o) => `${o.name} [${o.accessLevel}]`).join(", ") || "NONE (no admin in this workspace; skipped on --write)"}`);
  if (f.superAdmins.length) console.log(`  SUPER_ADMIN: ${f.superAdmins.map((u) => u.name).join(", ")}`);
  for (const e of f.executivesNotWholeOrg) console.log(`  executive without the whole org: ${e.name} [${e.accessLevel}] reports ${e.reports} of ${e.liveOthers}  -> default: People team (D6); or Admin`);
  for (const m of f.managersWithNoReports) console.log(`  manager with no reports: ${m.name} [${m.accessLevel}]  -> fix reportsTo, or they lose the Teams hub`);
  for (const k of f.adminKeysWithNonAdminCreator) console.log(`  ADMIN-scope key "${k.name}" (${k.id}) creator ${k.creatorId} [${k.creatorLevel ?? "gone"}]  -> capped at Can edit on its next request`);
  for (const c of f.cLevelLosesSettingsWrite) console.log(`  C-level loses the Workspace settings write: ${c.name}`);
  if (f.ownerPickConflict) {
    console.log(`  DECISION NEEDED before SETTINGS_OWNER_SPLIT: the decided rule makes the earliest COMPANY_ADMIN the Owner (${f.ownerPickConflict.earliestCompanyAdmin.name}), but an earlier SUPER_ADMIN (${f.ownerPickConflict.earlierSuperAdmins.map((u) => u.name).join(", ")}) makes today's pick exclude them, so they are written ADMIN. Confirm with the customer who runs the workspace; if it is ${f.ownerPickConflict.earliestCompanyAdmin.name}, make them an Owner (Settings > Members, or the Staff console's Set Owner) before the split is turned on.`);
  }
  if (f.noOwner) {
    console.log(
      f.livePeople > 0
        ? `  NO OWNER, ${f.livePeople} live ${f.livePeople === 1 ? "person" : "people"}: nobody can open Workspace settings here (invariant 10). Remedy: the Staff console's Set Owner on /admin/companies/${p.organizationId}, after confirming with the customer who runs it. The backfill writes nothing for this workspace until then.`
        : "  no Owner and no live people: an empty workspace; nothing to do.",
    );
  }
  if (f.everyoneCreatesSpacesWiderThanToday) {
    console.log(`  REVIEW: "Who can create Spaces" reads Everyone, so with ACCESS_V2_RESOLVER on ${f.everyoneCreatesSpacesWiderThanToday} people below the manager tier (Members, including outside-domain invitees) gain New Space. Spec toggle 1 decides this; set it to "Owners and Admins" on Settings > Access first if the customer did not choose it.`);
  }
  if (f.widenedAccessToggles) console.log("  REVIEW: stored access toggles read findableSpaces or editorsCanShare TRUE. Intended for a workspace created after Phase 8 stage B (seedOrgDefaults writes the section 8 defaults); for an older one the old merge wrote them without anyone choosing. Confirm on Settings > Access before ACCESS_V2_TABLES");
  console.log(`  writes: ${p.userUpdates.length} org roles, ${p.accessSettingsWrite ? "settings.access at today's values" : "settings.access kept"}, People team ${p.peopleTeamSeed ? `seeded with ${p.peopleTeamSeed.length} HR` : "kept"}, restricted ${p.restrictedFolders.length} folders + ${p.restrictedBoards.length} lists, findable ${p.findableSpaces.length} spaces, owner fills ${p.ownerFills.length}, grants ${p.grants.length}`);
  const d = p.deferredEveryone;
  console.log(`  EVERYONE rows planned, deferred to the step 8 file (visibility still grants them): spaces ${d.spaces}, lists ${d.boards}, standalone docs ${d.standaloneDocs}, whiteboards ${d.whiteboards}, tables ${d.tables}`);
}

async function apply(p: OrgBackfillPlan): Promise<{ ok: boolean; problems: string[] }> {
  if (p.preflight.noOwner) return { ok: false, problems: ["no Owner can be chosen (no admin); nothing written"] };
  try {
    await prisma.$transaction(async (tx) => {
      let users = 0;
      for (const u of p.userUpdates) {
        // Raw, so the person's updatedAt is not stamped by a mirror column.
        users += await tx.$executeRaw`UPDATE "User" SET "orgRole" = ${u.orgRole}, "isAgent" = ${u.isAgent} WHERE "id" = ${u.id}`;
      }
      if (p.accessSettingsWrite || p.peopleTeamSeed) {
        const org = await tx.organization.findUniqueOrThrow({ where: { id: p.organizationId }, select: { settings: true } });
        const settings = (org.settings as Record<string, unknown> | null) ?? {};
        const access = { ...((settings.access as Record<string, unknown> | undefined) ?? p.accessSettingsWrite ?? {}) };
        if (p.peopleTeamSeed) access.peopleTeamUserIds = p.peopleTeamSeed;
        await tx.$executeRaw`UPDATE "Organization" SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{access}', ${JSON.stringify(access)}::jsonb, true) WHERE id = ${p.organizationId}`;
      }
      // Raw statements, never updateMany: Prisma's @updatedAt would stamp
      // every PRIVATE Folder and List and every ORG Space with the migration
      // instant, reordering "recently updated" and changing etags across the
      // tenant for a column no person changed.
      const rf = { count: p.restrictedFolders.length ? await tx.$executeRaw`UPDATE "Folder" SET "restricted" = true WHERE "id" = ANY(${p.restrictedFolders}::text[])` : 0 };
      const rb = { count: p.restrictedBoards.length ? await tx.$executeRaw`UPDATE "Board" SET "restricted" = true WHERE "id" = ANY(${p.restrictedBoards}::text[])` : 0 };
      const fs = { count: p.findableSpaces.length ? await tx.$executeRaw`UPDATE "Space" SET "findable" = true WHERE "id" = ANY(${p.findableSpaces}::text[])` : 0 };
      let fills = 0;
      for (const o of p.ownerFills) {
        fills +=
          o.type === "Space"
            ? await tx.$executeRaw`UPDATE "Space" SET "ownerId" = ${o.ownerId} WHERE "id" = ${o.id} AND "ownerId" IS NULL`
            : o.type === "Folder"
              ? await tx.$executeRaw`UPDATE "Folder" SET "ownerId" = ${o.ownerId} WHERE "id" = ${o.id} AND "ownerId" IS NULL`
              : await tx.$executeRaw`UPDATE "Board" SET "ownerId" = ${o.ownerId} WHERE "id" = ${o.id} AND "ownerId" IS NULL`;
      }
      let grants = 0;
      const now = new Date();
      for (const g of p.grants) {
        grants += await tx.$executeRaw`
          INSERT INTO "AccessGrant" ("id", "organizationId", "objectType", "objectId", "subjectType", "subjectId", "role", "objectRole", "source", "grantedById", "createdAt", "updatedAt")
          VALUES (${randomUUID()}, ${p.organizationId}, ${g.objectType}, ${g.objectId}, 'USER', ${g.subjectId}, ${g.role}::"SpaceRole", ${g.objectRole}, ${g.objectType === "SOP_FOLDER" ? "backfill.sop_folder" : "backfill.g5"}, NULL, ${now}, ${now})
          ON CONFLICT ("objectType", "objectId", "subjectType", "subjectId") DO NOTHING`;
      }
      const [withoutRole, owners] = await Promise.all([
        tx.user.count({ where: { organizationId: p.organizationId, orgRole: null } }),
        tx.user.count({ where: { organizationId: p.organizationId, orgRole: "OWNER", deletedAt: null } }),
      ]);
      const problems = backfillAssertions(p, {
        users,
        grants,
        restrictedFolders: rf.count,
        restrictedBoards: rb.count,
        findable: fs.count,
        ownerFills: fills,
        usersWithoutRole: withoutRole,
        owners,
      });
      if (problems.length) throw new AssertionFailure(problems);
      const actorId = p.preflight.owners[0]?.id ?? null;
      await tx.activityLog.create({
        data: {
          organizationId: p.organizationId,
          actorId,
          actorType: "system",
          actorLabel: "Access migration",
          type: "access.migrated",
          targetType: "Organization",
          targetId: p.organizationId,
          description: `Access backfill: ${users} org roles, ${grants} grants, ${rf.count + rb.count} restricted, ${fs.count} findable, ${fills} owners filled.`,
          metadata: JSON.parse(JSON.stringify({ preflight: p.preflight, deferredEveryone: p.deferredEveryone, writes: { users, grants, restrictedFolders: rf.count, restrictedBoards: rb.count, findable: fs.count, ownerFills: fills } })),
        },
      });
    });
    return { ok: true, problems: [] };
  } catch (err) {
    if (err instanceof AssertionFailure) return { ok: false, problems: err.problems };
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)] };
  }
}

class AssertionFailure extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
  }
}

async function main() {
  console.log(`access-backfill   database: ${databaseLabel()}   mode: ${WRITE ? "WRITE" : "dry run"}`);
  const orgs = ONLY_ORG ? [{ id: ONLY_ORG }] : await prisma.organization.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  const plans: OrgBackfillPlan[] = [];
  const results: Record<string, { ok: boolean; problems: string[] }> = {};
  for (const o of orgs) {
    const plan = planOrgBackfill(await snapshot(o.id));
    plans.push(plan);
    printPreflight(plan);
    if (WRITE) {
      const r = await apply(plan);
      results[o.id] = r;
      console.log(r.ok ? "  WRITTEN (one transaction, assertions passed, access.migrated recorded)" : `  NOT WRITTEN: ${r.problems.join("; ")}`);
    }
  }
  const totals = plans.reduce(
    (t, p) => ({ roles: t.roles + p.userUpdates.length, grants: t.grants + p.grants.length, noOwner: t.noOwner + (p.preflight.noOwner ? 1 : 0) }),
    { roles: 0, grants: 0, noOwner: 0 },
  );
  console.log(`\nworkspaces: ${plans.length}   org roles to write: ${totals.roles}   grants: ${totals.grants}   workspaces with no Owner: ${totals.noOwner}`);
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), database: databaseLabel(), write: WRITE, plans, results }, null, 2));
    console.log(`report written to ${OUT}`);
  }
  await prisma.$disconnect();
  if (WRITE && Object.values(results).some((r) => !r.ok && !r.problems[0]?.startsWith("no Owner"))) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
