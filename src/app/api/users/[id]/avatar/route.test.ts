// POST /api/users/[id]/avatar on an account its own person erased (review
// round 8 of Phase 3). Before, an Admin or a manager could put a photo on
// the anonymised "Deleted User", which named them again. Now it is 409
// account_erased, and a normal account's photo is saved as before.
// Review round 9 of Phase 3: only while the account is in the state its
// erasure left it; an erased account an Admin restored before round 8 takes
// a photo as anyone does (before: 409).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ERASED_AT = new Date("2026-10-01T09:00:00Z");

const st = vi.hoisted(() => ({
  /** The withdrawnAt of the account's newest erasure record, or null. */
  erasedAt: null as Date | null,
  /** The account's deletedAt. */
  deletedAt: null as Date | null,
  updates: [] as Array<Record<string, unknown>>,
  uploads: [] as string[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async () => ({ id: "u-max", organizationId: "org1", deletedAt: st.deletedAt }),
      findUnique: async () => ({ id: "u-max", deletedAt: st.deletedAt }),
      update: async (a: { data: Record<string, unknown> }) => {
        st.updates.push(a.data);
        return { id: "u-max" };
      },
    },
    consentRecord: {
      findFirst: async (a: { where: { userId: string; method: string; withdrawnAt: unknown } }) =>
        st.erasedAt && a.where.method === "erasure" && JSON.stringify(a.where.withdrawnAt) === JSON.stringify({ not: null }) ? { id: "c1", withdrawnAt: st.erasedAt } : null,
    },
  },
}));
vi.mock("@/lib/api-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-admin", organizationId: "org1" } } }),
  getOrgId: () => "org1",
  getUserId: () => "u-admin",
}));
vi.mock("@/lib/alignment-scope", () => ({ canTouchUserAlignment: async () => true }));
vi.mock("@/lib/local-uploads", () => ({
  writeUpload: async (name: string) => {
    st.uploads.push(name);
  },
}));

import { POST } from "./route";

function upload() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "max.png", { type: "image/png" }));
  return POST(new NextRequest("https://app.test/api/users/u-max/avatar", { method: "POST", body: form }), { params: Promise.resolve({ id: "u-max" }) });
}

beforeEach(() => {
  st.erasedAt = null;
  st.deletedAt = null;
  st.updates = [];
  st.uploads = [];
});

describe("a photo on an erased account", () => {
  it("is refused with account_erased, and nothing is stored", async () => {
    st.erasedAt = ERASED_AT;
    st.deletedAt = ERASED_AT;
    const res = await upload();
    // Before: 200, the photo stored on the "Deleted User".
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("account_erased");
    expect(st.uploads).toEqual([]);
    expect(st.updates).toEqual([]);
  });

  it("is saved on an erased account an Admin restored before round 8, an ordinary account now", async () => {
    st.erasedAt = ERASED_AT;
    st.deletedAt = null;
    const res = await upload();
    // Before: 409 account_erased, any erasure record refused it.
    expect(res.status).toBe(200);
    expect(st.updates).toHaveLength(1);
  });

  it("is saved as before on a normal account", async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    expect(st.uploads).toHaveLength(1);
    expect(st.updates[0].avatar).toMatch(/^\/api\/uploads\/avatar-u-max-/);
  });
});
