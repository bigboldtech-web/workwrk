// A contract opens for the manager tier and for its parties, by user id or
// by the email on their account, as its page answers. The database is mocked.

import { describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "./test-fixtures";

let email: string | null = "Bob@Example.com ";
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: async () => ({ email }) } } }));

const { agreementReadWhere } = await import("./agreement-read");

describe("agreementReadWhere", () => {
  it("the manager tier opens every contract", async () => {
    expect(await agreementReadWhere(legacyTestSession("u-m", "MANAGER"))).toEqual({});
    expect(await agreementReadWhere(legacyTestSession("u-h", "HR"))).toEqual({});
    expect(await agreementReadWhere(legacyTestSession("u-a", "COMPANY_ADMIN"))).toEqual({});
  });

  it("anyone else opens the ones they are a party to, by id or by their account email", async () => {
    expect(await agreementReadWhere(legacyTestSession("u-1", "EMPLOYEE"))).toEqual({
      parties: { some: { OR: [{ userId: "u-1" }, { email: { equals: "Bob@Example.com", mode: "insensitive" } }] } },
    });
  });

  it("with no email on the account, by id alone; with no user, nothing", async () => {
    email = null;
    expect(await agreementReadWhere(legacyTestSession("u-1", "EMPLOYEE"))).toEqual({ parties: { some: { OR: [{ userId: "u-1" }] } } });
    expect(await agreementReadWhere({ user: {} })).toEqual({ id: { in: [] } });
  });
});
