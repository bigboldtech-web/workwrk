import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: (a: unknown) => findMany(a) } } }));

import { employedAmong } from "./employed.server";

describe("employedAmong: the people a body names who can still be given work", () => {
  beforeEach(() => findMany.mockReset());

  it("asks only for this workspace's people, never someone removed or deactivated", async () => {
    findMany.mockResolvedValue([{ id: "a" }]);
    await employedAmong("org-1", ["a", "b"]);
    expect(findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["a", "b"] },
      organizationId: "org-1",
      deletedAt: null,
      status: { not: "INACTIVE" },
    });
  });

  it("keeps the input's order, drops repeats and anyone the workspace does not hold", async () => {
    findMany.mockResolvedValue([{ id: "c" }, { id: "a" }]);
    expect(await employedAmong("org-1", ["a", "b", "a", "c"])).toEqual(["a", "c"]);
  });

  it("ignores what is not an id and asks nothing when nothing is left", async () => {
    expect(await employedAmong("org-1", [null, 3, "", "x".repeat(65), { id: "a" }])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
