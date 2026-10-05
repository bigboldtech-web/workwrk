// Which plans include Talk and Tables (src/lib/modules.ts): Starter cannot
// turn on a module it never had; a workspace that had one keeps it.

import { describe, expect, it } from "vitest";
import { moduleNeedsUpgrade, moduleUpgradeSentence } from "./modules";

describe("moduleNeedsUpgrade", () => {
  it("asks a Starter workspace that never had the module to change plan", () => {
    expect(moduleNeedsUpgrade("STARTER", false)).toBe(true);
    expect(moduleNeedsUpgrade(null, false)).toBe(true);
  });

  it("never takes a module away from a workspace that had it, on or off", () => {
    expect(moduleNeedsUpgrade("STARTER", true)).toBe(false);
  });

  it("lets every paid plan turn it on", () => {
    for (const plan of ["GROWTH", "SCALE", "ENTERPRISE"]) expect(moduleNeedsUpgrade(plan, false)).toBe(false);
  });
});

describe("moduleUpgradeSentence", () => {
  it("names the plan and the next step for whoever reads it", () => {
    expect(moduleUpgradeSentence("Talk", true)).toBe("Talk is included from the Growth plan. Change the plan in Settings, Plan & billing.");
    expect(moduleUpgradeSentence("Tables", false)).toBe("Tables is included from the Growth plan. Ask an Owner or Admin to change the plan.");
  });
});
