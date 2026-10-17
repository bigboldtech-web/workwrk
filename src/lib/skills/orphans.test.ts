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
import { resetOrphanCursorForTests, sweepOrphanSkills } from "./orphans";

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
