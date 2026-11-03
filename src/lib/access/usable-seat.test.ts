// D7's repair (docs/plans/workspace-status.md step 2): moveToUsableSeat, the
// move sign-in, Google sign-in and the session check make when an account's
// own seat is ended or its workspace is closed, and withUsableSeatElsewhere,
// which says which accounts it could move. Run through the real move
// (workspace-anchor.ts reanchorUser) on an in-memory database whose
// relations follow the rows.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { moveToUsableSeat, withUsableSeatElsewhere } from "./workspace-status";
import { seatDb as db } from "./seat-test-db";

const pat = () => db.row("user", "pat");
const seatIn = (organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === "pat" && m.organizationId === organizationId);
let created = 0;
function membership(organizationId: string, extra: Record<string, unknown> = {}, userId = "pat") {
  created += 1;
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, createdAt: new Date(Date.UTC(2026, 0, created)), ...extra });
}

beforeEach(() => {
  db.reset();
  created = 0;
  for (const [id, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["c", "TRIAL"], ["held", "SUSPENDED"], ["closed", "CANCELLED"]]) db.seed("organization", { id, name: `Org ${id}`, status });
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "a", accessLevel: "EMPLOYEE" });
});

describe("moveToUsableSeat", () => {
  it("moves an ended anchor to the best usable seat (primary first, then oldest), passing over ended, suspended, closed and taken ones", async () => {
    pat().status = "INACTIVE";
    membership("b", { isPrimary: true, status: "INACTIVE" });
    membership("held");
    membership("closed");
    membership("x-taken");
    db.seed("organization", { id: "x-taken", name: "Taken", status: "ACTIVE" });
    db.seed("user", { id: "twin", email: "pat@x.test", organizationId: "x-taken" });
    membership("c", { role: "MANAGER", status: "NOTICE_PERIOD" });
    expect(await moveToUsableSeat("pat")).toEqual({ organizationId: "c", organizationName: "Org c", accessLevel: "MANAGER", movedFrom: "a" });
    // The account takes that seat's status (an HR label is live); the seat it leaves keeps the ended one.
    expect(pat()).toMatchObject({ organizationId: "c", accessLevel: "MANAGER", status: "NOTICE_PERIOD", deletedAt: null });
    expect(seatIn("a")).toMatchObject({ status: "INACTIVE", removedAt: null, role: "EMPLOYEE" });
    expect(seatIn("b")).toMatchObject({ status: "INACTIVE" });
  });

  it("moves a live account out of a closed workspace, keeping its live seat there", async () => {
    pat().organizationId = "held";
    membership("b");
    expect(await moveToUsableSeat("pat")).toMatchObject({ organizationId: "b", movedFrom: "held" });
    expect(seatIn("held")).toMatchObject({ status: "ACTIVE", removedAt: null });
  });

  it("takes the person's row lock before it reads anything, every call inside its own transaction", async () => {
    pat().status = "INACTIVE";
    membership("b");
    await moveToUsableSeat("pat");
    // The first call is the lock; every read and write after it goes through the transaction's client.
    expect(db.log[0]).toBe("tx.lock:pat");
    expect(db.log.slice(1).length).toBeGreaterThan(3);
    expect(db.log.filter((e) => !e.startsWith("tx."))).toEqual([]);
  });

  it("answers an account that is usable where it is as it is, writing nothing (another device moved it first)", async () => {
    membership("b");
    expect(await moveToUsableSeat("pat")).toEqual({ organizationId: "a", organizationName: "Org a", accessLevel: "EMPLOYEE", movedFrom: null });
    expect(db.writes).toEqual([]);
  });

  it("answers null, writing nothing, with nowhere usable, for an account its own person erased, and for no account", async () => {
    pat().status = "INACTIVE";
    membership("b", { status: "INACTIVE" });
    membership("c", { removedAt: new Date("2026-10-01") });
    membership("held");
    expect(await moveToUsableSeat("pat")).toBeNull();

    const at = new Date("2026-10-30T10:00:00Z");
    pat().deletedAt = at;
    db.seed("consentRecord", { id: "cr", userId: "pat", method: "erasure", withdrawnAt: at, createdAt: at });
    membership("b2");
    db.seed("organization", { id: "b2", name: "Org b2", status: "ACTIVE" });
    expect(await moveToUsableSeat("pat")).toBeNull();
    expect(await moveToUsableSeat("nobody")).toBeNull();
    expect(db.writes).toEqual([]);
  });

  it("never counts the anchored workspace's own stale row as a seat to move into", async () => {
    pat().status = "INACTIVE";
    membership("a", { status: "ACTIVE" });
    expect(await moveToUsableSeat("pat")).toBeNull();
    expect(db.writes).toEqual([]);
  });
});

describe("withUsableSeatElsewhere", () => {
  it("names the accounts with a usable seat outside the workspace they are anchored to, never by their stale anchored row", async () => {
    db.seed("user", { id: "ann", email: "ann@x.test", organizationId: "b" });
    db.seed("user", { id: "bob", email: "bob@x.test", organizationId: "b" });
    db.seed("user", { id: "cat", email: "cat@x.test", organizationId: "b" });
    membership("c", {}, "ann");
    membership("b", {}, "bob");
    membership("c", { status: "INACTIVE" }, "cat");
    membership("held", {}, "cat");
    const rows = ["ann", "bob", "cat"].map((id) => ({ id, organizationId: "b", email: `${id}@x.test` }));
    expect([...(await withUsableSeatElsewhere(rows))]).toEqual(["ann"]);
    expect([...(await withUsableSeatElsewhere([]))]).toEqual([]);
  });

  it("passes over a seat in a workspace where an account with the same address, in any case, is anchored, as the repair does (the step 2 review L5)", async () => {
    db.seed("user", { id: "ann", email: "ann@x.test", organizationId: "b" });
    db.seed("user", { id: "twin", email: "ANN@x.test", organizationId: "c" });
    membership("c", {}, "ann");
    // Before: named, though moveToUsableSeat could not move her there.
    expect([...(await withUsableSeatElsewhere([{ id: "ann", organizationId: "b", email: "ann@x.test" }]))]).toEqual([]);
    membership("a", {}, "ann");
    expect([...(await withUsableSeatElsewhere([{ id: "ann", organizationId: "b", email: "ann@x.test" }]))]).toEqual(["ann"]);
  });
});
