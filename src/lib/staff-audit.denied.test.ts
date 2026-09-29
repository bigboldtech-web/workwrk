import { beforeEach, describe, expect, it, vi } from "vitest";

// recordDeniedAccess against an in-memory StaffAction table whose reads yield
// to the event loop (so a parallel burst really interleaves, as it does over
// a connection pool) and whose advisory locks are real per-key queues. The
// old find-then-write, run outside any transaction, let every request in a
// burst miss the findFirst together and each create its own row.

interface Row { id: string; action: string; actorEmail: string; createdAt: Date; hits: number; ip: string | null }

const rows: Row[] = [];
const locks = new Map<string, Promise<void>>();
const tick = () => new Promise<void>((r) => setTimeout(r, 1));

function makeStaffAction() {
  return {
    async findFirst(args: { where: { action: string; actorEmail: string; createdAt: { gt: Date } } }) {
      await tick();
      const hit = rows
        .filter((r) => r.action === args.where.action && r.actorEmail === args.where.actorEmail && r.createdAt > args.where.createdAt.gt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return hit ? { id: hit.id, createdAt: hit.createdAt } : null;
    },
    async update(args: { where: { id: string }; data: { ip?: string } }) {
      await tick();
      const r = rows.find((x) => x.id === args.where.id)!;
      r.hits += 1;
      if (args.data.ip !== undefined) r.ip = args.data.ip;
      return r;
    },
    async create(args: { data: { action: string; actorEmail: string; ip: string | null } }) {
      await tick();
      const r: Row = { id: `sa${rows.length + 1}`, action: args.data.action, actorEmail: args.data.actorEmail, createdAt: new Date(), hits: 1, ip: args.data.ip };
      rows.push(r);
      return r;
    },
  };
}

vi.mock("@/lib/prisma", () => {
  const staffAction = makeStaffAction();
  return {
    prisma: {
      staffAction,
      async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        const held: (() => void)[] = [];
        const tx = {
          staffAction,
          // pg_advisory_xact_lock: wait for the key's holder, then hold it
          // until this transaction ends.
          async $executeRaw(_s: TemplateStringsArray, ...values: unknown[]) {
            const key = String(values[0]);
            const prev = locks.get(key) ?? Promise.resolve();
            let release!: () => void;
            const mine = new Promise<void>((r) => (release = r));
            locks.set(key, prev.then(() => mine));
            await prev;
            held.push(release);
            return 1;
          },
        };
        try {
          return await fn(tx);
        } finally {
          held.forEach((r) => r());
        }
      },
    },
  };
});

const { recordDeniedAccess } = await import("./staff-audit");

describe("recordDeniedAccess", () => {
  beforeEach(() => {
    rows.length = 0;
    locks.clear();
  });

  it("a 12-way parallel burst with no open row writes ONE row carrying all 12 hits", async () => {
    await Promise.all(Array.from({ length: 12 }, () => recordDeniedAccess({ email: "Gate.Staffer@example.com", ip: "10.0.0.1" })));
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(12);
    expect(rows[0].actorEmail).toBe("gate.staffer@example.com");
  });

  it("two people denied at once each get their own row", async () => {
    await Promise.all([
      ...Array.from({ length: 5 }, () => recordDeniedAccess({ email: "a@example.com" })),
      ...Array.from({ length: 3 }, () => recordDeniedAccess({ email: "b@example.com" })),
    ]);
    expect(rows.map((r) => [r.actorEmail, r.hits]).sort()).toEqual([
      ["a@example.com", 5],
      ["b@example.com", 3],
    ]);
  });

  it("sequential denials inside the window bump the one row", async () => {
    for (let i = 0; i < 4; i++) await recordDeniedAccess({ email: "c@example.com" });
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(4);
  });
});
