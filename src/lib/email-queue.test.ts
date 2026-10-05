import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// processEmailQueue claims a batch, then writes each row's outcome. A row
// deleted after the claim (its company deleted for good, while the queue was
// sending it) must not stop the rest of the batch: before, its write threw
// out of the loop and every later row stayed in SENDING for good.
type Row = { id: string; to: string; subject: string; template: string; html: string | null; variables: object; attempts: number; createdAt: Date };
const claimed: Row[] = [];
const live = new Set<string>();
// Rows another run took after this run's lease ran out: renewing fails.
const takenByAnother = new Set<string>();
const written: Array<{ id: string; status: string }> = [];
const writeWheres: Array<Record<string, unknown>> = [];
const sweeps: Array<Record<string, unknown>> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: async () => claimed.map((r) => ({ id: r.id })),
    // The lease renewal before each send: 1 while this run still holds the row.
    $executeRawUnsafe: async (_sql: string, id: string) => (live.has(id) && !takenByAnother.has(id) ? 1 : 0),
    emailLog: {
      findMany: async () => claimed,
      updateMany: async ({ where, data }: { where: { id?: string } & Record<string, unknown>; data: { status: string } }) => {
        if (!where.id) {
          sweeps.push(where);
          return { count: 0 };
        }
        writeWheres.push(where);
        if (!live.has(where.id)) return { count: 0 };
        written.push({ id: where.id, status: data.status });
        return { count: 1 };
      },
      update: async () => {
        throw new Error("Record to update not found.");
      },
    },
  },
}));

import { processEmailQueue } from "./email";

const row = (id: string): Row => ({ id, to: `${id}@example.test`, subject: "S", template: "overdue-manager", html: "<p>hi</p>", variables: {}, attempts: 1, createdAt: new Date("2026-10-05T00:00:00.000Z") });

describe("processEmailQueue", () => {
  beforeEach(() => {
    claimed.length = 0;
    live.clear();
    takenByAnother.clear();
    written.length = 0;
    writeWheres.length = 0;
    sweeps.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("finishes the batch when a claimed row is deleted while it is sent", async () => {
    claimed.push(row("a"), row("gone"), row("c"));
    live.add("a").add("c");
    await expect(processEmailQueue()).resolves.toMatchObject({ failed: 0 });
    expect(written).toEqual([
      { id: "a", status: "SENT" },
      { id: "c", status: "SENT" },
    ]);
  });

  it("skips a row another run took after this run's lease ran out, and writes nothing over it", async () => {
    claimed.push(row("a"), row("theirs"));
    live.add("a").add("theirs");
    takenByAnother.add("theirs");
    await expect(processEmailQueue()).resolves.toMatchObject({ sent: 1, failed: 0, retrying: 0 });
    expect(written).toEqual([{ id: "a", status: "SENT" }]);
  });

  it("records a result only while the row is still SENDING with this run's attempts", async () => {
    claimed.push(row("a"));
    live.add("a");
    await processEmailQueue();
    expect(writeWheres).toEqual([{ id: "a", status: "SENDING", attempts: 1 }]);
  });

  it("gives up only on rows whose lease has run out, never on one a run is sending", async () => {
    await processEmailQueue();
    expect(sweeps.length).toBeGreaterThan(0);
    for (const w of sweeps) {
      expect(w).toMatchObject({ status: "SENDING" });
      expect(w.OR).toEqual([{ nextAttemptAt: null }, { nextAttemptAt: { lt: expect.any(Date) } }]);
    }
  });

  it("does nothing when nothing is queued", async () => {
    await expect(processEmailQueue()).resolves.toEqual({ sent: 0, retrying: 0, failed: 0 });
    expect(written).toHaveLength(0);
  });
});
