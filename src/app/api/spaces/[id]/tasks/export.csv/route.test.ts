// GET /api/spaces/[id]/tasks/export.csv: the Space List tab's Export.
//
// The button used to build the file in the browser from the tab's rows,
// which are at most 200, so a bigger Space exported 200 tasks and said
// nothing. The server export reads every task the tab's filters match, from
// the Space's readable Lists only, and refuses a Guest and an Agent.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "@/lib/item-test-db";

const st = vi.hoisted(() => ({
  viewer: { orgRole: "MEMBER", isAgent: false, actingAs: undefined as unknown },
  lists: [] as Array<{ id: string; statuses: unknown }>,
  space: { id: "sp-1", slug: "ops" } as null | { id: string; slug: string },
}));

vi.mock("@/lib/access/gate", () => {
  class AccessError extends Error {
    status = 401;
    body = { error: "Unauthorized" };
  }
  return { AccessError, requireCan: async () => ({ viewer: st.viewer, decision: { allowed: true } }) };
});
vi.mock("@/lib/api-helpers", () => ({ jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/item-gate", async () => {
  const { legacyLevelRow } = await import("@/lib/access/test-fixtures");
  return { itemCtx: async () => ({ userId: "u-me", organizationId: "org-1", userName: null, ...legacyLevelRow("EMPLOYEE") }) };
});
vi.mock("@/lib/list-links-server", () => ({ spaceForViewer: async () => st.space }));
vi.mock("@/lib/space", () => ({ readableListsInSpace: async () => ({ lists: st.lists, folderCount: 0 }) }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/item-test-db")).itemTestPrisma }));

import { GET } from "./route";

let db: ItemTestDb;
let n = 0;
function task(boardId: string, status: string, ownerId: string | null = null) {
  n += 1;
  db.items.push({
    id: `t-${String(n).padStart(4, "0")}`, title: `Task ${n}`, status, boardId, ownerId, archivedAt: null,
    updatedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000),
  });
}

async function csv(query = ""): Promise<{ status: number; lines: string[] }> {
  const res = await GET(new Request(`http://x/api/spaces/sp-1/tasks/export.csv${query}`) as never, { params: Promise.resolve({ id: "sp-1" }) });
  const text = await res.text();
  return { status: res.status, lines: text.trim().split("\r\n") };
}

beforeEach(() => {
  n = 0;
  st.viewer = { orgRole: "MEMBER", isAgent: false, actingAs: undefined };
  st.space = { id: "sp-1", slug: "ops" };
  st.lists = [{ id: "b-open", statuses: [{ value: "SHIPPED", label: "Shipped", color: "#15803D", group: "DONE" }] }];
  db = installItemTestDb(itemTestDb({ boards: [{ id: "b-open", name: "Roadmap" }, { id: "b-private", name: "Private" }] }));
  db.prisma.user = { findMany: async () => [{ id: "u-ann", firstName: "Ann", lastName: "Lee", email: "ann@x" }] };
});

describe("the Space List tab's export", () => {
  it("holds every matching task, not the 200 the tab shows, and nothing from a List the viewer cannot read", async () => {
    for (let i = 0; i < 2450; i++) task("b-open", "TO_DO");
    for (let i = 0; i < 3; i++) task("b-private", "TO_DO");
    const { status, lines } = await csv();
    expect(status).toBe(200);
    expect(lines[0]).toBe('"Title","Status","List","Owner","Updated"');
    expect(lines).toHaveLength(1 + 2450);
    expect(lines.some((l) => l.includes('"Private"'))).toBe(false);
  });

  it("applies the tab's filters and prints each status in its List's words", async () => {
    task("b-open", "SHIPPED", "u-ann");
    task("b-open", "TO_DO", "u-ann");
    const { lines } = await csv("?status=SHIPPED");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^"Task 1","Shipped","Roadmap","Ann Lee","/);
  });

  it("refuses a Guest and an Agent", async () => {
    st.viewer = { orgRole: "GUEST", isAgent: false, actingAs: undefined };
    expect((await csv()).status).toBe(403);
    st.viewer = { orgRole: "MEMBER", isAgent: true, actingAs: undefined };
    expect((await csv()).status).toBe(403);
  });

  it("a Space the viewer cannot read is not found", async () => {
    st.space = null;
    expect((await csv()).status).toBe(404);
  });
});
