import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// processEmailQueue claims a batch, then writes each row's outcome. A row
// deleted after the claim (its company deleted for good, while the queue was
// sending it) must not stop the rest of the batch: before, its write threw
// out of the loop and every later row stayed in SENDING for good.
type Row = { id: string; to: string; subject: string; template: string; html: string | null; variables: object; attempts: number; createdAt: Date };
const claimed: Row[] = [];
const live = new Set<string>();
const written: Array<{ id: string; status: string }> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: async () => claimed.map((r) => ({ id: r.id })),
    emailLog: {
      findMany: async () => claimed,
      updateMany: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
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
    written.length = 0;
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

  it("does nothing when nothing is queued", async () => {
    await expect(processEmailQueue()).resolves.toEqual({ sent: 0, retrying: 0, failed: 0 });
    expect(written).toHaveLength(0);
  });
});
