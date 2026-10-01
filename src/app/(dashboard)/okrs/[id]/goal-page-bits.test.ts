import { describe, expect, it } from "vitest";
import { goalRequestStanding, type OutgoingRequestRow } from "./goal-page-bits";

// A Can view viewer's Request strip on a goal must remember where their ask
// stands after a reload: pending (no second Request), declined (Request
// again), or nothing to say. The outgoing list is newest first.

const GOAL = "goal-1";
const row = (over: Partial<OutgoingRequestRow>): OutgoingRequestRow => ({
  objectType: "goal", objectId: GOAL, status: "PENDING", createdAt: "2026-10-01T08:15:00.000Z", decidedAt: null, ...over,
});

describe("goalRequestStanding", () => {
  it("has nothing to say with no request, or a failed read", () => {
    expect(goalRequestStanding([], GOAL)).toBeNull();
    expect(goalRequestStanding(undefined, GOAL)).toBeNull();
  });

  it("reads a pending request with the day it was asked", () => {
    expect(goalRequestStanding([row({})], GOAL)).toEqual({ kind: "pending", since: "2026-10-01T08:15:00.000Z" });
  });

  it("reads a decline with the day it was decided", () => {
    expect(goalRequestStanding([row({ status: "DENIED", decidedAt: "2026-10-01T08:20:00.000Z" })], GOAL))
      .toEqual({ kind: "declined", on: "2026-10-01T08:20:00.000Z" });
  });

  it("goes by the newest row: a fresh ask after a decline is pending", () => {
    const list = [row({ createdAt: "2026-10-02T09:00:00.000Z" }), row({ status: "DENIED", decidedAt: "2026-10-01T08:20:00.000Z" })];
    expect(goalRequestStanding(list, GOAL)).toEqual({ kind: "pending", since: "2026-10-02T09:00:00.000Z" });
  });

  it("ignores other goals and other kinds with the same id", () => {
    const list = [row({ objectId: "goal-2" }), row({ objectType: "doc" })];
    expect(goalRequestStanding(list, GOAL)).toBeNull();
  });

  it("leaves the plain Request after an approval, a cancel or an expiry", () => {
    for (const status of ["APPROVED", "CANCELLED", "EXPIRED"]) {
      expect(goalRequestStanding([row({ status, decidedAt: "2026-10-01T08:20:00.000Z" })], GOAL)).toBeNull();
    }
  });
});
