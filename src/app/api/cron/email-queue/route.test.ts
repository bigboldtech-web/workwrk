// /api/cron/email-queue answers 500 when mail is failing between tries
// (sends and retries mostly run in the request that queued them, so the
// job's own run usually fails nothing), and never for one bad address among
// mail that goes out.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  result: { sent: 0, retrying: 0, failed: 0 } as { sent: number; retrying: number; failed: number; held?: number },
  stuck: 0,
  sentLately: 0,
}));

vi.mock("@/lib/email", () => ({ processEmailQueue: async () => st.result, queueEmail: async () => {} }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailLog: {
      count: async ({ where }: { where: { status: string } }) => (where.status === "QUEUED" ? st.stuck : st.sentLately),
      findFirst: async () => null,
    },
  },
}));

import { POST } from "./route";

const run = () => POST(new Request("https://app.example.test/api/cron/email-queue", { method: "POST" }) as never);

beforeEach(() => {
  st.result = { sent: 0, retrying: 0, failed: 0 };
  st.stuck = 0;
  st.sentLately = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the email-queue job's answer", () => {
  it("is 200 when nothing is waiting after a failure", async () => {
    expect((await run()).status).toBe(200);
  });

  it("is 500 when a failed email has waited over 30 minutes and nothing was sent since", async () => {
    st.stuck = 2;
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ failingWaiting: 2 });
  });

  it("is 200 for a failed email while other mail goes out (one bad address)", async () => {
    st.stuck = 1;
    st.sentLately = 4;
    expect((await run()).status).toBe(200);
  });

  it("is 500 when this run's own sends failed, and 503 while mail is held", async () => {
    st.result = { sent: 0, retrying: 1, failed: 0 };
    expect((await run()).status).toBe(500);
    st.result = { sent: 0, retrying: 0, failed: 0, held: 3 };
    expect((await run()).status).toBe(503);
  });
});
