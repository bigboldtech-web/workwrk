// Phase 8 stage F: the pure helpers the enforcement and cleanup stage added.
import { describe, expect, it } from "vitest";
import { NO_TIERS, clearsTier, parseViewerTiers, tiersOfLevel } from "./viewer-tiers";
import { legacyTierAllows } from "./legacy-levels";
import { appAccessImpact, impactSentence, keepsApp, type ImpactPerson } from "./app-floor-impact";
import { appRouteAuditRow, settingsGateAuditRow, settingsGateDecision, settingsGateMode } from "./settings-gate-engine";
import { scoringWriteAllowed, sessionScoringWriteAllowed } from "./settings-legacy";
import { settingsReaderLanding, hubDefaultHref } from "../nav/route-hub";

const LEVELS = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR", "MEMBER", "", null, undefined] as const;

describe("viewer tiers (the Nav batch)", () => {
  it("answers exactly the ladder canAccessTier ran on the client, per level and tier", () => {
    for (const level of LEVELS) {
      const t = tiersOfLevel(level);
      for (const tier of ["manager", "hr-admin", "org-admin"] as const) {
        expect(clearsTier(t, tier)).toBe(legacyTierAllows(tier, level));
      }
      // No requirement always clears, as canAccessTier's first line did.
      expect(clearsTier(t, undefined)).toBe(true);
    }
  });
  it("clears nothing before boot answers, and nothing for an unknown tier", () => {
    expect(clearsTier(null, "manager")).toBe(false);
    expect(clearsTier(NO_TIERS, "org-admin")).toBe(false);
    expect(clearsTier(tiersOfLevel("SUPER_ADMIN"), "bogus")).toBe(false);
  });
  it("parses an older boot payload (no tiers) as none, and ignores stray values", () => {
    expect(parseViewerTiers(undefined)).toEqual(NO_TIERS);
    expect(parseViewerTiers({ manager: "yes", "org-admin": true })).toEqual({ manager: false, "hr-admin": false, "org-admin": true });
  });
});

const person = (over: Partial<ImpactPerson>): ImpactPerson => ({
  id: over.id ?? "u",
  name: over.name ?? "U",
  orgRole: over.orgRole ?? "MEMBER",
  peopleTeam: over.peopleTeam ?? false,
  hasReports: over.hasReports ?? false,
  tiers: over.tiers ?? tiersOfLevel("EMPLOYEE"),
});

describe("N people lose access (Apps & modules preview)", () => {
  const owner = person({ id: "o", name: "Owner", orgRole: "OWNER", tiers: tiersOfLevel("SUPER_ADMIN") });
  const hr = person({ id: "h", name: "Hana", peopleTeam: true, tiers: tiersOfLevel("HR") });
  const lead = person({ id: "l", name: "Lee", tiers: tiersOfLevel("TEAM_LEAD") });
  const ic = person({ id: "i", name: "Ivy", hasReports: true });
  const plain = person({ id: "p", name: "Pat" });
  const all = [owner, hr, lead, ic, plain];

  it("a hide takes the app from everyone, Owners included (rule 2 beats the Admin rule)", () => {
    expect(appAccessImpact(all, { hidden: false }, { hidden: true }, "engine").map((p) => p.id)).toEqual(["o", "h", "l", "i", "p"]);
    expect(appAccessImpact(all, { hidden: false }, { hidden: true }, "legacy")).toHaveLength(5);
  });
  it("a manager floor: the rung today, reports or the People team under the engine", () => {
    const after = { hidden: false, floor: "manager" as const };
    expect(appAccessImpact(all, { hidden: false }, after, "legacy").map((p) => p.id)).toEqual(["i", "p"]);
    expect(appAccessImpact(all, { hidden: false }, after, "engine").map((p) => p.id)).toEqual(["l", "p"]);
  });
  it("org-admin leaves only Owners and Admins; hr-admin adds the People team", () => {
    expect(appAccessImpact(all, { hidden: false }, { hidden: false, floor: "org-admin" }, "engine").map((p) => p.id)).toEqual(["h", "l", "i", "p"]);
    expect(appAccessImpact(all, { hidden: false }, { hidden: false, floor: "hr-admin" }, "engine").map((p) => p.id)).toEqual(["l", "i", "p"]);
  });
  it("a widening change (unhide, lower floor) takes the app from nobody", () => {
    expect(appAccessImpact(all, { hidden: true }, { hidden: false }, "engine")).toEqual([]);
    expect(appAccessImpact(all, { hidden: false, floor: "org-admin" }, { hidden: false, floor: "manager" }, "engine")).toEqual([]);
    expect(keepsApp(plain, { hidden: false, floor: null }, "engine")).toBe(true);
  });
  it("says it in one sentence", () => {
    expect(impactSentence(0, "Goals")).toBe("Nobody loses access to Goals.");
    expect(impactSentence(1, "Goals")).toBe("1 person loses access to Goals.");
    expect(impactSentence(12, "Goals")).toBe("12 people lose access to Goals.");
  });
});

describe("the log-only week", () => {
  it("log-only always wins: today's answer decides, the engine is only asked", () => {
    expect(settingsGateMode({ resolver: true, logOnly: true })).toBe("observe");
    expect(settingsGateMode({ resolver: false, logOnly: false })).toBe("legacy");
    const i = { legacy: true, engine: false, ownerPage: false, workspaceAdmin: false, mayManageOwnerPage: false };
    expect(settingsGateDecision("observe", i)).toEqual({ allowed: true, disagree: true });
    expect(settingsGateDecision("engine", i)).toEqual({ allowed: false, disagree: true });
  });
  it("names the page and says nothing changed, in both directions", () => {
    const deny = settingsGateAuditRow({ page: "scoring", label: "Scoring & reviews", legacy: true, engine: false });
    expect(deny.type).toBe("access.settings_gate.would_deny");
    expect(deny.description).toContain("Scoring & reviews");
    expect(deny.description).toContain("nothing changed");
    expect(settingsGateAuditRow({ page: "structure", legacy: false, engine: true }).type).toBe("access.settings_gate.would_allow");
    const app = appRouteAuditRow("goals", "app-off");
    expect(app.type).toBe("access.app_gate.would_deny");
    expect(app.description).toContain("hidden or has a minimum role");
  });
  it("no copy carries an em dash or a double hyphen", () => {
    const all = [
      settingsGateAuditRow({ page: "x", legacy: true, engine: false }).description,
      settingsGateAuditRow({ page: "x", legacy: false, engine: true }).description,
      appRouteAuditRow("x", "app-off").description,
      appRouteAuditRow("x", "module-off").description,
      appRouteAuditRow("x", "none").description,
      impactSentence(3, "X"),
    ];
    for (const s of all) expect(s).not.toMatch(/—|--/);
  });
});

describe("C-level's Scoring write (access-model-spec 10.1)", () => {
  it("keeps today's reach while today's door decides, and follows the page once the engine does", () => {
    expect(scoringWriteAllowed("C_LEVEL", { admin: false, engineDoor: false })).toBe(true);
    expect(scoringWriteAllowed("C_LEVEL", { admin: false, engineDoor: true })).toBe(false);
    expect(scoringWriteAllowed("COMPANY_ADMIN", { admin: true, engineDoor: true })).toBe(true);
    for (const l of ["VP", "DIRECTOR", "MANAGER", "HR", "EMPLOYEE"]) {
      expect(scoringWriteAllowed(l, { admin: false, engineDoor: false })).toBe(false);
    }
    expect(sessionScoringWriteAllowed({ user: { accessLevel: "C_LEVEL" } }, { admin: false, engineDoor: false })).toBe(true);
    expect(sessionScoringWriteAllowed(null, { admin: false, engineDoor: false })).toBe(false);
  });
});

describe("where the Settings hub lands (spec-settings-workspace 1.1)", () => {
  it("Owner and Admin on Overview, a reader on their first page, everyone else on My settings", () => {
    expect(hubDefaultHref("settings", { canManageWorkspace: true })).toBe("/settings");
    expect(hubDefaultHref("settings", { canManageWorkspace: false, settingsReaderHref: settingsReaderLanding({ settingsReaderPages: ["structure", "members"] }) })).toBe("/settings/members");
    expect(hubDefaultHref("settings", { canManageWorkspace: false, settingsReaderHref: settingsReaderLanding({ settingsReaderPages: [] }) })).toBe("/account/profile");
    expect(settingsReaderLanding({ settingsReader: true })).toBe("/settings/members");
    expect(settingsReaderLanding({ settingsReader: false })).toBeNull();
    expect(hubDefaultHref("settings", { canManageWorkspace: false })).toBe("/account/profile");
  });
});
