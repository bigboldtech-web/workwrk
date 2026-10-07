// GET /api/agents/actions/[id] (docs/plans/ai-teammates.md 4): the Inbox's
// approval pane reads one request together with every request its run asked
// of the same person, in the order asked, and anyone else's id answers the
// same 404 as a missing one, an Admin's attempt included. The queue is the
// real actions.ts over the shared queue double (test-fixtures.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/agents/test-fixtures")).prismaFake }));
vi.mock("@/lib/agents/acting", async () => (await import("@/lib/agents/test-fixtures")).actingFake);
vi.mock("@/lib/agents/previews", async () => ({ prepareCall: (await import("@/lib/agents/test-fixtures")).fakePrepareCall }));
vi.mock("@/lib/agents/tools", async () => ({ TOOLS: (await import("@/lib/agents/test-fixtures")).fakeTools() }));
vi.mock("@/lib/activity", async () => ({ logActivity: (await import("@/lib/agents/test-fixtures")).fakeLogActivity }));
vi.mock("@/lib/entitlements", async () => ({ isModuleActive: (await import("@/lib/agents/test-fixtures")).fakeIsModuleActive }));

const gate = vi.hoisted(() => ({ viewer: null as unknown }));
vi.mock("@/lib/app-gate", () => ({ requireApp: async () => ({ viewer: gate.viewer }), isOwnerOrAdmin: () => false }));

import { GET } from "./route";
import { AGENT_SLUG, VIEWER, resetFixtures, seedAction } from "@/lib/agents/test-fixtures";

async function read(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new Request(`http://x/api/agents/actions/${id}`), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const ids = (list: unknown) => (list as Array<{ id: string }>).map((a) => a.id);

beforeEach(() => {
  resetFixtures();
  gate.viewer = VIEWER;
});

describe("GET /api/agents/actions/[id]", () => {
  it("reads the request with every request its run asked of this person, in the order asked", async () => {
    const first = seedAction({ toolName: "post_in_talk", preview: { title: "Post in #general" } });
    const second = seedAction({ toolName: "comment_on_task", preview: { title: "Comment on Call Acme" } });
    seedAction({ toolName: "post_in_talk", runId: "run2", preview: { title: "Post in #random" } });
    seedAction({ toolName: "post_in_talk", actingForId: "u-max", preview: { title: "Post in #max" } });

    for (const id of [first.id, second.id]) {
      const { status, body } = await read(id);
      expect(status).toBe(200);
      expect((body.action as { id: string }).id).toBe(id);
      expect(ids(body.actions)).toEqual([first.id, second.id]);
      expect(body.agent).toMatchObject({ slug: AGENT_SLUG, name: "Chief of Staff" });
    }
  });

  it("reads a request no run asked as itself alone", async () => {
    const lone = seedAction({ toolName: "post_in_talk", runId: null });
    seedAction({ toolName: "post_in_talk", runId: null });
    const { status, body } = await read(lone.id);
    expect(status).toBe(200);
    expect(ids(body.actions)).toEqual([lone.id]);
  });

  it("shows a request decided since as decided, beside the ones still waiting", async () => {
    const done = seedAction({ toolName: "post_in_talk", status: "DENIED", decidedVia: "person", decidedAt: new Date() });
    const open = seedAction({ toolName: "comment_on_task" });
    const { body } = await read(done.id);
    expect((body.actions as Array<{ id: string; status: string }>).map((a) => [a.id, a.status])).toEqual([
      [done.id, "DENIED"],
      [open.id, "PENDING"],
    ]);
  });

  it("answers another person's request exactly like a missing one, an Admin's attempt included", async () => {
    const max = seedAction({ toolName: "post_in_talk", actingForId: "u-max" });
    for (const viewer of [VIEWER, { ...VIEWER, userId: "u-admin", orgRole: "ADMIN" }, { ...VIEWER, userId: "u-owner", orgRole: "OWNER" }]) {
      gate.viewer = viewer;
      const other = await read(max.id);
      const missing = await read("no-such-request");
      expect(other.status).toBe(404);
      expect(other.body).toEqual(missing.body);
      expect(other.body).toMatchObject({ code: "not_found" });
    }
  });
});
