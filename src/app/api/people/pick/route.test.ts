// Contract test for GET /api/people/pick: the where clause it hands Prisma.
//
// The route is the only search path for every sharing picker (the one Manage
// access dialog for Space, Folder, List, Doc, Table, Canvas and Form), plus
// Talk, mentions, meetings and forms. It used to OR one `contains q` over
// firstName, lastName and email, so "Verify Bot" (a full name, which lives in
// two columns) matched nobody. The database is mocked; the captured where is
// evaluated here against a few people by a small matcher that understands
// exactly the Prisma operators the route uses, so the test reads as "who would
// this query find" rather than as a snapshot of the object's shape.

import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
// The org role the mocked orgRoleOf answers; the session carries nothing the
// test needs beyond it.
let orgRole: "MEMBER" | "GUEST" = "MEMBER";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: (args: unknown) => findMany(args) },
    conversationMember: { findMany: async () => [{ userId: "u-bot" }] },
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: {} } }),
  getOrgId: () => "org-1",
  getUserId: () => "u-me",
  jsonError: (message: string, status: number) => ({ message, status }),
  jsonSuccess: (data: unknown) => data,
}));

vi.mock("@/lib/access/org-role", () => ({
  orgRoleOf: () => orgRole,
}));

import { GET } from "./route";

type Person = {
  id: string;
  organizationId: string;
  deletedAt: null;
  status: string;
  firstName: string;
  lastName: string;
  email: string;
};

const PEOPLE: Person[] = [
  { id: "u-me", organizationId: "org-1", deletedAt: null, status: "ACTIVE", firstName: "Verify", lastName: "Admin", email: "verify.admin@acmecorp.com" },
  { id: "u-bot", organizationId: "org-1", deletedAt: null, status: "ACTIVE", firstName: "Verify", lastName: "Bot", email: "verify.employee@acmecorp.com" },
  { id: "u-ann", organizationId: "org-1", deletedAt: null, status: "ON_LEAVE", firstName: "Ann", lastName: "Botham", email: "ann@acmecorp.com" },
  { id: "u-gone", organizationId: "org-1", deletedAt: null, status: "INACTIVE", firstName: "Verify", lastName: "Bot", email: "old.bot@acmecorp.com" },
  { id: "u-other", organizationId: "org-2", deletedAt: null, status: "ACTIVE", firstName: "Verify", lastName: "Bot", email: "bot@elsewhere.com" },
];

// The Prisma where subset the route builds: equality, AND, OR, NOT, `in`,
// `not`, and case-insensitive `contains`. Anything else throws, so a future
// operator in the route fails loudly here instead of silently matching.
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Record<string, unknown>);
    const value = row[key];
    if (cond === null || typeof cond !== "object") return value === cond;
    const c = cond as Record<string, unknown>;
    if ("contains" in c) {
      const needle = String(c.contains);
      return c.mode === "insensitive"
        ? String(value).toLowerCase().includes(needle.toLowerCase())
        : String(value).includes(needle);
    }
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("not" in c) return value !== c.not;
    throw new Error(`matcher does not know ${JSON.stringify(c)}`);
  });
}

async function pick(query: string): Promise<string[]> {
  await GET(new Request(`http://localhost/api/people/pick?${query}`) as never);
  const { where } = findMany.mock.calls.at(-1)![0] as { where: Record<string, unknown> };
  return PEOPLE.filter((p) => matches(p, where)).map((p) => p.id);
}

beforeEach(() => {
  orgRole = "MEMBER";
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe("GET /api/people/pick search text", () => {
  it("finds a person by the full name as it is typed", async () => {
    expect(await pick("q=Verify%20Bot&reach=signin")).toEqual(["u-bot"]);
  });

  it("finds them with the words in either order, any case, extra spaces", async () => {
    expect(await pick("q=%20bot%20%20%20VERIFY%20&reach=signin")).toEqual(["u-bot"]);
  });

  it("still finds by one word, by a fragment and by email", async () => {
    expect(await pick("q=Verify")).toEqual(["u-bot"]);
    expect(await pick("q=bot&reach=signin")).toEqual(["u-bot", "u-ann"]);
    expect(await pick("q=verify.employee%40acmecorp.com")).toEqual(["u-bot"]);
  });

  it("needs EVERY word to match somewhere, so a full name narrows", async () => {
    expect(await pick("q=Verify%20Botham&reach=signin")).toEqual([]);
    expect(await pick("q=Ann%20Bot&reach=signin")).toEqual(["u-ann"]);
  });

  it("keeps the self, exclude, status and org rules alongside the words", async () => {
    // The viewer is "Verify Admin": the words match them, the self rule drops them.
    expect(await pick("q=Verify%20Admin")).toEqual([]);
    expect(await pick("q=Verify%20Admin&includeSelf=1")).toEqual(["u-me"]);
    expect(await pick("q=Verify%20Bot&exclude=u-bot")).toEqual([]);
    // ON_LEAVE is offered only to the signin reach; INACTIVE and other orgs never.
    expect(await pick("q=Ann%20Botham")).toEqual([]);
    expect(await pick("q=Ann%20Botham&reach=signin")).toEqual(["u-ann"]);
  });

  it("keeps a Guest to the people they share a conversation with", async () => {
    orgRole = "GUEST";
    expect(await pick("q=Verify%20Bot")).toEqual(["u-bot"]);
    expect(await pick("q=Ann&reach=signin")).toEqual([]);
  });

  it("with no search text lists everyone the other rules allow", async () => {
    expect(await pick("reach=signin")).toEqual(["u-bot", "u-ann"]);
  });
});
