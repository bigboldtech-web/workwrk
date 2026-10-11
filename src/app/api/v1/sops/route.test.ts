// GET /api/v1/sops. Docs-found fixes batch 3: a status or sopType outside the
// enums reached the read and failed there (500). Both answer 400 now; a real
// value in any case is taken, and no status still means PUBLISHED.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ wheres: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["READ"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { sOP: { findMany: async (a: { where: Record<string, unknown> }) => { st.wheres.push(a.where); return []; } } },
}));

import { GET } from "./route";

const get = (q: string) => GET(new Request(`https://app.test/api/v1/sops?${q}`) as never);

beforeEach(() => { st.wheres = []; });

describe("GET /api/v1/sops filters", () => {
  it("answers 400 for a status or sopType outside the list, and reads nothing", async () => {
    const s = await get("status=LIVE");
    expect(s.status).toBe(400);
    expect((await s.json()).error).toMatch(/^status must be one of DRAFT, /);
    expect((await get("sopType=VIDEO")).status).toBe(400);
    expect(st.wheres).toEqual([]);
  });

  it("takes a real value in any case, and PUBLISHED when no status is asked for", async () => {
    await get("status=draft&sopType=checklist");
    await get("");
    expect(st.wheres.map((w) => [w.status, w.sopType])).toEqual([["DRAFT", "CHECKLIST"], ["PUBLISHED", undefined]]);
  });
});
