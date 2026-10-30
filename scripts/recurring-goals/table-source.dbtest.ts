// Step 5 of repeating goals on real Postgres (see vitest.db.config.mts): a
// goal's table count reads the rows by the Tables list's own rule
// (ROW_HAS_DATA in lib/table-counts.ts, here through liveTableRows and
// filledRowCounts, never the in-memory stand-in), so a new table with 3 typed
// rows counts 3, not 1,003, whatever empty shapes its other rows hold; the
// rows come back in the grid's storage order (position, then id), so a cell
// formula's A1 ref anchors past a blank row; a trashed row never counts; a
// cell formula stored as { "=": ... } survives the JSON round trip and runs
// through the embed's engine path; and a Date column's 1 November counts in
// November in Kolkata, through a monthly goal's periods. The in-memory rule
// (goal-test-db.ts rowHasData) is checked against the real one on the same
// rows. From the step 5 review: an unticked checkbox (false) is not data and
// a ticked one (true) is, in the goal's read, the Tables list's count and a
// form's append position alike (L5); a plain read loads only the keys it
// names while `filled` is still decided on the whole row (L2); and a formula
// that errors in every row pauses the source instead of summing to 0 (M1).
// The default suite proves the rest (src/lib/goals/goal-source.step5.test.ts).
//
// Run it (the local URL only, as vitest.db.config.mts says):
//   DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" TZ=UTC \
//     npx vitest run --config scripts/recurring-goals/vitest.db.config.mts scripts/recurring-goals/table-source.dbtest.ts
//
// Needs the recurring goals SQL files applied locally (no new SQL in step 5).
// Builds one throwaway organization in Asia/Kolkata and removes it after.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const LOCAL = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1):5432\//;
if (!LOCAL.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("table-source.dbtest refuses to run: DATABASE_URL is not the local database on port 5432 (use the URL from .env.local).");
}

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// The Tables module on for the throwaway workspace (its install rows are not what is proved).
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true, getActiveModuleAppKeys: async () => ["tables"] }));

import { prisma } from "@/lib/prisma";
import { filledRowCounts, lastFilledPosition, liveTableRows } from "@/lib/table-counts";
import { connectorFor, countTableSource, refreshGoalSources } from "@/lib/goals/goal-source.server";
import { settleGoalPeriods } from "@/lib/goals/goal-periods.server";
import { periodWindow } from "@/lib/goals/goal-source";
import { periodFor, periodSettingsOf } from "@/lib/goals/goal-period";
import { TABLE_PAUSE, type TableSource } from "@/lib/goals/table-source";
import { rowHasData } from "@/lib/goals/goal-test-db";

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ids = { org: "", user: "" };
const KOLKATA = periodSettingsOf({ timezone: "Asia/Kolkata" });
/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);

/** A table with these filled rows first, then `blank` seeded rows with values {}, as POST /api/tables seeds them. */
async function table(name: string, columns: unknown[], filled: Array<Record<string, unknown>>, blank: number): Promise<string> {
  const t = await prisma.dataTable.create({ data: { organizationId: ids.org, name: `${name} ${suffix}`, columns: columns as never, createdById: ids.user } });
  const data = [
    ...filled.map((values, i) => ({ organizationId: ids.org, tableId: t.id, values: values as never, position: i + 1, createdById: ids.user })),
    ...Array.from({ length: blank }, (_, i) => ({ organizationId: ids.org, tableId: t.id, values: {}, position: filled.length + i + 1, createdById: ids.user })),
  ];
  await prisma.dataTableRow.createMany({ data });
  return t.id;
}

async function connector() {
  const conn = await connectorFor(ids.org, ids.user);
  if (!conn.ok) throw new Error(conn.reason);
  return conn.connector;
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `TS ${suffix}`, slug: `ts-${suffix}`, settings: { timezone: "Asia/Kolkata" } } });
  const u = await prisma.user.create({ data: { email: `ts-${suffix}@ts.test`, passwordHash: "x", firstName: "Tara", lastName: "Test", organizationId: org.id, accessLevel: "COMPANY_ADMIN" } });
  ids.org = org.id;
  ids.user = u.id;
});

afterAll(async () => {
  if (ids.org) {
    await prisma.oKR.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup okr", e));
    await prisma.dataTableRow.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup rows", e));
    await prisma.dataTable.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup tables", e));
    await prisma.notification.deleteMany({ where: { userId: ids.user } }).catch((e) => console.error("cleanup inbox", e));
    await prisma.user.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup user", e));
    await prisma.organization.delete({ where: { id: ids.org } }).catch((e) => console.error("cleanup org", e));
  }
  await prisma.$disconnect();
});

describe("a goal's table count on Postgres", () => {
  it("a new table with 3 typed rows counts 3, not 1,003: ROW_HAS_DATA, whatever empty shapes the other rows hold, and the in-memory rule agrees", async () => {
    const A = "colA";
    const shapes: Array<Record<string, unknown>> = [
      { [A]: "Acme" },
      { [A]: 0 },
      // A ticked checkbox is data; an unticked one (false) is not (step 5 review L5).
      { [A]: true },
      { [A]: false },
      // Empty by the rule: a reserved key only, "", null, [], {}, and nothing at all.
      { $fmt: { [A]: { b: true } }, $rh: 40 },
      { [A]: "" },
      { [A]: null },
      { [A]: [] },
      { [A]: {} },
    ];
    const id = await table("New", [{ id: A, type: "short_text", label: "" }], shapes, 1000 - shapes.length);
    const all = await liveTableRows(id, { filledOnly: false });
    expect(all).toHaveLength(1000);
    expect(all.filter((r) => r.filled)).toHaveLength(3);
    expect((await liveTableRows(id, { filledOnly: true })).map((r) => r.values)).toEqual([{ [A]: "Acme" }, { [A]: 0 }, { [A]: true }]);
    expect((await filledRowCounts([id])).get(id)).toBe(3);
    // The stand-in the default suite counts with reads every row the same way.
    for (const r of all) expect(rowHasData(r.values), JSON.stringify(r.values)).toBe(r.filled);
    const source: TableSource = { kind: "table", tableId: id, metric: { op: "count" }, filters: [], countedBy: "now", dateColumnId: null };
    expect(await countTableSource({ orgId: ids.org, source, connector: await connector(), window: null, zone: "Asia/Kolkata", now: new Date() })).toMatchObject({ kind: "counted", value: 3 });
    // The last filled row is the ticked one (position 3): the false row after it is blank for a form's append too.
    expect(await lastFilledPosition(id)).toBe(3);
  });

  it("step 5 review L5 and L2: false is not data; a plain read loads only the keys it names, filled decided on the whole row", async () => {
    const A = "done";
    const B = "amount";
    const cols = [{ id: A, type: "checkbox", label: "Done" }, { id: B, type: "number", label: "Amount" }];
    const id = await table("Boxes", cols, [
      { [A]: true, [B]: 5 },
      // Only a column the read does not name: still a filled row, read as {}.
      { [A]: true },
      { [A]: false },
      { [A]: false, $rh: 40 },
      { [A]: false, [B]: 7 },
    ], 10);
    expect((await filledRowCounts([id])).get(id)).toBe(3);
    expect(await lastFilledPosition(id)).toBe(5);
    const projected = await liveTableRows(id, { filledOnly: true, keys: [B] });
    expect(projected.map((r) => [r.values, r.filled])).toEqual([[{ [B]: 5 }, true], [{}, true], [{ [B]: 7 }, true]]);
    expect((await liveTableRows(id, { filledOnly: true, keys: [] })).map((r) => r.values)).toEqual([{}, {}, {}]);
    const all = await liveTableRows(id, { filledOnly: false });
    for (const r of all) expect(rowHasData(r.values), JSON.stringify(r.values)).toBe(r.filled);
    const conn = await connector();
    const run = (s: TableSource) => countTableSource({ orgId: ids.org, source: s, connector: conn, window: null, zone: "Asia/Kolkata", now: new Date() });
    const base: TableSource = { kind: "table", tableId: id, metric: { op: "count" }, filters: [], countedBy: "now", dateColumnId: null };
    expect(await run(base)).toMatchObject({ kind: "counted", value: 3 });
    expect(await run({ ...base, metric: { op: "sum", columnId: B } })).toMatchObject({ kind: "counted", value: 12 });
    // A false row made last: the last filled row moves up.
    const last = await prisma.dataTableRow.findFirstOrThrow({ where: { tableId: id, position: 5 } });
    await prisma.dataTableRow.update({ where: { id: last.id }, data: { values: { [A]: false } } });
    expect(await lastFilledPosition(id)).toBe(2);
  });

  it("step 5 review M1: a formula that errors in every row pauses the source; a few errors are left out", async () => {
    const cols = [
      { id: "amount", type: "number", label: "Amount" },
      { id: "qty", type: "number", label: "Qty" },
      { id: "each", type: "formula", label: "Each", formula: "=[Amount]/[Qty]" },
    ];
    const conn = await connector();
    const run = (tableId: string) => countTableSource({
      orgId: ids.org, source: { kind: "table", tableId, metric: { op: "sum", columnId: "each" }, filters: [], countedBy: "now", dateColumnId: null },
      connector: conn, window: null, zone: "Asia/Kolkata", now: new Date(),
    });
    const broken = await table("Broken", cols, [{ amount: 10, qty: 0 }, { amount: 20, qty: 0 }], 10);
    expect(await run(broken)).toEqual({ kind: "paused", reason: TABLE_PAUSE.formulas });
    const few = await table("Few", cols, [{ amount: 10, qty: 2 }, { amount: 20, qty: 0 }, { amount: 9, qty: 3 }], 10);
    expect(await run(few)).toMatchObject({ kind: "counted", value: 8, errorRows: 1 });
  });

  it("storage order, a trashed row, and a cell formula through the JSON round trip: Sum of a formula column", async () => {
    const cols = [
      { id: "price", type: "number", label: "Price" },
      { id: "qty", type: "number", label: "Qty" },
      { id: "total", type: "formula", label: "Total", formula: "=[Price]*[Qty]" },
    ];
    // Row 2 is blank; row 4's price reads A3 (row 3's price, 5), so the blank row must hold its place.
    const id = await table("Sum", cols, [{ price: 10, qty: 2 }, {}, { price: 5, qty: 3 }, { price: { "=": "A3*2" }, qty: 1 }], 50);
    // A row whose id sorts first, written last at the end of the sheet: storage order is position, then id.
    await prisma.dataTableRow.create({ data: { id: `000${suffix}`, organizationId: ids.org, tableId: id, values: { price: 1, qty: 1 }, position: 999, createdById: ids.user } });
    const live = await liveTableRows(id, { filledOnly: false });
    expect(live.slice(0, 4).map((r) => r.values)).toEqual([{ price: 10, qty: 2 }, {}, { price: 5, qty: 3 }, { price: { "=": "A3*2" }, qty: 1 }]);
    expect(live[live.length - 1].values).toEqual({ price: 1, qty: 1 });
    const sum: TableSource = { kind: "table", tableId: id, metric: { op: "sum", columnId: "total" }, filters: [], countedBy: "now", dateColumnId: null };
    const run = async (s: TableSource) => countTableSource({ orgId: ids.org, source: s, connector: await connector(), window: null, zone: "Asia/Kolkata", now: new Date() });
    // 10*2 + 5*3 + 10*1 + 1*1: the cell formula reads 5 two rows up, past the blank one.
    expect(await run(sum)).toMatchObject({ kind: "counted", value: 46 });
    expect(await run({ ...sum, metric: { op: "sum", columnId: "price" } })).toMatchObject({ kind: "counted", value: 26 });
    // Row 1 to Trash: it leaves the count (and the rows below it move up, as in the grid).
    const first = await prisma.dataTableRow.findFirstOrThrow({ where: { tableId: id, position: 1 } });
    await prisma.dataTableRow.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    expect(await run({ ...sum, metric: { op: "count" } })).toMatchObject({ kind: "counted", value: 3 });
  });

  it("a Date column's 1 November counts in November in Kolkata, through a monthly goal's periods", async () => {
    const cols = [{ id: "name", type: "short_text", label: "Name" }, { id: "closed", type: "date", label: "Closed on" }];
    const id = await table("Dates", cols, [
      { name: "Day", closed: "2026-11-01" },
      { name: "UTC midnight", closed: "2026-11-01T00:00:00.000Z" },
      { name: "IST midnight", closed: "2026-10-31T18:30:00.000Z" },
      { name: "Formula", closed: { "=": "DATE(2026,11,1)" } },
      { name: "October", closed: "2026-10-31" },
    ], 100);
    const source: TableSource = { kind: "table", tableId: id, metric: { op: "count" }, filters: [], countedBy: "column", dateColumnId: "closed" };
    const conn = await connector();
    const month = (at: Date) => countTableSource({ orgId: ids.org, source, connector: conn, window: periodWindow(periodFor("MONTHLY", at, KOLKATA), KOLKATA), zone: "Asia/Kolkata", now: new Date() });
    expect(await month(ist(2026, 10, 15))).toMatchObject({ kind: "counted", value: 1 });
    expect(await month(ist(2026, 11, 15))).toMatchObject({ kind: "counted", value: 4 });
    // Through a goal: settle opens its periods, the refresh stores each period's number.
    const okr = await prisma.oKR.create({ data: { organizationId: ids.org, title: `Closed ${suffix}`, level: "INDIVIDUAL", ownerId: ids.user, repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 9, 20) } });
    const kr = await prisma.keyResult.create({ data: { okrId: okr.id, title: "Closed", startValue: 0, targetValue: 10, currentValue: 0, source: source as never, sourceById: ids.user, createdAt: ist(2026, 9, 20) } });
    const now = ist(2026, 11, 3);
    await settleGoalPeriods(ids.org, [okr.id], now);
    const r = await refreshGoalSources(ids.org, { okrIds: [okr.id], force: true, now });
    expect(r.counted).toBeGreaterThanOrEqual(2);
    const byKey = new Map((await prisma.keyResultPeriod.findMany({ where: { keyResultId: kr.id }, select: { currentValue: true, period: { select: { key: true } } } })).map((x) => [x.period.key, x.currentValue]));
    expect(byKey.get("2026-10-01")).toBe(1);
    expect(byKey.get("2026-11-01")).toBe(4);
  });
});
