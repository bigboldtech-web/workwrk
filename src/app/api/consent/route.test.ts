// POST /api/consent files the record under the random id the cookie holds,
// and writes that same id back, so the cookie never nests itself.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const created: Array<Record<string, unknown>> = [];
vi.mock("@/lib/prisma", () => ({
  prisma: { consentRecord: { create: async (a: { data: Record<string, unknown> }) => { created.push(a.data); return {}; } } },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/compliance/server", () => ({
  POLICY_VERSION: "2026-10-06",
  getClientIp: async () => "203.0.113.7",
  getVisitorGeo: async () => ({ regime: "NOTICE", country: "IN", region: null, label: "IN" }),
}));

import { DELETE, POST } from "./route";

const ID = "3f1c2a9e-8b7d-4c6e-9a5f-1e2d3c4b5a69";
const old = JSON.stringify({ necessary: true, preferences: false, analytics: false, marketing: false, doNotSell: false, v: "2026-04-18", t: ID, ts: 1759700000000 });
const req = (method: string, cookie?: string) =>
  new NextRequest("https://workwrk.com/api/consent", {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `wwrk_consent=${encodeURIComponent(cookie)}` } : {}) },
    body: method === "POST" ? "{}" : undefined,
  });
const tOf = (res: Response) => JSON.parse(decodeURIComponent(/wwrk_consent=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "null"))?.t;

beforeEach(() => {
  created.length = 0;
});

describe("POST /api/consent", () => {
  it("keeps the id a returning visitor's cookie holds on a re-prompt, and writes it back alone", async () => {
    const res = await POST(req("POST", old));
    expect(created[0].sessionId).toBe(ID);
    expect(tOf(res)).toBe(ID);
  });

  it("gives a first visitor a new random id", async () => {
    const res = await POST(req("POST"));
    const id = created[0].sessionId as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tOf(res)).toBe(id);
  });

  it("files a withdrawal under the same id", async () => {
    await DELETE(req("DELETE", old));
    expect(created[0]).toMatchObject({ sessionId: ID, method: "withdrawn" });
  });
});
