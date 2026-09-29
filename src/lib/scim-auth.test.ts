import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isDeprovisionOnly } from "./scim-auth";

describe("isDeprovisionOnly", () => {
  it("is true only for a write that deactivates and does nothing else", () => {
    expect(isDeprovisionOnly({ status: "INACTIVE" })).toBe(true);
    expect(isDeprovisionOnly({ status: "ACTIVE" })).toBe(false);
    expect(isDeprovisionOnly({ status: "INACTIVE", email: "x@y.z" })).toBe(false);
    expect(isDeprovisionOnly({ firstName: "A" })).toBe(false);
    expect(isDeprovisionOnly({})).toBe(false);
  });
});
