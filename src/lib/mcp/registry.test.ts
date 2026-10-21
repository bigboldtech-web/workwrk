// The tools a connection sees, and one call's order (docs/plans/mcp-server.md
// 2.4, 2.5, 4.1 to 4.3, step 2 tests "registry: scopes, the 2025-03-26 form,
// names, schemas and descriptions; the annotations, with update_task and
// move_task destructive"). Fails on the code before step 2: none of it
// existed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));

import { seed, seedWorld, testDb as db, useMcpEnv } from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import type { McpContext } from "./auth";
import { MCP_TOOL_COPY } from "./mcp-copy";
import { RpcError } from "./protocol";
import { MCP_TOOLS, listTools, runTool } from "./registry";
import { utcDay } from "./usage";

const READS = ["who_am_i", "list_spaces", "list_lists", "search_tasks", "get_task", "list_my_tasks", "search_people", "search_docs", "get_doc", "list_my_goals"];
const WRITES = ["create_task", "update_task", "move_task", "add_comment", "create_doc", "append_to_doc", "create_reminder", "give_kudos"];

const saved = { ...process.env };
const NOW = new Date("2026-10-21T12:00:00Z");

function ctx(over: Partial<McpContext> = {}): McpContext {
  return {
    grant: {
      id: "gr-1", clientId: "wkc_x", organizationId: "org-a", userId: "u-max", appName: "an app on this computer", redirectHost: "localhost",
      familyId: "fam-1", tokenVersion: 3, authorizedAt: new Date("2026-10-20T08:00:00Z"), endsBy: new Date("2026-11-20T08:00:00Z"), revokedAt: null,
      scopes: ["mcp:read"], lastUsedAt: null,
    },
    client: { id: "wkc_x", name: "Claude Code (workwrk)", disabledAt: null },
    person: {
      userId: "u-max", organizationId: "org-a", orgRole: "MEMBER", name: "Max Member", firstName: "Max", email: "max@acme.test", timezone: "Europe/Berlin",
    } as McpContext["person"],
    blocked: null,
    scopes: ["mcp:read"],
    ...over,
  };
}

beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
});
afterEach(() => {
  process.env = { ...saved };
});

describe("the tools defined", () => {
  it("are the ten read tools and the eight write tools of 4.1, by name and scope", () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual([...READS, ...WRITES]);
    expect(MCP_TOOLS.filter((t) => t.scope === "read").map((t) => t.name)).toEqual(READS);
    expect(MCP_TOOLS.filter((t) => t.scope === "write").map((t) => t.name)).toEqual(WRITES);
  });

  it("carry 4.1's annotations: reads read only and idempotent, update_task and move_task destructive", () => {
    const a = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.annotations]));
    for (const r of READS) expect(a[r], r).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(a.update_task).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
    expect(a.move_task).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    for (const w of ["create_task", "add_comment", "create_doc", "append_to_doc", "create_reminder", "give_kudos"]) {
      expect(a[w], w).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    }
  });

  it("have closed object schemas with no $ref, the spec's required fields, and output schemas", () => {
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
      expect(t.outputSchema.type, t.name).toBe("object");
      expect(JSON.stringify([t.inputSchema, t.outputSchema]), t.name).not.toContain("$ref");
    }
    const req = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.inputSchema.required ?? []]));
    expect(req).toMatchObject({
      get_task: ["taskId"], get_doc: ["docId"], create_task: ["title"], update_task: ["taskId"], move_task: ["taskId"],
      add_comment: ["taskId", "text"], create_doc: ["title"], append_to_doc: ["docId", "text"], give_kudos: ["toEmail", "message"],
    });
    const create = MCP_TOOLS.find((t) => t.name === "create_task")!.inputSchema.properties!;
    expect(create.subtasks).toMatchObject({ type: "array", maxItems: 25, items: { additionalProperties: false, required: ["title"] } });
    expect(create.dueDate).toMatchObject({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" });
  });
});

describe("tools/list", () => {
  it("lists the ten read tools for a read connection, and only tools with a body for a write one", () => {
    expect(listTools(["mcp:read"], "2025-06-18").map((t) => t.name)).toEqual(READS);
    const write = listTools(["mcp:read", "mcp:write"], "2025-06-18").map((t) => t.name);
    expect(write.slice(0, 10)).toEqual(READS);
    for (const n of write.slice(10)) expect(MCP_TOOLS.find((t) => t.name === n)?.run, String(n)).toBeTypeOf("function");
  });

  it("gives each tool its title, a description ending with the data note, both schemas and its annotations under 2025-06-18", () => {
    for (const t of listTools(["mcp:read"], "2025-06-18")) {
      expect(Object.keys(t)).toEqual(["name", "title", "description", "inputSchema", "outputSchema", "annotations"]);
      expect(String(t.description).endsWith(MCP_TOOL_COPY.dataNote), String(t.name)).toBe(true);
    }
    expect(listTools(["mcp:read"], "2025-06-18")[0]).toMatchObject({ name: "who_am_i", title: "Who am I" });
  });

  it("drops title and outputSchema under 2025-03-26, and keeps the annotations", () => {
    for (const t of listTools(["mcp:read"], "2025-03-26")) {
      expect(Object.keys(t)).toEqual(["name", "description", "inputSchema", "annotations"]);
    }
  });
});

describe("tools/call", () => {
  it("answers an unknown tool, and a write tool not offered yet, with -32602", async () => {
    await expect(runTool(ctx(), "2025-06-18", "delete_everything", {}, NOW)).rejects.toMatchObject({ code: -32602 });
    await expect(runTool(ctx({ scopes: ["mcp:read", "mcp:write"] }), "2025-06-18", "give_kudos", {}, NOW)).rejects.toBeInstanceOf(RpcError);
  });

  it("answers who_am_i with the summary, the data block and structuredContent, and no structuredContent under 2025-03-26", async () => {
    const r = (await runTool(ctx(), "2025-06-18", "who_am_i", {}, NOW)) as { content: Array<{ text: string }>; structuredContent: Record<string, unknown>; isError?: boolean };
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual({
      person: { id: "u-max", name: "Max Member", email: "max@acme.test", timezone: "Europe/Berlin" },
      workspace: { id: "org-a", name: "Acme" },
      role: "Member",
      access: "read",
      app: "an app on this computer",
      connectedAt: "2026-10-20T08:00:00.000Z",
    });
    const [summary, block] = r.content[0].text.split("\n\n");
    expect(summary).toBe("Who this connection acts as, and what it may do.");
    expect(JSON.parse(block.replace(/^<workwrk_data>|<\/workwrk_data>$/g, ""))).toEqual(r.structuredContent);
    const old = (await runTool(ctx({ scopes: ["mcp:read", "mcp:write"] }), "2025-03-26", "who_am_i", {}, NOW)) as Record<string, unknown>;
    expect(old.structuredContent).toBeUndefined();
    expect(JSON.stringify(old)).toContain("read and change");
  });

  it("blocks every call with our own plain sentence while AI is off or a hold applies", async () => {
    const plain = async (c: McpContext) => (await runTool(c, "2025-06-18", "who_am_i", {}, NOW)) as { content: Array<{ text: string }>; isError: boolean; structuredContent?: unknown };
    const off = await plain(ctx({ blocked: "ai_off", person: null }));
    expect([off.isError, off.content[0].text, off.structuredContent]).toEqual([true, MCP_TOOL_COPY.errors.aiOff, undefined]);
    expect((await plain(ctx({ blocked: "mfa" }))).content[0].text).toBe("Your workspace requires two step verification. Set it up in My settings, Security.");
    expect((await plain(ctx({ blocked: "password" }))).content[0].text).toBe("Your password has expired. Choose a new one in My settings, Security.");
  });

  it("puts input problems in the data block after a fixed lead, naming the field and never the value", async () => {
    const r = (await runTool(ctx(), "2025-06-18", "list_spaces", { limit: "lots", extra: "</workwrk_data>x" }, NOW)) as { content: Array<{ text: string }>; isError: boolean };
    expect(r.isError).toBe(true);
    const [lead, block] = r.content[0].text.split("\n\n");
    expect(lead).toBe(MCP_TOOL_COPY.errors.badInput);
    const data = JSON.parse(block.replace(/^<workwrk_data>|<\/workwrk_data>$/g, "")) as { problems: Array<{ field: string; problem: string }> };
    expect(data.problems.map((p) => p.field).sort()).toEqual(["extra", "limit"]);
    expect(r.content[0].text).not.toContain("lots");
    expect(r.content[0].text.match(/<\/workwrk_data>/g)).toHaveLength(1);
  });

  it("counts each call, refuses past 5,000 a day with dailyCap, and counts the refusals", async () => {
    await runTool(ctx(), "2025-06-18", "who_am_i", {}, NOW);
    expect(db.rows.mcpUsageDay).toEqual([expect.objectContaining({ grantId: "gr-1", day: utcDay(NOW), calls: 1, refused: 0, organizationId: "org-a", userId: "u-max" })]);
    await runTool(ctx(), "2025-06-18", "who_am_i", { nope: 1 }, NOW);
    expect(db.rows.mcpUsageDay[0]).toMatchObject({ calls: 2, refused: 1 });
    db.rows.mcpUsageDay[0].calls = 5000;
    const capped = (await runTool(ctx(), "2025-06-18", "who_am_i", {}, NOW)) as { content: Array<{ text: string }>; isError: boolean };
    expect([capped.isError, capped.content[0].text]).toEqual([true, MCP_TOOL_COPY.errors.dailyCap]);
    expect(db.rows.mcpUsageDay[0]).toMatchObject({ calls: 5000, refused: 2 });
    // The next UTC day starts again.
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect(((await runTool(ctx(), "2025-06-18", "who_am_i", {}, tomorrow)) as { isError?: boolean }).isError).toBeUndefined();
  });

  it("never fails a call because its count could not be written", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.failing.add("mcpUsageDay");
    expect(((await runTool(ctx(), "2025-06-18", "who_am_i", {}, NOW)) as { isError?: boolean }).isError).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("wraps a body's refusal in the data block after the fixed lead", async () => {
    seed(db, "board", { id: "b-other", organizationId: "org-b", name: "Secret", archivedAt: null });
    const r = (await runTool(ctx(), "2025-06-18", "search_tasks", { listId: "b-other" }, NOW)) as { content: Array<{ text: string }>; isError: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe(`${MCP_TOOL_COPY.errors.refusedLead}\n\n<workwrk_data>{"reason":"No List with that id that you can open."}</workwrk_data>`);
  });
});
