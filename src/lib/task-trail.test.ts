import { describe, expect, it, vi } from "vitest";
import { assembleTrail, formatLogged, type TrailCandidate } from "./task-trail";

describe("assembleTrail", () => {
  const c = (kind: TrailCandidate["kind"], id: string, title = `${kind} ${id}`): TrailCandidate => ({ kind, id, title, href: `/${kind}/${id}` });

  it("keeps only what the viewer may open, with no trace of the rest", () => {
    const out = assembleTrail([c("goal", "g1"), c("goal", "g2"), c("doc", "d1")], (kind, id) => !(kind === "goal" && id === "g2"));
    expect(out.map((e) => `${e.kind}:${e.id}`)).toEqual(["goal:g1", "doc:d1"]);
  });

  it("checks an SOP step under its SOP's access, and shows the SOP once, as the step", () => {
    const step = { ...c("sop-step", "s1"), title: "Client onboarding, step 3" };
    expect(assembleTrail([c("sop", "s1"), step], () => true).map((e) => e.kind)).toEqual(["sop-step"]);
    expect(assembleTrail([step], (kind) => kind !== "sop")).toEqual([]);
  });

  it("orders by kind (step, SOP, job title, KRA, KPI, goal, then the rest) and dedupes", () => {
    const out = assembleTrail([c("timer", "t"), c("doc", "d"), c("kpi", "k"), c("kra", "r"), c("goal", "g"), c("doc", "d"), c("job-title", "j")], () => true);
    expect(out.map((e) => e.kind)).toEqual(["job-title", "kra", "kpi", "goal", "doc", "timer"]);
    expect(out.find((e) => e.kind === "job-title")?.label).toBe("Owner by job title");
  });

  it("drops a candidate with no title rather than printing an empty row", () => {
    expect(assembleTrail([{ kind: "doc", id: "d", title: "", href: null }], () => true)).toEqual([]);
  });
});

describe("formatLogged", () => {
  it("reads as the timer reads", () => {
    expect(formatLogged(7_800_000)).toBe("2h 10m");
    expect(formatLogged(3_600_000)).toBe("1h");
    expect(formatLogged(45 * 60_000)).toBe("45m");
    expect(formatLogged(20_000)).toBe("under a minute");
  });
});

// ── the loader: each kind under its own read rule ───────────────────

const links = [
  { sourceType: "BOARD_ITEM", sourceId: "task", targetType: "SOP", targetId: "sop-open", context: "Step 3: Kick off" },
  { sourceType: "BOARD_ITEM", sourceId: "task", targetType: "SOP", targetId: "sop-hidden", context: null },
  { sourceType: "BOARD_ITEM", sourceId: "task", targetType: "DOC", targetId: "doc-open", context: null },
  { sourceType: "BOARD_ITEM", sourceId: "task", targetType: "DOC", targetId: "doc-hidden", context: null },
  { sourceType: "BOARD_ITEM", sourceId: "task", targetType: "CONTRACT", targetId: "agr-1", context: null },
];
type OrgRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
const reader = (orgRole: OrgRole) => ({
  session: { user: { id: "u" } },
  viewer: { userId: "u", organizationId: "org", orgRole, isAgent: false, adminScopes: [] },
  nodeCtx: {} as never,
  fileViewer: { organizationId: "org", userId: "u" },
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entityLink: {
      findMany: async ({ where }: { where: { sourceType?: string } }) => (where.sourceType === "OKR" ? [{ sourceId: "goal-open" }, { sourceId: "goal-hidden" }] : links),
    },
    keyResult: { findMany: async () => [] },
    // The visibility WHERE the SOP rule returns is honoured by the fake: only sop-open passes.
    sOP: { findMany: async ({ where }: { where: { AND: Array<Record<string, unknown>> } }) => (JSON.stringify(where).includes("VISIBLE") ? [{ id: "sop-open", title: "Client onboarding" }] : []) },
    kRA: { findMany: async () => [{ id: "kra-1", name: "Client onboarding runs on time", roleId: "role-1" }] },
    kPI: { findMany: async () => [] },
    oKR: { findMany: async ({ where }: { where: { OR?: unknown } }) => (where.OR ? [{ id: "goal-open", title: "Onboard every client in 10 days", progress: 0 }] : []) },
    role: { findFirst: async () => null },
    doc: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, title: id })) },
    whiteboard: { findMany: async () => [] },
    dataTable: { findMany: async () => [] },
    board: { findMany: async () => [] },
    fileEntry: { findMany: async () => [] },
    user: { findUnique: async () => ({ email: "e@x.com" }) },
    // An employee who is not a party: the party filter is in the where, and the fake finds no row.
    agreement: { findMany: async ({ where }: { where: { parties?: unknown } }) => (where.parties ? [] : [{ id: "agr-1", title: "Services agreement" }]) },
    kudos: { findMany: async () => [] },
    timerSession: { findMany: async () => [{ durationMs: 7_800_000, startedAt: new Date(), stoppedAt: new Date() }] },
  },
}));
vi.mock("@/lib/sop-access", () => ({ sopVisibilityWhere: async () => ({ OR: [{ id: "VISIBLE" }] }) }));
vi.mock("@/lib/goal-audience", () => ({ goalVisibilityOr: async () => [{ level: "COMPANY" }] }));
vi.mock("@/lib/file-access", () => ({ readableFileIds: async () => [] }));
vi.mock("@/lib/access/node-access", () => ({
  idsWithRole: async (_c: unknown, _k: string, ids: string[]) => new Set(ids.filter((id) => !id.endsWith("hidden"))),
}));

describe("loadTaskTrail", () => {
  const task = { id: "task", organizationId: "org", boardId: "b1", metadata: { kraId: "kra-1" }, board: { spaceId: "sp1" } };

  it("a member sees the SOP, KRA, goal, doc and timer they may open, and not the hidden SOP, doc, goal or the contract", async () => {
    const { loadTaskTrail } = await import("./task-trail-server");
    const t = await loadTaskTrail(reader("MEMBER"), task);
    expect(t.entries.map((e) => `${e.kind}:${e.id}`)).toEqual(["sop:sop-open", "kra:kra-1", "goal:goal-open", "doc:doc-open", "timer:task"]);
    expect(t.entries.find((e) => e.kind === "sop")?.detail).toBe("Step 3: Kick off");
    expect(t.entries.find((e) => e.kind === "timer")?.title).toBe("2h 10m");
  });

  it("an admin also sees the contract", async () => {
    const { loadTaskTrail } = await import("./task-trail-server");
    const t = await loadTaskTrail(reader("ADMIN"), task);
    expect(t.entries.some((e) => e.kind === "contract" && e.id === "agr-1")).toBe(true);
  });

  it("a guest gets no KRA or KPI definitions", async () => {
    const { loadTaskTrail } = await import("./task-trail-server");
    const t = await loadTaskTrail(reader("GUEST"), task);
    expect(t.entries.some((e) => e.kind === "kra")).toBe(false);
  });
});
