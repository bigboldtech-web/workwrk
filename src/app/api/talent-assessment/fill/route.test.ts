// Contract test for Fill from scores (spec-teams-performance /talent): the
// People team and Admin only. "Read only: a manager sees only their chain and
// no Fill from scores." A manager's talentCtx is allowed (they hold the page
// for their chain), so the old check, ctx.allowed alone, let a manager run the
// bulk write. Every door is covered: the count (GET /fill), the write (POST
// /fill), the legacy POST /api/talent-assessment { autoPlace: true }, and the
// canFill flag the page reads to decide whether to offer it at all. The
// server helpers are mocked: the test reads who reached fillFromScores.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

type Ctx = { userId: string; organizationId: string; ids: string[] | null; allowed: boolean; peopleTeamOrAdmin: boolean; isAgent: boolean; isGuest: boolean; chain: Set<string> };
let ctx: Ctx | null;
const fill = vi.fn(async (_c: unknown, _p: string, _o?: unknown) => ({ placed: 1, skipped: 0 }));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "me" } } }),
  jsonError: (message: string, status = 400) => NextResponse.json({ error: message }, { status }),
  jsonSuccess: (data: unknown, status = 200) => NextResponse.json(data, { status }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/performance/talent.server", () => ({
  talentCtx: async () => ctx,
  fillFromScores: (c: unknown, p: string, o?: unknown) => fill(c, p, o),
}));

import { GET as fillGET, POST as fillPOST } from "./route";
import { GET as gridGET, POST as gridPOST } from "../route";

const base = { userId: "me", organizationId: "org-1", isAgent: false, isGuest: false };
const manager = (): Ctx => ({ ...base, ids: ["r-1"], allowed: true, peopleTeamOrAdmin: false, chain: new Set(["r-1"]) });
const admin = (): Ctx => ({ ...base, ids: null, allowed: true, peopleTeamOrAdmin: true, chain: new Set() });

const period = "Q2 FY27";
const req = (url: string, body?: unknown) => new Request(url, body ? { method: "POST", body: JSON.stringify(body) } : undefined) as never;
async function call(p: Promise<Response>) {
  const res = await p;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => { ctx = null; fill.mockClear(); });

describe("Fill from scores is the People team and Admin only", () => {
  it("refuses a manager's count, write and legacy autoPlace, and never reaches fillFromScores", async () => {
    ctx = manager();
    expect((await call(fillGET(req(`http://x/api/talent-assessment/fill?period=${encodeURIComponent(period)}`)))).status).toBe(403);
    expect((await call(fillPOST(req("http://x/api/talent-assessment/fill", { period })))).status).toBe(403);
    expect((await call(gridPOST(req("http://x/api/talent-assessment", { autoPlace: true, period })))).status).toBe(403);
    expect(fill).not.toHaveBeenCalled();
  });

  it("tells a manager's page canFill false, and an admin's canFill true", async () => {
    ctx = manager();
    expect(await call(gridGET(req("http://x/api/talent-assessment?viewer=1")))).toEqual({ status: 200, body: { canFill: false } });
    ctx = admin();
    expect(await call(gridGET(req("http://x/api/talent-assessment?viewer=1")))).toEqual({ status: 200, body: { canFill: true } });
  });

  it("lets the People team and Admin count, write and use the legacy autoPlace", async () => {
    ctx = admin();
    expect(await call(fillGET(req(`http://x/api/talent-assessment/fill?period=${encodeURIComponent(period)}`)))).toEqual({ status: 200, body: { wouldPlace: 1, skipped: 0, period } });
    expect((await call(fillPOST(req("http://x/api/talent-assessment/fill", { period })))).body).toMatchObject({ placed: 1, period });
    expect((await call(gridPOST(req("http://x/api/talent-assessment", { autoPlace: true, period })))).body).toMatchObject({ placed: 1, period });
    expect(fill).toHaveBeenCalledTimes(3);
    expect(fill.mock.calls[0][2]).toEqual({ dryRun: true });
  });

  it("still refuses someone with no reports and no org scope", async () => {
    ctx = { ...manager(), ids: [], allowed: false, chain: new Set() };
    expect((await call(fillGET(req(`http://x/api/talent-assessment/fill?period=x`)))).status).toBe(403);
    expect((await call(gridGET(req("http://x/api/talent-assessment?viewer=1")))).status).toBe(403);
  });
});
