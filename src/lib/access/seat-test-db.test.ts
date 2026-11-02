// The in-memory database of the workspace-status suites (seat-test-db.ts)
// answers as Postgres and Prisma would where those suites lean on it (the
// step 2 review L9): a transaction is its own client, every read is logged
// in order, a condition it does not model throws, NULL is never equal or
// unequal to anything, and the unique keys hold.

import { beforeEach, describe, expect, it } from "vitest";
import { createSeatDb } from "./seat-test-db";

const db = createSeatDb();
type Model = Record<string, (a: Record<string, unknown>) => Promise<unknown>>;
const model = (client: unknown, name: string) => (client as Record<string, Model>)[name];

beforeEach(() => {
  db.reset();
  db.seed("user", { id: "a", email: "a@x.test", organizationId: "o1", deletedAt: null });
  db.seed("user", { id: "b", email: "b@x.test", organizationId: "o1", deletedAt: new Date("2026-10-01") });
});

describe("seat-test-db", () => {
  it("hands a transaction its own client, with no $transaction of its own, and logs which client made each call", async () => {
    const prisma = db.prisma as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    await prisma.$transaction(async (tx) => {
      expect(tx).not.toBe(db.prisma);
      expect((tx as { $transaction?: unknown }).$transaction).toBeUndefined();
      await (tx as { $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<number> }).$executeRaw`SELECT 1 FROM "User" WHERE "id" = ${"a"} FOR NO KEY UPDATE`;
      await model(tx, "user").findUnique({ where: { id: "a" } });
      await model(db.prisma, "user").findUnique({ where: { id: "a" } });
    });
    expect(db.log).toEqual(["tx.lock:a", "tx.user.findUnique", "user.findUnique"]);
  });

  it("rolls a transaction back on a throw", async () => {
    const prisma = db.prisma as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    await expect(prisma.$transaction(async (tx) => {
      await model(tx, "user").update({ where: { id: "a" }, data: { email: "z@x.test" } });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(db.row("user", "a").email).toBe("a@x.test");
  });

  it("throws on a condition it does not model, a `not` with an operator included", async () => {
    await expect(model(db.prisma, "user").findMany({ where: { id: { not: { in: ["a"] } } } })).rejects.toThrow(/not modelled/);
    await expect(model(db.prisma, "user").findMany({ where: { email: { contains: "a" } } })).rejects.toThrow(/unknown condition/);
    await expect((db.prisma as { $queryRaw: (s: TemplateStringsArray) => Promise<unknown> }).$queryRaw`SELECT 1`).rejects.toThrow(/not modelled/);
  });

  it("never matches a NULL column with not or notIn, as SQL; nulls sort last ascending and first descending", async () => {
    const ids = async (where: Record<string, unknown>, orderBy?: unknown) =>
      ((await model(db.prisma, "user").findMany({ where, ...(orderBy ? { orderBy } : {}) })) as Array<{ id: string }>).map((u) => u.id);
    expect(await ids({ deletedAt: { not: new Date("2020-01-01") } })).toEqual(["b"]);
    expect(await ids({ deletedAt: { notIn: [new Date("2020-01-01")] } })).toEqual(["b"]);
    expect(await ids({ deletedAt: { not: null } })).toEqual(["b"]);
    expect(await ids({}, { deletedAt: "asc" })).toEqual(["b", "a"]);
    expect(await ids({}, { deletedAt: "desc" })).toEqual(["a", "b"]);
  });

  it("holds the unique keys: an account's exact address in a workspace, one membership per person and workspace", async () => {
    await expect(model(db.prisma, "user").create({ data: { id: "c", email: "a@x.test", organizationId: "o1" } })).rejects.toMatchObject({ code: "P2002" });
    // The index compares the spelling exactly, as Postgres' does.
    await expect(model(db.prisma, "user").create({ data: { id: "d", email: "A@x.test", organizationId: "o1" } })).resolves.toBeTruthy();
    await model(db.prisma, "organizationMembership").create({ data: { userId: "a", organizationId: "o2" } });
    await expect(model(db.prisma, "organizationMembership").create({ data: { userId: "a", organizationId: "o2" } })).rejects.toMatchObject({ code: "P2002" });
  });
});
