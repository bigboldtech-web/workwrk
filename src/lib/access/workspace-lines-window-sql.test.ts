// The window of prisma/sql/2026-11-03-workspace-lines.sql (docs/plans/
// workspace-status-2.md, the step 1 review H1): between that file and the new
// release's first request, the release before serves on the new data; its
// moves write no membership line and carry the account's across, its
// handover moves account lines only, and a membership it makes gets no copy.
// prisma/sql/after-deploy/ holds the read-only check run right after every
// deploy and the recovery for what the check lists as recoverable. Neither
// is in the deploy manifest. The final review (integrity H1): both read the
// snapshot the file takes before it changes anything, so a move in the
// window followed by a move back after the reload (whose swap writes over
// the evidence) is still listed and put back. Checked as text, in the way of
// membership-status-sql.test.ts; the coordinator runs both on the local
// database with the planted cases in the plan ("Final review fixes, part
// A").

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const CHECK_FILE = "after-deploy/2026-11-03-workspace-lines-window-check.sql";
const RECOVERY_FILE = "after-deploy/2026-11-03-workspace-lines-window-recovery.sql";
const CHECK = read(`prisma/sql/${CHECK_FILE}`);
const RECOVERY = read(`prisma/sql/${RECOVERY_FILE}`);
const MAIN = read("prisma/sql/2026-11-03-workspace-lines.sql");
const body = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "");
const CHECK_BODY = body(CHECK);
const RECOVERY_BODY = body(RECOVERY);

/** A CTE's text, from "<name> AS (" to the line that closes it. */
function cte(sql: string, name: string): string {
  const start = sql.indexOf(`${name} AS (`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n)", start);
  return sql.slice(start, end);
}

describe("the window's T0 and T1", () => {
  it("reads T0 from the marker comment the file writes, in the very format it writes", () => {
    // What the file writes: the marker, then the moment the step ran, in UTC.
    const fmt = /'YYYY-MM-DD HH24:MI:SS\.MS'/;
    expect(MAIN).toMatch(fmt);
    const written = "The person's manager in this workspace while the account is anchored elsewhere (User.managerId is the anchored workspace's). Keep this marker in any new comment: workspace-lines-2026-11-03, applied 2026-11-03 10:15:02.123 UTC";
    for (const sql of [CHECK, RECOVERY]) {
      const pattern = /FROM '(applied \(\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\} \[0-9:\.\]\+\) UTC)'\)::timestamp/.exec(sql)?.[1];
      expect(pattern).toBeDefined();
      expect(new RegExp(pattern!).exec(written)?.[1]).toBe("2026-11-03 10:15:02.123");
      const guard = /FROM '(workspace-lines-2026-11-03, applied [^']+ UTC)'\) IS NULL THEN/.exec(sql)?.[1];
      expect(guard).toBeDefined();
      expect(new RegExp(guard!).exec(written)?.[1]).toBe("2026-11-03 10:15:02.123");
    }
  });

  it("starts five minutes before T0, and refuses to run until T1 is written in", () => {
    for (const sql of [CHECK_BODY, RECOVERY_BODY]) {
      const windows = sql.match(/WITH w AS \(/g)?.length ?? 0;
      expect(windows).toBeGreaterThan(0);
      // Every statement that reads the window has its own T1 to fill, which fails as it stands (not a timestamp).
      expect(sql.match(/'<T1>'::timestamp AS "t1"/g)).toHaveLength(windows);
      expect(sql.match(/::timestamp - interval '5 minutes' AS "t0"/g)).toHaveLength(windows);
    }
  });

  it("stops before anything when the comment holds no applied time, naming where to take it from", () => {
    for (const sql of [CHECK_BODY, RECOVERY_BODY]) {
      const first = sql.trim();
      expect(first.startsWith("DO $$")).toBe(true);
      expect(first.slice(0, first.indexOf("END\n$$;"))).toContain(`RAISE EXCEPTION 'The comment on "OrganizationMembership"."managerId" holds no applied time (T0)`);
      expect(sql).toContain(`deploy-migrations: applied 2026-11-03-workspace-lines.sql`);
    }
  });
});

describe("the check (read-only)", () => {
  it("writes nothing", () => {
    expect(CHECK_BODY).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE|COMMENT ON)\b/);
  });

  it("stops when the snapshot is gone, saying why", () => {
    for (const sql of [CHECK_BODY, RECOVERY_BODY]) {
      const guard = sql.slice(0, sql.indexOf("END\n$$;"));
      expect(guard).toContain(`IF to_regclass('"_deploy_lines_2026_11_03_accounts"') IS NULL OR to_regclass('"_deploy_lines_2026_11_03_dotted"') IS NULL THEN`);
      expect(guard).toContain(`RAISE EXCEPTION 'The snapshot tables "_deploy_lines_2026_11_03_accounts" and "_deploy_lines_2026_11_03_dotted" are not here`);
    }
  });

  it("lists (a) every line that is not what the file left it, read from the snapshot, the anchored workspace's stale row never", () => {
    const seats = cte(CHECK_BODY, "seats");
    // Both halves: the account where it is anchored, a membership elsewhere, from the snapshot of every account.
    expect(seats).toMatch(/FROM "_deploy_lines_2026_11_03_accounts" s\s+JOIN "User" u ON u\."id" = s\."id"\s+UNION ALL/);
    expect(seats).toMatch(/JOIN "OrganizationMembership" m ON m\."userId" = u\."id" AND m\."organizationId" <> u\."organizationId"\s*$/);
    expect(seats).toContain(`u."organizationId" = s."organizationId" AS "heldAtT0"`);
    const judged = cte(CHECK_BODY, "judged");
    // Seats held before the reload only: a seat made after T1 is the new release's.
    expect(judged).toMatch(/WHERE t\."heldAtT0" OR t\."since" <= w\."t1"$/);
    // The file's rules (E11 i and ii): the line at T0 where that manager held a row there at T0, never the person but where anchored.
    expect(judged).toContain(`t."lineAtT0" IS NOT NULL AND (t."lineAtT0" <> t."userId" OR t."organizationId" = t."anchoredAtT0")`);
    expect(judged).toContain(`EXISTS (SELECT 1 FROM "_deploy_lines_2026_11_03_accounts" x WHERE x."id" = t."lineAtT0" AND x."organizationId" = t."organizationId")
           OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = t."lineAtT0" AND y."organizationId" = t."organizationId" AND y."createdAt" < w."t0") AS "certain"`);
    // A manager deleted since leaves no line (the key's SET NULL), so none is expected.
    expect(judged).toContain(`AND EXISTS (SELECT 1 FROM "User" z WHERE z."id" = t."lineAtT0") AS "qualifies"`);
    const lost = cte(CHECK_BODY, "lost");
    expect(lost).toContain(`SELECT CASE WHEN j."qualifies" AND j."certain" THEN j."lineAtT0" END AS "expected"`);
    expect(lost).toMatch(/WHERE NOT j\."explained"\s+AND CASE WHEN e\."ambiguous" THEN j\."line" IS DISTINCT FROM j\."lineAtT0" ELSE j\."line" IS DISTINCT FROM e\."expected" END$/);
    // Recoverable only when nothing may have written it on purpose, the manager stands, it was not put back before, and the row is not a moment old.
    expect(lost).toMatch(/CASE\s+WHEN j\."touched" THEN '[^']+: set it by hand'\s+WHEN e\."ambiguous" THEN '[^']+: set it by hand'\s+WHEN e\."expected" IS NOT NULL AND j\."managerEnded" THEN '(?:[^']|'')+: set it by hand'\s+WHEN j\."putBack" THEN '[^']+: set it by hand'\s+WHEN j\."justWritten" THEN '[^']+'\s+ELSE 'recoverable'\s+END AS "state"/);
  });

  it("counts as written on purpose a line write recorded for that person there, a join there, an Agent's reports moved or a bulk change of managers there, by either release, never the deploy's own rows", () => {
    const log = cte(CHECK_BODY, "log");
    expect(log).toMatch(/WHERE a\."createdAt" >= w\."t0"\s+AND a\."id" NOT LIKE 'deploy-%'\s+AND a\."type" IN \('reporting_line_changed', 'user\.joined', 'bulk_update'\)$/);
    const judged = cte(CHECK_BODY, "judged");
    expect(judged).toContain(`(a."type" = 'reporting_line_changed' AND a."targetId" = t."userId" AND (a."oldValue" ? 'managerId' OR a."newValue" ? 'managerId'))`);
    expect(judged).toContain(`(a."type" = 'reporting_line_changed' AND a."metadata" ? 'agentReports')`);
    expect(judged).toContain(`(a."type" = 'user.joined' AND a."actorId" = t."userId")`);
    expect(judged).toContain(`(a."type" = 'bulk_update' AND a."metadata" ->> 'action' = 'change_manager')`);
    // A line still as its newest recorded write left it is not listed at all.
    expect(judged).toMatch(/ORDER BY a\."createdAt" DESC, a\."id" DESC LIMIT 1\) n\s+WHERE n\."m" IS NOT DISTINCT FROM t\."line"\) AS "explained"/);
    // A manager whose seat there, or whose account, ended since the window opened: by hand (no handover saw this person).
    expect(judged).toMatch(/\(\(x\."status" = 'INACTIVE' OR x\."deletedAt" IS NOT NULL\) AND x\."updatedAt" >= w\."t0"\)/);
    expect(judged).toMatch(/\(xs\."status" = 'INACTIVE' OR xs\."removedAt" IS NOT NULL\) AND xs\."updatedAt" >= w\."t0"\)\)\) AS "managerEnded"/);
    expect(judged).toContain(`t."rowWrittenAt" > (now() AT TIME ZONE 'UTC') - interval '2 minutes' AS "justWritten"`);
    expect(judged).toContain(`EXISTS (SELECT 1 FROM "ActivityLog" p WHERE p."id" = 'deploy-window-line-' || t."userId" || '-' || t."organizationId") AS "putBack"`);
  });

  it("lists (b) every account or membership line naming someone with no row in that workspace, (c) the handovers, (d) the dotted lines the file left that are gone, and (e) the dotted-line writes", () => {
    // (b): both halves, the anchored workspace's stale row never.
    expect(CHECK_BODY).toMatch(/WHERE u\."managerId" IS NOT NULL\s+AND NOT EXISTS \(SELECT 1 FROM "User" x WHERE x\."id" = u\."managerId" AND \(x\."organizationId" = u\."organizationId" OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = x\."id" AND y\."organizationId" = u\."organizationId"\)\)\)\s+UNION ALL/);
    expect(CHECK_BODY).toMatch(/JOIN "User" u ON u\."id" = m\."userId" AND u\."organizationId" <> m\."organizationId"\s+WHERE m\."managerId" IS NOT NULL\s+AND NOT EXISTS \(SELECT 1 FROM "User" x WHERE x\."id" = m\."managerId" AND \(x\."organizationId" = m\."organizationId" OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = x\."id" AND y\."organizationId" = m\."organizationId"\)\)\);/);
    // (c): a membership line naming a manager whose seat there ended since T0, anchored there or through a membership there, or their account ended.
    expect(CHECK_BODY).toMatch(/\(x\."organizationId" = m\."organizationId" AND \(x\."status" = 'INACTIVE' OR x\."deletedAt" IS NOT NULL\) AND x\."updatedAt" >= w\."t0"\)/);
    expect(CHECK_BODY).toMatch(/\(xs\."id" IS NOT NULL AND \(xs\."status" = 'INACTIVE' OR xs\."removedAt" IS NOT NULL\) AND xs\."updatedAt" >= w\."t0"\)/);
    expect(CHECK_BODY).toMatch(/\(xs\."id" IS NOT NULL AND \(x\."status" = 'INACTIVE' OR x\."deletedAt" IS NOT NULL\) AND x\."updatedAt" >= w\."t0"\)/);
    // (d): each snapshot dotted line in each workspace where both held a row at T0 (E11 iii), missing now, everyone still here.
    const missing = cte(CHECK_BODY, "missing");
    expect(missing).toContain(`FROM "_deploy_lines_2026_11_03_dotted" d`);
    expect(missing).toMatch(/JOIN \(SELECT s\."id" AS "userId", s\."organizationId" FROM "_deploy_lines_2026_11_03_accounts" s\s+UNION\s+SELECT y\."userId", y\."organizationId" FROM "OrganizationMembership" y CROSS JOIN w WHERE y\."createdAt" < w\."t0"\) p ON p\."userId" = d\."userId"/);
    expect(missing).toMatch(/AND NOT EXISTS \(SELECT 1 FROM "UserDottedLine" e WHERE e\."userId" = d\."userId" AND e\."managerId" = d\."managerId" AND e\."organizationId" = p\."organizationId"\)$/);
    expect(missing).toMatch(/WHEN EXISTS \(SELECT 1 FROM log a WHERE a\."organizationId" = p\."organizationId" AND a\."type" = 'reporting_line_changed' AND \(a\."targetId" = d\."userId" OR a\."metadata" \? 'agentReports'\)\)/);
    // (e): the release before's own dotted-line audit rows in the window, never the deploy's.
    expect(CHECK_BODY).toMatch(/a\."type" = 'reporting_line_changed'\s+AND a\."id" NOT LIKE 'deploy-%'\s+AND \(a\."oldValue" \? 'dottedManagerId' OR a\."metadata" \? 'dottedManagerIds'\)/);
    const header = (/^\/\*([\s\S]*?)\*\//.exec(CHECK)?.[1] ?? "").replace(/\s+/g, " ");
    for (const words of [
      "NOT in the deploy manifest", "psql -v ON_ERROR_STOP=1", "again right after the redeploy",
      "If (a), (b) or (d) lists anything, run 2026-11-03-workspace-lines-window-recovery.sql, then this again.",
      // The final review, integrity H1: read from the snapshot, so a move back after the reload hides nothing, and the check is no less complete for being run late.
      "SO THIS READS THE SNAPSHOT", "a move back after the reload included", "as complete an hour after the reload as a minute after it", "Run it at once all the same",
      `DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_accounts"; DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_dotted";`,
    ]) {
      expect(header).toContain(words);
    }
  });
});

describe("the recovery", () => {
  it("picks with exactly the check's rules, in each of its three statements", () => {
    // After the guard: the membership lines, the account lines, the dotted lines.
    expect(RECOVERY.match(/^\/\* [123]\. The (membership lines|account lines|dotted lines)\. \*\/$/gm)).toEqual(["/* 1. The membership lines. */", "/* 2. The account lines. */", "/* 3. The dotted lines. */"]);
    const parts = RECOVERY_BODY.split("WITH w AS (").slice(1).map((p) => `WITH w AS (${p}`);
    expect(parts).toHaveLength(3);
    for (const part of parts.slice(0, 2)) {
      for (const name of ["w", "log", "seats", "judged", "lost"]) expect(cte(part, name), name).toBe(cte(CHECK_BODY, name));
    }
    for (const name of ["w", "log", "missing"]) expect(cte(parts[2], name), name).toBe(cte(CHECK_BODY, name));
  });

  it("writes each line under the person's row lock, read again under it, only while the row still holds the line read, never a row it locked in the same statement", () => {
    const [membership, account, dotted] = RECOVERY_BODY.split("WITH w AS (").slice(1);
    for (const part of [membership, account]) {
      expect(part).toMatch(/held AS \(\s+SELECT l\."userId", l\."organizationId", [^\n]*\n\s+FROM lost l\s+JOIN "User" u ON u\."id" = l\."userId" AND u\."organizationId" = l\."anchoredIn" AND u\."updatedAt" = l\."accountWrittenAt"\s+WHERE l\."state" = 'recoverable'/);
      expect(part).toMatch(/FOR UPDATE OF u\n\)/);
    }
    // The membership statement writes memberships only, the account statement the account only (so no statement writes a User row it locked twice).
    expect(membership).toMatch(/AND l\."membershipId" IS NOT NULL\s+FOR UPDATE OF u/);
    expect(membership).toMatch(/membership_set AS \(\s+UPDATE "OrganizationMembership" m\s+SET "managerId" = h\."expected"\s+FROM held h\s+WHERE m\."id" = h\."membershipId"\s+AND m\."managerId" IS NOT DISTINCT FROM h\."line"/);
    expect(membership).not.toContain(`UPDATE "User"`);
    expect(account).toMatch(/AND l\."membershipId" IS NULL\s+FOR UPDATE OF u/);
    expect(account).toMatch(/account_set AS \(\s+UPDATE "User" u\s+SET "managerId" = h\."expected"\s+FROM held h\s+WHERE u\."id" = h\."userId"\s+AND u\."organizationId" = h\."organizationId"\s+AND u\."managerId" IS NOT DISTINCT FROM h\."line"/);
    expect(account).not.toContain(`UPDATE "OrganizationMembership"`);
    // The dotted lines: the snapshot's note, weight, dates and age, never over a line there now.
    expect(dotted).toMatch(/held AS \(\s+[^\n]*\n\s+SELECT g\."lineId", g\."userId", g\."managerId", g\."organizationId", g\."role", g\."weight", g\."startDate", g\."endDate", g\."createdAt"\s+FROM missing g\s+JOIN "User" u ON u\."id" = g\."userId"\s+WHERE g\."state" = 'recoverable'\s+FOR UPDATE OF u/);
    expect(dotted).toMatch(/INSERT INTO "UserDottedLine" \("id", "userId", "managerId", "organizationId", "role", "weight", "startDate", "endDate", "createdAt", "updatedAt"\)\s+SELECT 'deploy-window-dotted-' \|\| h\."lineId" \|\| '-' \|\| h\."organizationId", h\."userId", h\."managerId", h\."organizationId",\s+h\."role", h\."weight", h\."startDate", h\."endDate", h\."createdAt", \(now\(\) AT TIME ZONE 'UTC'\)\s+FROM held h\s+ON CONFLICT DO NOTHING/);
    // These writes and the audit rows, nothing else; nothing deleted.
    expect(RECOVERY_BODY.match(/\bUPDATE "/g)).toHaveLength(2);
    expect(RECOVERY_BODY.match(/INSERT INTO "ActivityLog"/g)).toHaveLength(3);
    expect(RECOVERY_BODY.match(/INSERT INTO "UserDottedLine"/g)).toHaveLength(1);
    expect(RECOVERY_BODY).not.toMatch(/\b(DELETE|ALTER|CREATE|DROP|TRUNCATE|COMMENT ON)\b/);
  });

  it("records each change in an Audit row, actor the system, the old and new line, ids that keep a second run from changing anything", () => {
    const [membership, account, dotted] = RECOVERY_BODY.split("WITH w AS (").slice(1);
    for (const [part, from] of [[membership, "membership_set s"], [account, "account_set s"]] as const) {
      const at = part.indexOf(`SELECT 'deploy-window-line-' || s."userId" || '-' || s."organizationId", 'reporting_line_changed', NULL, 'system', s."organizationId",`);
      expect(at, from).toBeGreaterThanOrEqual(0);
      expect(part.indexOf(`FROM ${from}\nON CONFLICT ("id") DO NOTHING;`, at)).toBeGreaterThan(at);
      expect(part).toContain(`jsonb_build_object('managerId', s."was"), jsonb_build_object('managerId', s."now")`);
    }
    const at = dotted.indexOf(`SELECT p."id", 'reporting_line_changed', NULL, 'system', p."organizationId",`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(dotted.indexOf(`FROM put p\nON CONFLICT ("id") DO NOTHING;`, at)).toBeGreaterThan(at);
    expect(dotted).toContain(`'managerId', p."managerId", 'note', p."role", 'weight', p."weight", 'startDate', p."startDate", 'endDate', p."endDate", 'createdAt', p."createdAt"`);
    // The audit row's id is the one the check's putBack reads: a seat or a line put back once is never put back again.
    expect(CHECK_BODY).toContain(`p."id" = 'deploy-window-line-' || t."userId" || '-' || t."organizationId"`);
    expect(CHECK_BODY).toContain(`b."id" = 'deploy-window-dotted-' || d."id" || '-' || p."organizationId"`);
    expect(RECOVERY_BODY.match(/ON CONFLICT \("id"\) DO NOTHING;/g)).toHaveLength(3);
    const header = (/^\/\*([\s\S]*?)\*\//.exec(RECOVERY)?.[1] ?? "").replace(/\s+/g, " ");
    for (const words of ["FROM THE SNAPSHOT AND THE FILE'S OWN RULES", "NEVER OVER A LINE WRITTEN ON PURPOSE", "a second run changes nothing", "Nothing is deleted", "The handovers (list (c)) and everything not recoverable are set by hand"]) {
      expect(header).toContain(words);
    }
  });
});

describe("where they live", () => {
  it("are not in the deploy manifest, and have their README rows", () => {
    const block = /const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(read("scripts/deploy-migrations.mjs"))?.[1] ?? "";
    expect(block).not.toContain("window-check");
    expect(block).not.toContain("window-recovery");
    const readme = read("prisma/sql/README.md");
    for (const file of [CHECK_FILE, RECOVERY_FILE]) {
      expect(readme).toMatch(new RegExp(`^\\| \`${file.replace(/[.]/g, "\\.")}\` \\| .*NOT in the deploy manifest \\| \\*\\*run by hand after the deploy\\*\\* \\|$`, "m"));
    }
    // The file's own header points at them.
    expect(MAIN).toContain(`prisma/sql/${CHECK_FILE}`);
    expect(MAIN).toContain(`prisma/sql/${RECOVERY_FILE}`);
    for (const sql of [CHECK, RECOVERY]) expect(sql).not.toMatch(/—|–|--/);
  });
});
