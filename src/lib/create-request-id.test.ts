import { describe, expect, it } from "vitest";
import { createReplayDecision, newCreateRequestId, readCreateRequestId, withoutRequestId } from "./create-request-id";

describe("create request ids", () => {
  it("makes a cuid shaped id the server accepts back", () => {
    const id = newCreateRequestId(() => new Uint8Array(24).map((_, i) => i * 11));
    expect(id).toMatch(/^c[0-9a-z]{24}$/);
    expect(readCreateRequestId({ requestId: id })).toBe(id);
    expect(newCreateRequestId()).not.toBe(newCreateRequestId());
  });

  it("ignores a missing or malformed id", () => {
    expect(readCreateRequestId(null)).toBeNull();
    expect(readCreateRequestId({})).toBeNull();
    expect(readCreateRequestId({ requestId: "sov_abc" })).toBeNull();
    expect(readCreateRequestId({ requestId: "C".padEnd(25, "a") })).toBeNull();
    expect(readCreateRequestId({ requestId: 42 })).toBeNull();
  });

  it("strips the id for a strict validator and leaves other bodies alone", () => {
    expect(withoutRequestId({ a: 1, requestId: "x" })).toEqual({ a: 1 });
    const body = { a: 1 };
    expect(withoutRequestId(body)).toBe(body);
    expect(withoutRequestId(null)).toBeNull();
  });

  it("replays only the same person's row in the same org", () => {
    const caller = { organizationId: "o1", userId: "u1" };
    expect(createReplayDecision(null, caller)).toBe("create");
    expect(createReplayDecision({ organizationId: "o1", creatorId: "u1" }, caller)).toBe("replay");
    expect(createReplayDecision({ organizationId: "o1", creatorId: "u2" }, caller)).toBe("refuse");
    expect(createReplayDecision({ organizationId: "o2", creatorId: "u1" }, caller)).toBe("refuse");
    expect(createReplayDecision({ organizationId: "o1", creatorId: null }, caller)).toBe("refuse");
  });
});
