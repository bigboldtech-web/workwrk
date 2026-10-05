// Notifications about a company that is deleted for good, in the inboxes of
// the people whose accounts outlive it (/api/cron/org-hard-delete).
// Server-only.
//
// WHY. Notification has no company: a row is deleted only with its person.
// The accounts that go with the company take their notifications with them,
// but a member anchored to another workspace, or moved out before the delete
// (moveHomesOutOf), keeps rows naming the company's tasks, policies, reviews
// and people, linking to things that no longer exist.
//
// WHAT GOES. In the inbox of anyone who holds a membership in the company,
// every notification whose link carries the id of one of the company's own
// rows, in any table with an "id" and an "organizationId" column. Ids are
// unique across companies, and each match is checked against the company's
// own rows, so another company's notification is never touched.
//
// WHAT STAYS. A notification whose link names no record (a kudos note, the
// KRA tab, the team reviews page) cannot be told apart from one about another
// workspace, and is kept.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

/** What can be a record id in a link: 20 or more letters, digits, - or _. */
export const LINK_ID_PATTERN = "[A-Za-z0-9_-]{20,}";

/** The record ids a link may carry (for tests and reading; the sweep runs in SQL). */
export function linkIds(link: string | null | undefined): string[] {
  if (!link) return [];
  return [...new Set(link.match(new RegExp(LINK_ID_PATTERN, "g")) ?? [])];
}

/** The tables whose rows belong to one company: they have an "id" and an
 *  "organizationId" column. Names come from the database catalog. */
export async function companyOwnedTables(db: typeof prisma | Prisma.TransactionClient = prisma): Promise<string[]> {
  const rows = await db.$queryRaw<{ name: string }[]>`
    SELECT c."table_name" AS name
      FROM information_schema.columns c
     WHERE c."table_schema" = 'public' AND c."column_name" = 'organizationId'
       AND EXISTS (
             SELECT 1 FROM information_schema.columns d
              WHERE d."table_schema" = 'public' AND d."table_name" = c."table_name" AND d."column_name" = 'id'
           )
     ORDER BY 1`;
  return rows.map((r) => r.name).filter((n) => /^[A-Za-z][A-Za-z0-9_]*$/.test(n));
}

/**
 * Inside the hard delete's transaction, while the company's rows still exist:
 * delete the notifications described above. Returns how many went.
 */
export async function deleteNotificationsAbout(tx: Prisma.TransactionClient, organizationId: string, tables: readonly string[]): Promise<number> {
  // Each member notification's candidate ids, then the ones that are the
  // company's own rows, table by table by primary key.
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE hd_note_id ON COMMIT DROP AS
       SELECT n."id" AS nid, m[1] AS rid
         FROM "Notification" n
        CROSS JOIN LATERAL regexp_matches(n."link", '${LINK_ID_PATTERN}', 'g') AS m
        WHERE n."link" IS NOT NULL
          AND n."userId" IN (SELECT o."userId" FROM "OrganizationMembership" o WHERE o."organizationId" = $1)`,
    organizationId,
  );
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE hd_company_id (rid text PRIMARY KEY) ON COMMIT DROP`);
  for (const table of tables) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table)) continue;
    await tx.$executeRawUnsafe(
      `INSERT INTO hd_company_id (rid)
         SELECT DISTINCT t.rid FROM hd_note_id t JOIN "${table}" x ON x."id"::text = t.rid
          WHERE x."organizationId" = $1
       ON CONFLICT DO NOTHING`,
      organizationId,
    );
  }
  const gone = await tx.$executeRawUnsafe(
    `DELETE FROM "Notification" n
      WHERE n."id" IN (SELECT t.nid FROM hd_note_id t JOIN hd_company_id c ON c.rid = t.rid)`,
  );
  await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS hd_note_id, hd_company_id`);
  return gone;
}
