// Repeating goals, step 5: numbers from a table (docs/plans/recurring-goals.md
// C5, C7 to C10, and the step's "Must prove" list, one `describe` each). The
// real table create route, the real count, refresh, close and routes, over
// the in-memory database of goal-test-db.ts (its rowHasData plays
// ROW_HAS_DATA; scripts/recurring-goals/table-source.dbtest.ts runs the real
// rule on Postgres), in an Asia/Kolkata workspace and a New York one. Access
// is a table the test sets (who can open which table), the Tables module a
// switch the test flips.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  /** userId to table id to role. */
  roles: new Map<string, Map<string, string>>(),
  /** Who may edit the goals. */
  editors: new Set<string>(),
  session: null as null | { user: Record<string, unknown> },
  /** The Tables module, per workspace (all on unless set). */
  tablesOff: new Set<string>(),
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./goal-test-db")).goalDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/entitlements", () => ({
  isModuleActive: async (orgId: string, slug: string) => slug !== "workwrk-tables" || !st.tablesOff.has(orgId),
  getActiveModuleAppKeys: async () => [],
}));
vi.mock("@/lib/access/acting-person", async () => {
  const { goalDb } = await import("./goal-test-db");
  const { legacyTestSession: session, legacyLevelRow: level } = await import("@/lib/access/test-fixtures");
  return {
    actingPerson: async (organizationId: string, userId: string) => {
      const row = (goalDb.rows.user ?? []).find((u) => u.id === userId && u.organizationId === organizationId);
      if (!row) return null;
      const viewer = { userId, organizationId, orgRole: "MEMBER", isAgent: false, adminScopes: [], peopleTeam: false, status: row.status, deleted: row.deletedAt != null };
      return { viewer, link: { userId, organizationId, ...level("EMPLOYEE") }, session: session(userId, "EMPLOYEE", organizationId) };
    },
  };
});
vi.mock("@/lib/access/node-access", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const roleOf = (ctx: { userId: string; denied?: boolean }, id: string) => (ctx.denied ? "none" : st.roles.get(ctx.userId)?.get(id) ?? "none");
  return {
    ...real,
    nodeCtxFromViewer: (v: { userId: string; organizationId: string; deleted?: boolean; status?: string }) => ({
      userId: v.userId, organizationId: v.organizationId, orgAdmin: false, orgGuest: false, isAgent: false, denied: v.deleted === true || v.status === "INACTIVE",
    }),
    nodeRoleMap: async (ctx: { userId: string; denied?: boolean }, _kind: string, ids: Iterable<string>) => new Map([...ids].map((id) => [id, roleOf(ctx, id)])),
    nodeRole: async (ctx: { userId: string; denied?: boolean }, ref: { id: string }) => ({ role: roleOf(ctx, ref.id), strictRole: "none", via: { type: "none" }, path: false }),
  };
});
vi.mock("@/lib/alignment-scope", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  canEditGoal: async (s: { user: { id: string } }) => st.editors.has(s.user.id),
}));
vi.mock("@/lib/goal-audience", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  canSeeGoal: async () => true,
  goalEditDenial: async (s: { user: { id: string } }) => (st.editors.has(s.user.id) ? null : { error: "You can't edit this goal.", status: 403 }),
}));
vi.mock("@/lib/goals/goal-contributor", () => ({ isGoalContributor: async () => false }));
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: st.session }),
  getSessionAndModule: async (slug: string) => (slug === "workwrk-tables" && st.tablesOff.has(String(st.session?.user.organizationId))
    ? { error: Response.json({ error: "This module isn't enabled for your workspace." }, { status: 403 }), session: null }
    : { error: null, session: st.session }),
  getOrgId: (s: { user: { organizationId: string } }) => s.user.organizationId,
  getUserId: (s: { user: { id: string } }) => s.user.id,
  isManager: () => false,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/notify-realtime", () => ({ publishItemChanged: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logActivity: () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => {}, calculatePerformanceScore: async () => undefined }));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: async () => undefined }));

import { goalDb as db, seedRow } from "./goal-test-db";
import { createTableEngine } from "@/lib/sheet-engine-host";
import { closeDuePeriods, settleGoalPeriods } from "./goal-periods.server";
import { connectorFor, countTableSource, describeTargetSources, handOverGoalSources, refreshGoalSources } from "./goal-source.server";
import { periodWindow, PRIVATE_TABLE_WORDS } from "./goal-source";
import { parseTableSource, TABLE_FORMULA_CAP, TABLE_PAUSE, TABLE_PLAIN_CAP, type TableSource } from "./table-source";
import { countTableRows, tableDateKey, wallClockIn } from "./table-count";
import { periodFor, periodSettingsOf } from "./goal-period";
import { parseTargetSource } from "./target-source";
import * as tablesRoute from "@/app/api/tables/route";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";
import * as previewRoute from "@/app/api/okrs/[id]/key-results/preview/route";

const ORG = "org-1";
const NY = "org-ny";
const OWNER = "u-olga";
const CONN = "u-priya";
const VIEWER = "u-vic";
const KOLKATA = periodSettingsOf({ timezone: "Asia/Kolkata" });
const NEW_YORK = periodSettingsOf({ timezone: "America/New_York" });

/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const at = (t: Date) => vi.setSystemTime(t);
const rows = (model: string) => (db.rows[model] ?? []) as Array<Record<string, unknown>>;

/** The deals table: a name, a closing date, an amount, a stage, a link to another table, a formula. */
const DEAL_COLUMNS = [
  { id: "c-name", type: "short_text", label: "Name" },
  { id: "c-closed", type: "date", label: "Closed on" },
  { id: "c-amount", type: "currency", label: "Amount" },
  { id: "c-stage", type: "select", label: "Stage", options: ["Won", "Lost", "Open"] },
  { id: "c-account", type: "link", label: "Account" },
  { id: "c-fee", type: "formula", label: "Fee", formula: "=[Amount]/10" },
];

function grant(userId: string, id: string, role = "VIEW") {
  const m = st.roles.get(userId) ?? new Map<string, string>();
  m.set(id, role);
  st.roles.set(userId, m);
}

/** A table with these rows (values, optionally trashed), then `blank` seeded blank rows after them, every row created on `born`. */
function seedTable(id: string, org: string, columns: unknown[], filled: Array<Record<string, unknown> | { values: Record<string, unknown>; deletedAt: Date }>, opts: { blank?: number; born?: Date; name?: string } = {}) {
  const born = opts.born ?? ist(2026, 9, 1);
  seedRow(db, "dataTable", { id, organizationId: org, name: opts.name ?? "Deals", columns, createdById: CONN, createdAt: born, updatedAt: born });
  let position = 0;
  for (const r of filled) {
    const trashed = "deletedAt" in r && r.deletedAt instanceof Date;
    seedRow(db, "dataTableRow", {
      id: `${id}-r${++position}`, organizationId: org, tableId: id, position,
      values: trashed ? (r as { values: Record<string, unknown> }).values : r, deletedAt: trashed ? (r as { deletedAt: Date }).deletedAt : null,
      createdAt: born, updatedAt: born,
    });
  }
  for (let i = 0; i < (opts.blank ?? 0); i++) {
    seedRow(db, "dataTableRow", { id: `${id}-b${i}`, organizationId: org, tableId: id, position: ++position, values: {}, createdAt: born, updatedAt: born });
  }
}

const COUNT_BY_CLOSED: TableSource = { kind: "table", tableId: "t-deals", metric: { op: "count" }, filters: [], countedBy: "column", dateColumnId: "c-closed" };

/** A monthly goal whose one target counts `source` as Priya, from September. */
function tableGoal(id: string, source: unknown, org = ORG, connector = CONN) {
  seedRow(db, "oKR", { id, organizationId: org, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: OWNER, repeat: "MONTHLY", startDate: new Date("2026-09-01T00:00:00Z"), createdAt: ist(2026, 8, 20) });
  seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "Counted", startValue: 0, targetValue: 10, currentValue: 0, source, sourceById: connector, createdAt: ist(2026, 8, 20) });
}

const periodOf = (okrId: string, key: string) => rows("goalPeriod").find((p) => p.okrId === okrId && p.key === key);
const rowIn = (okrId: string, key: string) => rows("keyResultPeriod").find((r) => r.keyResultId === `${okrId}-kr` && r.periodId === periodOf(okrId, key)?.id);

async function count(okrId: string, now: Date, org = ORG) {
  at(now);
  await settleGoalPeriods(org, [okrId], now);
  return refreshGoalSources(org, { okrIds: [okrId], force: true, now });
}

/** One count of `source` over the month holding `month`, as `connector`, with no stored goal. */
async function countMonth(source: TableSource, month: Date, settings = KOLKATA, org = ORG, connector = CONN, now = ist(2026, 11, 20)) {
  const conn = await connectorFor(org, connector);
  if (!conn.ok) throw new Error(conn.reason);
  const r = await countTableSource({ orgId: org, source, connector: conn.connector, window: periodWindow(periodFor("MONTHLY", month, settings), settings), zone: settings.timezone, now });
  return r.kind === "counted" ? r.value : r.kind === "paused" ? r.reason : "same";
}

type Json = Record<string, unknown> & { error?: string };
async function call(handler: unknown, url: string, init: { method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Json }> {
  const req = new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await (handler as (r: never, c: { params: Promise<Record<string, string>> }) => Promise<Response>)(req as never, { params: Promise.resolve(init.params ?? {}) });
  return { status: res.status, body: (await res.json()) as Json };
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  st.roles.clear();
  st.tablesOff.clear();
  st.editors = new Set([OWNER, CONN]);
  st.session = legacyTestSession(CONN, "EMPLOYEE", ORG);
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "organization", { id: NY, name: "Acme NY", settings: { timezone: "America/New_York" } });
  seedRow(db, "user", { id: OWNER, organizationId: ORG, firstName: "Olga", lastName: "Owner" });
  seedRow(db, "user", { id: CONN, organizationId: ORG, firstName: "Priya", lastName: "Shah" });
  seedRow(db, "user", { id: VIEWER, organizationId: ORG, firstName: "Vic", lastName: "Viewer" });
  seedRow(db, "user", { id: "u-nyc", organizationId: NY, firstName: "Nia", lastName: "York" });
  grant(CONN, "t-deals");
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errors.mockRestore();
});

afterAll(() => {
  delete process.env.RECURRING_GOALS;
  delete process.env.CRON_SECRET;
});

describe("a new table with 3 typed rows counts 3, not 1,003", () => {
  it("the table POST seeds 1,000 blank rows; three typed in, a styled-only and a cleared row: Count of rows is 3", async () => {
    at(ist(2026, 10, 2));
    const made = await call(tablesRoute.POST, "/api/tables", { method: "POST", body: {} });
    expect(made.status).toBe(201);
    const tableId = String(made.body.id);
    const seeded = rows("dataTableRow").filter((r) => r.tableId === tableId).sort((a, b) => Number(a.position) - Number(b.position));
    expect(seeded).toHaveLength(1000);
    grant(CONN, tableId);
    const colA = ((made.body.columns as Array<{ id: string }>)[0]).id;
    // Three typed in, as the grid writes cells.
    at(ist(2026, 10, 5));
    for (const [i, v] of [[0, "Acme"], [1, "Globex"], [7, 42]] as const) seeded[i].values = { [colA]: v };
    // A row only styled ($fmt is layout), and one whose cell was cleared.
    seeded[3].values = { $fmt: { [colA]: { b: true } } };
    seeded[4].values = { [colA]: "" };
    tableGoal("g-new", { kind: "table", tableId, metric: { op: "count" }, filters: [], countedBy: "now" });
    await count("g-new", ist(2026, 10, 6));
    expect(rowIn("g-new", "2026-10-01")?.currentValue).toBe(3);
  });
});

describe("a seeded row filled in and dated 2 November counts in November", () => {
  it("counted by its Date column, not by when the row was made (every seeded row carries the table's creation day)", async () => {
    // Born in October with 1,000 blank rows; two of them filled in November.
    seedTable("t-deals", ORG, DEAL_COLUMNS, [], { blank: 1000, born: ist(2026, 10, 3) });
    const seeded = rows("dataTableRow").filter((r) => r.tableId === "t-deals");
    at(ist(2026, 11, 3));
    seeded[10].values = { "c-name": "Initech", "c-closed": "2026-11-02" };
    seeded[11].values = { "c-name": "Hooli", "c-closed": "2026-10-30" };
    seeded[10].updatedAt = ist(2026, 11, 3);
    seeded[11].updatedAt = ist(2026, 11, 3);
    expect(await countMonth(COUNT_BY_CLOSED, ist(2026, 10, 15))).toBe(1);
    expect(await countMonth(COUNT_BY_CLOSED, ist(2026, 11, 15))).toBe(1);
    // Through a goal: November's period counts Initech, October's Hooli.
    tableGoal("g-deals", COUNT_BY_CLOSED);
    await count("g-deals", ist(2026, 11, 3, 13));
    expect(rowIn("g-deals", "2026-11-01")?.currentValue).toBe(1);
    expect(rowIn("g-deals", "2026-10-01")?.currentValue).toBe(1);
  });
});

describe("a sum over a formula column equals what the grid computes for the same rows", () => {
  const COLS = [
    { id: "c-price", type: "number", label: "Price" },
    { id: "c-qty", type: "number", label: "Qty" },
    { id: "c-total", type: "formula", label: "Total", formula: "=[Price]*[Qty]" },
  ];
  // Row 2 is blank and row 4's price is a cell formula reading A3 (row 3's
  // price): its A1 ref anchors to storage order, so the blank row must stay
  // in place for it to read 5, not itself.
  const FILLED = [
    { "c-price": 10, "c-qty": 2 },
    {},
    { "c-price": 5, "c-qty": 3 },
    { "c-price": { "=": "A3*2" }, "c-qty": 1 },
    { "c-price": 7, "c-qty": "x" },
  ];

  /** What the grid computes: its engine over every live row in storage order, the filled rows' Totals added up. */
  function gridSum() {
    const live = rows("dataTableRow").filter((r) => r.tableId === "t-sum" && r.deletedAt == null).sort((a, b) => Number(a.position) - Number(b.position));
    const engine = createTableEngine({ columns: COLS, rows: live.map((r) => ({ id: String(r.id), values: r.values as Record<string, unknown> })) });
    const filled = live.filter((r) => Object.keys(r.values as object).length > 0);
    const values = filled.map((r) => engine.value("c-total", String(r.id))).filter((v): v is number => typeof v === "number");
    return { sum: values.reduce((a, b) => a + b, 0), n: values.length };
  }

  it("Sum of Total and Average of Total over the filled rows, with a cell formula anchored past a blank row", async () => {
    seedTable("t-sum", ORG, COLS, FILLED, { blank: 1000 });
    grant(CONN, "t-sum");
    const grid = gridSum();
    // 10*2 + 5*3 + 10*1, and 7*"x" is an error the sum leaves out.
    expect(grid).toEqual({ sum: 45, n: 3 });
    const sum: TableSource = { kind: "table", tableId: "t-sum", metric: { op: "sum", columnId: "c-total" }, filters: [], countedBy: "now", dateColumnId: null };
    const conn = await connectorFor(ORG, CONN);
    if (!conn.ok) throw new Error(conn.reason);
    const run = (source: TableSource) => countTableSource({ orgId: ORG, source, connector: conn.connector, window: null, zone: "Asia/Kolkata", now: ist(2026, 10, 10) });
    expect(await run(sum)).toMatchObject({ kind: "counted", value: grid.sum });
    expect(await run({ ...sum, metric: { op: "average", columnId: "c-total" } })).toMatchObject({ kind: "counted", value: grid.sum / grid.n });
    // A plain column holding a cell formula runs the engine too: Sum of Price is 10 + 5 + 10 + 7.
    expect(await run({ ...sum, metric: { op: "sum", columnId: "c-price" } })).toMatchObject({ kind: "counted", value: 32 });
    // A filter on the formula column reads what it shows: Total contains "1" is 15 and 10.
    expect(await run({ ...sum, metric: { op: "count" }, filters: [{ colId: "c-total", kind: "contains", value: "1" }] })).toMatchObject({ kind: "counted", value: 2 });
  });
});

describe("TODAY() in a formula reads the workspace day", () => {
  const COLS = [
    { id: "c-name", type: "short_text", label: "Name" },
    { id: "c-day", type: "formula", label: "Day", formula: "=DAY(TODAY())" },
  ];

  it("New York at 22:00 on 31 October reads 31; Auckland at 01:00 on 1 November reads 1, whatever zone the server runs in", async () => {
    seedTable("t-day", ORG, COLS, [{ "c-name": "Today" }], { blank: 5 });
    grant(CONN, "t-day");
    const conn = await connectorFor(ORG, CONN);
    if (!conn.ok) throw new Error(conn.reason);
    const source: TableSource = { kind: "table", tableId: "t-day", metric: { op: "sum", columnId: "c-day" }, filters: [], countedBy: "now", dateColumnId: null };
    const dayIn = async (zone: string, now: Date) => {
      const r = await countTableSource({ orgId: ORG, source, connector: conn.connector, window: null, zone, now });
      return r.kind === "counted" ? r.value : null;
    };
    // 1 November 02:00 UTC: 22:00 on 31 October in New York, already 1 November in UTC and in Kolkata.
    expect(await dayIn("America/New_York", new Date("2026-11-01T02:00:00Z"))).toBe(31);
    // 31 October 12:00 UTC: 01:00 on 1 November in Auckland, still 31 October in UTC and in Kolkata.
    expect(await dayIn("Pacific/Auckland", new Date("2026-10-31T12:00:00Z"))).toBe(1);
  });

  it("wallClockIn hands the engine the zone's wall clock in its local parts", () => {
    const d = wallClockIn("America/New_York", new Date("2026-11-01T02:00:00Z"));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2026, 10, 31, 22]);
    const k = wallClockIn("Asia/Kolkata", new Date("2026-10-31T18:30:00Z"));
    expect([k.getMonth() + 1, k.getDate(), k.getHours(), k.getMinutes()]).toEqual([11, 1, 0, 0]);
  });
});

describe("trashed rows never count", () => {
  it("a row in Trash leaves the count, and back from Trash it counts again", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [
      { "c-name": "Acme", "c-closed": "2026-10-04" },
      { values: { "c-name": "Gone", "c-closed": "2026-10-05" }, deletedAt: ist(2026, 10, 6) },
      { "c-name": "Globex", "c-closed": "2026-10-07" },
    ], { blank: 10 });
    tableGoal("g-trash", COUNT_BY_CLOSED);
    await count("g-trash", ist(2026, 10, 8));
    expect(rowIn("g-trash", "2026-10-01")?.currentValue).toBe(2);
    const gone = rows("dataTableRow").find((r) => r.id === "t-deals-r2")!;
    at(ist(2026, 10, 9));
    gone.deletedAt = null;
    gone.updatedAt = ist(2026, 10, 9);
    await count("g-trash", ist(2026, 10, 9, 13));
    expect(rowIn("g-trash", "2026-10-01")?.currentValue).toBe(3);
  });
});

describe("a Date column row dated 1 November counts in November in Kolkata and New York", () => {
  /** 1 November written every way a table holds it, and 31 October once. */
  const rowsFor = (zoneMidnight: string) => [
    { "c-name": "Grid day", "c-closed": "2026-11-01" },
    { "c-name": "UTC midnight", "c-closed": "2026-11-01T00:00:00.000Z" },
    { "c-name": "Zone midnight", "c-closed": zoneMidnight },
    { "c-name": "No zone", "c-closed": "2026-11-01T09:00" },
    { "c-name": "Formula", "c-closed": { "=": "DATE(2026,11,1)" } },
    { "c-name": "October", "c-closed": "2026-10-31" },
  ];

  it("Kolkata", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, rowsFor("2026-10-31T18:30:00.000Z"), { blank: 20 });
    expect(await countMonth(COUNT_BY_CLOSED, ist(2026, 10, 15))).toBe(1);
    expect(await countMonth(COUNT_BY_CLOSED, ist(2026, 11, 15))).toBe(5);
  });

  it("New York", async () => {
    seedTable("t-ny", NY, DEAL_COLUMNS, rowsFor("2026-11-01T04:00:00.000Z"), { blank: 20 });
    grant("u-nyc", "t-ny");
    const source = { ...COUNT_BY_CLOSED, tableId: "t-ny" };
    expect(await countMonth(source, ist(2026, 10, 15), NEW_YORK, NY, "u-nyc")).toBe(1);
    expect(await countMonth(source, ist(2026, 11, 15), NEW_YORK, NY, "u-nyc")).toBe(5);
  });

  it("the day keys, one by one", () => {
    expect(tableDateKey("2026-11-01", "America/New_York")).toBe("2026-11-01");
    expect(tableDateKey("2026-11-01T00:00:00.000Z", "America/New_York")).toBe("2026-11-01");
    expect(tableDateKey("2026-11-01T04:00:00.000Z", "America/New_York")).toBe("2026-11-01");
    expect(tableDateKey("2026-10-31T18:30:00.000Z", "Asia/Kolkata")).toBe("2026-11-01");
    expect(tableDateKey("2026-11-01T09:00", "Asia/Kolkata")).toBe("2026-11-01");
    // DATE(2026,11,1) is serial 46327.
    expect(tableDateKey(46327, "America/New_York")).toBe("2026-11-01");
  });
});

describe("Tables off pauses", () => {
  it("the module off pauses with its words, the number stands, one Inbox row; on again, it counts", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04" }], { blank: 10 });
    tableGoal("g-off", COUNT_BY_CLOSED);
    await count("g-off", ist(2026, 10, 5));
    expect(rowIn("g-off", "2026-10-01")?.currentValue).toBe(1);
    st.tablesOff.add(ORG);
    rows("dataTableRow").find((r) => r.id === "t-deals-b0")!.values = { "c-name": "Globex", "c-closed": "2026-10-06" };
    await count("g-off", ist(2026, 10, 7));
    expect(rowIn("g-off", "2026-10-01")).toMatchObject({ currentValue: 1, pausedReason: TABLE_PAUSE.tablesOff });
    expect(rows("keyResult").find((k) => k.id === "g-off-kr")?.sourcePausedReason).toBe("Tables is turned off for this workspace.");
    const inbox = rows("notification").filter((n) => n.type === "goal_source_paused");
    expect(inbox.map((n) => [n.userId, n.message]).sort()).toEqual([[CONN, TABLE_PAUSE.tablesOff], [OWNER, TABLE_PAUSE.tablesOff]].sort());
    st.tablesOff.delete(ORG);
    await count("g-off", ist(2026, 10, 8));
    expect(rowIn("g-off", "2026-10-01")).toMatchObject({ currentValue: 2, pausedReason: null });
  });
});

describe("the other pauses (C10): the table deleted, a column removed, the connector losing the table, the caps", () => {
  it("moved to Trash (the row goes until a restore brings it back with its id): paused, then counting again", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04" }], { blank: 3 });
    tableGoal("g-del", COUNT_BY_CLOSED);
    await count("g-del", ist(2026, 10, 5));
    const tableRow = rows("dataTable").find((t) => t.id === "t-deals")!;
    db.rows.dataTable = rows("dataTable").filter((t) => t.id !== "t-deals");
    await count("g-del", ist(2026, 10, 6));
    expect(rowIn("g-del", "2026-10-01")).toMatchObject({ currentValue: 1, pausedReason: TABLE_PAUSE.tableGone });
    db.rows.dataTable.push(tableRow);
    await count("g-del", ist(2026, 10, 7));
    expect(rowIn("g-del", "2026-10-01")).toMatchObject({ currentValue: 1, pausedReason: null });
  });

  it("the column it adds up removed, the date column retyped, a filter's column gone; the connector losing the table", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04", "c-amount": 100 }], { blank: 3 });
    const sum: TableSource = { ...COUNT_BY_CLOSED, metric: { op: "sum", columnId: "c-amount" } };
    expect(await countMonth(sum, ist(2026, 10, 15))).toBe(100);
    const table = rows("dataTable").find((t) => t.id === "t-deals")!;
    table.columns = DEAL_COLUMNS.filter((c) => c.id !== "c-amount");
    expect(await countMonth(sum, ist(2026, 10, 15))).toBe(TABLE_PAUSE.columnGone);
    table.columns = DEAL_COLUMNS.map((c) => (c.id === "c-closed" ? { ...c, type: "short_text" } : c));
    expect(await countMonth(COUNT_BY_CLOSED, ist(2026, 10, 15))).toBe(TABLE_PAUSE.dateColumnGone);
    table.columns = DEAL_COLUMNS.filter((c) => c.id !== "c-stage");
    expect(await countMonth({ ...COUNT_BY_CLOSED, filters: [{ colId: "c-stage", kind: "value", values: ["Won"] }] }, ist(2026, 10, 15))).toBe(TABLE_PAUSE.filterColumnGone);
    table.columns = DEAL_COLUMNS;
    st.roles.get(CONN)!.delete("t-deals");
    expect(await countMonth(COUNT_BY_CLOSED, ist(2026, 10, 15))).toBe("Priya can no longer open the table it counts. Reconnect it.");
  });

  it("over the caps: 20,001 live rows with a formula read, 50,001 filled rows of plain columns", async () => {
    expect([TABLE_FORMULA_CAP, TABLE_PLAIN_CAP]).toEqual([20_000, 50_000]);
    const big = (id: string, n: number, filled: boolean) => {
      seedRow(db, "dataTable", { id, organizationId: ORG, name: id, columns: DEAL_COLUMNS, createdById: CONN });
      const list = db.rows.dataTableRow ?? (db.rows.dataTableRow = []);
      const t = ist(2026, 10, 1);
      for (let i = 0; i < n; i++) list.push({ id: `${id}-${i}`, organizationId: ORG, tableId: id, position: i + 1, values: filled ? { "c-name": `R${i}`, "c-amount": 1 } : {}, deletedAt: null, createdAt: t, updatedAt: t });
      grant(CONN, id);
    };
    // 20,001 live rows, one of them filled: a sum over the formula column cannot run.
    big("t-formula", TABLE_FORMULA_CAP + 1, false);
    rows("dataTableRow").find((r) => r.id === "t-formula-0")!.values = { "c-amount": 10 };
    const fee: TableSource = { kind: "table", tableId: "t-formula", metric: { op: "sum", columnId: "c-fee" }, filters: [], countedBy: "now", dateColumnId: null };
    expect(await countMonth(fee, ist(2026, 10, 15))).toBe(TABLE_PAUSE.tooLarge);
    // The same table counted by a plain column reads its one filled row.
    expect(await countMonth({ ...fee, metric: { op: "sum", columnId: "c-amount" } }, ist(2026, 10, 15))).toBe(10);
    big("t-plain", TABLE_PLAIN_CAP + 1, true);
    expect(await countMonth({ ...fee, tableId: "t-plain", metric: { op: "count" } }, ist(2026, 10, 15))).toBe(TABLE_PAUSE.tooLarge);
  }, 120_000);
});

describe("Right now (C3's rule for its final number) on a table", () => {
  it("open deals counted Right now freeze at the first cron run after October; a deal won on 2 November leaves October alone", async () => {
    const OPEN_DEALS: TableSource = { kind: "table", tableId: "t-deals", metric: { op: "count" }, filters: [{ colId: "c-stage", kind: "value", values: ["Open"] }], countedBy: "now", dateColumnId: null };
    seedTable("t-deals", ORG, DEAL_COLUMNS, [
      { "c-name": "A", "c-stage": "Open" }, { "c-name": "B", "c-stage": "Open" }, { "c-name": "C", "c-stage": "Won" },
    ], { blank: 5 });
    tableGoal("g-open", OPEN_DEALS);
    await count("g-open", ist(2026, 10, 20));
    expect(rowIn("g-open", "2026-10-01")?.currentValue).toBe(2);
    at(ist(2026, 11, 1, 0, 5));
    expect((await call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } })).status).toBe(200);
    expect(rowIn("g-open", "2026-10-01")).toMatchObject({ currentValue: 2, frozenAt: ist(2026, 11, 1, 0, 5) });
    const a = rows("dataTableRow").find((r) => r.id === "t-deals-r1")!;
    a.values = { "c-name": "A", "c-stage": "Won" };
    a.updatedAt = ist(2026, 11, 2);
    at(ist(2026, 11, 2, 12));
    await call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
    expect(rowIn("g-open", "2026-11-01")?.currentValue).toBe(1);
    expect(rowIn("g-open", "2026-10-01")?.currentValue).toBe(2);
    at(ist(2026, 11, 6, 0, 5));
    await closeDuePeriods(ORG, ist(2026, 11, 6, 0, 5));
    expect(periodOf("g-open", "2026-10-01")).toMatchObject({ status: "CLOSED", progress: 20 });
  });
});

describe("a viewer without the table sees the number and \"From a private table\", never the name", () => {
  it("the page's source facts name the table only for who can open it", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04" }], { blank: 3, name: "Hiring pipeline" });
    tableGoal("g-private", COUNT_BY_CLOSED);
    await count("g-private", ist(2026, 10, 5));
    const krs = rows("keyResult").filter((k) => k.okrId === "g-private") as Array<{ id: string; source: unknown; sourceById: string | null; sourcePausedReason: string | null }>;
    const forViewer = (await describeTargetSources(ORG, VIEWER, krs)).get("g-private-kr")!;
    expect(forViewer).toEqual({ kind: "table", label: PRIVATE_TABLE_WORDS, private: true, href: null, connectorName: null, paused: null, settings: null });
    expect(JSON.stringify(forViewer)).not.toMatch(/Hiring|t-deals|c-closed/);
    const forEditor = (await describeTargetSources(ORG, OWNER, krs, { canEdit: true })).get("g-private-kr")!;
    expect(forEditor).toMatchObject({ kind: "table", label: PRIVATE_TABLE_WORDS, private: true, connectorName: "Priya Shah", settings: null });
    const forConnector = (await describeTargetSources(ORG, CONN, krs, { canEdit: true })).get("g-private-kr")!;
    expect(forConnector).toMatchObject({ kind: "table", label: "From Hiring pipeline", private: false, href: "/tables/t-deals", settings: COUNT_BY_CLOSED });
    expect(rowIn("g-private", "2026-10-01")?.currentValue).toBe(1);
  });
});

describe("the doors: connecting a table source", () => {
  it("refused with the switch off, with Tables off, for a table the caller cannot open, and for a link column; counts at once otherwise", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04", "c-amount": 250 }], { blank: 3 });
    tableGoal("g-doors", null);
    rows("keyResult").splice(rows("keyResult").findIndex((k) => k.id === "g-doors-kr"), 1);
    at(ist(2026, 10, 6));
    const body = (source: unknown) => ({ title: "Won", startValue: 0, targetValue: 1000, source });
    const post = (source: unknown) => call(krsRoute.POST, "/api/okrs/g-doors/key-results", { method: "POST", params: { id: "g-doors" }, body: body(source) });
    process.env.RECURRING_GOALS = "0";
    expect(await post(COUNT_BY_CLOSED)).toMatchObject({ status: 400, body: { error: "Repeating goals are not turned on." } });
    process.env.RECURRING_GOALS = "1";
    st.tablesOff.add(ORG);
    expect(await post(COUNT_BY_CLOSED)).toMatchObject({ status: 400, body: { error: "Tables is turned off for this workspace." } });
    st.tablesOff.delete(ORG);
    st.session = legacyTestSession(OWNER, "EMPLOYEE", ORG);
    expect(await post(COUNT_BY_CLOSED)).toMatchObject({ status: 400, body: { error: "You can only count from a table you can open." } });
    st.session = legacyTestSession(CONN, "EMPLOYEE", ORG);
    expect(await post({ ...COUNT_BY_CLOSED, metric: { op: "sum", columnId: "c-account" } })).toMatchObject({ status: 400, body: { error: "Choose a number column of this table to add up." } });
    expect(await post({ ...COUNT_BY_CLOSED, filters: [{ colId: "c-account", kind: "contains", value: "x" }] })).toMatchObject({ status: 400 });
    const ok = await post({ ...COUNT_BY_CLOSED, metric: { op: "sum", columnId: "c-amount" } });
    expect(ok.status).toBe(201);
    const kr = rows("keyResult").find((k) => k.okrId === "g-doors" && k.title === "Won")!;
    expect(kr.sourceById).toBe(CONN);
    expect(kr.source).toEqual({ ...COUNT_BY_CLOSED, metric: { op: "sum", columnId: "c-amount" } });
    expect(rows("keyResultPeriod").find((r) => r.keyResultId === kr.id && r.periodId === periodOf("g-doors", "2026-10-01")?.id)?.currentValue).toBe(250);
    // The answer carries no source (C9).
    expect(JSON.stringify(ok.body)).not.toContain("t-deals");
  });

  it("the preview counts as the person editing, and says when the table is not open to the whole workspace", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04" }, { "c-name": "Globex", "c-closed": "2026-09-30" }], { blank: 3 });
    tableGoal("g-preview", null);
    at(ist(2026, 10, 6));
    await settleGoalPeriods(ORG, ["g-preview"], ist(2026, 10, 6));
    const preview = () => call(previewRoute.POST, "/api/okrs/g-preview/key-results/preview", { method: "POST", params: { id: "g-preview" }, body: { source: COUNT_BY_CLOSED } });
    expect(await preview()).toMatchObject({ status: 200, body: { value: 1, paused: null, openToWorkspace: false } });
    grant("workspace-member", "t-deals");
    expect((await preview()).body.openToWorkspace).toBe(true);
    st.tablesOff.add(ORG);
    expect((await preview()).body).toMatchObject({ value: null, paused: TABLE_PAUSE.tablesOff });
  });

  it("Reconnect moves a paused table source to the editor who can open it", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04" }], { blank: 3 });
    tableGoal("g-re", COUNT_BY_CLOSED);
    st.roles.get(CONN)!.delete("t-deals");
    await count("g-re", ist(2026, 10, 5));
    expect(rows("keyResult").find((k) => k.id === "g-re-kr")?.sourcePausedReason).toBe("Priya can no longer open the table it counts. Reconnect it.");
    grant(OWNER, "t-deals");
    st.session = legacyTestSession(OWNER, "EMPLOYEE", ORG);
    const r = await call(krRoute.PATCH, "/api/okrs/g-re/key-results/g-re-kr", { method: "PATCH", params: { id: "g-re", krId: "g-re-kr" }, body: { reconnect: true } });
    expect(r.status).toBe(200);
    expect(rows("keyResult").find((k) => k.id === "g-re-kr")).toMatchObject({ sourceById: OWNER, sourcePausedReason: null });
    expect(rowIn("g-re", "2026-10-01")).toMatchObject({ currentValue: 1, pausedReason: null });
  });
});

describe("the leaver handover moves a table source only to someone who can open the table (C10)", () => {
  it("to the owner, who can open it: moved; to a person who cannot: it stays, paused, and the owner hears why", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04" }], { blank: 3 });
    tableGoal("g-hand", COUNT_BY_CLOSED);
    tableGoal("g-stay", COUNT_BY_CLOSED);
    grant(OWNER, "t-deals");
    // Only g-hand's target first: Olga can open the table and edit the goal.
    rows("keyResult").find((k) => k.id === "g-stay-kr")!.sourceById = "u-later";
    expect(await handOverGoalSources(ORG, CONN, OWNER)).toEqual({ moved: 1, paused: 0 });
    expect(rows("keyResult").find((k) => k.id === "g-hand-kr")?.sourceById).toBe(OWNER);
    // Vic can edit g-stay but cannot open the table: it stays with its connector, paused.
    rows("keyResult").find((k) => k.id === "g-stay-kr")!.sourceById = CONN;
    st.editors.add(VIEWER);
    expect(await handOverGoalSources(ORG, CONN, VIEWER)).toEqual({ moved: 0, paused: 1 });
    expect(rows("keyResult").find((k) => k.id === "g-stay-kr")).toMatchObject({ sourceById: CONN, sourcePausedReason: "Priya no longer works here. Reconnect it." });
    expect(rows("notification").filter((n) => n.type === "goal_source_paused").map((n) => n.userId)).toEqual([OWNER]);
  });
});

describe("the shape a table source is stored in (table-source.ts)", () => {
  it("reads what it stores, drops filters that narrow nothing, refuses what is not complete", () => {
    expect(parseTableSource(COUNT_BY_CLOSED)).toEqual(COUNT_BY_CLOSED);
    expect(parseTableSource({ ...COUNT_BY_CLOSED, filters: [{ colId: "c-stage", kind: "value", values: [] }, { colId: "c-name", kind: "contains", value: "Ac" }] })?.filters)
      .toEqual([{ colId: "c-name", kind: "contains", value: "Ac" }]);
    expect(parseTableSource({ ...COUNT_BY_CLOSED, dateColumnId: null })).toBeNull();
    expect(parseTableSource({ ...COUNT_BY_CLOSED, metric: { op: "sum" } })).toBeNull();
    expect(parseTableSource({ kind: "list", listIds: ["b"] })).toBeNull();
    // The route's reader: no longer "not available yet".
    expect(parseTargetSource(COUNT_BY_CLOSED)).toMatchObject({ ok: true, connected: COUNT_BY_CLOSED });
  });
});

describe("one read of a table per run, whatever number of its targets count it", () => {
  it("a count and a sum on one table: the rows are read once", async () => {
    seedTable("t-deals", ORG, DEAL_COLUMNS, [{ "c-name": "Acme", "c-closed": "2026-10-04", "c-amount": 5 }], { blank: 3 });
    tableGoal("g-two", COUNT_BY_CLOSED);
    seedRow(db, "keyResult", { id: "g-two-sum", okrId: "g-two", title: "Amount", startValue: 0, targetValue: 10, currentValue: 0, source: { ...COUNT_BY_CLOSED, metric: { op: "sum", columnId: "c-amount" } }, sourceById: CONN, createdAt: ist(2026, 8, 20) });
    const before = db.raw.length;
    await count("g-two", ist(2026, 10, 5));
    const reads = db.raw.slice(before).filter((t) => t.includes('FROM "DataTableRow" r'));
    // October and September (still in its grace), each a count and a sum: one read.
    expect(reads).toHaveLength(1);
    expect(rows("keyResultPeriod").find((r) => r.keyResultId === "g-two-sum" && r.periodId === periodOf("g-two", "2026-10-01")?.id)?.currentValue).toBe(5);
    expect(rowIn("g-two", "2026-10-01")?.currentValue).toBe(1);
  });

  it("countTableRows over plain arrays: a blank row never counts, an error is left out of a sum", () => {
    const columns = [{ id: "a", type: "number", label: "A" }];
    const source: TableSource = { kind: "table", tableId: "t", metric: { op: "sum", columnId: "a" }, filters: [], countedBy: "now", dateColumnId: null };
    const read = [{ id: "1", values: { a: 2 }, filled: true }, { id: "2", values: {}, filled: false }, { id: "3", values: { a: "#N/A" }, filled: true }];
    expect(countTableRows({ source, columns, rows: read, engine: null, window: null, zone: "UTC" })).toBe(2);
    expect(countTableRows({ source: { ...source, metric: { op: "count" } }, columns, rows: read, engine: null, window: null, zone: "UTC" })).toBe(2);
  });
});

