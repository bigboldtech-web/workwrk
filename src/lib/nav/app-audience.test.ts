import { describe, expect, it } from "vitest";
import { appAudienceAllows } from "./app-audience";

const member = { orgRole: "MEMBER" };
const manager = { orgRole: "MEMBER", hasReports: true };
const hr = { orgRole: "MEMBER", peopleTeam: true };
const admin = { orgRole: "ADMIN" };
const guest = { orgRole: "GUEST" };

describe("appAudienceAllows (Phase 7 keys, access 5.2.1)", () => {
  it("opens Tools, Marketplace, Integrations, Automation and Ask AI to every Member", () => {
    for (const key of ["tools", "store", "integrations", "automation", "ai"] as const) {
      expect(appAudienceAllows(key, member)).toBe(true);
      expect(appAudienceAllows(key, guest)).toBe(false);
    }
  });

  it("keeps Assets to anyone with reports, the People team and Admin", () => {
    expect(appAudienceAllows("assets", member)).toBe(false);
    expect(appAudienceAllows("assets", manager)).toBe(true);
    expect(appAudienceAllows("assets", hr)).toBe(true);
    expect(appAudienceAllows("assets", admin)).toBe(true);
  });

  it("keeps Build apps to Owner and Admin", () => {
    expect(appAudienceAllows("build", member)).toBe(false);
    expect(appAudienceAllows("build", manager)).toBe(false);
    expect(appAudienceAllows("build", { orgRole: "OWNER" })).toBe(true);
    expect(appAudienceAllows("build", admin)).toBe(true);
  });
});
