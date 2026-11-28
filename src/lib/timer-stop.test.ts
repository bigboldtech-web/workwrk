import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimerSession } from "@/generated/prisma";

// Pen test 2026-11-28 (V-16): starting a timer on a second task stopped the
// first with a bare update and never logged it, so a task switch dropped the
// earlier hours from the person's week.

type Session = TimerSession;
const sessions = new Map<string, Session>();
const items = new Map<string, { id: string; title: string; organizationId: string }>();
const logged: Array<{ itemId: string; durationMs: number }> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    timerSession: {
      updateMany: async ({ where, data }: { where: { id: string; stoppedAt: null }; data: { stoppedAt: Date; durationMs: number } }) => {
        const s = sessions.get(where.id);
        if (!s || s.stoppedAt !== null) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...sessions.get(where.id)! }),
    },
    item: { findUnique: async ({ where }: { where: { id: string } }) => items.get(where.id) ?? null },
  },
}));
vi.mock("@/lib/timesheet", () => ({
  logTimerToTimesheet: async (a: { itemId: string; durationMs: number }) => { logged.push({ itemId: a.itemId, durationMs: a.durationMs }); return { logged: true }; },
  timerBridgeMessage: () => null,
}));

const { stopTimerSession } = await import("./timer-stop");

const ctx = { orgId: "org", userId: "u" };
const running = (id: string, entityId: string, startedAt: Date): Session => {
  const s: Session = { id, organizationId: "org", userId: "u", entityType: "BOARD_ITEM", entityId, startedAt, stoppedAt: null, durationMs: 0, notes: null, createdAt: startedAt, updatedAt: startedAt };
  sessions.set(id, s);
  return { ...s };
};

beforeEach(() => {
  sessions.clear();
  items.clear();
  logged.length = 0;
  items.set("task-a", { id: "task-a", title: "Task A", organizationId: "org" });
});

describe("stopping a timer", () => {
  it("closes the session and logs its time to the timesheet", async () => {
    const s = running("s1", "task-a", new Date("2026-11-28T10:00:00Z"));
    const out = await stopTimerSession(s, ctx, new Date("2026-11-28T10:25:00Z"));
    expect(out?.session.stoppedAt).toEqual(new Date("2026-11-28T10:25:00Z"));
    expect(logged).toEqual([{ itemId: "task-a", durationMs: 25 * 60_000 }]);
  });

  it("two stops of the same session at once log its time once", async () => {
    const s = running("s1", "task-a", new Date("2026-11-28T10:00:00Z"));
    const now = new Date("2026-11-28T10:10:00Z");
    const [a, b] = await Promise.all([stopTimerSession(s, ctx, now), stopTimerSession(s, ctx, now)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(logged).toHaveLength(1);
  });

  it("another company's task is never logged", async () => {
    items.set("task-x", { id: "task-x", title: "Theirs", organizationId: "other" });
    const s = running("s2", "task-x", new Date("2026-11-28T10:00:00Z"));
    await stopTimerSession(s, ctx, new Date("2026-11-28T10:05:00Z"));
    expect(logged).toEqual([]);
  });
});

describe("the routes", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("a timer started on another task stops the running one through the logging stop (V-16)", () => {
    const start = read("src/app/api/timers/start/route.ts");
    expect(start).toMatch(/const previous = otherActive \? await stopTimerSession\(otherActive, ctx\) : null;/);
    expect(start).not.toMatch(/prisma\.timerSession\.update\(/);
    expect(read("src/app/api/timers/stop/route.ts")).toMatch(/await stopTimerSession\(active, ctx\)/);
  });

  it("a task's timer starts only on a task the person can open (V-24, V-59)", () => {
    expect(read("src/lib/timer-stop.ts")).toMatch(/if \(entityType !== "BOARD_ITEM"\) return null;[\s\S]{0,300}gateItem\(entityId, c, "view"\)/);
    expect(read("src/app/api/timers/start/route.ts")).toMatch(/const refused = await taskTimerRefusal\(parsed\.data\.entityType, parsed\.data\.entityId\);/);
    const timers = read("src/app/api/timers/route.ts");
    expect(timers).toMatch(/const refusedRead = await taskTimerRefusal\(entityType, entityId\);/);
    expect(timers).toMatch(/const refused = await taskTimerRefusal\(parsed\.data\.entityType, parsed\.data\.entityId\);/);
  });

  it("the drawer says when a switch could not log the earlier task's hours", () => {
    expect(read("src/components/board-view/time-tracker.tsx")).toMatch(/setBridgeNote\(\(body\?\.previous\?\.timesheet\?\.message as string \| undefined\) \?\? null\)/);
  });
});

describe("Notepad never loses a big note in silence (V-19)", () => {
  const panel = readFileSync("src/components/layout/os/notepad-panel.tsx", "utf8");

  it("saves through fetchWithRetry (keepalive only while the body fits), never a bare keepalive fetch", () => {
    expect(panel.match(/fetchWithRetry\(`\/api\/docs\/\$\{/g)).toHaveLength(1);
    expect(panel).not.toMatch(/keepalive: true/);
  });

  it("says when a save failed, and keeps retrying a retryable failure until it lands", () => {
    expect(panel).toMatch(/setSaveFailed\(r\.status >= 400 && r\.status < 500 \? "refused" : "retrying"\)/);
    expect(panel).toMatch(/Not saved\. Retrying…/);
    expect(panel).toMatch(/if \(saveFailed !== "retrying"\) return;\s+const t = window\.setInterval\(\(\) => flushPending\(\), 10_000\);/);
    expect(panel).toMatch(/Couldn&apos;t save this note\. Copy your text before closing\./);
  });

  it("saves go one at a time, and an older save never lands after a newer one (the step 2 review)", () => {
    expect(panel).toMatch(/const run = saveQueueRef\.current\.then\(async \(\) => \{\s+const latest = pendingRef\.current;\s+if \(latest && latest\.id === id && latest\.body !== body\) return;/);
    expect(panel).toMatch(/void sendNote\(id, body\)\.finally/);
  });
});

describe("a stale table tab never deletes what others added (V-18)", () => {
  const route = readFileSync("src/app/api/tables/[id]/route.ts", "utf8");
  const editor = readFileSync("src/components/tables/table-editor.tsx", "utf8");

  it("the server writes columns, views and settings only while they still equal what the tab last saw", () => {
    expect(route).toMatch(/guard\.columns = \{ equals: expect\.columns/);
    expect(route).toMatch(/guard\.views = \{ equals: expect\.views/);
    expect(route).toMatch(/guard\.settings = \{ equals: expect\.settings/);
    expect(route).toMatch(/updateMany\(\{ where: \{ id, organizationId: orgId, \.\.\.guard \}, data \}\)/);
    expect(route).toMatch(/if \(count === 0\) \{[\s\S]{0,400}status: 409/);
  });

  it("the editor sends expect with every structure save, one at a time, and adopts the table on a 409", () => {
    expect(editor).toMatch(/const res = await sendTablePatch\(patch as Record<string, unknown>\);/);
    expect(editor).toMatch(/const res = await sendTablePatch\(\{ columns: cols \}\);/);
    expect(editor).toMatch(/structQueueRef\.current\.catch\(\(\) => undefined\)\.then\(/);
    expect(editor).toMatch(/if \(live\) adoptServerStructure\(live,/);
    // No structure PATCH goes around it.
    expect(editor).not.toMatch(/body: JSON\.stringify\(\{ columns: cols \}\)/);
  });
});
