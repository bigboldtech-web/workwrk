import { describe, expect, it, vi } from "vitest";
import { assembleTrail, formatLogged, ownerNoticeFor, type TrailCandidate } from "./task-trail";

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
    sOP: {
      findMany: async ({ where }: { where: { AND: Array<Record<string, unknown>> } }) => (JSON.stringify(where).includes("VISIBLE") ? [{ id: "sop-open", title: "Client onboarding" }] : []),
      // The SOP's own content, which the trail checks a stored step against.
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === "sop-open"
          ? { content: { type: "steps", steps: [{ id: "s1", title: "Sign the contract" }, { id: "s2", title: "Collect the intake form" }, { id: "s3", title: "Kick off the project", createsTask: true, jobTitle: { roleId: "role-lead", title: "Onboarding lead" } }] } }
          : null,
    },
    kRA: { findMany: async () => [{ id: "kra-1", name: "Client onboarding runs on time", roleId: "role-1" }] },
    kPI: { findMany: async () => [] },
    oKR: { findMany: async ({ where }: { where: { OR?: unknown } }) => (where.OR ? [{ id: "goal-open", title: "Onboard every client in 10 days", progress: 0 }] : []) },
    role: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === "role-lead" ? { id: "role-lead", title: "Onboarding lead" } : null) },
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
  const task = { id: "task", organizationId: "org", boardId: "b1", metadata: { kraId: "kra-1" } as Record<string, unknown>, assigneeIds: [] as string[], ownerId: null as string | null, board: { spaceId: "sp1" } };
  const spawned = (over: Record<string, unknown> = {}, onTask: Partial<typeof task> = {}) => ({
    ...task,
    ...onTask,
    metadata: {
      kraId: "kra-1",
      sopStep: { sopId: "sop-open", sopTitle: "Client onboarding", stepId: "s3", n: 3, stepTitle: "Kick off the project", runId: "run_12345678", jobTitle: { roleId: "role-lead", title: "Onboarding lead" }, assignedBy: "none", reason: "nobody", notice: "Nobody holds the Onboarding lead job title yet.", ...over },
    },
  });

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

  it("shows an SOP step from the SOP's own content, not from what the task stores", async () => {
    const { loadTaskTrail } = await import("./task-trail-server");
    const t = await loadTaskTrail(reader("MEMBER"), spawned({ n: 9, stepTitle: "FORGED step text" }));
    const step = t.entries.find((e) => e.kind === "sop-step");
    expect(step?.title).toBe("Client onboarding, step 3");
    expect(step?.detail).toBe("Kick off the project");
  });

  it("drops a stored step that is not a step of that SOP", async () => {
    const { loadTaskTrail } = await import("./task-trail-server");
    const t = await loadTaskTrail(reader("MEMBER"), spawned({ stepId: "made-up" }));
    expect(t.entries.some((e) => e.kind === "sop-step")).toBe(false);
    expect(t.ownerNotice).toBeNull();
  });

  it("words the unassigned notice from current facts and drops it once someone is assigned", async () => {
    const { loadTaskTrail } = await import("./task-trail-server");
    const open = await loadTaskTrail(reader("MEMBER"), spawned({ notice: "FORGED notice" }));
    expect(open.ownerNotice).toBe("Nobody held the Onboarding lead job title when this SOP ran, so this task is unassigned. Anyone who can edit the task can assign it.");
    const admin = await loadTaskTrail(reader("ADMIN"), spawned());
    expect(admin.ownerNotice).toContain("Give someone the title in People");
    const assigned = await loadTaskTrail(reader("MEMBER"), spawned({}, { assigneeIds: ["gus"], ownerId: "gus" }));
    expect(assigned.ownerNotice).toBeNull();
    const guest = await loadTaskTrail(reader("GUEST"), spawned());
    expect(guest.ownerNotice).toBeNull();
  });

  it("says a task was assigned by the job title only while that person is still on it", async () => {
    const { loadTaskTrail } = await import("./task-trail-server");
    const picked = { assignedBy: "job-title", assigneeId: "amy", reason: null, notice: null };
    const kept = await loadTaskTrail(reader("MEMBER"), spawned(picked, { assigneeIds: ["amy"], ownerId: "amy" }));
    expect(kept.entries.find((e) => e.kind === "job-title")?.detail).toBe("Assigned by the soonest available holder");
    const moved = await loadTaskTrail(reader("MEMBER"), spawned(picked, { assigneeIds: ["bob"], ownerId: "bob" }));
    expect(moved.entries.find((e) => e.kind === "job-title")?.detail ?? null).toBeNull();
  });
});

describe("ownerNoticeFor", () => {
  const none = { assignedBy: "none" as const, reason: null, notice: null };
  it("is null for a task the rule assigned, or one with anyone on it", () => {
    expect(ownerNoticeFor({ ...none, assignedBy: "job-title" }, "Finance", { assigneeIds: [], ownerId: null }, false)).toBeNull();
    expect(ownerNoticeFor(none, "Finance", { assigneeIds: ["x"], ownerId: "x" }, false)).toBeNull();
    expect(ownerNoticeFor(null, "Finance", { assigneeIds: [], ownerId: null }, false)).toBeNull();
  });
  it("tells an away-holder case apart, reading an older stored notice when there is no reason", () => {
    const away = ownerNoticeFor({ ...none, notice: "The one person who holds the Finance job title is away with no return date, so this task is unassigned." }, "Finance", { assigneeIds: [], ownerId: null }, true);
    expect(away).toContain("was away with no return date");
    expect(away).toContain("Give someone the title in People");
  });
});
