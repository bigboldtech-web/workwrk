// "Via <app> (MCP)" on task activity (docs/plans/mcp-server.md Decision 14,
// section 7, step 3 tests "via: stamped inside, not outside, not in
// parallel requests; an automation's rows carry no via"). The writers are
// the real item-thread.ts ones over the in-memory store, and the automation
// fan-in is the real dispatchEvent (src/services/webhookDispatcher.ts) with
// the engine standing in. Fails on the code before step 3: there was no
// context, and no row said how it was made.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ automations: [] as Promise<void>[] }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
// The engine, as an automation that changes the task it was set off by, a moment later.
vi.mock("@/lib/automation/engine", () => ({
  runAutomationsForEvent: (input: { organizationId: string; payload: { id: string } }) => {
    const run = (async () => {
      await new Promise((r) => setTimeout(r, 2));
      const { logActivity } = await import("@/lib/item-thread");
      await logActivity({ organizationId: input.organizationId, itemId: input.payload.id, actorId: null, action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE", by: "automation" } });
    })();
    h.automations.push(run);
    return run;
  },
}));

import { logItemActivity } from "@/lib/activity/log";
import { createUpdate, logActivity, writeItemActivity } from "@/lib/item-thread";
import { testDb as db } from "@/lib/oauth/oauth-test-db";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { exitMcpVia, mcpVia, runAsMcp, stampVia } from "./via";

const VIA = { app: "Claude", clientId: "wkc_x", grantId: "gr-1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const row = (action: string) => (db.rows.itemActivity ?? []).find((r) => r.action === action)!;
const log = (action: string, meta: Record<string, unknown> = {}) => logActivity({ organizationId: "org-a", itemId: "t1", actorId: "u-max", action, meta });

beforeEach(() => {
  db.reset();
  h.automations.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("inside a tool call, and outside one", () => {
  it("stamps every row a call writes with the app, and writes a row outside exactly as before", async () => {
    await runAsMcp(VIA, async () => {
      await log("TITLE_CHANGED", { from: "a", to: "b" });
      await createUpdate({ organizationId: "org-a", itemId: "t1", authorId: "u-max", body: "Hello" });
    });
    await log("PRIORITY_CHANGED", { from: "LOW", to: "HIGH" });
    expect(row("TITLE_CHANGED").meta).toEqual({ from: "a", to: "b", via: { kind: "mcp", app: "Claude" } });
    expect(row("COMMENTED").meta).toMatchObject({ via: { kind: "mcp", app: "Claude" } });
    expect(row("PRIORITY_CHANGED").meta).toEqual({ from: "LOW", to: "HIGH" });
    expect(mcpVia()).toBeNull();
  });

  it("stamps a row written on a transaction's client, and the fire-and-forget writer's, through the one writer", async () => {
    await runAsMcp(VIA, async () => {
      await writeItemActivity(db.prisma as never, { organizationId: "org-a", entityType: "BOARD_ITEM", entityId: "t1", actorId: "u-max", action: "PUBLIC_LINK_ON", meta: {} });
      logItemActivity({ organizationId: "org-a", entityType: "MEETING", entityId: "m1", actorId: "u-max", action: "UPDATED", meta: { field: "title" } });
      await sleep(1);
    });
    expect(row("PUBLIC_LINK_ON").meta).toEqual({ via: { kind: "mcp", app: "Claude" } });
    expect(row("UPDATED").meta).toEqual({ field: "title", via: { kind: "mcp", app: "Claude" } });
  });

  it("keeps a row's own word for how it was made (Fill with AI)", () => {
    return runAsMcp(VIA, async () => {
      expect(stampVia({ fields: ["Effort"], via: "ai" })).toEqual({ fields: ["Effort"], via: "ai" });
    });
  });
});

describe("never anything else's", () => {
  it("does not reach a request served at the same moment, before, between or after the call's awaits", async () => {
    const call = runAsMcp(VIA, async () => {
      await sleep(3);
      await log("DUE_CHANGED");
      await sleep(3);
      await log("START_CHANGED");
    });
    const other = (async () => {
      await sleep(1);
      await log("ASSIGNEES_CHANGED");
      await sleep(4);
      await log("TAGS_CHANGED");
      await sleep(4);
      await log("TYPE_CHANGED");
    })();
    await Promise.all([call, other]);
    for (const a of ["DUE_CHANGED", "START_CHANGED"]) expect(row(a).meta, a).toMatchObject({ via: { app: "Claude" } });
    for (const a of ["ASSIGNEES_CHANGED", "TAGS_CHANGED", "TYPE_CHANGED"]) expect(row(a).meta, a).toEqual({});
  });

  it("keeps two calls of two apps apart", async () => {
    await Promise.all([
      runAsMcp(VIA, async () => {
        await sleep(2);
        await log("RECUR_SET");
      }),
      runAsMcp({ app: "Cursor", clientId: "wkc_y", grantId: "gr-2" }, async () => {
        await sleep(1);
        await log("RECUR_CLEARED");
      }),
    ]);
    expect(row("RECUR_SET").meta).toEqual({ via: { kind: "mcp", app: "Claude" } });
    expect(row("RECUR_CLEARED").meta).toEqual({ via: { kind: "mcp", app: "Cursor" } });
  });

  it("an automation the call sets off through dispatchEvent writes its rows with no via", async () => {
    await runAsMcp(VIA, async () => {
      await log("MOVED");
      await dispatchEvent({ organizationId: "org-a", event: "task.status_changed", payload: { id: "t1" } });
      await log("ARCHIVED");
    });
    await Promise.all(h.automations);
    expect(h.automations).toHaveLength(1);
    expect(row("MOVED").meta).toMatchObject({ via: { app: "Claude" } });
    expect(row("ARCHIVED").meta).toMatchObject({ via: { app: "Claude" } });
    expect(row("STATUS_CHANGED").meta).toEqual({ from: "TO_DO", to: "DONE", by: "automation" });
  });

  it("exitMcpVia runs its work, and everything it starts, outside the call", async () => {
    await runAsMcp(VIA, async () => {
      expect(mcpVia()).toEqual(VIA);
      await exitMcpVia(async () => {
        expect(mcpVia()).toBeNull();
        await sleep(1);
        await log("RESTORED");
      });
      expect(mcpVia()).toEqual(VIA);
    });
    expect(row("RESTORED").meta).toEqual({});
  });
});
