import { describe, expect, it } from "vitest";
import { buildIdempotencyKey, extractEventQualifier } from "./idempotency";

describe("idempotency key", () => {
  const base = { organizationId: "org1", eventKey: "task.field_changed", recordId: "item1", eventTimestamp: "2026-09-27T10:00:00.000Z" };

  it("is the same for the same event twice", () => {
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
  });

  it("tells two field changes of one save apart (same record, same updatedAt)", () => {
    const title = buildIdempotencyKey({ ...base, qualifier: extractEventQualifier({ field: "title" }) });
    const priority = buildIdempotencyKey({ ...base, qualifier: extractEventQualifier({ field: "priority" }) });
    expect(title).not.toBe(priority);
    // The same field twice is still one event.
    expect(title).toBe(buildIdempotencyKey({ ...base, qualifier: "field:title" }));
  });

  it("has no qualifier for an event with no field", () => {
    expect(extractEventQualifier({ id: "x", status: "done" })).toBeNull();
    expect(extractEventQualifier({ field: "" })).toBeNull();
    expect(buildIdempotencyKey({ ...base, qualifier: null })).toBe(buildIdempotencyKey(base));
  });
});
