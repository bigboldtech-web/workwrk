// Skills nobody can use any more (src/lib/skills/orphans.ts,
// docs/plans/ai-teammates-phase5.md Decision 14, step 3): the rolling check
// marks those whose person left or was deactivated, or whose teammate was
// removed, and clears those that came back; a skill orphaned past 30 days
// is checked again before it is deleted, so one whose person is back is
// kept, never deleted by its date alone.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ acting: new Map<string, { ok: boolean; reason?: string }>(), reads: [] as string[] }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/agents/acting", () => ({
  resolveActingPerson: async (org: string, userId: string) => {
    st.reads.push(`${org}:${userId}`);
    const r = st.acting.get(userId) ?? { ok: true };
    if (r.reason === "throw") throw new Error("database down");
    return r.ok ? { ok: true, person: { userId } } : { ok: false, reason: r.reason };
  },
}));

import { bdb, resetBrowserDb, seedAgent, seedRoutine, seedSkill } from "@/lib/browser/browser-test-db";
import { clearSkillsOrphaned, markSkillsOrphaned, resetOrphanCursorForTests, sweepOrphanSkills } from "./orphans";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetBrowserDb();
  resetOrphanCursorForTests();
  st.acting = new Map();
  st.reads = [];
  seedAgent();
  seedAgent({ id: "a-gone", slug: "gone", name: "Gone", status: "ARCHIVED" });
});

describe("the rolling check", () => {
  it("marks a leaver's, a deactivated person's and a removed teammate's skills, never a Guest's, and clears those that came back", async () => {
    const now = new Date();
    st.acting.set("u-lee", { ok: false, reason: "gone" });
    st.acting.set("u-ina", { ok: false, reason: "inactive" });
    st.acting.set("u-gus", { ok: false, reason: "guest" });
    st.acting.set("u-aio", { ok: false, reason: "ai_off" });
    const lee = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's" });
    const ina = seedSkill({ status: "draft", userId: "u-ina", name: "Ina's" });
    const removed = seedSkill({ status: "ready", agentId: "a-gone", name: "On a removed teammate" });
    const guest = seedSkill({ status: "ready", userId: "u-gus", name: "A guest's" });
    const aiOff = seedSkill({ status: "ready", userId: "u-aio", name: "AI off" });
    const back = seedSkill({ status: "ready", name: "Max came back", orphanedAt: new Date(now.getTime() - 3 * DAY) });
    const c = await sweepOrphanSkills(now);
    expect(c).toEqual({ marked: 3, cleared: 1, deleted: 0 });
    expect([lee, ina, removed].map((s) => s.orphanedAt)).toEqual([now, now, now]);
    expect([guest, aiOff, back].map((s) => s.orphanedAt)).toEqual([null, null, null]);
    // Read once a tick each.
    expect(st.reads.filter((r) => r === "org1:u-max")).toHaveLength(1);
  });

  it("reads at most its page a tick, from where the last stopped, and starts again from the first after the end", async () => {
    st.acting.set("u-lee", { ok: false, reason: "gone" });
    const a = seedSkill({ id: "sk-a", userId: "u-lee", name: "A" });
    const b = seedSkill({ id: "sk-b", userId: "u-lee", name: "B" });
    const c = seedSkill({ id: "sk-c", userId: "u-lee", name: "C" });
    const now = new Date();
    expect((await sweepOrphanSkills(now, { checkMax: 2 })).marked).toBe(2);
    expect([a.orphanedAt, b.orphanedAt, c.orphanedAt]).toEqual([now, now, null]);
    expect((await sweepOrphanSkills(now, { checkMax: 2 })).marked).toBe(1);
    expect(c.orphanedAt).toBe(now);
    // Past the end: from the first again (nothing left to mark).
    a.orphanedAt = null;
    expect((await sweepOrphanSkills(now, { checkMax: 2 })).marked).toBe(1);
    expect(a.orphanedAt).toBe(now);
  });
});

describe("the 30-day delete", () => {
  it("checks each candidate again first: one whose person is back is cleared and kept, never deleted by its date", async () => {
    const now = new Date();
    // Max was deactivated 40 days ago and reactivated by a path that cleared nothing: orphanedAt is still set.
    const back = seedSkill({ status: "ready", name: "Max's", orphanedAt: new Date(now.getTime() - 40 * DAY) });
    seedRoutine({ skillId: back.id });
    const c = await sweepOrphanSkills(now, { checkMax: 0 });
    // Before: deleted on its date alone, the routine with it.
    expect(c).toEqual({ marked: 0, cleared: 1, deleted: 0 });
    expect(bdb.t.skills.map((s) => s.id)).toEqual([back.id]);
    expect(back.orphanedAt).toBeNull();
    expect(bdb.t.routines).toHaveLength(1);
  });

  it("deletes one whose person is still gone, or whose teammate is still removed, its routines with it; one under 30 days waits", async () => {
    const now = new Date();
    st.acting.set("u-lee", { ok: false, reason: "gone" });
    const leaver = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: new Date(now.getTime() - 31 * DAY) });
    const removed = seedSkill({ status: "draft", agentId: "a-gone", name: "Removed teammate's", orphanedAt: new Date(now.getTime() - 45 * DAY) });
    const young = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's other", orphanedAt: new Date(now.getTime() - 29 * DAY) });
    seedRoutine({ skillId: leaver.id });
    const c = await sweepOrphanSkills(now, { checkMax: 0 });
    expect(c).toEqual({ marked: 0, cleared: 0, deleted: 2 });
    expect(bdb.t.skills.map((s) => s.id)).toEqual([young.id]);
    expect(bdb.t.routines).toEqual([]);
    expect(removed.id).not.toBe(young.id);
  });

  it("never deletes on a read that failed", async () => {
    const now = new Date();
    st.acting.set("u-lee", { ok: false, reason: "throw" });
    const s = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: new Date(now.getTime() - 31 * DAY) });
    // The person could not be read: kept as it is, never deleted on a guess, and its 30 days not restarted either.
    const at = s.orphanedAt;
    const c = await sweepOrphanSkills(now);
    expect(c).toEqual({ marked: 0, cleared: 0, deleted: 0 });
    expect(bdb.t.skills.map((x) => x.id)).toEqual([s.id]);
    expect(s.orphanedAt).toBe(at);
  });
});

// Review of step 3: orphanedAt is when a skill last became unusable, so the
// hooks read the cause they do not name. A mark starts the 30 days again on
// a skill that was usable a moment ago (a return no hook saw), never from an
// older leave; a clear clears only what came back.
describe("the hooks' mark and clear (review of step 3)", () => {
  it("starts a returning leaver's 30 days again when they leave again, and keeps the date of a skill whose teammate is still removed", async () => {
    const then = new Date(Date.now() - 25 * DAY);
    const now = new Date();
    // Max left 25 days ago, came back by a path that cleared nothing, and leaves again now.
    const live = seedSkill({ status: "ready", name: "With Shopper", orphanedAt: then });
    const onRemoved = seedSkill({ status: "ready", agentId: "a-gone", name: "With a removed teammate", orphanedAt: then });
    const fresh = seedSkill({ status: "draft", name: "Never marked" });
    expect(await markSkillsOrphaned({ organizationId: "org1", userIds: ["u-max"] }, now)).toBe(2);
    // Before: the old date kept, so it would be deleted 5 days from now.
    expect(live.orphanedAt).toBe(now);
    expect(fresh.orphanedAt).toBe(now);
    // Unusable all along (its teammate removed): its date stays.
    expect(onRemoved.orphanedAt).toBe(then);
  });

  it("starts the 30 days again for a teammate removed again, except for a person still gone", async () => {
    const then = new Date(Date.now() - 20 * DAY);
    const now = new Date();
    st.acting.set("u-lee", { ok: false, reason: "gone" });
    const maxs = seedSkill({ status: "ready", name: "Max's", orphanedAt: then });
    const lees = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: then });
    expect(await markSkillsOrphaned({ organizationId: "org1", agentId: "a-shop" }, now)).toBe(1);
    expect(maxs.orphanedAt).toBe(now);
    expect(lees.orphanedAt).toBe(then);
  });

  it("starts it again when the other cause cannot be read: kept longer, never deleted early", async () => {
    const then = new Date(Date.now() - 25 * DAY);
    const now = new Date();
    st.acting.set("u-max", { ok: false, reason: "throw" });
    const s = seedSkill({ status: "ready", name: "Max's", orphanedAt: then });
    await markSkillsOrphaned({ organizationId: "org1", agentId: "a-shop" }, now);
    expect(s.orphanedAt).toBe(now);
  });

  it("clears a returning person's skills only where the teammate is live, and a restored teammate's only for people who are back", async () => {
    const then = new Date(Date.now() - 5 * DAY);
    const live = seedSkill({ status: "ready", name: "With Shopper", orphanedAt: then });
    const onRemoved = seedSkill({ status: "ready", agentId: "a-gone", name: "With a removed teammate", orphanedAt: then });
    const onMissing = seedSkill({ status: "ready", agentId: "a-none", name: "With a teammate no longer there", orphanedAt: then });
    expect(await clearSkillsOrphaned({ organizationId: "org1", userIds: ["u-max"] })).toBe(1);
    expect(live.orphanedAt).toBeNull();
    // Before: cleared too, though nobody can use them yet.
    expect(onRemoved.orphanedAt).toBe(then);
    expect(onMissing.orphanedAt).toBe(then);

    st.acting.set("u-lee", { ok: false, reason: "inactive" });
    st.acting.set("u-aio", { ok: false, reason: "ai_off" });
    const lees = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: then });
    const aiOff = seedSkill({ status: "ready", userId: "u-aio", name: "AI off", orphanedAt: then });
    const maxs = seedSkill({ status: "ready", name: "Max's other", orphanedAt: then });
    expect(await clearSkillsOrphaned({ organizationId: "org1", agentId: "a-shop" })).toBe(2);
    expect([maxs.orphanedAt, aiOff.orphanedAt]).toEqual([null, null]);
    // Before: cleared, though Lee is still deactivated.
    expect(lees.orphanedAt).toBe(then);
  });

  it("clears nothing on a read that failed, and never a whole workspace", async () => {
    const then = new Date(Date.now() - 5 * DAY);
    st.acting.set("u-max", { ok: false, reason: "throw" });
    const s = seedSkill({ status: "ready", name: "Max's", orphanedAt: then });
    expect(await clearSkillsOrphaned({ organizationId: "org1", agentId: "a-shop" })).toBe(0);
    expect(s.orphanedAt).toBe(then);
    expect(await clearSkillsOrphaned({ organizationId: "org1" })).toBe(0);
    expect(await markSkillsOrphaned({ organizationId: "org1" }, new Date())).toBe(0);
    expect(s.orphanedAt).toBe(then);
  });
});
