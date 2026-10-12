// The workspace's role lock waits a bounded time (docs-found fixes batch 4,
// membership.ts lockOrgRoles). Batch 3 put every write of a reporting line
// under it, and the handover held it across the whole run, so a writer
// queued behind a long holder until Prisma's 5 second interactive timeout
// answered 500, holding a pooled connection all the while; ten of them took
// the process's whole pool. Now a writer waits at most ORG_ROLES_WAIT_MS
// (lock_timeout, inside the transaction), answers busy (OrgRolesBusy, a 503
// roles_busy at the routes) and never parks more than three connections.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/admin/companies-list", () => ({ ownerIdsOf: () => [] }));

import { lockOrgRoles, ORG_ROLES_WAIT_MS } from "./membership";
import { isOrgRolesBusy, OrgRolesBusy, rolesBusyAnswer } from "./org-roles-busy";
import { rolesBusyOrThrow, rolesBusyResponse } from "./roles-busy";

type Sql = { text: string; values: unknown[] };

/** A transaction whose advisory lock waits until `release` is called, or fails as told. */
function fakeTx(opts: { lockFails?: unknown; tryLock?: boolean } = {}) {
  const sql: Sql[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const run = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?");
    sql.push({ text, values });
    return text;
  };
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = run(strings, values);
      if (text.includes("pg_advisory_xact_lock")) {
        if (opts.lockFails) throw opts.lockFails;
        await held;
      }
      return 0;
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      run(strings, values);
      return [{ ok: opts.tryLock ?? false }];
    },
  };
  return { tx: tx as never, sql, release };
}

describe("lockOrgRoles waits a bounded time", () => {
  it("sets lock_timeout for the wait, takes the lock, then puts lock_timeout back", async () => {
    const t = fakeTx();
    t.release();
    await lockOrgRoles(t.tx, "org-1");
    expect(t.sql.map((s) => s.text)).toEqual([
      "SELECT set_config('lock_timeout', ?, true)",
      "SELECT pg_advisory_xact_lock(hashtext(?))",
      "SET LOCAL lock_timeout TO DEFAULT",
    ]);
    expect(t.sql[0].values).toEqual([`${ORG_ROLES_WAIT_MS}ms`]);
    expect(t.sql[1].values).toEqual(["org-roles:org-1"]);
    expect(ORG_ROLES_WAIT_MS).toBeLessThan(5_000);
  });

  it("turns Postgres' lock timeout into OrgRolesBusy, however the driver wraps it", async () => {
    const shapes = [
      Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }),
      Object.assign(new Error("Raw query failed."), { code: "P2010", meta: { code: "55P03", message: "canceling statement due to lock timeout" } }),
      Object.assign(new Error("driver adapter error"), { cause: { originalCode: "55P03" } }),
    ];
    for (const e of shapes) {
      const t = fakeTx({ lockFails: e });
      await expect(lockOrgRoles(t.tx, "org-1")).rejects.toBeInstanceOf(OrgRolesBusy);
    }
  });

  it("lets any other error through as it was", async () => {
    const boom = new Error("connection reset");
    const t = fakeTx({ lockFails: boom });
    await expect(lockOrgRoles(t.tx, "org-1")).rejects.toBe(boom);
  });

  it("never parks more than three waiters: the next one only tries the lock and answers busy", async () => {
    const waiters = [fakeTx(), fakeTx(), fakeTx()];
    const parked = waiters.map((w) => lockOrgRoles(w.tx, "org-1"));
    await new Promise((r) => setTimeout(r, 0));
    const fourth = fakeTx({ tryLock: false });
    const outcome = await Promise.race([
      lockOrgRoles(fourth.tx, "org-1").then(() => "locked", (e: unknown) => (isOrgRolesBusy(e) ? "busy" : "error")),
      new Promise((r) => setTimeout(() => r("still waiting"), 50)),
    ]);
    expect(outcome).toBe("busy");
    expect(fourth.sql.map((s) => s.text)).toEqual(["SELECT pg_try_advisory_xact_lock(hashtext(?)) AS ok"]);
    // A free lock is still taken that way.
    const fifth = fakeTx({ tryLock: true });
    await expect(lockOrgRoles(fifth.tx, "org-1")).resolves.toBeUndefined();
    for (const w of waiters) w.release();
    await Promise.all(parked);
    // Once they are through, a writer waits again.
    const sixth = fakeTx();
    sixth.release();
    await lockOrgRoles(sixth.tx, "org-1");
    expect(sixth.sql[1].text).toBe("SELECT pg_advisory_xact_lock(hashtext(?))");
  });
});

describe("the busy answer", () => {
  it("is a plain 503 roles_busy with Retry-After, and nothing for any other error", async () => {
    const res = rolesBusyResponse(new OrgRolesBusy())!;
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("roles_busy");
    expect(body.error).not.toMatch(/--|—/);
    expect(rolesBusyResponse(new Error("x"))).toBeNull();
    expect(rolesBusyAnswer(new Error("x"))).toBeNull();
    expect(() => rolesBusyOrThrow(new Error("x"))).toThrow("x");
    expect(rolesBusyOrThrow(new OrgRolesBusy()).status).toBe(503);
  });
});
