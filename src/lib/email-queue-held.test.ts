import { afterAll, describe, expect, it, vi } from "vitest";

// Production with no mail transport (EMAIL_ENABLED unset): nothing is
// claimed or marked sent, the rows stay QUEUED with their content, and the
// run says how many are waiting. It used to log each email and mark it SENT.
const saved = vi.hoisted(() => {
  const was = { EMAIL_ENABLED: process.env.EMAIL_ENABLED, NODE_ENV: process.env.NODE_ENV };
  delete process.env.EMAIL_ENABLED;
  (process.env as Record<string, string>).NODE_ENV = "production";
  return was;
});
afterAll(() => {
  if (saved.EMAIL_ENABLED === undefined) delete process.env.EMAIL_ENABLED; else process.env.EMAIL_ENABLED = saved.EMAIL_ENABLED;
  (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
});

const calls: string[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: async () => { calls.push("claim"); return []; },
    emailLog: {
      count: async () => { calls.push("count"); return 3; },
      findMany: async () => { calls.push("findMany"); return []; },
      updateMany: async () => { calls.push("updateMany"); return { count: 0 }; },
    },
  },
}));

import { processEmailQueue } from "./email";

describe("email with mail off in production", () => {
  it("holds the queue instead of marking it sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(processEmailQueue()).resolves.toEqual({ sent: 0, retrying: 0, failed: 0, held: 3 });
    expect(calls).toEqual(["count"]);
  });
});
