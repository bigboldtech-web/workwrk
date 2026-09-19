/**
 * migrate-preference-keys.ts: fold every top-pinned favorite into the
 * favorites it is now part of.
 *
 * Spec: docs/plans/ui-refresh/spec-shell.md section 0 ("TopPinsStrip merged
 * into the Work hub sidebar FAVORITES section; pins are favorites. Strip
 * deleted; /api/me/pins rows migrate into favorites"),
 * docs/plans/ui-refresh/spec-spaces-lists.md section 5 (the row that promises
 * "Favorite > Top (top-pins strip) -> Favorites; rows migrated") and
 * naming-canon.md line 210 ("Top pins", whose rows migrate into favorites).
 * Rules: scripts/MIGRATIONS.md (all seven; rule 4 is met, see below).
 *
 * WHY. ClickUp-style "Favorite" used to be a submenu with two destinations:
 * Sidebar, which wrote `home.favorite<Kind>Ids`, and Top, which wrote a
 * SEPARATE key, `home.topPins`, rendered as chips by `TopPinsStrip` under the
 * top bar. Phase 2 collapses the submenu to one row and deletes the strip, so
 * `home.topPins` has no writer and no reader left. The rows are still in the
 * database. Without this script a person who had pinned six Spaces to the top
 * opens the product and finds six favorites missing, with no way to get them
 * back, which is exactly the silent removal this phase forbids.
 *
 * WHAT IT DOES. For every user with a non-empty `home.topPins`, each pin is
 * unioned into the `favorite<Kind>Ids` array for its kind. Union, not append:
 * an object that is already a favorite is counted as "already migrated" and
 * nothing is written twice.
 *
 *   { kind: "space",      id } -> home.favoriteSpaceIds
 *   { kind: "board",      id } -> home.favoriteBoardIds
 *   { kind: "folder",     id } -> home.favoriteFolderIds
 *   { kind: "table",      id } -> home.favoriteTableIds
 *   { kind: "doc",        id } -> home.favoriteDocIds
 *   { kind: "whiteboard", id } -> home.favoriteWhiteboardIds
 *   { kind: "file",       id } -> home.favoriteFileIds
 *
 * A kind outside that list is REPORTED and SKIPPED, never guessed at: writing
 * it into the wrong array would put an id in a list whose reader hydrates a
 * different model, and the row would render as a broken favorite rather than
 * as nothing.
 *
 * `home.topPins` IS NOT CLEARED (rule 6: the source is never deleted). The key
 * has no reader left, so leaving it costs nothing, it makes the script
 * idempotent by construction, and it means the founder can see exactly what
 * was folded for a year afterwards.
 *
 * DEAD PINS ARE STILL MIGRATED. A pin whose object was deleted is folded in
 * like any other: the favorites readers already prune ids they cannot resolve
 * (GET /api/me/favorites filters by accessibleIds per kind), so a stale id
 * renders as nothing rather than as a broken row. Dropping them here would be
 * this script deciding, on a workspace it cannot see, that an id is dead.
 *
 * RULE 4, per-org transactions, is met in the shape the data allows.
 * `UserPreference` is keyed on `userId` and has no `organizationId`: the
 * organisation comes from the User row. Users are grouped by org and each
 * org's rows are written in one `$transaction`, so a failure on workspace 9
 * cannot leave workspace 8 half folded.
 *
 * Usage, see scripts/MIGRATIONS.md for the approval gate.
 *
 *   npx tsx scripts/migrate-preference-keys.ts                     # dry run
 *   npx tsx scripts/migrate-preference-keys.ts --report /tmp/r.txt # dry run, saved
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/migrate-preference-keys.ts --write           # LOCAL only
 */

import fs from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";

const prisma = scriptPrisma();

/** Pin kind to the favorites array that now holds it. The whole mapping. */
const FAVORITE_KEY_BY_KIND: Readonly<Record<string, string>> = {
  space: "favoriteSpaceIds",
  board: "favoriteBoardIds",
  folder: "favoriteFolderIds",
  table: "favoriteTableIds",
  doc: "favoriteDocIds",
  whiteboard: "favoriteWhiteboardIds",
  file: "favoriteFileIds",
};

interface UserReport {
  userId: string;
  email: string;
  pins: number;
  folded: number;
  alreadyFavorite: number;
}

interface OrgReport {
  organizationId: string;
  organizationName: string;
  usersWithPins: number;
  pinsRead: number;
  pinsFolded: number;
  pinsAlreadyFavorite: number;
  users: UserReport[];
  /** Pins whose kind has no favorites array. Read, reported, not written. */
  unknownKinds: Array<{ userId: string; kind: string; id: string }>;
  error?: string;
}

interface Report {
  ranAt: string;
  database: string;
  write: boolean;
  orgFilter: string | null;
  orgs: OrgReport[];
  totals: { usersWithPins: number; pinsRead: number; pinsFolded: number; pinsAlreadyFavorite: number; unknownKinds: number };
}

type Pin = { kind: string; id: string };

/** Tolerant read: the column is free-form JSON written by three releases. */
function readPins(home: unknown): Pin[] {
  const raw = (home as { topPins?: unknown } | null)?.topPins;
  if (!Array.isArray(raw)) return [];
  const out: Pin[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const kind = (entry as { kind?: unknown }).kind;
    const id = (entry as { id?: unknown }).id;
    if (typeof kind !== "string" || typeof id !== "string") continue;
    if (!kind.trim() || !id.trim()) continue;
    out.push({ kind: kind.trim(), id: id.trim() });
  }
  return out;
}

function readIdArray(home: unknown, key: string): string[] {
  const raw = (home as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

async function migrateOrg(
  organizationId: string,
  organizationName: string,
  write: boolean,
): Promise<OrgReport | null> {
  const r: OrgReport = {
    organizationId,
    organizationName,
    usersWithPins: 0,
    pinsRead: 0,
    pinsFolded: 0,
    pinsAlreadyFavorite: 0,
    users: [],
    unknownKinds: [],
  };

  const users = await prisma.user.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, email: true, accessLevel: true },
    orderBy: { createdAt: "asc" },
  });
  if (users.length === 0) return null;

  // `ActivityLog.actorId` is required, so the record (rule 7) is attributed to
  // the workspace's most senior live account, the same choice migrate-ideas.ts
  // makes. A workspace with nobody left cannot carry a record and is skipped
  // below rather than having one invented for it.
  const actorId =
    users.find((u) => u.accessLevel === "SUPER_ADMIN")?.id ??
    users.find((u) => u.accessLevel === "COMPANY_ADMIN")?.id ??
    users[0]?.id ??
    null;

  const prefs = await prisma.userPreference.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
    select: { userId: true, home: true },
  });
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  // The plan, computed before anything is written so the dry run and the write
  // pass produce the same numbers from the same code.
  const plan: Array<{ userId: string; home: Record<string, unknown> }> = [];

  for (const p of prefs) {
    const pins = readPins(p.home);
    if (pins.length === 0) continue;
    r.usersWithPins += 1;
    r.pinsRead += pins.length;

    const home = { ...((p.home ?? {}) as Record<string, unknown>) };
    let folded = 0;
    let already = 0;

    for (const pin of pins) {
      const key = FAVORITE_KEY_BY_KIND[pin.kind];
      if (!key) {
        r.unknownKinds.push({ userId: p.userId, kind: pin.kind, id: pin.id });
        continue;
      }
      const current = readIdArray(home, key);
      if (current.includes(pin.id)) {
        already += 1;
        continue;
      }
      home[key] = [...current, pin.id];
      folded += 1;
    }

    r.pinsFolded += folded;
    r.pinsAlreadyFavorite += already;
    r.users.push({ userId: p.userId, email: emailById.get(p.userId) ?? "(unknown)", pins: pins.length, folded, alreadyFavorite: already });
    if (folded > 0) plan.push({ userId: p.userId, home });
  }

  if (!write || plan.length === 0) return r;

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const row of plan) {
          await tx.userPreference.update({
            where: { userId: row.userId },
            data: { home: row.home as object },
          });
        }

        // Rule 3, and a REAL read-back rather than a tally of the counters
        // this function already holds: every pin that was supposed to land is
        // re-read out of the stored blob and counted. A write that did not
        // land aborts this workspace.
        const after = await tx.userPreference.findMany({
          where: { userId: { in: plan.map((p) => p.userId) } },
          select: { userId: true, home: true },
        });
        const stored = new Map(after.map((a) => [a.userId, a.home]));
        let missing = 0;
        for (const row of plan) {
          const home = stored.get(row.userId);
          for (const pin of readPins(home)) {
            const key = FAVORITE_KEY_BY_KIND[pin.kind];
            if (!key) continue;
            if (!readIdArray(home, key).includes(pin.id)) missing += 1;
          }
        }
        if (missing > 0) {
          throw new Error(
            `Assertion failed for ${organizationName}: ${missing} pin(s) are not in their favorites array after the write. Rolled back.`,
          );
        }

        // Rule 7, the record in the product.
        if (actorId) await tx.activityLog.create({
          data: {
            organizationId,
            actorId,
            type: "work.preference_keys_migrated",
            targetType: "organization",
            targetId: organizationId,
            description:
              `Top-pinned favorites folded into favorites for ${plan.length} person(s). ` +
              `${r.pinsFolded} pin(s) added, ${r.pinsAlreadyFavorite} already there. ` +
              `home.topPins was NOT cleared.`,
            metadata: {
              usersWithPins: r.usersWithPins,
              pinsRead: r.pinsRead,
              pinsFolded: r.pinsFolded,
              pinsAlreadyFavorite: r.pinsAlreadyFavorite,
              unknownKinds: r.unknownKinds.length,
              ranAt: new Date().toISOString(),
            },
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
    r.pinsFolded = 0;
  }

  return r;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function render(report: Report): string {
  const L: string[] = [];
  L.push("");
  L.push(`Preference key migration (home.topPins -> home.favorite<Kind>Ids), ${report.write ? "WRITE" : "dry run"}`);
  L.push(`Ran at   ${report.ranAt}`);
  L.push(`Database ${report.database}`);
  if (report.orgFilter) L.push(`Org      ${report.orgFilter} (filtered)`);
  L.push("");

  for (const o of report.orgs) {
    L.push(`─ ${o.organizationName}  (${o.organizationId})`);
    if (o.error) {
      L.push(`  FAILED and rolled back: ${o.error}`);
      L.push("");
      continue;
    }
    L.push(`  people with top pins      ${o.usersWithPins}`);
    L.push(`  pins read                 ${o.pinsRead}`);
    L.push(`  pins ${report.write ? "folded" : "to fold"}              ${o.pinsFolded}`);
    L.push(`  pins already a favorite   ${o.pinsAlreadyFavorite}`);
    for (const u of o.users.slice(0, 50)) {
      L.push(`    ${u.email.padEnd(36)} ${String(u.pins).padStart(3)} pin(s), ${u.folded} to fold, ${u.alreadyFavorite} already there`);
    }
    if (o.unknownKinds.length) {
      L.push(`  NOT MIGRATED, no favorites array for this kind (${o.unknownKinds.length}):`);
      for (const u of o.unknownKinds.slice(0, 25)) L.push(`    kind "${u.kind}"  id ${u.id}  user ${u.userId}`);
    } else {
      L.push("  every pin kind mapped cleanly.");
    }
    L.push("");
  }

  if (report.orgs.length === 0) L.push("  No workspace has a single top pin. Nothing to do.");

  L.push("─ Totals");
  L.push(`  people with top pins    ${report.totals.usersWithPins}`);
  L.push(`  pins read               ${report.totals.pinsRead}`);
  L.push(`  pins ${report.write ? "folded" : "to fold"}            ${report.totals.pinsFolded}`);
  L.push(`  pins already a favorite ${report.totals.pinsAlreadyFavorite}`);
  L.push(`  pins with an unknown kind ${report.totals.unknownKinds}`);
  L.push("");
  L.push("  home.topPins is NOT cleared. The key has no reader left, keeping it makes");
  L.push("  a re-run a no-op, and it is the record of what was folded.");
  return L.join("\n");
}

async function main() {
  const write = process.argv.includes("--write");
  const reportAt = argValue("--report");
  const orgFilter = argValue("--org");

  const report: Report = {
    ranAt: new Date().toISOString(),
    database: databaseLabel(),
    write,
    orgFilter,
    orgs: [],
    totals: { usersWithPins: 0, pinsRead: 0, pinsFolded: 0, pinsAlreadyFavorite: 0, unknownKinds: 0 },
  };

  const orgs = await prisma.organization.findMany({
    where: orgFilter ? { id: orgFilter } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  for (const org of orgs) {
    const r = await migrateOrg(org.id, org.name, write);
    if (!r || r.usersWithPins === 0) continue;
    report.orgs.push(r);
    report.totals.usersWithPins += r.usersWithPins;
    report.totals.pinsRead += r.pinsRead;
    report.totals.pinsFolded += r.pinsFolded;
    report.totals.pinsAlreadyFavorite += r.pinsAlreadyFavorite;
    report.totals.unknownKinds += r.unknownKinds.length;
  }

  const text = render(report);
  console.log(text);
  if (reportAt) {
    const dir = reportAt.replace(/\/[^/]+$/, "");
    if (dir && dir !== reportAt) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(reportAt, text);
    console.log(`\nReport saved to ${reportAt}`);
  }
  if (!write) {
    console.log("\nDRY RUN. Nothing was written. Add --write to apply (see scripts/MIGRATIONS.md).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
