import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Retries back off instead of three quick tries, the last failure closes the
// row (a secret link's HTML cleared with it), and the claim compares the
// stored UTC times with UTC "now". Mail is on here: the transport is mocked
// and every send fails.
const env = vi.hoisted(() => {
  const was = process.env.EMAIL_ENABLED;
  process.env.EMAIL_ENABLED = "true";
  return { sql: [] as string[], was };
});
afterAll(() => {
  if (env.was === undefined) delete process.env.EMAIL_ENABLED; else process.env.EMAIL_ENABLED = env.was;
});

type Row = { id: string; to: string; subject: string; template: string; html: string | null; variables: object; attempts: number; createdAt: Date };
const claimed: Row[] = [];
const written: Array<{ id: string; data: Record<string, unknown> }> = [];

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async () => { throw new Error("connect ECONNREFUSED"); } }) },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => {
      env.sql.push(sql);
      return claimed.map((r) => ({ id: r.id }));
    },
    emailLog: {
      count: async () => 0,
      findMany: async () => claimed,
      updateMany: async ({ where, data }: { where: { id?: string }; data: Record<string, unknown> }) => {
        if (where.id) written.push({ id: where.id, data });
        return { count: where.id ? 1 : 0 };
      },
    },
  },
}));

import { EMAIL_MAX_ATTEMPTS, emailRetryDelayMs, processEmailQueue } from "./email";

const row = (id: string, attempts: number, template = "overdue-manager"): Row => ({ id, to: `${id}@example.test`, subject: "S", template, html: "<p>hi</p>", variables: {}, attempts, createdAt: new Date() });

describe("email retries", () => {
  beforeEach(() => {
    claimed.length = 0;
    written.length = 0;
    env.sql.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("waits longer after each failed try, over hours, not seconds", () => {
    expect([1, 2, 3, 4, 5].map((n) => emailRetryDelayMs(n) / 60_000)).toEqual([1, 5, 30, 120, 360]);
    expect(EMAIL_MAX_ATTEMPTS).toBe(6);
  });

  it("puts a failed send back in the queue with its next try set, until the last try", async () => {
    claimed.push(row("early", 2), row("last", EMAIL_MAX_ATTEMPTS), row("reset", EMAIL_MAX_ATTEMPTS, "password-reset"));
    const before = Date.now();
    await expect(processEmailQueue()).resolves.toEqual({ sent: 0, retrying: 1, failed: 2 });
    const early = written.find((w) => w.id === "early")!.data;
    expect(early.status).toBe("QUEUED");
    const next = (early.nextAttemptAt as Date).getTime();
    expect(next).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(next).toBeLessThan(before + 6 * 60_000);
    expect(written.find((w) => w.id === "last")!.data).toMatchObject({ status: "FAILED", nextAttemptAt: null });
    expect(written.find((w) => w.id === "last")!.data).not.toHaveProperty("html");
    // A secret link never outlives the row: its HTML goes with the last try.
    expect(written.find((w) => w.id === "reset")!.data).toMatchObject({ status: "FAILED", html: null });
  });

  it("compares the stored times with UTC now, never with the session's now()", async () => {
    await processEmailQueue();
    const sql = env.sql.join("\n");
    expect(sql).toContain("now() AT TIME ZONE 'UTC'");
    expect(sql).not.toMatch(/now\(\)(?! AT TIME ZONE 'UTC')/);
    // A claim is a lease, and a row whose run died is taken again.
    expect(sql).toMatch(/"status" = 'SENDING'/);
  });
});
