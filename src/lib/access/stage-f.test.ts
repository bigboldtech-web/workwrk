// Phase 8 stage F: the pure helpers the enforcement and cleanup stage added.
import { describe, expect, it } from "vitest";
import { NO_TIERS, clearsTier, engineTiers, parseViewerTiers, tiersOfLevel } from "./viewer-tiers";
import { legacyTierAllows } from "./legacy-levels";
import { appAccessImpact, impactSentence, keepsApp, type ImpactPerson } from "./app-floor-impact";
import { appRouteAuditRow, settingsGateAuditRow, settingsGateDecision, settingsGateMode } from "./settings-gate-engine";
import { scoringWriteAllowed, sessionScoringWriteAllowed } from "./settings-legacy";
import { settingsReaderLanding, hubDefaultHref } from "../nav/route-hub";
import { appGatesEnforce } from "./flags";
import { APP_GATE_FILES, ENFORCED_AT } from "./enforcement";
import { APP_KEYS } from "./settings";
import { denialAuditRow } from "./guards";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  ...(over.shared !== undefined ? { shared: over.shared } : {}),
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

// ── Stage F review fixes ─────────────────────────────────────────


describe("the engine's reading of the tiers (rail and route agree once the gates enforce)", () => {
  it("is resolve.ts clearsAppFloor: reports or the People team for manager, the People team for hr-admin", () => {
    expect(engineTiers({ orgRole: "MEMBER", peopleTeam: false, hasReports: false })).toEqual({ manager: false, "hr-admin": false, "org-admin": false });
    expect(engineTiers({ orgRole: "MEMBER", peopleTeam: false, hasReports: true })).toEqual({ manager: true, "hr-admin": false, "org-admin": false });
    expect(engineTiers({ orgRole: "MEMBER", peopleTeam: true, hasReports: false })).toEqual({ manager: true, "hr-admin": true, "org-admin": false });
    expect(engineTiers({ orgRole: "ADMIN", peopleTeam: false, hasReports: false })).toEqual({ manager: true, "hr-admin": true, "org-admin": true });
    expect(engineTiers({ orgRole: "OWNER", peopleTeam: false, hasReports: false })["org-admin"]).toBe(true);
  });
  it("a Guest clears no tier, whatever the facts say", () => {
    expect(engineTiers({ orgRole: "GUEST", peopleTeam: true, hasReports: true })).toEqual(NO_TIERS);
  });
  it("boot switches to it exactly when FlaggedAppKeyGate enforces", () => {
    expect(appGatesEnforce({})).toBe(false);
    expect(appGatesEnforce({ ACCESS_V2_RESOLVER: "true" })).toBe(true);
    expect(appGatesEnforce({ ACCESS_V2_RESOLVER: "true", SETTINGS_GATE_LOG_ONLY: "true" })).toBe(false);
    expect(appGatesEnforce({ SETTINGS_GATE_LOG_ONLY: "true" })).toBe(false);
    for (const resolver of [false, true]) for (const logOnly of [false, true]) {
      const env = { ACCESS_V2_RESOLVER: resolver ? "true" : undefined, SETTINGS_GATE_LOG_ONLY: logOnly ? "true" : undefined };
      expect(appGatesEnforce(env)).toBe(settingsGateMode({ resolver, logOnly }) === "engine");
    }
  });
});

describe("N people lose access counts only people who have the app", () => {
  const admin = person({ id: "a", orgRole: "ADMIN", tiers: tiersOfLevel("COMPANY_ADMIN") });
  const member = person({ id: "m" });
  const lead = person({ id: "l", tiers: tiersOfLevel("TEAM_LEAD") });
  const hr = person({ id: "h", peopleTeam: true, tiers: tiersOfLevel("HR") });
  const guestShared = person({ id: "gs", orgRole: "GUEST", tiers: NO_TIERS, shared: true });
  const guestNone = person({ id: "gn", orgRole: "GUEST", tiers: NO_TIERS, shared: false });
  const all = [admin, member, lead, hr, guestShared, guestNone];

  it("a floor on an Admin-only app (Build apps) names nobody, under either rule", () => {
    const baseline = { requiredAccess: "org-admin" as const, appKey: "build" as const };
    for (const rule of ["legacy", "engine"] as const) {
      expect(appAccessImpact(all, { hidden: false }, { hidden: false, floor: "org-admin" }, rule, baseline)).toEqual([]);
    }
    // Hiding it takes it from the Admin alone.
    expect(appAccessImpact(all, { hidden: false }, { hidden: true }, "engine", baseline).map((p) => p.id)).toEqual(["a"]);
  });
  it("hiding Policies: today the hr-admin launcher entry (Admins, People team); under the engine the page every Member opens", () => {
    const baseline = { requiredAccess: "hr-admin" as const, appKey: "policies" as const };
    expect(appAccessImpact(all, { hidden: false }, { hidden: true }, "legacy", baseline).map((p) => p.id)).toEqual(["a", "h"]);
    expect(appAccessImpact(all, { hidden: false }, { hidden: true }, "engine", baseline).map((p) => p.id)).toEqual(["a", "m", "l", "h"]);
  });
  it("under the engine a Guest counts only for a Guest-visible app they hold something in", () => {
    const docs = { appKey: "docs" as const };
    expect(appAccessImpact(all, { hidden: false }, { hidden: true }, "engine", docs).map((p) => p.id)).toEqual(["a", "m", "l", "h", "gs"]);
    const planner = { appKey: "planner" as const };
    expect(appAccessImpact(all, { hidden: false }, { hidden: true }, "engine", planner).map((p) => p.id)).toEqual(["a", "m", "l", "h"]);
  });
});

describe("every app key names the file that gates it (nothing can go cosmetic)", () => {
  const root = process.cwd();
  it("has one row per APP_KEYS entry, and the file exists", () => {
    for (const key of APP_KEYS) {
      const row = APP_GATE_FILES[key];
      expect(row, key).toBeTruthy();
      expect(existsSync(join(root, row.file)), `${key}: ${row.file}`).toBe(true);
      expect(ENFORCED_AT[`app.${key}`]).toContain(row.file);
    }
  });
  it("the FlaggedAppKeyGate rows name a file that renders it for that key", () => {
    for (const key of APP_KEYS) {
      const row = APP_GATE_FILES[key];
      if (!/FlaggedAppKeyGate|^AppKeyGate/.test(row.how)) continue;
      expect(readFileSync(join(root, row.file), "utf8"), key).toMatch(new RegExp(`appKey="${key}"`));
    }
  });
  it("the canonical object routes sit outside the Docs and SOPs app gates (decision B3)", () => {
    for (const f of ["src/app/(dashboard)/docs/layout.tsx", "src/app/(dashboard)/docs/[id]/layout.tsx", "src/app/(dashboard)/sops/[id]/layout.tsx"]) {
      expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/AppKeyGate/);
    }
    expect(existsSync(join(root, "src/app/(dashboard)/sops/layout.tsx"))).toBe(false);
  });
});

describe("access.denied (spec 5.1)", () => {
  it("names the action, the target and the reason", () => {
    const row = denialAuditRow("view", { type: "app", key: "docs" }, { via: "app-off", reason: "This app is hidden." });
    expect(row.type).toBe("access.denied");
    expect(row.targetType).toBe("app");
    expect(row.targetId).toBe("docs");
    expect(row.metadata).toEqual({ action: "view", via: "app-off", reason: "This app is hidden." });
    expect(row.description).not.toMatch(/—|--/);
  });
});
