// The paths that make a person a live member of a workspace again
// (docs/plans/ai-teammates-phase5.md Decision 14, step 3), held by reading
// them as written: each clears that person's skills' 30 days there
// (store.ts skillsBackFor), after its write commits, so a skill is never
// deleted 30 days after a leave its person came back from. The users route's
// and SCIM's reactivations are proven by their own route tests; an
// invitation accepted with an existing account has no route test, so its
// order is held here. A brand new account (SCIM's or an invitation's sign up)
// has no skills to clear.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("a membership made by accepting an invitation (Phase 5 step 3)", () => {
  const src = read("src/app/api/auth/accept-invite/route.ts");

  it("clears the person's skills there after the membership's transaction commits, before it answers", () => {
    expect(src).toContain('import { skillsBackFor } from "@/lib/skills/store";');
    const branch = src.slice(src.indexOf("if (sessionUser?.id) {"), src.indexOf("// ── Signed out"));
    const upsert = branch.indexOf("tx.organizationMembership.upsert(");
    const committed = branch.indexOf("}, LOCKED_TX);", upsert);
    const back = branch.indexOf("await skillsBackFor(inv.organizationId, [me.id]);");
    const answer = branch.indexOf("return NextResponse.json({ ok: true, landing, refreshSession: true }, { status: 201 });");
    expect(upsert).toBeGreaterThan(0);
    // Before: nothing cleared, so a returning person's skills there were deleted on their old leave's 30th day.
    expect(back).toBeGreaterThan(committed);
    expect(back).toBeLessThan(answer);
  });
});

describe("skillsBackFor never fails the route that calls it", () => {
  it("logs a throw by its code and answers nothing", () => {
    const store = read("src/lib/skills/store.ts");
    const fn = store.slice(store.indexOf("export async function skillsBackFor("));
    expect(fn).toMatch(/try \{\s*await clearSkillsOrphaned\(\{ organizationId, userIds \}\);\s*\} catch \(err\) \{\s*console\.error\(`\[skills\] return hook \$\{codeOf\(err\)\}`\);\s*\}/);
  });
});
