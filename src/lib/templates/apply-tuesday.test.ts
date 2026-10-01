// The Tuesday template at signup: what it makes, that it is applied once and
// only to a brand new workspace, and that a failure part way is finished by
// Try again without doubling a piece. The database is an in-memory fake; the
// Space, List, doc and task creators are mocked to record what was asked.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const db: Record<string, Row[]> = {};
let seq = 0;
const nid = (p: string) => `${p}_${++seq}`;
let settings: Record<string, unknown> = {};
let orgCreatedAt = new Date();
let failOn: string | null = null;

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const o = v as { equals?: unknown; mode?: string; in?: unknown[] };
      if ("equals" in o) return String(row[k]).toLowerCase() === String(o.equals).toLowerCase();
      if ("in" in o) return (o.in ?? []).includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function table(name: string) {
  db[name] ??= [];
  return {
    findFirst: async ({ where }: { where?: Record<string, unknown> }) => db[name].find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => db[name].filter((r) => matches(r, where)),
    count: async ({ where }: { where?: Record<string, unknown> } = {}) => db[name].filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (failOn === name) throw new Error(`boom in ${name}`);
      const row = { id: nid(name), ...data } as Row;
      db[name].push(row);
      return row;
    },
    upsert: async ({ where, create }: { where: Record<string, Record<string, unknown>>; create: Record<string, unknown> }) => {
      const key = Object.values(where)[0];
      const found = db[name].find((r) => Object.entries(key).every(([k, v]) => r[k] === v));
      if (found) return found;
      const row = { id: nid(name), ...create } as Row;
      db[name].push(row);
      return row;
    },
    updateMany: async () => ({ count: 0 }),
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {
      organization: { findUnique: async () => ({ createdAt: orgCreatedAt, settings }) },
      // The conditional marker claims (apply-tuesday.ts claimMarker).
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        const next = JSON.parse(String(values[0])) as { signupTemplate: Record<string, unknown> };
        const cur = settings.signupTemplate as { status?: string; startedAt?: string } | undefined;
        if (sql.includes("? 'signupTemplate'")) {
          if (cur) return 0;
        } else if (sql.includes("= 'failed'")) {
          if (cur?.status !== "failed") return 0;
        } else if (sql.includes("= 'applying'")) {
          if (cur?.status !== "applying" || !(String(cur.startedAt) < String(values[3]))) return 0;
        }
        settings = { ...settings, ...next };
        return 1;
      },
    } as Record<string, unknown>,
    { get: (t, p: string) => (p in t ? t[p] : table(p)) },
  ),
}));
vi.mock("@/lib/org-settings-write", () => ({
  writeOrgSettingsKeys: async (_org: string, patch: Record<string, unknown>) => { settings = { ...settings, ...patch }; return true; },
}));
vi.mock("@/lib/alignment-assign", () => ({ seedKraToRoleHolders: async () => ({ peopleSeeded: 0 }) }));
let sopCapReached = false;
vi.mock("@/lib/plan-limits", () => ({
  checkPlanLimit: async () => (sopCapReached ? { allowed: false, message: "You've reached your plan limit of 20 SOPs.", limit: 20, current: 20 } : { allowed: true }),
}));
vi.mock("@/lib/template-center", () => ({
  applySpaceTemplate: async (_p: unknown, ctx: { name: string; organizationId: string }) => {
    const row = { id: nid("space"), slug: "operations", name: ctx.name, organizationId: ctx.organizationId, archivedAt: null };
    (db.space ??= []).push(row);
    return { spaceId: row.id, slug: row.slug };
  },
  applyListTemplate: async (_p: unknown, ctx: { spaceId: string; name: string; organizationId: string }) => {
    const row = { id: nid("board"), slug: "onboarding", name: ctx.name, spaceId: ctx.spaceId, organizationId: ctx.organizationId, archivedAt: null };
    (db.board ??= []).push(row);
    return { boardId: row.id, slug: row.slug };
  },
  applyDocTemplate: async (p: { content?: { blocks?: Array<{ text?: string }> } }, ctx: { spaceId: string; name: string; organizationId: string }) => {
    if (failOn === "doc") throw new Error("boom in doc");
    const text = (p?.content?.blocks ?? []).map((b) => b.text ?? "").join("\n");
    const row = { id: nid("doc"), title: ctx.name, entityType: "SPACE", entityId: ctx.spaceId, organizationId: ctx.organizationId, text };
    (db.doc ??= []).push(row);
    return { docId: row.id };
  },
}));
vi.mock("@/lib/board-items", () => ({
  createBoardItem: async (input: { boardId: string; title: string; organizationId: string; metadata?: Record<string, unknown> }) => {
    const row = { id: nid("item"), boardId: input.boardId, title: input.title, organizationId: input.organizationId, metadata: input.metadata ?? {} };
    (db.item ??= []).push(row);
    return row;
  },
}));

import { applySignupTemplate, applyTuesdayBundle, retrySignupTemplate, readSignupMarker } from "./apply-tuesday";
import { TUESDAY_TEMPLATE_KEY, signupTemplateKey, tuesdayPayload } from "./tuesday-template";

const ORG = "org_1";
const USER = "user_1";

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  seq = 0;
  settings = {};
  orgCreatedAt = new Date();
  failOn = null;
  sopCapReached = false;
  db.user = [{ id: USER, organizationId: ORG }];
  db.department = [{ id: "dept_ops", name: "Operations", organizationId: ORG }, { id: "dept_fin", name: "Finance", organizationId: ORG }];
});

const count = (t: string) => (db[t] ?? []).length;

describe("signupTemplateKey", () => {
  it("accepts only the allowlisted value, whatever its case", () => {
    expect(signupTemplateKey("tuesday")).toBe(TUESDAY_TEMPLATE_KEY);
    expect(signupTemplateKey(" Tuesday ")).toBe(TUESDAY_TEMPLATE_KEY);
    expect(signupTemplateKey("wednesday")).toBeNull();
    expect(signupTemplateKey("__proto__")).toBeNull();
    expect(signupTemplateKey(undefined)).toBeNull();
  });
});

describe("the Tuesday payload", () => {
  it("is built from the site's fixture and seeds no invented person", () => {
    const p = tuesdayPayload();
    expect(p.lists[0].name).toBe("Onboarding");
    expect(p.bundle.jobTitles.map((j) => j.title)).toEqual(["Onboarding lead", "Finance"]);
    expect(p.bundle.sop.steps).toHaveLength(7);
    expect(p.bundle.sop.steps.filter((s) => s.createsTask).map((s) => s.title)).toEqual(["Kick off internal onboarding"]);
    const text = JSON.stringify(p);
    for (const name of ["Maya", "Sam ", "Priya", "Bluefin", "Harbour", "Quayside", "Lowtide", "Northwind"]) expect(text).not.toContain(name);
    expect(p.bundle.sampleTask.title.startsWith("Sample:")).toBe(true);
  });
});

describe("applySignupTemplate", () => {
  it("makes the Space, List, job titles, KRA, KPI, published step-by-step SOP, goal, doc and sample task, and records it", async () => {
    const m = await applySignupTemplate({ organizationId: ORG, userId: USER, key: TUESDAY_TEMPLATE_KEY });
    expect(m?.status).toBe("applied");
    expect([count("space"), count("board"), count("role"), count("kRA"), count("kPI"), count("sOP"), count("oKR"), count("doc"), count("item")]).toEqual([1, 1, 2, 1, 1, 1, 1, 1, 1]);
    const sop = db.sOP[0] as unknown as { status: string; sopType: string; content: { type: string; steps: Array<{ jobTitle?: { roleId: string }; createsTask?: boolean }>; spawn: { boardId: string } }; kraId: string };
    expect(sop.status).toBe("PUBLISHED");
    expect(sop.sopType).toBe("WRITTEN");
    expect(sop.content.type).toBe("steps");
    expect(sop.content.spawn.boardId).toBe(db.board[0].id);
    const lead = db.role.find((r) => r.title === "Onboarding lead")!;
    expect(sop.content.steps[2]).toMatchObject({ createsTask: true, jobTitle: { roleId: lead.id } });
    expect(db.role.find((r) => r.title === "Finance")?.departmentId).toBe("dept_fin");
    expect(db.kRA[0].roleId).toBe(lead.id);
    expect(db.kPI[0]).toMatchObject({ kraId: db.kRA[0].id, lowerIsBetter: true, direction: "LOWER" });
    expect(db.oKR[0]).toMatchObject({ level: "COMPANY", ownerId: USER });
    const links = db.entityLink.map((l) => `${l.sourceType}>${l.targetType}`).sort();
    expect(links).toEqual(["BOARD_ITEM>DOC", "BOARD_ITEM>SOP", "OKR>BOARD", "OKR>KRA", "SPACE>KRA"]);
    expect((db.item[0].metadata as { kraId?: string }).kraId).toBe(db.kRA[0].id);
    expect(readSignupMarker(settings)).toMatchObject({ status: "applied", spaceId: db.space[0].id, sopId: db.sOP[0].id });
  });

  it("is applied once: a second call makes nothing", async () => {
    await applySignupTemplate({ organizationId: ORG, userId: USER, key: TUESDAY_TEMPLATE_KEY });
    const again = await applySignupTemplate({ organizationId: ORG, userId: USER, key: TUESDAY_TEMPLATE_KEY });
    expect(again).toBeNull();
    expect([count("space"), count("sOP"), count("oKR"), count("item")]).toEqual([1, 1, 1, 1]);
  });

  it("never applies to a workspace that is not brand new", async () => {
    db.user.push({ id: "user_2", organizationId: ORG });
    expect(await applySignupTemplate({ organizationId: ORG, userId: USER, key: TUESDAY_TEMPLATE_KEY })).toBeNull();
    db.user.pop();
    orgCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(await applySignupTemplate({ organizationId: ORG, userId: USER, key: TUESDAY_TEMPLATE_KEY })).toBeNull();
    expect(count("space")).toBe(0);
    expect(settings.signupTemplate).toBeUndefined();
  });

  it("ignores a key it does not know", async () => {
    expect(await applySignupTemplate({ organizationId: ORG, userId: USER, key: "space.something-else" })).toBeNull();
    expect(settings.signupTemplate).toBeUndefined();
  });

  it("records a failure part way, and Try again finishes in the same Space without doubling anything", async () => {
    failOn = "doc";
    const first = await applySignupTemplate({ organizationId: ORG, userId: USER, key: TUESDAY_TEMPLATE_KEY });
    expect(first?.status).toBe("failed");
    expect(readSignupMarker(settings)).toMatchObject({ status: "failed", spaceId: db.space[0].id });
    failOn = null;
    const retried = await retrySignupTemplate({ organizationId: ORG, userId: USER });
    expect(retried?.status).toBe("applied");
    expect([count("space"), count("board"), count("role"), count("kRA"), count("kPI"), count("sOP"), count("oKR"), count("doc"), count("item")]).toEqual([1, 1, 2, 1, 1, 1, 1, 1, 1]);
    // Nothing left to retry once applied.
    expect(await retrySignupTemplate({ organizationId: ORG, userId: USER })).toBeNull();
  });

  it("does not let a retry run while a fresh apply is still in flight", async () => {
    settings = { signupTemplate: { key: TUESDAY_TEMPLATE_KEY, status: "applying", startedAt: new Date().toISOString(), spaceId: null } };
    expect(await retrySignupTemplate({ organizationId: ORG, userId: USER })).toBeNull();
    expect(count("space")).toBe(0);
  });
});

describe("applyTuesdayBundle from the Template Center", () => {
  it("gives a manager the Space, List, doc and sample task only (no job titles, KRA, KPI, SOP or goal)", async () => {
    const res = await applyTuesdayBundle(tuesdayPayload(), { organizationId: ORG, userId: USER, name: "Client onboarding", governance: false });
    expect(res.governance).toBe(false);
    expect([count("space"), count("board"), count("doc"), count("item")]).toEqual([1, 1, 1, 1]);
    expect([count("role"), count("kRA"), count("kPI"), count("sOP"), count("oKR")]).toEqual([0, 0, 0, 0, 0]);
    // The doc never points at the SOP, KRA, KPI or goal this apply did not make.
    const text = String(db.doc[0].text);
    expect(text).not.toContain("choose Run steps");
    expect(text).not.toContain("KPI sit on");
    expect(text).toContain("When a workspace admin applies this template");
  });

  it("an admin apply's doc describes the SOP, KRA, KPI and goal it made", async () => {
    await applyTuesdayBundle(tuesdayPayload(), { organizationId: ORG, userId: USER, name: "Operations", governance: true });
    const text = String(db.doc[0].text);
    expect(text).toContain("choose Run steps");
    expect(text).toContain("KPI sit on");
    expect(text).not.toContain("When a workspace admin applies this template");
  });

  it("a second admin apply reuses the workspace's job titles, KRA, KPI, SOP and goal", async () => {
    await applyTuesdayBundle(tuesdayPayload(), { organizationId: ORG, userId: USER, name: "Operations", governance: true });
    await applyTuesdayBundle(tuesdayPayload(), { organizationId: ORG, userId: USER, name: "Operations 2", governance: true });
    expect(count("space")).toBe(2);
    expect([count("role"), count("kRA"), count("kPI"), count("sOP"), count("oKR")]).toEqual([2, 1, 1, 1, 1]);
  });

  it("respects the plan's SOP cap: the SOP is left out and the result says why", async () => {
    sopCapReached = true;
    const res = await applyTuesdayBundle(tuesdayPayload(), { organizationId: ORG, userId: USER, name: "Operations", governance: true });
    expect(count("sOP")).toBe(0);
    expect(res.sopId).toBeNull();
    expect(res.skipped[0]).toContain("plan limit");
    expect(db.entityLink.some((l) => l.targetType === "SOP")).toBe(false);
    expect(String(db.doc[0].text)).toContain("The Client onboarding SOP was not added");
    expect(String(db.doc[0].text)).not.toContain("choose Run steps");
  });
});
