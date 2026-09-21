import { describe, expect, it } from "vitest";
import { isMissingContractColumnError } from "./contract-columns";

describe("isMissingContractColumnError", () => {
  it("matches Prisma P2022 on one of the new columns", () => {
    expect(isMissingContractColumnError({ code: "P2022", meta: { column: "Agreement.sentAt" } })).toBe(true);
    expect(isMissingContractColumnError({ code: "42703", message: 'column "declinedAt" does not exist' })).toBe(true);
  });
  it("ignores other columns and other errors", () => {
    expect(isMissingContractColumnError({ code: "P2022", meta: { column: "somethingElse" } })).toBe(false);
    expect(isMissingContractColumnError({ code: "P2002", message: "sentAt unique" })).toBe(false);
    expect(isMissingContractColumnError(null)).toBe(false);
    expect(isMissingContractColumnError(new Error("network"))).toBe(false);
  });
});
