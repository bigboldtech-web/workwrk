// The loader behind every link list, link add and link removal: each set
// holds only ids that exist in this workspace and pass the end's own rule,
// and nothing is queried for an end type the links do not hold. The
// database and the rules are mocked: the test reads what was asked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "./test-fixtures";

const calls: Record<string, unknown[]> = {};
const rows = (model: string) => async (args: { where: unknown }) => {
  (calls[model] ??= []).push(args.where);
  const w = args.where as { id?: { in: string[] }; AND?: Array<{ id?: { in: string[] } }> };
  const ids = w.id?.in ?? w.AND?.[0]?.id?.in ?? [];
  // the mocked database knows only these ids in org-1
  const known = new Set(["sop-1", "goal-1", "kr-1", "kra-1", "kpi-1"]);
  return ids.filter((id) => known.has(id)).map((id) => ({ id }));
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sOP: { findMany: rows("sop") },
    oKR: { findMany: rows("okr") },
    keyResult: { findMany: rows("kr") },
    kRA: { findMany: rows("kra") },
    kPI: { findMany: rows("kpi") },
  },
}));
vi.mock("@/lib/sop-access", () => ({ sopVisibilityWhere: async () => ({ OR: [{ folderId: null }] }) }));
vi.mock("@/lib/goal-audience", () => ({ goalVisibilityOr: async () => [{ level: "COMPANY" }] }));

const { loadReadableLinkEnds } = await import("./link-end-readable");

beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

describe("loadReadableLinkEnds", () => {
  const employee = legacyTestSession("u-1", "EMPLOYEE", "org-1");

  it("asks nothing for end types the links do not hold", async () => {
    const r = await loadReadableLinkEnds(employee, "org-1", [{ type: "BOARD_ITEM", id: "t1" }, { type: "DOC", id: "d1" }]);
    expect(Object.keys(calls)).toEqual([]);
    expect([...r.readableSops, ...r.readableGoals, ...r.readableKeyResults, ...r.readableKras]).toEqual([]);
  });

  it("reads each end type under its own rule, scoped to the workspace, and drops unknown ids", async () => {
    const r = await loadReadableLinkEnds(employee, "org-1", [
      { type: "SOP", id: "sop-1" }, { type: "SOP", id: "sop-guess" },
      { type: "OKR", id: "goal-1" }, { type: "KEY_RESULT", id: "kr-1" },
      { type: "KRA", id: "kra-1" }, { type: "KPI", id: "kpi-1" }, { type: "KRA", id: "kra-other-org" },
    ]);
    expect([...r.readableSops]).toEqual(["sop-1"]);
    expect([...r.readableGoals]).toEqual(["goal-1"]);
    expect([...r.readableKeyResults]).toEqual(["kr-1"]);
    expect([...r.readableKras].sort()).toEqual(["KPI:kpi-1", "KRA:kra-1"]);
    expect(calls.sop?.[0]).toEqual({ AND: [{ organizationId: "org-1", id: { in: ["sop-1", "sop-guess"] } }, { OR: [{ folderId: null }] }] });
    expect(calls.okr?.[0]).toEqual({ organizationId: "org-1", id: { in: ["goal-1"] }, OR: [{ level: "COMPANY" }] });
    expect(calls.kr?.[0]).toEqual({ id: { in: ["kr-1"] }, okr: { organizationId: "org-1", OR: [{ level: "COMPANY" }] } });
    expect(calls.kra?.[0]).toEqual({ organizationId: "org-1", id: { in: ["kra-1", "kra-other-org"] } });
  });

  it("a Guest reads no KRA or KPI, and nothing is asked for them", async () => {
    const guest = legacyTestSession("u-g", "GUEST", "org-1");
    const r = await loadReadableLinkEnds(guest, "org-1", [{ type: "KRA", id: "kra-1" }, { type: "KPI", id: "kpi-1" }]);
    expect([...r.readableKras]).toEqual([]);
    expect(calls.kra).toBeUndefined();
    expect(calls.kpi).toBeUndefined();
  });
});
