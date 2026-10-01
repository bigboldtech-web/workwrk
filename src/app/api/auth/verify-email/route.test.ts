import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/auth/verify-email, opened twice. A person who confirms and later
// opens the same email again (or whose mail scanner opened it first) used to
// be told "This link has expired" with a Send a new link that sends nothing,
// because success threw the token away and the second open matched no row.
// The handler now keeps the hash and marks it spent, so the second open says
// "already verified"; and a spent link must never confirm an address SCIM
// renamed afterwards. The database is an in-memory row so the handler runs
// as the pure function it is between those calls.

type Row = { id: string; email: string; verifyToken: string | null; verifyExpiresAt: Date | null; emailVerifiedAt: Date | null; deletedAt: Date | null };
let rows: Row[] = [];

vi.mock("@/lib/rate-limit-memory", () => ({ ipFromRequest: () => "1.1.1.1", rateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { verifyToken: string } }) => rows.find((r) => r.verifyToken === where.verifyToken) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; emailVerifiedAt: null }; data: Partial<Row> }) => {
        const hit = rows.filter((r) => r.id === where.id && r.emailVerifiedAt === null);
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
    },
  },
}));

import { POST } from "./route";
import { hashVerifyToken } from "@/lib/auth/verify-token";

const RAW = "MQGuSTU0wENF2k6Oycj3W_7d-R9ODzYZFMyu6CawlIA";

function post(token: string) {
  return POST(new Request("http://x/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }) as never);
}

describe("POST /api/auth/verify-email", () => {
  beforeEach(() => {
    rows = [{ id: "u1", email: "priya@co.com", verifyToken: hashVerifyToken(RAW), verifyExpiresAt: new Date(Date.now() + 60_000), emailVerifiedAt: null, deletedAt: null }];
  });

  it("verifies on the first open and says already verified on the second", async () => {
    const first = await post(RAW);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, email: "priya@co.com" });
    const verifiedAt = rows[0].emailVerifiedAt;
    expect(verifiedAt).toBeInstanceOf(Date);

    const second = await post(RAW);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, alreadyVerified: true, email: "priya@co.com" });
    expect(rows[0].emailVerifiedAt).toBe(verifiedAt);
  });

  it("keeps only the hash at rest, also for an old raw-token row", async () => {
    rows[0].verifyToken = RAW;
    await post(RAW);
    expect(rows[0].verifyToken).toBe(hashVerifyToken(RAW));
    expect((await (await post(RAW)).json()).alreadyVerified).toBe(true);
  });

  it("a spent link does not confirm an address renamed after it was used", async () => {
    await post(RAW);
    // SCIM rename: new address, emailVerifiedAt cleared, token untouched.
    rows[0].email = "new@co.com";
    rows[0].emailVerifiedAt = null;
    const res = await post(RAW);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid");
    expect(body.email).toBeUndefined();
    expect(rows[0].emailVerifiedAt).toBeNull();
  });

  it("an expired link still answers expired, and a made-up one invalid", async () => {
    rows[0].verifyExpiresAt = new Date(Date.now() - 1);
    expect((await (await post(RAW)).json()).code).toBe("expired");
    expect(rows[0].emailVerifiedAt).toBeNull();
    expect((await (await post("x".repeat(43))).json()).code).toBe("invalid");
  });

  it("a deleted account's link is not valid and names no address", async () => {
    rows[0].deletedAt = new Date();
    const body = await (await post(RAW)).json();
    expect(body.code).toBe("invalid");
    expect(body.email).toBeUndefined();
  });
});
