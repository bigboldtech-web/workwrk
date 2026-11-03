// The window of prisma/sql/2026-11-03-workspace-lines.sql (docs/plans/
// workspace-status-2.md, the step 1 review H1): between that file and the new
// release's first request, the release before serves on the new data; its
// moves write no membership line and carry the account's across, its
// handover moves account lines only, and a membership it makes gets no copy.
// prisma/sql/after-deploy/ holds the read-only check run right after every
// deploy and the recovery for what the check lists as recoverable. Neither
// is in the deploy manifest. Checked as text, in the way of
// membership-status-sql.test.ts; the coordinator runs both on the local
// database against the f16c2220 code's moves and handover.

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

  it("lists (a) lines carried in, (b) the moves, (c) the handovers, (d) the memberships made in the window and (e) the dotted-line writes", () => {
    // (a): an account line naming someone with no row in the anchored workspace.
    expect(CHECK_BODY).toMatch(/WHERE u\."managerId" IS NOT NULL\s+AND NOT EXISTS \(SELECT 1 FROM "User" x WHERE x\."id" = u\."managerId" AND \(x\."organizationId" = u\."organizationId" OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = x\."id" AND y\."organizationId" = u\."organizationId"\)\)\);/);
    // (b) and (d) mark what the recovery puts back with the recovery's own rules.
    expect(CHECK_BODY).toContain(`EXISTS (SELECT 1 FROM moved m WHERE m."userId" = u."id" AND m."leftId" = l."id") AS "recoverable"`);
    expect(CHECK_BODY).toContain(`EXISTS (SELECT 1 FROM made d WHERE d."membershipId" = m."id") AS "recoverable"`);
    // (c): a membership line naming a manager whose seat there ended since T0, anchored there or through a membership there, or their account ended.
    expect(CHECK_BODY).toMatch(/\(x\."organizationId" = m\."organizationId" AND \(x\."status" = 'INACTIVE' OR x\."deletedAt" IS NOT NULL\) AND x\."updatedAt" >= w\."t0"\)/);
    expect(CHECK_BODY).toMatch(/\(xs\."id" IS NOT NULL AND \(xs\."status" = 'INACTIVE' OR xs\."removedAt" IS NOT NULL\) AND xs\."updatedAt" >= w\."t0"\)/);
    expect(CHECK_BODY).toMatch(/\(xs\."id" IS NOT NULL AND \(x\."status" = 'INACTIVE' OR x\."deletedAt" IS NOT NULL\) AND x\."updatedAt" >= w\."t0"\)/);
    // (e): the release before's own dotted-line audit rows in the window, never the deploy's.
    expect(CHECK_BODY).toMatch(/a\."type" = 'reporting_line_changed'\s+AND a\."id" NOT LIKE 'deploy-%'\s+AND \(a\."oldValue" \? 'dottedManagerId' OR a\."metadata" \? 'dottedManagerIds'\)/);
    const header = (/^\/\*([\s\S]*?)\*\//.exec(CHECK)?.[1] ?? "").replace(/\s+/g, " ");
    for (const words of ["NOT in the deploy manifest", "psql -v ON_ERROR_STOP=1", "again right after the redeploy", "If (a), (b) or (d) lists anything, run 2026-11-03-workspace-lines-window-recovery.sql, then this again."]) {
      expect(header).toContain(words);
    }
  });
});

describe("the recovery", () => {
  const moved = cte(RECOVERY_BODY, "moved");
  const made = cte(RECOVERY_BODY, "made");

  it("picks with exactly the check's rules, under each person's row lock", () => {
    expect(moved.replace(/\s+FOR UPDATE OF u$/, "")).toBe(cte(CHECK_BODY, "moved"));
    expect(made.replace(/\s+FOR UPDATE OF u$/, "")).toBe(cte(CHECK_BODY, "made"));
    expect(moved).toMatch(/FOR UPDATE OF u$/);
    expect(made).toMatch(/FOR UPDATE OF u$/);
  });

  it("takes a move only when the account and the membership it left were written together in the window, nothing since T1, the left line NULL and the account's line that workspace's", () => {
    expect(moved).toMatch(/JOIN "User" u ON u\."updatedAt" BETWEEN w\."t0" AND w\."t1"/);
    expect(moved).toMatch(/JOIN "OrganizationMembership" l ON l\."userId" = u\."id" AND l\."organizationId" <> u\."organizationId"\s+AND l\."managerId" IS NULL AND l\."updatedAt" BETWEEN w\."t0" AND w\."t1"/);
    // The new workspace's own row, never written since T1.
    expect(moved).toMatch(/JOIN "OrganizationMembership" r ON r\."userId" = u\."id" AND r\."organizationId" = u\."organizationId" AND r\."updatedAt" <= w\."t1"/);
    // Written together (one transaction), the line the left workspace's (or none), one such row only, never matched twice.
    expect(moved).toContain(`abs(extract(epoch FROM (u."updatedAt" - l."updatedAt"))) < 60`);
    expect(moved).toMatch(/AND \(u\."managerId" IS NULL OR EXISTS \(SELECT 1 FROM "User" x WHERE x\."id" = u\."managerId" AND \(x\."organizationId" = l\."organizationId" OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = x\."id" AND y\."organizationId" = l\."organizationId"\)\)\)\)/);
    expect(moved).toMatch(/NOT EXISTS \(SELECT 1 FROM "OrganizationMembership" o\s+WHERE o\."userId" = u\."id" AND o\."id" <> l\."id" AND o\."organizationId" <> u\."organizationId"\s+AND o\."managerId" IS NULL AND o\."updatedAt" BETWEEN w\."t0" AND w\."t1"\)/);
    expect(moved).toContain(`NOT EXISTS (SELECT 1 FROM "ActivityLog" a WHERE a."id" IN ('deploy-window-left-' || u."id", 'deploy-window-anchor-' || u."id"))`);
  });

  it("gives the account its new workspace's line from that workspace's own row, and for a row made in the window the file's own rule (E11 i)", () => {
    expect(moved).toMatch(/CASE\s+WHEN r\."managerId" IS NULL AND r\."createdAt" >= w\."t0"\s+AND u\."managerId" IS NOT NULL AND u\."managerId" <> u\."id"\s+AND EXISTS \(SELECT 1 FROM "User" x WHERE x\."id" = u\."managerId" AND \(x\."organizationId" = r\."organizationId" OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = x\."id" AND y\."organizationId" = r\."organizationId"\)\)\)\s+THEN u\."managerId"\s+ELSE r\."managerId"\s+END AS "anchorLine"/);
  });

  it("writes the left membership only while it is still NULL, and the account only while it holds the line read, never over the new release's", () => {
    expect(RECOVERY_BODY).toMatch(/left_set AS \(\s+UPDATE "OrganizationMembership" l\s+SET "managerId" = m\."accountLine"\s+FROM moved m\s+WHERE l\."id" = m\."leftId"\s+AND l\."managerId" IS NULL\s+AND m\."accountLine" IS NOT NULL/);
    expect(RECOVERY_BODY).toMatch(/anchor_set AS \(\s+UPDATE "User" u\s+SET "managerId" = m\."anchorLine"\s+FROM moved m\s+WHERE u\."id" = m\."userId"\s+AND u\."managerId" IS NOT DISTINCT FROM m\."accountLine"\s+AND m\."anchorLine" IS DISTINCT FROM m\."accountLine"/);
    expect(RECOVERY_BODY).toMatch(/fixed AS \(\s+UPDATE "OrganizationMembership" m\s+SET "managerId" = d\."line"\s+FROM made d\s+WHERE m\."id" = d\."membershipId"\s+AND m\."managerId" IS NULL/);
    // A membership made in the window is copied only for an account not written since before it, where the manager holds a row there.
    expect(made).toMatch(/JOIN "OrganizationMembership" m ON m\."createdAt" BETWEEN w\."t0" AND w\."t1" AND m\."updatedAt" <= w\."t1" AND m\."managerId" IS NULL/);
    expect(made).toMatch(/JOIN "User" u ON u\."id" = m\."userId" AND u\."organizationId" <> m\."organizationId" AND u\."updatedAt" < w\."t0"/);
    expect(made).toContain(`NOT EXISTS (SELECT 1 FROM "ActivityLog" a WHERE a."id" = 'deploy-window-made-' || m."id")`);
    // These three writes and the audit rows, nothing else; nothing deleted.
    expect(RECOVERY_BODY.match(/\bUPDATE "/g)).toHaveLength(3);
    expect(RECOVERY_BODY.match(/INSERT INTO "ActivityLog"/g)).toHaveLength(2);
    expect(RECOVERY_BODY).not.toMatch(/\b(DELETE|ALTER|CREATE|DROP|TRUNCATE|COMMENT ON)\b/);
  });

  it("records each change in an Audit row, actor the system, the old and new manager, ids that keep a second run from changing anything", () => {
    for (const [id, from] of [["deploy-window-left-' || s.\"userId\"", "left_set s"], ["deploy-window-anchor-' || s.\"id\"", "anchor_set s"], ["deploy-window-made-' || f.\"id\"", "fixed f"]]) {
      const at = RECOVERY_BODY.indexOf(`'${id}, 'reporting_line_changed', NULL, 'system',`);
      expect(at, id).toBeGreaterThanOrEqual(0);
      expect(RECOVERY_BODY.indexOf(`FROM ${from}`, at)).toBeGreaterThan(at);
    }
    expect(RECOVERY_BODY).toContain(`jsonb_build_object('managerId', s."was"), jsonb_build_object('managerId', s."now")`);
    expect(RECOVERY_BODY.match(/ON CONFLICT \("id"\) DO NOTHING;/g)).toHaveLength(2);
    const header = (/^\/\*([\s\S]*?)\*\//.exec(RECOVERY)?.[1] ?? "").replace(/\s+/g, " ");
    for (const words of ["NEVER OVER A LINE THE NEW RELEASE WROTE", "a second run changes nothing", "Nothing is deleted", "The handovers (list (c)) and anything not recoverable are set by hand"]) {
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
