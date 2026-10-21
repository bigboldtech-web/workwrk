// The audit rows of the writes (docs/plans/mcp-server.md section 7, step 3
// tests "audit: the fields, no titles, refusals counted"). One
// mcp.tool.<tool> row per write that changed something: the person as actor
// and actingFor, actorType mcp, the app as "<label> (MCP)", the target, the
// tool and the connection, the address and user agent, never a title. A
// refusal writes none and counts one refused. Through the registry, and
// once through the endpoint. Fails on the code before step 3: no write tool
// had a body, and nothing wrote these rows.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/item-gate", async () => (await import("./write-test-world")).itemGateMock);
vi.mock("@/lib/agents/acting", async () => (await import("./write-test-world")).actingMock);
vi.mock("@/lib/board", async () => (await import("./write-test-world")).boardMock);
vi.mock("@/lib/board-items", async () => (await import("./write-test-world")).boardItemsMock);
vi.mock("@/lib/items/item-patch", async () => (await import("./write-test-world")).itemPatchMock);
vi.mock("@/lib/items/item-comment", async () => (await import("./write-test-world")).itemCommentMock);
vi.mock("@/lib/doc-access", async () => (await import("./write-test-world")).docAccessMock);
vi.mock("@/lib/access/node-access", async () => (await import("./write-test-world")).nodeAccessMock);
vi.mock("@/lib/access/node-placement", async () => (await import("./write-test-world")).nodePlacementMock);
vi.mock("@/lib/docs/doc-save", async () => (await import("./write-test-world")).docSaveMock);
vi.mock("@/lib/kudos-give", async () => (await import("./write-test-world")).kudosMock);
vi.mock("@/lib/notify-item", async () => (await import("./write-test-world")).quietMocks.notifyItem);
vi.mock("@/services/webhookDispatcher", async () => (await import("./write-test-world")).quietMocks.dispatcher);
vi.mock("@/lib/assignable", async () => (await import("./write-test-world")).quietMocks.assignable);
vi.mock("@/lib/list-connect-server", async () => (await import("./write-test-world")).quietMocks.connect);
vi.mock("@/lib/list-links-server", async () => (await import("./write-test-world")).quietMocks.links);
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));

import * as route from "@/app/api/mcp/route";
import { seedConnection, testDb as db } from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import { utcDay } from "./usage";
import { APP, NOW, call, data, reason, seedWriteWorld } from "./write-test-call";

const at = (s: number) => new Date(NOW.getTime() + s * 1000);
const audit = () => (db.rows.activityLog ?? []).filter((r) => String(r.type).startsWith("mcp.tool."));
const usage = () => db.rows.mcpUsageDay.find((u) => u.grantId === "gr-u-max" && u.day === utcDay(NOW))!;
const META = { ip: "203.0.113.9", userAgent: "claude-code/2.0" };

beforeEach(() => {
  seedWriteWorld();
});

describe("one audit row per write", () => {
  it("carries section 7's fields: the person for themselves, the app's label, the target and the connection, the address and user agent", async () => {
    const out = data(await call("create_task", { title: "Plan", listId: "b-launch", subtasks: [{ title: "One" }, { title: "Two" }] }, { meta: META }));
    const rows = audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        type: "mcp.tool.create_task",
        actorId: "u-max",
        actingForId: "u-max",
        actorType: "mcp",
        actorLabel: `${APP} (MCP)`,
        organizationId: "org-a",
        description: "Created a task through an AI app (MCP)",
        targetType: "item",
        targetId: (out.task as { id: string }).id,
        metadata: { tool: "create_task", grantId: "gr-u-max", clientId: "wkc_x", redirectHost: "localhost" },
        ipAddress: "203.0.113.9",
        userAgent: "claude-code/2.0",
        severity: "info",
      }),
    );
  });

  it("names each tool and its target, and never a title, a comment, a doc's words, a note or a message", async () => {
    const SECRET = "Zebra-Title-4471";
    db.rows.board.push({ id: "b-two", organizationId: "org-a", name: "Two", slug: "two", spaceId: "s-proof", folderId: null, productSlug: null, ownerId: null, itemType: "studio-item", settings: {}, statuses: null, schema: { fields: [] }, archivedAt: null });
    const { world } = await import("./write-test-world");
    world.roles.get("u-max")!.set("list:b-two", "EDIT");
    const t = data(await call("create_task", { title: SECRET, listId: "b-launch" }, { at: at(0) }));
    const id = (t.task as { id: string }).id;
    data(await call("update_task", { taskId: id, title: `${SECRET} 2`, appendToDescription: SECRET }, { at: at(1) }));
    data(await call("move_task", { taskId: id, listId: "b-two" }, { at: at(2) }));
    data(await call("add_comment", { taskId: id, text: SECRET }, { at: at(3) }));
    data(await call("create_doc", { title: SECRET, markdown: SECRET }, { at: at(4) }));
    data(await call("append_to_doc", { docId: "d-root", heading: SECRET, text: SECRET }, { at: at(5) }));
    data(await call("create_reminder", { title: SECRET, note: SECRET, remindAt: "2026-10-22T09:00Z" }, { at: at(6) }));
    data(await call("give_kudos", { toEmail: "olivia@acme.test", message: SECRET, companyValue: SECRET }, { at: at(7) }));
    expect(audit().map((r) => [r.type, r.targetType])).toEqual([
      ["mcp.tool.create_task", "item"],
      ["mcp.tool.update_task", "item"],
      ["mcp.tool.move_task", "item"],
      ["mcp.tool.add_comment", "item"],
      ["mcp.tool.create_doc", "doc"],
      ["mcp.tool.append_to_doc", "doc"],
      ["mcp.tool.create_reminder", "reminder"],
      ["mcp.tool.give_kudos", "kudos"],
    ]);
    expect(JSON.stringify(audit())).not.toContain("Zebra");
    expect(usage()).toMatchObject({ writes: 8, refused: 0 });
  });

  it("writes no row for a refusal, and counts it refused; nor for a read, nor for a retry answered again", async () => {
    expect(reason(await call("update_task", { taskId: "t1", status: "Shipped" }))).toBe("That isn't a status in this List. Its statuses are: To Do, In Progress, Done.");
    expect(audit()).toHaveLength(0);
    expect(usage()).toMatchObject({ calls: 1, writes: 0, refused: 1 });
    data(await call("who_am_i"));
    data(await call("add_comment", { taskId: "t1", text: "Once" }, { at: at(1) }));
    data(await call("add_comment", { taskId: "t1", text: "Once" }, { at: at(2) }));
    expect(audit()).toHaveLength(1);
    expect(usage()).toMatchObject({ calls: 4, writes: 1, refused: 1 });
  });
});

describe("through the endpoint", () => {
  it("takes the address and the user agent from the request", async () => {
    const { token } = seedConnection(db, hashSecret, { grantId: "gr-http", scopes: ["mcp:read", "mcp:write"] });
    const res = await route.POST(
      new Request("https://app.workwrk.com/api/mcp", {
        method: "POST",
        headers: {
          host: "app.workwrk.com",
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "x-real-ip": "198.51.100.77",
          "user-agent": "cursor/1.7",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "add_comment", arguments: { taskId: "t1", text: "From Cursor" } } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).toBeUndefined();
    expect(audit()).toEqual([expect.objectContaining({ type: "mcp.tool.add_comment", ipAddress: "198.51.100.77", userAgent: "cursor/1.7", metadata: expect.objectContaining({ grantId: "gr-http" }) })]);
    const rows = (db.rows.itemActivity ?? []).filter((r) => r.action === "COMMENTED");
    expect(rows.map((r) => r.meta)).toEqual([expect.objectContaining({ via: { kind: "mcp", app: "an app on this computer" } })]);
  });
});

// ── The step 3 review (2026-10-22): low 9 and M2 ──

describe("review low 9: a change that changes nothing", () => {
  it("writes nothing, counts no change and no audit row: the same priority, a tag not on the task, a person already on it", async () => {
    data(await call("update_task", { taskId: "t1", priority: "HIGH" }, { at: at(0) }));
    expect(audit()).toHaveLength(1);
    const { world } = await import("./write-test-world");
    const patches = world.calls.patch.length;
    for (const [s, args] of [
      [1, { taskId: "t1", priority: "HIGH" }],
      [2, { taskId: "t1", removeTags: ["urgent"] }],
      [3, { taskId: "t1", status: "To Do" }],
      [4, { taskId: "t1", title: "Ship it" }],
    ] as const) {
      const out = data(await call("update_task", args, { at: at(s) }));
      expect(out.changed, JSON.stringify(args)).toEqual([]);
    }
    expect(world.calls.patch).toHaveLength(patches);
    expect(audit()).toHaveLength(1);
    expect(usage()).toMatchObject({ writes: 1, refused: 0 });
  });
});

describe("review M2: what a failing write made is still counted and audited", () => {
  it("one audit row and the change counted when the write fails after making it", async () => {
    const { MCP_TOOLS } = await import("./registry");
    const tool = MCP_TOOLS.find((t) => t.name === "create_doc")!;
    const run = tool.run!;
    tool.run = async (c, inp) => {
      await run(c, inp);
      throw new Error("lost");
    };
    try {
      expect((await call("create_doc", { title: "Kept" }, { at: at(0) })).isError).toBeUndefined();
    } finally {
      tool.run = run;
    }
    expect(audit().map((r) => r.type)).toEqual(["mcp.tool.create_doc"]);
    expect(usage()).toMatchObject({ writes: 1 });
  });
});
