// Group chats, the server half (src/lib/agents/group-server.ts;
// docs/plans/ai-teammates-phase2.md step 3): a group is its person's own,
// is made of 2 to 5 teammates they may use, at most 20 per person, never
// shrinks below two by a removal, and leaving it cancels what waits in it.
// The database and the teammate lookup are mocked at their boundaries.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  teammates: {} as Record<string, Row>,
  sessions: [] as Row[],
  members: [] as Row[],
  liveCount: 0,
  lines: [] as Row[],
  actionUpdates: [] as Array<{ where: Row; data: Row }>,
  sessionUpdates: [] as Array<{ where: Row; data: Row }>,
  published: [] as Row[],
  findFirstWhere: [] as Row[],
}));

function teammate(slug: string, over: Row = {}): Row {
  return {
    id: `a-${slug}`, organizationId: "org1", slug, name: slug, description: "", systemPrompt: "", modelOverride: null, productSlug: null,
    toolNames: ["search_tasks"], approvalRules: {}, avatar: null, hue: null, visibility: "WORKSPACE", ownerId: null, status: "ENABLED",
    template: null, monthlyQuestionCap: null, autonomousEnabled: false, scheduleCron: null, ...over,
  };
}

vi.mock("@/lib/prisma", () => {
  const tx = {
    chatSession: {
      create: async (a: { data: Row }) => {
        const row = { id: `g${st.sessions.length + 1}`, createdAt: new Date("2026-10-07T10:00:00Z"), lastReadAt: null, archivedAt: null, ...a.data };
        st.sessions.push(row);
        return { id: row.id };
      },
      update: async (a: { where: Row; data: Row }) => {
        st.sessionUpdates.push(a);
        const row = st.sessions.find((r) => r.id === a.where.id);
        if (row) Object.assign(row, a.data);
        return {};
      },
    },
    chatSessionTeammate: {
      createMany: async (a: { data: Row[] }) => {
        st.members.push(...a.data);
        return { count: a.data.length };
      },
      deleteMany: async (a: { where: { sessionId: string; agentId: { in: string[] } } }) => {
        st.members = st.members.filter((m) => !(m.sessionId === a.where.sessionId && a.where.agentId.in.includes(m.agentId as string)));
        return { count: 1 };
      },
    },
    agentAction: {
      updateMany: async (a: { where: Row; data: Row }) => (st.actionUpdates.push(a), { count: 1 }),
    },
  };
  const groupOf = (row: Row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    lastReadAt: row.lastReadAt,
    teammates: st.members
      .filter((m) => m.sessionId === row.id)
      .sort((x, y) => (x.position as number) - (y.position as number))
      .map((m) => ({ position: m.position, agent: Object.values(st.teammates).find((t) => t.id === m.agentId) })),
  });
  return {
    prisma: {
      chatSession: {
        findFirst: async (a: { where: Row }) => {
          st.findFirstWhere.push(a.where);
          const w = a.where;
          const row = st.sessions.find(
            (r) => r.id === w.id && r.organizationId === w.organizationId && r.userId === w.userId && r.kind === w.kind && (r.archivedAt ?? null) === w.archivedAt,
          );
          return row ? groupOf(row) : null;
        },
        count: async () => st.liveCount,
        updateMany: async (a: { where: Row; data: Row }) => {
          st.sessionUpdates.push(a);
          return { count: 1 };
        },
      },
      agentAction: {
        updateMany: async (a: { where: Row; data: Row }) => {
          st.actionUpdates.push(a);
          return { count: 2 };
        },
      },
      // Both forms: a callback, or a list of statements run together (leaveGroup).
      $transaction: async (fn: ((t: typeof tx) => Promise<unknown>) | Promise<unknown>[]) => (Array.isArray(fn) ? Promise.all(fn) : fn(tx)),
    },
  };
});
vi.mock("./teammate-server", () => ({
  TEAMMATE_SELECT: { id: true },
  MESSAGE_SELECT: { id: true },
  SHOWN_MESSAGES: {},
  loadTeammate: async (slug: string) => st.teammates[slug] ?? null,
}));
vi.mock("./actions", () => ({ writeEventLine: async (sessionId: string, line: Row) => void st.lines.push({ sessionId, ...line }) }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: (userId: string, e: Row) => void st.published.push({ userId, ...e }) }));

import { GROUP_LIMITS } from "./group-chat";
import { createGroup, leaveGroup, loadGroup, updateGroup } from "./group-server";
import { GROUP_COPY } from "./teammate-copy";

const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false } as never;
const OLIVIA = { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false } as never;

beforeEach(() => {
  st.teammates = {};
  for (const slug of ["pm", "triage", "cos", "analyst", "ops", "extra"]) st.teammates[slug] = teammate(slug);
  st.sessions = [];
  st.members = [];
  st.liveCount = 0;
  st.lines = [];
  st.actionUpdates = [];
  st.sessionUpdates = [];
  st.published = [];
  st.findFirstWhere = [];
});

describe("createGroup", () => {
  it("makes the person's group with its teammates at positions 0 to n-1, named after them when it has no name", async () => {
    const made = await createGroup(MAX, { name: "", agentSlugs: ["pm", "triage", "cos", "analyst"] });
    expect(made.ok).toBe(true);
    expect(st.sessions[0]).toMatchObject({ organizationId: "org1", userId: "u-max", kind: "TEAMMATE_GROUP", agentId: null, title: "pm, triage and cos" });
    expect(st.members.map((m) => [m.agentId, m.position])).toEqual([["a-pm", 0], ["a-triage", 1], ["a-cos", 2], ["a-analyst", 3]]);
  });

  it("refuses too few, too many and two sharing a name", async () => {
    expect(await createGroup(MAX, { agentSlugs: ["pm"] })).toEqual({ ok: false, status: 400, code: "too_few", error: GROUP_COPY.pickMore });
    expect(await createGroup(MAX, { agentSlugs: ["pm", "pm"] })).toMatchObject({ ok: false, code: "too_few" });
    expect(await createGroup(MAX, { agentSlugs: ["pm", "triage", "cos", "analyst", "ops", "extra"] })).toEqual({ ok: false, status: 400, code: "too_many", error: GROUP_COPY.tooMany });
    st.teammates.ops = teammate("ops", { name: "PM" });
    st.teammates.pm = teammate("pm", { name: "pm" });
    expect(await createGroup(MAX, { agentSlugs: ["pm", "ops"] })).toMatchObject({ ok: false, status: 400, code: "duplicate_name" });
    expect(st.sessions).toEqual([]);
  });

  it("answers a teammate the person cannot use exactly as one that does not exist", async () => {
    const unknown = await createGroup(MAX, { agentSlugs: ["pm", "no-such"] });
    delete st.teammates.triage; // loadTeammate hides another person's private teammate the same way
    const hidden = await createGroup(MAX, { agentSlugs: ["pm", "triage"] });
    expect(unknown).toEqual(hidden);
    expect(unknown).toMatchObject({ ok: false, status: 404, code: "not_found" });
  });

  it("refuses a removed teammate and the 21st group", async () => {
    st.teammates.triage = teammate("triage", { status: "ARCHIVED" });
    expect(await createGroup(MAX, { agentSlugs: ["pm", "triage"] })).toEqual({ ok: false, status: 409, code: "agent_removed", error: GROUP_COPY.removedCantJoin("triage") });
    st.liveCount = GROUP_LIMITS.perPerson;
    expect(await createGroup(MAX, { agentSlugs: ["pm", "cos"] })).toEqual({ ok: false, status: 403, code: "limit", error: GROUP_COPY.limit(20) });
    expect(st.sessions).toEqual([]);
  });
});

describe("loadGroup", () => {
  it("reads only the person's own live group chat", async () => {
    const made = await createGroup(MAX, { name: "Offsite crew", agentSlugs: ["pm", "triage"] });
    if (!made.ok) throw new Error("not made");
    expect(await loadGroup(made.group.id, MAX)).toMatchObject({ id: made.group.id, title: "Offsite crew" });
    expect(await loadGroup(made.group.id, OLIVIA)).toBeNull();
    expect(st.findFirstWhere.at(-1)).toMatchObject({ kind: "TEAMMATE_GROUP", userId: "u-olivia", archivedAt: null });
    st.sessions[0].kind = "TEAMMATE";
    expect(await loadGroup(made.group.id, MAX)).toBeNull();
  });
});

describe("updateGroup", () => {
  async function group(slugs: string[]) {
    const made = await createGroup(MAX, { name: "Crew", agentSlugs: slugs });
    if (!made.ok) throw new Error("not made");
    return made.group;
  }

  it("never removes below two teammates: the person leaves instead", async () => {
    const g = await group(["pm", "triage"]);
    expect(await updateGroup(g, MAX, { remove: ["triage"] })).toEqual({ ok: false, status: 409, code: "min_members", error: GROUP_COPY.minMembers });
    expect(st.members).toHaveLength(2);
  });

  it("adds at the end, removes, renames, and writes a line for each change", async () => {
    const g = await group(["pm", "triage"]);
    const out = await updateGroup(g, MAX, { name: "Launch crew", add: ["cos"], remove: [] });
    expect(out.ok).toBe(true);
    expect(st.members.find((m) => m.agentId === "a-cos")).toMatchObject({ position: 2 });
    expect(st.lines).toEqual([
      { sessionId: g.id, text: "Renamed to Launch crew", event: "group_renamed" },
      { sessionId: g.id, text: "Added cos", event: "group_member_added", agentId: "a-cos" },
    ]);
    const again = await loadGroup(g.id, MAX);
    if (!again) throw new Error("gone");
    await updateGroup(again, MAX, { remove: ["pm"] });
    expect(st.members.map((m) => m.agentId)).toEqual(["a-triage", "a-cos"]);
    expect(st.lines.at(-1)).toEqual({ sessionId: g.id, text: "Removed pm", event: "group_member_removed", agentId: "a-pm" });
    // What it still asked in this group is cancelled with it (review round 1).
    expect(st.actionUpdates.at(-1)).toMatchObject({
      where: { sessionId: g.id, actingForId: "u-max", agentId: { in: ["a-pm"] }, status: "PENDING" },
      data: { status: "CANCELLED", decidedVia: "system", error: GROUP_COPY.cancelledRemoved },
    });
  });

  it("lets the person remove a teammate that was removed from the workspace", async () => {
    const g = await group(["pm", "triage", "cos"]);
    st.teammates.cos.status = "ARCHIVED";
    st.teammates.triage.status = "ARCHIVED";
    const again = await loadGroup(g.id, MAX);
    if (!again) throw new Error("gone");
    expect(await updateGroup(again, MAX, { remove: ["cos"] })).toMatchObject({ ok: true });
  });
});

describe("leaveGroup", () => {
  it("archives it and cancels only what still waits in it, by compare-and-swap", async () => {
    const made = await createGroup(MAX, { agentSlugs: ["pm", "triage"] });
    if (!made.ok) throw new Error("not made");
    const now = new Date("2026-10-07T12:00:00Z");
    await leaveGroup(made.group, MAX, now);
    expect(st.sessionUpdates.at(-1)).toEqual({ where: { id: made.group.id, organizationId: "org1", userId: "u-max", kind: "TEAMMATE_GROUP", archivedAt: null }, data: { archivedAt: now } });
    expect(st.actionUpdates).toEqual([
      { where: { sessionId: made.group.id, actingForId: "u-max", status: "PENDING" }, data: { status: "CANCELLED", decidedVia: "system", decidedAt: now, error: GROUP_COPY.cancelledLeft } },
    ]);
    expect(st.published).toEqual([{ userId: "u-max", type: "agent.changed", agentId: "a-pm", sessionId: made.group.id }]);
  });
});
