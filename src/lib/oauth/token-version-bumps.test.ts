// Every tokenVersion increment, classified (docs/plans/mcp-server.md
// Decision 10, review H1, step 1 tests "token-version-bumps: classifies
// every increment"). A grant holds the account's tokenVersion, so a bump
// ends the person's AI apps, with ONE exception: the ordinary log out, which
// moves the account and its matching grants together (grants.ts
// signOutBump). A new bump anywhere fails this test until it is classified
// here, so nobody adds a way to keep an app connected, or to end one, by
// accident.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
type Kind =
  /** The ordinary log out: the account and its matching grants in one transaction (the accepted risk). */
  | "signout_carries_grants"
  /** The signOut event's plain bump, only when the carrying transaction failed: the apps then end (fail closed). */
  | "signout_fallback"
  /** Ends the apps at once (revokeAllGrantsOf), and by the bump at their next request too. */
  | "revokes_now"
  /** Ends the bumped accounts' apps once the bump commits (grants.ts revokeLeftBehind; final review, privacy M2). */
  | "revokes_after_commit"
  /**
   * Ends the apps at their next request (3.8 step 7, sessions_ended), or the
   * erasure revoked them first; one never used again is ended by the nightly
   * sweep (sweep.ts revokeLeftBehind; final review, privacy M2).
   */
  | "ends_at_next_request"
  /** Another table's tokenVersion (a Google connection's), not the account's. */
  | "not_the_account";

/** Each file that increments a tokenVersion, how many times, and what that does to an AI app. */
const CLASSIFIED: Record<string, { kind: Kind; count: number }> = {
  "src/lib/oauth/grants.ts": { kind: "signout_carries_grants", count: 1 },
  "src/lib/auth.ts": { kind: "signout_fallback", count: 1 },
  "src/app/api/me/sign-out-everywhere/route.ts": { kind: "revokes_now", count: 1 },
  "src/app/api/me/change-password/route.ts": { kind: "revokes_now", count: 1 },
  "src/app/api/auth/reset-password/route.ts": { kind: "revokes_now", count: 1 },
  "src/app/api/me/delete/route.ts": { kind: "ends_at_next_request", count: 1 },
  "src/app/api/org/sign-out-everyone/route.ts": { kind: "revokes_after_commit", count: 1 },
  "src/app/api/users/[id]/route.ts": { kind: "ends_at_next_request", count: 2 },
  "src/lib/scim-deprovision.ts": { kind: "ends_at_next_request", count: 2 },
  "src/lib/access/membership.ts": { kind: "ends_at_next_request", count: 2 },
  "src/lib/admin/company-patch.ts": { kind: "ends_at_next_request", count: 1 },
  "scripts/reset-admin.ts": { kind: "ends_at_next_request", count: 1 },
  // An Owner's or Admin's two step verification reset (launch audit): the
  // bump, and the account's AI apps ended at once.
  "src/app/api/users/[id]/mfa-reset/route.ts": { kind: "revokes_now", count: 1 },
  // The staff path for a locked-out sole Owner, as reset-admin.ts.
  "scripts/reset-two-step.ts": { kind: "ends_at_next_request", count: 1 },
  "src/lib/connectors/connections.ts": { kind: "not_the_account", count: 1 },
};

const INCREMENT = /tokenVersion\s*[:=]\s*\{\s*increment\b|"tokenVersion"\s*=\s*"tokenVersion"\s*\+/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === "generated" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith("-test-db.ts")) out.push(p);
  }
  return out;
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("every tokenVersion increment is classified", () => {
  it("finds each one where the table says, and no other", () => {
    const found: Record<string, number> = {};
    for (const file of [...sources(path.join(ROOT, "src")), ...sources(path.join(ROOT, "scripts"))]) {
      const n = (readFileSync(file, "utf8").match(INCREMENT) ?? []).length;
      if (n > 0) found[path.relative(ROOT, file).split(path.sep).join("/")] = n;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(CLASSIFIED).map(([f, c]) => [f, c.count])));
  });

  it("carries the grants only in the ordinary log out, in the same transaction as the account", () => {
    const grants = read("src/lib/oauth/grants.ts");
    const fn = grants.slice(grants.indexOf("export async function signOutBump"), grants.indexOf("// ── Ending grants"));
    expect(fn).toContain("prisma.$transaction");
    expect(fn).toMatch(/tx\.user\.update\(\{ where: \{ id: userId \}, data: \{ tokenVersion: \{ increment: 1 \} \}/);
    expect(fn).toMatch(/tx\.oAuthGrant\.updateMany\(\{\s*where: \{ userId, revokedAt: null, tokenVersion: after\.tokenVersion - 1 \},\s*data: \{ tokenVersion: after\.tokenVersion \}/);
    // Nothing else moves a grant's tokenVersion forward.
    const movers = Object.keys(CLASSIFIED).filter((f) => /oAuthGrant\.updateMany\([^)]*tokenVersion: after/.test(read(f).replace(/\s+/g, " ")));
    expect(movers).toEqual(["src/lib/oauth/grants.ts"]);
  });

  it("has the signOut event use signOutBump, with the plain bump only as its fallback", () => {
    const auth = read("src/lib/auth.ts");
    const event = auth.slice(auth.indexOf("async signOut({ token })"));
    expect(event).toMatch(/const carried = await signOutBump\(id\)/);
    expect(event).toMatch(/if \(!carried\) \{\s*await prisma\.user\s*\.update\(\{ where: \{ id \}, data: \{ tokenVersion: \{ increment: 1 \} \} \}\)/);
  });

  it("has Sign out everywhere, a password change and a reset end the apps at once", () => {
    for (const [file, c] of Object.entries(CLASSIFIED)) {
      if (c.kind !== "revokes_now") continue;
      const src = read(file);
      expect(src, file).toContain('import { revokeAllGrantsOf } from "@/lib/oauth/grants"');
      expect(src, file).toMatch(/await revokeAllGrantsOf\([^,]+, "sessions_ended"/);
    }
  });

  // Final review of the MCP server, privacy M2: a grant a bump left behind
  // stayed unrevoked until its endsBy when its app was never used again.
  // Fails on fcca4075: Sign everyone out revoked nothing, and the sweep had
  // no such step.
  it("has Sign everyone out end its bumped accounts' apps after its commit, and the sweep end every other one", () => {
    for (const [file, c] of Object.entries(CLASSIFIED)) {
      if (c.kind !== "revokes_after_commit") continue;
      const src = read(file);
      expect(src, file).toContain('import { revokeLeftBehind } from "@/lib/oauth/grants"');
      // After the transaction that bumps, with the accounts it read inside it.
      const tx = src.indexOf("await prisma.$transaction(");
      const call = src.indexOf("await revokeLeftBehind({ userIds: r.people, actorId: su.id })");
      expect(tx, file).toBeGreaterThan(0);
      expect(call, file).toBeGreaterThan(tx);
      expect(src.slice(tx, call)).toMatch(/tx\.user\.findMany\(\{ where: \{ organizationId: su\.organizationId \}, select: \{ id: true \} \}\)/);
    }
    const sweep = read("src/lib/oauth/sweep.ts");
    expect(sweep.indexOf('step("left_behind", () => revokeLeftBehind({ now }))')).toBeGreaterThan(0);
    expect(sweep.indexOf('step("left_behind"')).toBeLessThan(sweep.indexOf('step("expired"'));
  });
});
