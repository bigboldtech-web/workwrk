// A person's skills in the database (src/lib/skills/store.ts,
// docs/plans/ai-teammates-phase5.md Decisions 3, 10 and 14, step 2): the
// person's lock before any count, each cap its own reason, the steps written
// only while recording, and a recording's end kept or deleted once.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
import { bdb, browserDb, resetBrowserDb, seedAgent, seedSession, seedSkill, seedStep, seedUser } from "@/lib/browser/browser-test-db";
import { clearSkillsOrphaned, createRecording, finishRecordingRow, markSkillsOrphaned, ownSkill, SKILL_LOCK_CLASS, skillsBackFor, skillsOfViewer, writeRecordedSteps } from "./store";
import { SKILL_LIMITS, type SkillStep } from "./types";
import type { Prisma } from "@/generated/prisma";

const A = { organizationId: "org1", userId: "u-max", agentId: "a-shop", name: "Submit an expense", sessionId: "bs1", startUrl: "http://expenses.proof.test/" };

const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => (browserDb.$transaction as (f: (tx: unknown) => Promise<T>) => Promise<T>)((tx) => fn(tx as Prisma.TransactionClient));

const start: SkillStep = { id: "s1", kind: "start", title: "Start on expenses.proof.test", site: "expenses.proof.test", page: "expenses.proof.test", shotId: null, address: "http://expenses.proof.test/" };
const click: SkillStep = { id: "s2", kind: "click", title: 'Click "submit"', site: "expenses.proof.test", page: "expenses.proof.test/new", shotId: null, role: "button", name: "submit", tag: "button", type: null, formHost: "expenses.proof.test", warnings: ["submits"] };

beforeEach(() => {
  resetBrowserDb();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createRecording", () => {
  it("takes the person's lock (73040) before any count, then makes the recording row", async () => {
    const out = await inTx((tx) => createRecording(tx, A));
    expect(out).toMatchObject({ ok: true });
    expect(SKILL_LOCK_CLASS).toBe(73_040);
    expect(bdb.locks).toEqual([{ cls: 73_040, key: "u-max", inTx: true }]);
    const order = bdb.events.map((e) => e.op);
    // Before: no lock, so two starts at once could both pass a cap.
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("count.skills"));
    expect(order.indexOf("count.skills")).toBeLessThan(order.indexOf("count.recordings"));
    expect(order.indexOf("count.recordings")).toBeLessThan(order.indexOf("teammateSkill.create"));
    expect(bdb.t.skills).toEqual([expect.objectContaining({ organizationId: "org1", userId: "u-max", agentId: "a-shop", name: "Submit an expense", status: "recording", recordingSessionId: "bs1", startUrl: "http://expenses.proof.test/", steps: [], stepCount: 0 })]);
  });

  it("refuses each cap with its own reason, making nothing", async () => {
    // One recording at a time (one browser per person makes it unreachable through the route: proven here).
    seedSkill({ status: "recording", name: "Other" });
    expect(await inTx((tx) => createRecording(tx, A))).toEqual({ ok: false, reason: "already_recording" });
    resetBrowserDb();
    for (let i = 0; i < SKILL_LIMITS.perTeammate; i++) seedSkill({ status: "draft", name: `S${i}` });
    expect(await inTx((tx) => createRecording(tx, A))).toEqual({ ok: false, reason: "too_many_for_teammate" });
    resetBrowserDb();
    for (let i = 0; i < SKILL_LIMITS.perPerson; i++) seedSkill({ status: "ready", name: `S${i}`, agentId: `a-${i}` });
    expect(await inTx((tx) => createRecording(tx, A))).toEqual({ ok: false, reason: "too_many" });
    resetBrowserDb();
    // Ten recordings today, counted by their sessions' steps (a discarded one's row is gone, its step stays).
    const s = seedSession({ id: "bs-today", startedAt: new Date() });
    for (let i = 0; i < SKILL_LIMITS.recordingsPerDay; i++) seedStep({ browserSessionId: s.id, userId: "u-max", seq: i + 1, kind: "take_over", code: "recording", at: new Date() });
    expect(await inTx((tx) => createRecording(tx, A))).toEqual({ ok: false, reason: "recordings_today" });
    resetBrowserDb();
    // A plain take over is no recording.
    const p = seedSession({ id: "bs-plain", startedAt: new Date() });
    for (let i = 0; i < 12; i++) seedStep({ browserSessionId: p.id, userId: "u-max", seq: i + 1, kind: "take_over", code: null, at: new Date() });
    seedSkill({ status: "draft", name: "submit AN expense" });
    // The name with this teammate, case aside.
    expect(await inTx((tx) => createRecording(tx, A))).toEqual({ ok: false, reason: "name_taken" });
    expect(bdb.events.some((e) => e.op === "teammateSkill.create")).toBe(false);
    // Another teammate's skill of that name is no clash.
    expect(await inTx((tx) => createRecording(tx, { ...A, agentId: "a-res" }))).toMatchObject({ ok: true });
  });
});

describe("writeRecordedSteps and finishRecordingRow", () => {
  it("writes the whole list only while the row is recording", async () => {
    const rec = seedSkill({ status: "recording" });
    const draft = seedSkill({ status: "draft", name: "B" });
    expect(await writeRecordedSteps(String(rec.id), [start, click], false)).toBe(true);
    expect(rec).toMatchObject({ stepCount: 2, sites: ["expenses.proof.test"], recordingFull: false });
    expect(rec.steps).toEqual([start, click]);
    // Before: a write could land on a draft the person was reviewing.
    expect(await writeRecordedSteps(String(draft.id), [start], true)).toBe(false);
    expect(draft).toMatchObject({ stepCount: 0, steps: [] });
  });

  it("deletes an empty recording, keeps one with a step the person did as a draft, once", async () => {
    const empty = seedSkill({ status: "recording", steps: [start], stepCount: 1, sites: ["expenses.proof.test"] });
    expect(await finishRecordingRow(String(empty.id), true, "done")).toMatchObject({ kept: false, steps: 0, finished: true });
    expect(bdb.t.skills.find((s) => s.id === empty.id)).toBeUndefined();
    const kept = seedSkill({ status: "recording", steps: [start, click], stepCount: 2, sites: ["expenses.proof.test"] });
    expect(await finishRecordingRow(String(kept.id), true, "time")).toEqual({ kept: true, steps: 2, sites: ["expenses.proof.test"], finished: true });
    expect(kept).toMatchObject({ status: "draft", recordingEndReason: "time" });
    expect(kept.recordingEndedAt).toBeInstanceOf(Date);
    // A second end finds nothing to finish.
    expect(await finishRecordingRow(String(kept.id), true, "ended")).toEqual({ kept: false, steps: 0, sites: [], finished: false });
    expect(kept.recordingEndReason).toBe("time");
    // Discard deletes it whatever it holds.
    const gone = seedSkill({ status: "recording", steps: [start, click], stepCount: 2 });
    expect(await finishRecordingRow(String(gone.id), false, "done")).toMatchObject({ kept: false, finished: true });
    expect(bdb.t.skills.find((s) => s.id === gone.id)).toBeUndefined();
  });
});

describe("the viewer's own skills, and the 30 days", () => {
  it("reads only the viewer's own, in their workspace", async () => {
    const mine = seedSkill({ status: "draft" });
    seedSkill({ status: "draft", userId: "u-olivia", name: "Hers" });
    seedSkill({ status: "draft", organizationId: "org2", name: "Elsewhere" });
    expect((await skillsOfViewer({ userId: "u-max", organizationId: "org1" }, "a-shop")).map((s) => s.id)).toEqual([mine.id]);
    expect(await ownSkill({ userId: "u-olivia", organizationId: "org1" }, String(mine.id))).toBeNull();
    expect(await ownSkill({ userId: "u-max", organizationId: "org1" }, String(mine.id))).toMatchObject({ id: mine.id });
  });

  it("marks and clears a person's or a teammate's skills, never a whole workspace by accident", async () => {
    seedAgent();
    // A mark or a clear reads the cause it does not name (orphans.ts, review of step 3): both people here are live members.
    seedUser();
    seedUser({ id: "u-lee", firstName: "Lee" });
    const a = seedSkill({ status: "draft" });
    const b = seedSkill({ status: "draft", userId: "u-lee", name: "Lee's" });
    const now = new Date();
    expect(await markSkillsOrphaned({ organizationId: "org1" }, now)).toBe(0);
    expect(await markSkillsOrphaned({ organizationId: "org1", userIds: ["u-lee"] }, now)).toBe(1);
    expect(b.orphanedAt).toBe(now);
    expect(a.orphanedAt).toBeNull();
    // Lee leaving again while marked, the teammate live: the 30 days start again (review of step 3).
    const again = new Date(now.getTime() + 1000);
    expect(await markSkillsOrphaned({ organizationId: "org1", userIds: ["u-lee"] }, again)).toBe(1);
    expect(b.orphanedAt).toBe(again);
    expect(await clearSkillsOrphaned({ organizationId: "org1", agentId: "a-shop" })).toBe(1);
    expect(b.orphanedAt).toBeNull();
  });

  it("clears a returning person's skills in that workspace only, and never throws (Phase 5 step 3)", async () => {
    seedAgent();
    seedAgent({ organizationId: "org2" });
    const then = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const here = seedSkill({ status: "ready", userId: "u-lee", name: "Lee's", orphanedAt: then });
    const elsewhere = seedSkill({ status: "ready", userId: "u-lee", organizationId: "org2", name: "Lee's other", orphanedAt: then });
    const someoneElse = seedSkill({ status: "ready", userId: "u-ina", name: "Ina's", orphanedAt: then });
    await skillsBackFor("org1", ["u-lee"]);
    expect([here.orphanedAt, elsewhere.orphanedAt, someoneElse.orphanedAt]).toEqual([null, then, then]);
    const spy = vi.spyOn(browserDb.teammateSkill as { updateMany: (...a: unknown[]) => Promise<unknown> }, "updateMany").mockRejectedValue(new Error("database down"));
    await expect(skillsBackFor("org1", ["u-ina"])).resolves.toBeUndefined();
    expect(String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0])).toBe("[skills] return hook Error");
    spy.mockRestore();
  });
});
