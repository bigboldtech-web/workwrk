// Skills nobody can use any more (src/lib/skills/orphans.ts,
// docs/plans/ai-teammates-phase5.md Decision 14, step 3): the rolling check
// marks those whose person left or was deactivated, or whose teammate was
// removed, and clears those that came back; a skill orphaned past 30 days
// is checked again before it is deleted, so one whose person is back is
// kept, never deleted by its date alone. Final races review, M2: the person
// is read by the light read (personGoneNow: their row and the level they
// hold here), never a whole acting person; one delete candidate that always
// fails is skipped and the tick moves on past it. orphans-gone.test.ts holds
// the light read to resolveActingPerson's own answers.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ wholePersonReads: 0, userReads: [] as string[], throwFor: new Set<string>(), deleteThrowsFor: new Set<string>() }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
// Before (M2): every check read a whole acting person, about ten reads each.
vi.mock("@/lib/agents/acting", () => ({
  resolveActingPerson: async () => {
    st.wholePersonReads += 1;
    throw new Error("the orphan checks read only what the rule needs");
  },
}));

import { bdb, browserDb, resetBrowserDb, seedAgent, seedRoutine, seedSkill, seedUser } from "@/lib/browser/browser-test-db";
import { clearSkillsOrphaned, markSkillsOrphaned, resetOrphanCursorForTests, sweepOrphanSkills } from "./orphans";

const DAY = 24 * 60 * 60 * 1000;

type Model = Record<string, (a: { where?: Record<string, unknown> }) => Promise<unknown>>;
const users = (browserDb as unknown as Record<string, Model>).user;
const skillsModel = (browserDb as unknown as Record<string, Model>).teammateSkill;
const realFindFirst = users.findFirst;
const realDeleteMany = skillsModel.deleteMany;
// Every person read, by id, and a read that fails for the ids the test names.
users.findFirst = async (a) => {
  const id = String(a.where?.id ?? "");
  st.userReads.push(id);
  if (st.throwFor.has(id)) throw new Error("database down");
  return realFindFirst(a);
};
skillsModel.deleteMany = async (a) => {
  if (st.deleteThrowsFor.has(String(a.where?.id ?? ""))) throw new Error("a delete that fails");
  return realDeleteMany(a);
};

/** Lee left: anchored in another workspace, with no membership here. */
const seedLeaver = (id = "u-lee") => seedUser({ id, organizationId: "org2", firstName: "Lee" });

beforeEach(() => {
  resetBrowserDb();
  resetOrphanCursorForTests();
  st.wholePersonReads = 0;
  st.userReads = [];
  st.throwFor = new Set();
  st.deleteThrowsFor = new Set();
  seedAgent();
  seedAgent({ id: "a-gone", slug: "gone", name: "Gone", status: "ARCHIVED" });
  seedUser();
});

describe("the rolling check", () => {
  it("marks a leaver's, a deleted person's, a deactivated person's and a removed teammate's skills, never a Guest's or a member's through a second membership, and clears those that came back", async () => {
    const now = new Date();
    seedLeaver();
    seedUser({ id: "u-del", deletedAt: new Date(now.getTime() - DAY) });
    seedUser({ id: "u-ina", status: "INACTIVE" });
    seedUser({ id: "u-gus", orgRole: "GUEST" });
    seedUser({ id: "u-aio", firstName: "AI off" });
    seedUser({ id: "u-mem", organizationId: "org2" });
    bdb.t.memberships.push({ userId: "u-mem", organizationId: "org1", role: "MANAGER" });
    const lee = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's" });
    const del = seedSkill({ status: "ready", userId: "u-del", name: "Del's" });
    const nobody = seedSkill({ status: "ready", userId: "u-none", name: "Nobody's" });
    const ina = seedSkill({ status: "draft", userId: "u-ina", name: "Ina's" });
    const removed = seedSkill({ status: "ready", agentId: "a-gone", name: "On a removed teammate" });
    const guest = seedSkill({ status: "ready", userId: "u-gus", name: "A guest's" });
    const aiOff = seedSkill({ status: "ready", userId: "u-aio", name: "AI off" });
    const member = seedSkill({ status: "ready", userId: "u-mem", name: "A member's through a second membership" });
    const back = seedSkill({ status: "ready", name: "Max came back", orphanedAt: new Date(now.getTime() - 3 * DAY) });
    const c = await sweepOrphanSkills(now);
    expect(c).toEqual({ marked: 5, cleared: 1, deleted: 0 });
    expect([lee, del, nobody, ina, removed].map((s) => s.orphanedAt)).toEqual([now, now, now, now, now]);
    expect([guest, aiOff, member, back].map((s) => s.orphanedAt)).toEqual([null, null, null, null]);
    // Read once a tick each, by the light read: one read of the person's row. Before: a whole acting person each.
    expect(st.userReads.filter((r) => r === "u-max")).toHaveLength(1);
    expect(st.wholePersonReads).toBe(0);
  });

  it("reads at most its page a tick, from where the last stopped, and starts again from the first after the end", async () => {
    seedLeaver();
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
    seedLeaver();
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
    seedLeaver();
    st.throwFor.add("u-lee");
    const s = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: new Date(now.getTime() - 31 * DAY) });
    // The person could not be read: kept as it is, never deleted on a guess, and its 30 days not restarted either.
    const at = s.orphanedAt;
    const c = await sweepOrphanSkills(now);
    expect(c).toEqual({ marked: 0, cleared: 0, deleted: 0 });
    expect(bdb.t.skills.map((x) => x.id)).toEqual([s.id]);
    expect(s.orphanedAt).toBe(at);
  });

  // Final races review, M2's low.
  it("skips a candidate whose check always fails, never deleting it, and reaches the next one on the next tick", async () => {
    const now = new Date();
    seedLeaver();
    seedLeaver("u-ben");
    st.throwFor.add("u-lee");
    const stuck = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: new Date(now.getTime() - 60 * DAY) });
    const next = seedSkill({ status: "ready", userId: "u-ben", name: "Ben's", orphanedAt: new Date(now.getTime() - 40 * DAY) });
    expect(await sweepOrphanSkills(now, { checkMax: 0, deleteMax: 1 })).toEqual({ marked: 0, cleared: 0, deleted: 0 });
    // Before: the page started at the oldest every tick, so the one that always failed held it for good.
    expect(await sweepOrphanSkills(now, { checkMax: 0, deleteMax: 1 })).toEqual({ marked: 0, cleared: 0, deleted: 1 });
    expect(bdb.t.skills.map((x) => x.id)).toEqual([stuck.id]);
    expect(next.id).not.toBe(stuck.id);
    // Past the newest it starts from the oldest again, and still never deletes on a guess.
    expect(await sweepOrphanSkills(now, { checkMax: 0, deleteMax: 1 })).toEqual({ marked: 0, cleared: 0, deleted: 0 });
    st.throwFor.clear();
    expect(await sweepOrphanSkills(now, { checkMax: 0, deleteMax: 1 })).toEqual({ marked: 0, cleared: 0, deleted: 1 });
    expect(bdb.t.skills).toEqual([]);
  });

  it("skips a candidate whose delete fails and goes on with the rest of the page in the same tick", async () => {
    const now = new Date();
    seedLeaver();
    const stuck = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: new Date(now.getTime() - 60 * DAY) });
    const other = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's other", orphanedAt: new Date(now.getTime() - 40 * DAY) });
    st.deleteThrowsFor.add(String(stuck.id));
    // Before: the failed delete threw out of the part, and the rest of the page never ran.
    expect(await sweepOrphanSkills(now, { checkMax: 0 })).toEqual({ marked: 0, cleared: 0, deleted: 1 });
    expect(bdb.t.skills.map((x) => x.id)).toEqual([stuck.id]);
    expect(other.id).not.toBe(stuck.id);
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
    seedLeaver();
    const maxs = seedSkill({ status: "ready", name: "Max's", orphanedAt: then });
    const lees = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: then });
    expect(await markSkillsOrphaned({ organizationId: "org1", agentId: "a-shop" }, now)).toBe(1);
    expect(maxs.orphanedAt).toBe(now);
    expect(lees.orphanedAt).toBe(then);
  });

  it("starts it again when the other cause cannot be read: kept longer, never deleted early", async () => {
    const then = new Date(Date.now() - 25 * DAY);
    const now = new Date();
    st.throwFor.add("u-max");
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

    seedUser({ id: "u-lee", status: "INACTIVE" });
    seedUser({ id: "u-aio", firstName: "AI off" });
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
    st.throwFor.add("u-max");
    const s = seedSkill({ status: "ready", name: "Max's", orphanedAt: then });
    expect(await clearSkillsOrphaned({ organizationId: "org1", agentId: "a-shop" })).toBe(0);
    expect(s.orphanedAt).toBe(then);
    expect(await clearSkillsOrphaned({ organizationId: "org1" })).toBe(0);
    expect(await markSkillsOrphaned({ organizationId: "org1" }, new Date())).toBe(0);
    expect(s.orphanedAt).toBe(then);
  });
});
