import { describe, expect, it } from "vitest";
import { AUTOMATION_TRIGGERS, isLegacyTrigger, legacyTriggersEnabled, triggersForOrg } from "./registry-triggers";

describe("the Cashkr-era triggers behind the product flag", () => {
  it("marks leads, quotes, pickups and payments as legacy and nothing else", () => {
    const legacy = AUTOMATION_TRIGGERS.filter((t) => isLegacyTrigger(t.key)).map((t) => t.key).sort();
    expect(legacy).toEqual([
      "lead.created", "lead.owner_changed", "lead.status_changed",
      "payment.failed", "payment.successful",
      "pickup.completed", "pickup.scheduled",
      "quote.accepted", "quote.generated",
    ]);
    expect(isLegacyTrigger("task.created")).toBe(false);
  });

  it("hides them while the flag is off, and never drops a trigger from the list", () => {
    const off = triggersForOrg(false);
    expect(off).toHaveLength(AUTOMATION_TRIGGERS.length);
    expect(off.filter((t) => t.hidden).every((t) => isLegacyTrigger(t.key))).toBe(true);
    expect(off.find((t) => t.key === "lead.created")?.hidden).toBe(true);
    expect(triggersForOrg(true).some((t) => (t as { hidden?: boolean }).hidden)).toBe(false);
  });

  it("reads the flag tolerantly", () => {
    expect(legacyTriggersEnabled(null)).toBe(false);
    expect(legacyTriggersEnabled({})).toBe(false);
    expect(legacyTriggersEnabled({ automation: { legacyTriggers: "yes" } })).toBe(false);
    expect(legacyTriggersEnabled({ automation: { legacyTriggers: true } })).toBe(true);
  });
});
