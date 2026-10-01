import { describe, expect, it, vi } from "vitest";

// item-types.ts imports the Prisma client at module load; the pure planner
// under test never touches it.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { planItemTypeRepair, itemTypePlanIsNoop, type ItemTypeRepairRow } from "./item-types";

const t0 = new Date("2026-09-30T13:57:19.864Z");
const t1 = new Date("2026-09-30T13:57:19.876Z");

function row(id: string, singular: string, opts: Partial<ItemTypeRepairRow> = {}): ItemTypeRepairRow {
  return { id, singular, builtIn: true, isDefault: false, createdAt: t0, updatedAt: t0, ...opts };
}

function builtInSet(prefix: string, at: Date): ItemTypeRepairRow[] {
  return [
    row(`${prefix}task`, "Task", { isDefault: true, createdAt: at, updatedAt: at }),
    row(`${prefix}mile`, "Milestone", { createdAt: at, updatedAt: at }),
    row(`${prefix}form`, "Form Response", { createdAt: at, updatedAt: at }),
    row(`${prefix}meet`, "Meeting Note", { createdAt: at, updatedAt: at }),
  ];
}

describe("planItemTypeRepair", () => {
  it("seeds a brand new org, with Task as the default", () => {
    const plan = planItemTypeRepair([]);
    expect(plan.seed).toBe(true);
    expect(plan.seedTaskAsDefault).toBe(true);
  });

  it("seeds without a second default when a custom type already holds it", () => {
    const plan = planItemTypeRepair([row("bug", "Bug", { builtIn: false, isDefault: true })]);
    expect(plan.seed).toBe(true);
    expect(plan.seedTaskAsDefault).toBe(false);
  });

  it("does nothing for a healthy org", () => {
    const rows = [...builtInSet("a", t0), row("bug", "Bug", { builtIn: false })];
    expect(itemTypePlanIsNoop(planItemTypeRepair(rows))).toBe(true);
  });

  it("collapses a double seed to the oldest set with one default", () => {
    // The reported state: two sets 12ms apart, both Tasks marked Default.
    const plan = planItemTypeRepair([...builtInSet("b", t1), ...builtInSet("a", t0)]);
    expect(plan.seed).toBe(false);
    expect(plan.remove.map((r) => r.id).sort()).toEqual(["bform", "bmeet", "bmile", "btask"]);
    expect(plan.remove.find((r) => r.id === "btask")?.keepId).toBe("atask");
    expect(plan.clearDefaultIds).toEqual([]);
    expect(plan.setDefaultId).toBeNull();
  });

  it("breaks a createdAt tie on id so both racers agree on the survivor", () => {
    const plan = planItemTypeRepair([...builtInSet("z", t0), ...builtInSet("a", t0)]);
    expect(plan.remove.every((r) => r.id.startsWith("z") && r.keepId.startsWith("a"))).toBe(true);
  });

  it("moves the default to the survivor when only the duplicate held it", () => {
    const older = builtInSet("a", t0).map((r) => ({ ...r, isDefault: false }));
    const plan = planItemTypeRepair([...older, ...builtInSet("b", t1)]);
    expect(plan.setDefaultId).toBe("atask");
  });

  it("keeps the newest deliberate default when two rows claim it", () => {
    const later = new Date("2026-10-01T09:00:00.000Z");
    const rows = [
      ...builtInSet("a", t0),
      row("bug", "Bug", { builtIn: false, isDefault: true, createdAt: t1, updatedAt: later }),
    ];
    const plan = planItemTypeRepair(rows);
    expect(plan.remove).toEqual([]);
    expect(plan.clearDefaultIds).toEqual(["atask"]);
    expect(plan.setDefaultId).toBeNull();
  });
});
