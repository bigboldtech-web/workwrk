// The routes' own teammate-step rules (docs/plans/ai-teammates-phase2.md
// step 7 and review rounds 3 and 4): an AI teammate step works as the
// automation's creator, so anyone else's save, publish or turn-on that would
// add, change, keep live or take out such a step is refused, and publish
// checks the row again under its lock. teammateStepProblem runs for real;
// the database, the gate and the places are stand-ins (review round 6: only
// the helper was tested, so deleting a route's call passed every test).

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  ctx: null as Row | null,
  wf: null as Row | null,
  /** What the row reads under publish's lock, when it changed in between. */
  wfUnderLock: null as Row | null,
  live: null as Row | null,
  updates: [] as Row[],
  versions: [] as Row[],
  /** How the creator resolves now: acted for, or refused (gone, inactive, guest, ai_off). */
  creator: { ok: true } as { ok: true } | { ok: false; reason: string },
}));

const STEP = { key: "ask_teammate", params: { teammate: "t-triage", request: "Summarise [title]" } };
const COMMENT = { key: "add_comment", params: { body: "Thanks" } };

vi.mock("@/lib/automation/gate", () => ({
  requireAutomation: async () => st.ctx,
  refuseWorkflowWrite: async () => null,
  triggerProblem: async () => null,
  workflowRights: () => ({ edit: true, archive: true }),
}));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: async () => (st.creator.ok ? { ok: true, person: { userId: "u-max" } } : st.creator) }));
vi.mock("@/lib/agents/teammate-server", () => ({ loadTeammate: async (slug: string) => (slug === "t-triage" ? { id: "a1", slug } : null) }));
vi.mock("@/lib/automation/definition-view", () => ({
  definitionForViewer: async (_v: unknown, definition: unknown) => ({ definition, scopeHidden: false, scopeKept: [] }),
  workflowForViewer: async (_v: unknown, wf: unknown) => wf,
  versionForViewer: async (_v: unknown, v: unknown) => v,
}));
vi.mock("@/lib/automation/versions-server", () => ({ listVersions: async () => [] }));
vi.mock("@/lib/automation/places-server", () => ({
  definitionWithScopeInOrg: async (_org: string, d: unknown) => d,
  scopeNamer: async () => () => null,
  scopeReadable: async () => new Set<string>(),
  livePlaces: async () => new Set<string>(),
}));
vi.mock("@/lib/automation/engine", () => ({
  parseDefinition: (d: { conditions?: unknown; actions?: Array<{ key: string; params?: Row }> } | null) => ({
    conditions: d?.conditions ?? null,
    actions: (d?.actions ?? []).map((a) => ({ key: a.key, name: a.key, params: a.params ?? {} })),
  }),
}));
vi.mock("@/lib/automation/registry-actions", () => ({ getAction: (key: string) => ({ key, name: key, available: true }) }));
vi.mock("@/lib/automation/registry-triggers", () => ({ getTrigger: () => ({ key: "task.created" }) }));
vi.mock("@/lib/prisma", () => {
  const workflow = {
    findFirst: async () => (st.wf ? { ...st.wf } : null),
    findUnique: async () => (st.wf ? { ...st.wf } : null),
    update: async (a: { data: Row }) => {
      st.updates.push(a.data);
      return { ...st.wf, ...a.data };
    },
  };
  const tx = {
    $queryRaw: async () => [],
    automationWorkflow: {
      ...workflow,
      // The row as it is under the lock: a save that landed in between shows here.
      findFirst: async () => (st.wfUnderLock ?? st.wf ? { ...(st.wfUnderLock ?? st.wf) } : null),
      findUnique: async () => (st.wfUnderLock ?? st.wf ? { ...(st.wfUnderLock ?? st.wf) } : null),
    },
    automationWorkflowVersion: {
      aggregate: async () => ({ _max: { versionNumber: 1 } }),
      create: async (a: { data: Row }) => {
        st.versions.push(a.data);
        return { id: "v2", ...a.data };
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  return {
    prisma: {
      automationWorkflow: workflow,
      automationWorkflowVersion: { findFirst: async () => st.live },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { PUT } from "./route";
import { POST as publish } from "./publish/route";
import { POST as activate } from "./activate/route";
import { POST as restore } from "./versions/[n]/restore/route";

const params = { params: Promise.resolve({ id: "wf1" }) };
const put = (body: Row) => PUT(new Request("https://app.example.test/api/automation/workflows/wf1", { method: "PUT", body: JSON.stringify(body) }) as never, params);
const as = (userId: string) => {
  st.ctx = { userId, orgId: "org1", canCreate: true, canManage: true, isAdmin: false, viewer: { userId, organizationId: "org1" } };
};
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Row });

beforeEach(() => {
  st.updates = [];
  st.versions = [];
  st.wfUnderLock = null;
  st.live = null;
  st.creator = { ok: true };
  // Max made it; its draft asks Triage.
  st.wf = { id: "wf1", status: "PAUSED", publishedVersionId: null, triggerEvent: "task.created", definition: { trigger: "task.created", conditions: null, actions: [COMMENT, STEP] }, name: "Support triage", description: null, severity: "MINOR", createdById: "u-max" };
});

describe("saving (PUT)", () => {
  it("refuses anyone but the creator taking the teammate step out (review round 3)", async () => {
    as("u-mia");
    const out = await read(await put({ definition: { trigger: "task.created", actions: [COMMENT], everywhere: true } }));
    expect(out).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    expect(st.updates).toEqual([]);
  });

  it("refuses anyone but the creator changing only what starts it", async () => {
    as("u-mia");
    const out = await read(await put({ triggerEvent: "task.updated" }));
    expect(out).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    expect(st.updates).toEqual([]);
  });

  it("lets the creator save it, and anyone save an automation with no teammate step", async () => {
    as("u-max");
    expect((await put({ definition: { trigger: "task.created", actions: [COMMENT, STEP], everywhere: true } })).status).toBe(200);
    st.wf = { ...st.wf, definition: { trigger: "task.created", conditions: null, actions: [COMMENT] } };
    as("u-mia");
    expect((await put({ definition: { trigger: "task.created", actions: [COMMENT], everywhere: true } })).status).toBe(200);
    expect(st.updates).toHaveLength(2);
  });
});

describe("a teammate step the creator saved while someone else saved or restored (review round 9)", () => {
  it("is checked again under the lock: someone else never takes it out", async () => {
    as("u-mia");
    // Mia's draft (and the row she read) had no step; Max saved one meanwhile.
    st.wf = { ...st.wf, definition: { trigger: "task.created", conditions: null, actions: [COMMENT] } };
    st.wfUnderLock = { ...st.wf, definition: { trigger: "task.created", conditions: null, actions: [COMMENT, STEP] } };
    expect(await read(await put({ definition: { trigger: "task.created", actions: [COMMENT], everywhere: true } }))).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    expect(st.updates).toEqual([]);
    st.live = { definitionJson: { actions: [COMMENT] } };
    const res = await restore(new Request("https://x.test", { method: "POST" }) as never, { params: Promise.resolve({ id: "wf1", n: "1" }) });
    expect(await read(res)).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
  });
});

describe("publishing", () => {
  it("refuses anyone but the creator publishing a teammate step, or publishing one away (review round 3)", async () => {
    as("u-mia");
    expect(await read(await publish(new Request("https://x.test") as never, params))).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    // The draft has no step, but the live version does.
    st.wf = { ...st.wf, publishedVersionId: "v1", definition: { trigger: "task.created", conditions: null, actions: [COMMENT] } };
    st.live = { definitionJson: { actions: [COMMENT, STEP] } };
    expect(await read(await publish(new Request("https://x.test") as never, params))).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    expect(st.versions).toEqual([]);
  });

  it("sends a publish back when the row changed between its checks and its lock (review round 4)", async () => {
    as("u-mia");
    st.wf = { ...st.wf, definition: { trigger: "task.created", conditions: null, actions: [COMMENT] } };
    // Max added a teammate step in between.
    st.wfUnderLock = { ...st.wf, definition: { trigger: "task.created", conditions: null, actions: [COMMENT, STEP] } };
    expect(await read(await publish(new Request("https://x.test") as never, params))).toMatchObject({ status: 409, body: { code: "changed" } });
    expect(st.versions).toEqual([]);
  });

  it("publishes the creator's teammate step, with the teammate as it is now (review round 9)", async () => {
    as("u-max");
    expect((await publish(new Request("https://x.test") as never, params)).status).toBe(200);
    expect(st.versions).toHaveLength(1);
    const prints = (st.versions[0].definitionJson as { __teammates?: Record<string, string> }).__teammates;
    expect(Object.keys(prints ?? {})).toEqual(["t-triage"]);
    expect(prints?.["t-triage"]).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("turning it back on", () => {
  it("is the creator's alone while the live version has a teammate step; pausing stays open", async () => {
    st.wf = { ...st.wf, publishedVersionId: "v1" };
    st.live = { definitionJson: { actions: [STEP] } };
    as("u-mia");
    expect(await read(await activate(new Request("https://x.test") as never, params))).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    expect(st.updates).toEqual([]);
    as("u-max");
    expect((await activate(new Request("https://x.test") as never, params)).status).toBe(200);
    expect(st.updates).toEqual([expect.objectContaining({ status: "ACTIVE" })]);
  });
});

describe("restoring an older version", () => {
  const restoreParams = { params: Promise.resolve({ id: "wf1", n: "1" }) };
  it("is the creator's alone when the draft or the version has a teammate step", async () => {
    as("u-mia");
    // The draft has the step: restoring any version would take it out.
    st.live = { definitionJson: { actions: [COMMENT] } };
    expect(await read(await restore(new Request("https://x.test", { method: "POST" }) as never, restoreParams))).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    // The version has one: restoring it would put an older request in its place.
    st.wf = { ...st.wf, definition: { trigger: "task.created", conditions: null, actions: [COMMENT] } };
    st.live = { definitionJson: { actions: [COMMENT, STEP] } };
    expect(await read(await restore(new Request("https://x.test", { method: "POST" }) as never, restoreParams))).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
    expect(st.updates).toEqual([]);
  });
});

describe("when its creator can no longer be acted for (review round 7)", () => {
  it("lets anyone who may edit it take the teammate step out, save and publish, and nothing more", async () => {
    st.creator = { ok: false, reason: "inactive" };
    as("u-olivia");
    // Keeping the step (changing anything else) is still refused: it works as Max.
    expect(await read(await put({ definition: { trigger: "task.updated", actions: [COMMENT, STEP], everywhere: true } }))).toMatchObject({ status: 403 });
    // Taking it out is allowed.
    expect((await put({ definition: { trigger: "task.created", actions: [COMMENT], everywhere: true } })).status).toBe(200);
    // Publishing a draft without it over a live version with it is allowed too.
    st.wf = { ...st.wf, publishedVersionId: "v1", definition: { trigger: "task.created", conditions: null, actions: [COMMENT] } };
    st.live = { definitionJson: { actions: [COMMENT, STEP] } };
    expect((await publish(new Request("https://x.test") as never, params)).status).toBe(200);
  });

  it("keeps the lock while AI is only turned off: it can come back on", async () => {
    st.creator = { ok: false, reason: "ai_off" };
    as("u-olivia");
    expect(await read(await put({ definition: { trigger: "task.created", actions: [COMMENT], everywhere: true } }))).toMatchObject({ status: 403 });
  });

  it("never lets anyone else restore a version with a teammate step into the draft", async () => {
    st.creator = { ok: false, reason: "gone" };
    as("u-olivia");
    st.wf = { ...st.wf, definition: { trigger: "task.created", conditions: null, actions: [COMMENT] } };
    st.live = { definitionJson: { actions: [COMMENT, STEP] } };
    const res = await restore(new Request("https://x.test", { method: "POST" }) as never, { params: Promise.resolve({ id: "wf1", n: "1" }) });
    expect(await read(res)).toMatchObject({ status: 403, body: { code: "teammate_step_creator_only" } });
  });
});
