import { describe, expect, it } from "vitest";
import { presenceDot } from "./presence";
import { isAssignableSeniority, isSetSeniority, seniorityLabel, seniorityStoredLabel } from "./seniority";

describe("presenceDot", () => {
  const now = new Date("2026-09-27T10:00:00Z");
  it("draws nothing without a value, or once it has expired", () => {
    expect(presenceDot(null, null, now)).toBeNull();
    expect(presenceDot("  ", null, now)).toBeNull();
    expect(presenceDot("In a meeting", "2026-09-27T09:00:00Z", now)).toBeNull();
  });
  it("reads busy statuses as busy and carries the words", () => {
    expect(presenceDot("Do not disturb", "2026-09-27T12:00:00Z", now)).toEqual({ label: "Do not disturb", tone: "busy" });
    expect(presenceDot("Online", null, now)?.tone).toBe("online");
  });
});

describe("seniority", () => {
  it("labels the six, never shows an access word as seniority, and exports the stored value", () => {
    expect(seniorityLabel("TEAM_LEAD")).toBe("Team lead");
    // spec-goals: display-only seniority never reads "Admin", "Super" or "HR".
    expect(seniorityLabel("COMPANY_ADMIN")).toBe("Not set");
    expect(seniorityLabel("HR")).toBe("Not set");
    expect(seniorityLabel(null)).toBe("Employee");
    expect(seniorityStoredLabel("COMPANY_ADMIN")).toBe("Company admin");
    expect(isSetSeniority("HR")).toBe(false);
    expect(isSetSeniority("VP")).toBe(true);
  });
  it("never lets a picker write an admin level onto a job title", () => {
    expect(isAssignableSeniority("COMPANY_ADMIN")).toBe(false);
    expect(isAssignableSeniority("COMPANY_ADMIN", "COMPANY_ADMIN")).toBe(true);
    expect(isAssignableSeniority("VP")).toBe(true);
  });
});
