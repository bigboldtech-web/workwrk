// A teammate's fingerprints (src/lib/agents/teammate-print.ts): the whole
// one is worked out as round 9 did, so versions published since still match
// an unchanged teammate, and the part prints say what changed.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stableJson } from "@/lib/automation/definition";
import { changedFields, othersMayChange, teammateFieldPrints, teammateFingerprint, type PrintedTeammate } from "./teammate-print";

const PLANNER: PrintedTeammate = {
  name: "Planner",
  description: "Plans the week",
  systemPrompt: "Be brief.",
  toolNames: ["list_tasks", "create_task"],
  approvalRules: { create_task: "ask" },
  modelOverride: null,
  productSlug: null,
};

describe("teammateFingerprint", () => {
  it("is the round 9 fingerprint, so an unchanged teammate still matches a version published then", () => {
    const round9 = createHash("sha256")
      .update(stableJson([PLANNER.name, PLANNER.description ?? "", PLANNER.systemPrompt ?? "", PLANNER.toolNames ?? null, PLANNER.approvalRules ?? null, PLANNER.modelOverride ?? "", PLANNER.productSlug ?? ""]))
      .digest("hex")
      .slice(0, 32);
    expect(teammateFingerprint(PLANNER)).toBe(round9);
    expect(teammateFingerprint({ ...PLANNER, systemPrompt: "Read everything." })).not.toBe(round9);
  });
});

describe("changedFields", () => {
  it("names each part that changed, and none without kept part prints", () => {
    const kept = teammateFieldPrints(PLANNER);
    expect(changedFields(kept, PLANNER)).toEqual([]);
    expect(changedFields(kept, { ...PLANNER, systemPrompt: "Read everything.", toolNames: ["read_dms"] })).toEqual(["instructions", "tools"]);
    expect(changedFields(kept, { ...PLANNER, modelOverride: "claude-opus-5-5" })).toEqual(["model"]);
    expect(changedFields(undefined, { ...PLANNER, name: "Spy" })).toEqual([]);
  });
});

describe("othersMayChange", () => {
  it("is false only for the person's own private teammate", () => {
    expect(othersMayChange({ visibility: "PRIVATE", ownerId: "u1" }, "u1")).toBe(false);
    expect(othersMayChange({ visibility: "PRIVATE", ownerId: "u2" }, "u1")).toBe(true);
    expect(othersMayChange({ visibility: "WORKSPACE", ownerId: "u1" }, "u1")).toBe(true);
  });
});
