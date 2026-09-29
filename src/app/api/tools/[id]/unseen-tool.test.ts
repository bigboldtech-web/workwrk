import { beforeEach, describe, expect, it, vi } from "vitest";

// A tool the viewer cannot see must be "Not found" on every method, not only
// on GET. PATCH, DELETE and the share routes used to decide manage before
// see, so a Member whose share had just been taken back could tell a real id
// from a made-up one (403 "Ask whoever added it." against 404) with curl and
// the stale /tools?tool=<id> link from the share notification. The database
// and the app gate are mocked so each handler runs as the pure rule it is.

const findFirst = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const moveToTrash = vi.fn();
const requireTools = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/trash", () => ({ moveToTrash: (...a: unknown[]) => moveToTrash(...a) }));
vi.mock("@/lib/tools/tool-server", () => ({ requireTools: (...a: unknown[]) => requireTools(...a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tool: { findFirst: (...a: unknown[]) => findFirst(...a), update: (...a: unknown[]) => update(...a) },
    toolShare: { findUnique: (...a: unknown[]) => findUnique(...a), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    notification: { createMany: vi.fn() },
  },
}));

import { NextRequest, type NextResponse } from "next/server";
import { DELETE, GET, PATCH } from "./route";
import { DELETE as UNSHARE, POST as SHARE } from "./share/route";

const member = { userId: "emp", orgId: "org1", toolAdmin: false, isManager: false, name: "Verify Employee", isAgent: false, actingAs: false };
const tool = { id: "t1", name: "Old Figma seat", description: null, url: null, icon: null, category: null, credentials: null, addedBy: "admin", createdAt: new Date(), updatedAt: new Date() };
const params = { params: Promise.resolve({ id: "t1" }) };
const req = (body: unknown) => new NextRequest("http://localhost/api/tools/t1", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

// GET, PATCH, DELETE, POST share, DELETE share, in that order. The share
// handlers are typed as possibly undefined (TypeScript normalises the two
// object literals manageable() returns), though every path returns a
// response, hence the casts.
type Five = [NextResponse, NextResponse, NextResponse, NextResponse, NextResponse];
async function everyMethod(): Promise<Five> {
  return Promise.all([
    GET(req(null), params),
    PATCH(req({ description: "x" }), params),
    DELETE(req(null), params),
    SHARE(req({ userIds: ["u2"] }), params) as Promise<NextResponse>,
    UNSHARE(req({ userId: "u2" }), params) as Promise<NextResponse>,
  ]);
}

describe("/api/tools/[id] for a tool the viewer cannot see", () => {
  beforeEach(() => {
    requireTools.mockResolvedValue(member);
    findFirst.mockReset();
    findUnique.mockReset();
    update.mockReset();
    moveToTrash.mockReset();
  });

  it("answers the same 404 on every method as a made-up id does", async () => {
    findFirst.mockResolvedValue(tool);
    findUnique.mockResolvedValue(null); // no ToolShare for this Member
    const real = await everyMethod();
    findFirst.mockResolvedValue(null);
    const fake = await everyMethod();
    expect(real.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(fake.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(await Promise.all(real.map((r) => r.json()))).toEqual(await Promise.all(fake.map((r) => r.json())));
    expect(update).not.toHaveBeenCalled();
    expect(moveToTrash).not.toHaveBeenCalled();
  });

  it("keeps the 403 and its copy for a Can view holder, who can see the tool", async () => {
    findFirst.mockResolvedValue(tool);
    findUnique.mockResolvedValue({ id: "share1" });
    const [get, patch, del, share, unshare] = await everyMethod();
    expect(get.status).toBe(200);
    expect(patch.status).toBe(403);
    expect((await patch.json()).error).toBe("You can't change this tool. Ask whoever added it.");
    expect(del.status).toBe(403);
    expect(share.status).toBe(403);
    expect(unshare.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(moveToTrash).not.toHaveBeenCalled();
  });
});
