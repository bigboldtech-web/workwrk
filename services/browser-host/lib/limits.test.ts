import { describe, expect, it } from "vitest";

import { computeMax, createSlots, GIB, MIB } from "./limits.mjs";

describe("computeMax (6.2)", () => {
  it("gives the table's max for each server, at the default 1280 MiB", () => {
    expect(computeMax(7936 * MIB, 4, 1280, null)).toBe(4);
    expect(computeMax(15_970 * MIB, 8, 1280, null)).toBe(10);
    expect(computeMax(32_050 * MIB, 8, 1280, null)).toBe(16);
  });

  it("gives 1 for 4 GiB with 2 vCPU, and 0 under 2 GiB, so a start is refused", () => {
    expect(computeMax(4 * GIB, 2, 1280, null)).toBe(1);
    expect(computeMax(2 * GIB - 1, 8, 1280, null)).toBe(0);
    expect(computeMax(GIB, 8, 1280, null)).toBe(0);
  });

  it("is never above 2 a vCPU or 100", () => {
    expect(computeMax(64 * GIB, 2, 1024, null)).toBe(4);
    expect(computeMax(4096 * GIB, 512, 1024, null)).toBe(100);
  });

  it("lets the override lower it and never raise it", () => {
    expect(computeMax(7936 * MIB, 4, 1280, 2)).toBe(2);
    expect(computeMax(7936 * MIB, 4, 1280, 40)).toBe(4);
    expect(computeMax(7936 * MIB, 4, 1280, 0)).toBe(0);
  });

  it("process mode: 1024 MiB and no shim", () => {
    expect(computeMax(16 * GIB, 8, 1024, null, 0)).toBe(14);
  });
});

describe("held slots", () => {
  it("count beside the sessions, and holdSlot is refused when none is free", () => {
    const slots = createSlots(4);
    const a = slots.holdSlot("image_build", 2);
    expect(a).toBeTypeOf("function");
    expect(slots.held()).toBe(1);
    expect(slots.holdSlot("selftest", 3)).toBeNull();
    const b = slots.holdSlot("selftest", 2);
    expect(b).toBeTypeOf("function");
    expect(slots.held()).toBe(2);
    expect(slots.holdSlot("selftest", 2)).toBeNull();
    a?.();
    a?.();
    expect(slots.held()).toBe(1);
    expect(slots.reasons()).toEqual(["selftest"]);
  });
});
