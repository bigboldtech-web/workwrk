// A List template's seed tasks (docs/plans/recurring-goals.md C4, the step 4
// review M3): a sample task seeded into a done status is nobody's finished
// work, so it records no completion, and a goal counted by Done date never
// counts a template applied today as work done today.

import { describe, expect, it, vi } from "vitest";

const { createBoardItem } = vi.hoisted(() => ({
  createBoardItem: vi.fn(async (...args: [input: Record<string, unknown>, opts?: Record<string, unknown>]) => ({ id: `it-${args.length}` })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { board: { update: async () => ({}) }, view: { findMany: async () => [] } } }));
vi.mock("@/lib/board", () => ({ createBoard: async () => ({ id: "b-new", slug: "new" }) }));
vi.mock("@/lib/space", () => ({ createSpace: async () => ({}) }));
vi.mock("@/lib/folder", () => ({ createFolder: async () => ({}) }));
vi.mock("@/lib/access/node-placement", () => ({ lockParentFolder: async () => undefined }));
vi.mock("@/lib/board-items", () => ({ createBoardItem }));

import { applyListTemplate } from "./template-center";

describe("applyListTemplate's seed tasks", () => {
  it("are created with no completion, whatever status they are seeded in", async () => {
    await applyListTemplate(
      { statuses: [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" }, { value: "DONE", label: "Done", color: "#090", group: "DONE" }], items: [{ title: "A finished example", status: "DONE" }, { title: "An open one", status: "OPEN" }] } as Parameters<typeof applyListTemplate>[0],
      { organizationId: "org-1", userId: "u-1", spaceId: "s-1", name: "Launch" },
    );
    expect(createBoardItem).toHaveBeenCalledTimes(2);
    for (const [input, opts] of createBoardItem.mock.calls) {
      expect(input).toMatchObject({ boardId: "b-new" });
      expect(opts).toEqual({ completionAt: null });
    }
  });
});
