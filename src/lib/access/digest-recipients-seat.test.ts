// The manager digests read this workspace's seat (docs/plans/workspace-status.md
// D12; src/lib/access/digest-recipients.ts): a person whose membership here
// this workspace deactivated or removed has no digest manager here, and a
// manager whose membership here is ended gets no digest, whatever their
// account's status where it is anchored. Run on the in-memory database with
// the real line reads (manager-lines.ts, acting-workspace.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { seatDb as db } from "./seat-test-db";
import { digestManagersOf } from "./digest-recipients";

const person = (id: string, organizationId: string, level: string, managerId: string | null = null) =>
  db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Lee", organizationId, ...legacyLevelRow(level), managerId });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  // Mia manages in B through a membership; her account is anchored in A.
  person("mia", "a", "EMPLOYEE");
  db.seed("organizationMembership", { id: "m-mia-b", userId: "mia", organizationId: "b", role: "MANAGER" });
  person("pat", "b", "EMPLOYEE", "mia");
  // Sam manages in B, anchored there; Rae reports to him and works in B
  // through a membership, whose line names him (workspace-status-2 E1). In A
  // Mia leads her: her account's line, never read in B.
  person("sam", "b", "MANAGER");
  person("rae", "a", "EMPLOYEE", "mia");
  db.seed("organizationMembership", { id: "m-rae-b", userId: "rae", organizationId: "b", role: "EMPLOYEE", managerId: "sam" });
});

describe("the digest manager reads the seat here (D12)", () => {
  it("names a manager and a report who work here through live memberships", async () => {
    const got = await digestManagersOf("b", ["pat", "rae"]);
    expect(got.get("pat")).toMatchObject({ id: "mia", accessLevel: "MANAGER" });
    expect(got.get("rae")).toMatchObject({ id: "sam" });
  });

  it("gives no digest to a manager this workspace deactivated or removed through their membership", async () => {
    // Before: Mia's account is live in A, so her role here was read whatever her seat, and she got Pat's late work.
    db.row("organizationMembership", "m-mia-b").status = "INACTIVE";
    expect((await digestManagersOf("b", ["pat"])).has("pat")).toBe(false);
    db.row("organizationMembership", "m-mia-b").status = "ACTIVE";
    db.row("organizationMembership", "m-mia-b").removedAt = new Date("2026-10-01");
    expect((await digestManagersOf("b", ["pat"])).has("pat")).toBe(false);
  });

  it("names no digest manager for someone this workspace deactivated or removed through their membership", async () => {
    // Before: any membership row here counted, so Sam heard of Rae's late work after B ended her.
    db.row("organizationMembership", "m-rae-b").status = "INACTIVE";
    expect((await digestManagersOf("b", ["rae"])).has("rae")).toBe(false);
    db.row("organizationMembership", "m-rae-b").status = "ACTIVE";
    db.row("organizationMembership", "m-rae-b").removedAt = new Date("2026-10-01");
    expect((await digestManagersOf("b", ["rae"])).has("rae")).toBe(false);
  });

  it("keeps an HR label as a live seat", async () => {
    db.row("organizationMembership", "m-mia-b").status = "ON_LEAVE";
    db.row("organizationMembership", "m-rae-b").status = "NOTICE_PERIOD";
    const got = await digestManagersOf("b", ["pat", "rae"]);
    expect(got.get("pat")?.id).toBe("mia");
    expect(got.get("rae")?.id).toBe("sam");
  });
});
