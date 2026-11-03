// /people/[id] as a full page opens for everyone who holds a seat here
// (docs/plans/workspace-status.md, the final review, product H2): someone
// anchored here in any state, and someone who works here through a
// membership, a removed one included (the Directory's Removed view opens
// it); never someone with no seat here. Before, a membership person's
// record was the in-shell 404 on a refresh, in a new tab and from every
// copied link, while the drawer opened it. Run on the in-memory database.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/access/gate", () => ({ gatePage: async () => ({ viewer: { organizationId: "b" } }) }));
vi.mock("@/components/people/person-record", () => ({ PersonRecord: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import PersonPage from "./page";

const open = (id: string) => PersonPage({ params: Promise.resolve({ id }) });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  db.seed("user", { id: "bea", email: "bea@x.test", organizationId: "b" });
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "a" });
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b" });
  db.seed("user", { id: "ned", email: "ned@x.test", organizationId: "a" });
});

describe("/people/[id] opens for everyone with a seat here (product H2)", () => {
  it("opens someone anchored here, and someone here through a membership", async () => {
    await expect(open("bea")).resolves.toBeTruthy();
    // Before: NOT_FOUND, Pat being anchored in A.
    await expect(open("pat")).resolves.toBeTruthy();
  });

  it("opens a removed membership person, as the Removed view lists them, and a deactivated anchored person", async () => {
    Object.assign(db.row("organizationMembership", "m-pat-b"), { status: "INACTIVE", removedAt: new Date("2026-10-01") });
    db.row("user", "bea").status = "INACTIVE";
    await expect(open("pat")).resolves.toBeTruthy();
    await expect(open("bea")).resolves.toBeTruthy();
  });

  it("is the 404 for someone with no seat here, and for nobody at all", async () => {
    await expect(open("ned")).rejects.toThrow("NOT_FOUND");
    await expect(open("nobody")).rejects.toThrow("NOT_FOUND");
  });
});
