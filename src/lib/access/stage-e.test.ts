// Phase 8 stage E: the pure pieces of the access flip (flags, the node
// bridge, the effective org role, the matrix gate rules, the settings door
// with its log-only week, the node-access parity table).

import { describe, expect, it, vi, afterEach } from "vitest";
import { accessV2Resolver, accessV2Tables, delegateOn, flagOn, flagSummary, settingsGateLogOnly } from "./flags";
import { bridgeTarget, bridgedGrants, isBridgedType, objectRoleOfNodeRole } from "./node-bridge";
import { effectiveAdminScopes, effectiveIsAgent, effectiveOrgRole } from "./org-role";
import { MATRIX_CELL_RULES, matrixCellAllowed } from "./matrix-rules";
import {
  engineWithOwnerFloor,
  logSettingsGateDisagreement,
  resetSettingsGateLog,
  settingsGateDecision,
  settingsGateMode,
} from "./settings-gate-engine";
import { classifyNodeMismatch, parityRoleOf, runNodeParity, type NodeParityCase } from "./node-parity";
import { legacySettingsAllows } from "./settings-legacy";
import { nodeRoleOfEngineRole } from "./delegate";
import type { ChainLink } from "./types";

describe("flags: every flag is off unless exactly 'true'", () => {
  it("defaults off", () => {
    expect(accessV2Resolver({})).toBe(false);
    expect(accessV2Tables({})).toBe(false);
    expect(settingsGateLogOnly({})).toBe(false);
  });
  it("only the literal true turns one on", () => {
    expect(flagOn("ACCESS_V2_TABLES", { ACCESS_V2_TABLES: "1" })).toBe(false);
    expect(flagOn("ACCESS_V2_TABLES", { ACCESS_V2_TABLES: "TRUE" })).toBe(false);
    expect(flagOn("ACCESS_V2_TABLES", { ACCESS_V2_TABLES: "true" })).toBe(true);
  });
  it("node helpers delegate only with BOTH flags on (never over the old tables)", () => {
    expect(delegateOn("node", { ACCESS_V2_RESOLVER: "true" })).toBe(false);
    expect(delegateOn("node", { ACCESS_V2_TABLES: "true" })).toBe(false);
    expect(delegateOn("node", { ACCESS_V2_RESOLVER: "true", ACCESS_V2_TABLES: "true" })).toBe(true);
  });
  it("the settings door waits for its log-only week to end", () => {
    expect(delegateOn("settings", { ACCESS_V2_RESOLVER: "true", SETTINGS_GATE_LOG_ONLY: "true" })).toBe(false);
    expect(delegateOn("settings", { ACCESS_V2_RESOLVER: "true" })).toBe(true);
  });
  it("summarises", () => {
    expect(flagSummary({ ACCESS_V2_TABLES: "true" })).toBe("ACCESS_V2_RESOLVER=off ACCESS_V2_TABLES=on SETTINGS_GATE_LOG_ONLY=off");
  });
});

describe("node bridge", () => {
  const listLink: ChainLink = { type: "list", id: "L1", name: "L", ownerId: null, restricted: false, findable: false, archived: false };
  it("maps the five panel rungs onto four roles; the Space Owner rung is Full", () => {
    expect(objectRoleOfNodeRole("OWNER")).toBe("FULL");
    expect(objectRoleOfNodeRole("FULL")).toBe("FULL");
    expect(objectRoleOfNodeRole("COMMENT")).toBe("COMMENT");
    expect(objectRoleOfNodeRole("none")).toBeNull();
  });
  it("a task asks its List and the grant sits on the List", () => {
    expect(bridgeTarget({ type: "item", id: "I1" }, [listLink])).toEqual({ node: { kind: "list", id: "L1" }, grantOn: { type: "list", id: "L1" } });
    expect(bridgeTarget({ type: "item", id: "I1" }, [])).toBeNull();
  });
  it("a canvas is a whiteboard to the engine", () => {
    expect(bridgeTarget({ type: "whiteboard", id: "W" }, [])?.node).toEqual({ kind: "canvas", id: "W" });
  });
  it("types node-access does not own are never bridged", () => {
    expect(isBridgedType("sop_folder")).toBe(false);
    expect(isBridgedType("goal")).toBe(false);
    expect(isBridgedType("item")).toBe(true);
    expect(bridgeTarget({ type: "goal", id: "G" }, [])).toBeNull();
  });
  it("none is no grant at all, never a VIEW", () => {
    expect(bridgedGrants({ type: "doc", id: "D" }, "u", "none")).toEqual([]);
    expect(bridgedGrants({ type: "doc", id: "D" }, "u", "EDIT")[0]).toMatchObject({ subjectType: "USER", subjectId: "u", role: "EDIT", expiresAt: null });
  });
  it("the engine's role goes back onto the panel ladder keeping the Owner rung", () => {
    expect(nodeRoleOfEngineRole("FULL", "OWNER")).toBe("OWNER");
    expect(nodeRoleOfEngineRole("FULL", "EDIT")).toBe("FULL");
    expect(nodeRoleOfEngineRole("none", "OWNER")).toBe("none");
  });
});

describe("the org role with the tables flag: the mirror, refined only by the live Owner pick", () => {
  it("an Admin who is the Owner pick is an Owner", () => {
    expect(effectiveOrgRole("COMPANY_ADMIN", true)).toBe("OWNER");
    expect(effectiveOrgRole("COMPANY_ADMIN", false)).toBe("ADMIN");
  });
  it("the pick never lifts a Member", () => {
    expect(effectiveOrgRole("EMPLOYEE", true)).toBe("MEMBER");
    expect(effectiveOrgRole("MANAGER", true)).toBe("MEMBER");
  });
  it("SUPER_ADMIN is always an Owner", () => {
    expect(effectiveOrgRole("SUPER_ADMIN", false)).toBe("OWNER");
  });
  it("scopes count only for an Admin; Owners hold both", () => {
    expect(effectiveAdminScopes("MEMBER", ["billing"])).toEqual([]);
    expect(effectiveAdminScopes("ADMIN", ["billing", "bogus"])).toEqual(["billing"]);
    expect(effectiveAdminScopes("OWNER", [])).toEqual(["billing", "security"]);
  });
  it("the Agent flag follows the level", () => {
    expect(effectiveIsAgent("AGENT")).toBe(true);
    expect(effectiveIsAgent("EMPLOYEE")).toBe(false);
  });
});

describe("matrix cells as gate rules (spec 9)", () => {
  const member = { orgRole: "MEMBER" as const, isAgent: false, peopleTeam: false, hasReports: false };
  const editors = { whoCanPublish: "editors" as const };
  it("names the fourteen enforced cells plus the four extra reads, once each", () => {
    const keys = MATRIX_CELL_RULES.map((r) => `${r.module}.${r.action}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["people.create", "kras.create", "kras.edit", "kras.delete", "kras.assign", "sops.create", "sops.edit", "sops.publish", "sops.delete", "policies.create", "announcements.create", "assets.create", "assets.edit", "assets.delete"]) {
      expect(keys).toContain(k);
    }
  });
  it("a cell the table does not own keeps the matrix (null)", () => {
    expect(matrixCellAllowed("tools", "share", member, editors)).toBeNull();
    expect(matrixCellAllowed("settings", "manageBilling", member, editors)).toBeNull();
  });
  it("invites are Owner and Admin", () => {
    expect(matrixCellAllowed("people", "create", member, editors)).toBe(false);
    expect(matrixCellAllowed("people", "create", { ...member, peopleTeam: true }, editors)).toBe(false);
    expect(matrixCellAllowed("people", "create", { ...member, orgRole: "ADMIN" }, editors)).toBe(true);
  });
  it("KRA definitions are Admin and the People team; assigning adds the manager chain", () => {
    expect(matrixCellAllowed("kras", "create", { ...member, peopleTeam: true }, editors)).toBe(true);
    expect(matrixCellAllowed("kras", "create", { ...member, hasReports: true }, editors)).toBe(false);
    expect(matrixCellAllowed("kras", "assign", { ...member, hasReports: true }, editors)).toBe(true);
  });
  it("deletes stay Owner and Admin (never widened at the org level)", () => {
    expect(matrixCellAllowed("sops", "delete", { ...member, peopleTeam: true }, editors)).toBe(false);
    expect(matrixCellAllowed("kras", "delete", { ...member, peopleTeam: true }, editors)).toBe(false);
    expect(matrixCellAllowed("assets", "delete", { ...member, orgRole: "OWNER" }, editors)).toBe(true);
  });
  it("toggle 7 decides who publishes", () => {
    expect(matrixCellAllowed("sops", "publish", member, editors)).toBe(true);
    expect(matrixCellAllowed("sops", "publish", member, { whoCanPublish: "admins_people_team" })).toBe(false);
    expect(matrixCellAllowed("sops", "publish", { ...member, peopleTeam: true }, { whoCanPublish: "admins_people_team" })).toBe(true);
  });
  it("Guests never, Agents only for content", () => {
    expect(matrixCellAllowed("sops", "create", { ...member, orgRole: "GUEST" }, editors)).toBe(false);
    expect(matrixCellAllowed("sops", "create", { ...member, isAgent: true }, editors)).toBe(true);
    expect(matrixCellAllowed("kras", "create", { ...member, isAgent: true, peopleTeam: true }, editors)).toBe(false);
  });
});

describe("the settings door on the engine", () => {
  afterEach(() => resetSettingsGateLog());
  const base = { legacy: true, engine: true, ownerPage: false, workspaceAdmin: true, mayManageOwnerPage: true };
  it("modes: legacy by default, observe in the log-only week, engine after", () => {
    expect(settingsGateMode({ resolver: false, logOnly: false })).toBe("legacy");
    expect(settingsGateMode({ resolver: true, logOnly: true })).toBe("observe");
    expect(settingsGateMode({ resolver: false, logOnly: true })).toBe("observe");
    expect(settingsGateMode({ resolver: true, logOnly: false })).toBe("engine");
  });
  it("observe never changes the answer, and flags the disagreement", () => {
    const d = settingsGateDecision("observe", { ...base, legacy: true, engine: false });
    expect(d).toEqual({ allowed: true, disagree: true });
  });
  it("an Admin the engine refuses on an Owner page still opens it while the split is off", () => {
    expect(engineWithOwnerFloor({ ...base, engine: false, ownerPage: true, mayManageOwnerPage: true })).toBe(true);
    expect(engineWithOwnerFloor({ ...base, engine: false, ownerPage: true, mayManageOwnerPage: false })).toBe(false);
    expect(engineWithOwnerFloor({ ...base, engine: false, ownerPage: false })).toBe(false);
  });
  it("engine mode narrows the manager tier off Members", () => {
    expect(settingsGateDecision("engine", { ...base, legacy: true, engine: false, workspaceAdmin: false }).allowed).toBe(false);
  });
  it("logs a disagreement once per person per page per window", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = { userId: "u", organizationId: "o", page: "members", legacy: true, engine: false, mode: "observe" as const, now: 1000 };
    expect(logSettingsGateDisagreement(e)).toBe(true);
    expect(logSettingsGateDisagreement({ ...e, now: 2000 })).toBe(false);
    expect(logSettingsGateDisagreement({ ...e, now: 1000 + 10 * 60 * 1000 })).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it("today's table", () => {
    expect(legacySettingsAllows("members", "MANAGER")).toBe(true);
    expect(legacySettingsAllows("billing", "MANAGER")).toBe(false);
    expect(legacySettingsAllows("billing", "COMPANY_ADMIN")).toBe(true);
    expect(legacySettingsAllows("structure", "HR")).toBe(false);
  });
});

describe("node-access parity table", () => {
  const viewer = { userId: "u", accessLevel: "EMPLOYEE", orgAdmin: false, peopleTeam: false, agent: false, hasReports: false };
  const c = (over: Partial<NodeParityCase>): NodeParityCase => ({ id: "x", section: "node", kind: "doc", objectId: "d", viewer, truth: "EDIT", engine: "VIEW", ...over });
  it("the old-tables row applies only with ACCESS_V2_TABLES off", () => {
    expect(classifyNodeMismatch(c({}), { resolver: false, tables: false })).toBe("tables-off-engine-reads-old-tables");
    expect(classifyNodeMismatch(c({}), { resolver: false, tables: true })).toBeNull();
  });
  it("an Agent capped at Can edit is expected in every state", () => {
    expect(classifyNodeMismatch(c({ truth: "FULL", engine: "EDIT", viewer: { ...viewer, agent: true } }), { resolver: true, tables: true })).toBe("agent-cap-clamps-full-to-edit");
  });
  it("the archived cap is expected; a denial is not", () => {
    expect(classifyNodeMismatch(c({ facts: { archived: true } }), { resolver: true, tables: true })).toBe("archived-object-reads-view-only");
    expect(classifyNodeMismatch(c({ engine: "none", facts: { archived: true } }), { resolver: true, tables: true })).toBeNull();
  });
  it("counts agreed, expected and unexpected", () => {
    const r = runNodeParity([c({ truth: "VIEW", engine: "VIEW" }), c({ facts: { archived: true } }), c({ truth: "VIEW", engine: "FULL" })], { resolver: true, tables: true });
    expect(r.agreed).toBe(1);
    expect(r.expectedByKey["archived-object-reads-view-only"]).toBe(1);
    expect(r.unexpected).toHaveLength(1);
  });
  it("maps panel roles", () => {
    expect(parityRoleOf("OWNER")).toBe("FULL");
    expect(parityRoleOf(undefined)).toBe("none");
  });
});

import { lockItDownChanges, lockItDownPatch, toggleStatuses } from "./toggle-status";
import { DEFAULT_ACCESS_SETTINGS } from "./settings";
import { requestExpired, requestNodeRef, REQUEST_TTL_MS } from "./access-requests";
import { viaSentence } from "./check-access";

describe("access toggles: live only where something reads them", () => {
  it("with the flags off only the People team and Public links are live", () => {
    const live = toggleStatuses({ resolver: false, tables: false }).filter((t) => t.live).map((t) => t.key);
    expect(live).toEqual(["peopleTeamUserIds", "publicLinks"]);
  });
  it("the resolver makes Space creation and SOP publishing live", () => {
    const live = toggleStatuses({ resolver: true, tables: false }).filter((t) => t.live).map((t) => t.key);
    expect(live).toContain("whoCanCreateSpaces");
    expect(live).toContain("whoCanPublish");
  });
  it("every toggle that is not live says why", () => {
    for (const t of toggleStatuses({ resolver: false, tables: false })) {
      if (!t.live) expect(t.caption).toBeTruthy();
    }
  });
  it("Lock it down never touches the People team", () => {
    const p = lockItDownPatch();
    expect("peopleTeamUserIds" in p).toBe(false);
    expect("peopleTeamDepartmentId" in p).toBe(false);
    expect(p.publicLinks).toBe("off");
    expect(lockItDownChanges(DEFAULT_ACCESS_SETTINGS)).toContain("whoCanCreateSpaces");
  });
});

describe("access requests", () => {
  it("maps the seven node kinds and nothing else", () => {
    expect(requestNodeRef("board", "b")).toEqual({ kind: "list", id: "b" });
    expect(requestNodeRef("whiteboard", "w")).toEqual({ kind: "canvas", id: "w" });
    expect(requestNodeRef("sop", "s")).toBeNull();
    expect(requestNodeRef("goal", "g")).toBeNull();
  });
  it("a request expires after 14 days", () => {
    expect(requestExpired(new Date(0), REQUEST_TTL_MS - 1)).toBe(false);
    expect(requestExpired(new Date(0), REQUEST_TTL_MS + 1)).toBe(true);
  });
});

describe("Check access sentences", () => {
  const name = () => "Marketing";
  it("names the source in plain words", () => {
    expect(viaSentence("EDIT", { type: "own", node: { kind: "list", id: "l" }, source: "BoardMember" }, name, "Acme")).toBe("Can edit. Shared with them directly.");
    expect(viaSentence("VIEW", { type: "everyone", node: { kind: "space", id: "s" } }, name, "Acme")).toBe("Can view. Space Marketing is open to everyone in Acme.");
    expect(viaSentence("FULL", { type: "org_admin" }, name, "Acme")).toBe("Full access. They are an Owner or Admin of Acme.");
    expect(viaSentence("none", { type: "none" }, name, "Acme")).toMatch(/^No access/);
  });
});

import { issueKey } from "../zod-issue-key";
import { z } from "zod";

describe("a strict 400 names the key", () => {
  it("names an unknown key, a bad field, or the body", () => {
    const s = z.object({ name: z.string() }).strict();
    const r1 = s.safeParse({ name: "x", bogus: 1 });
    expect(r1.success ? "" : issueKey(r1.error.issues[0])).toBe("bogus");
    const r2 = s.safeParse({ name: 3 });
    expect(r2.success ? "" : issueKey(r2.error.issues[0])).toBe("name");
    expect(issueKey(undefined)).toBe("body");
  });
});

describe("node parity: a deactivated person", () => {
  it("is expected to be refused by the engine whatever the live helper said", () => {
    const viewer = { userId: "u", accessLevel: "EMPLOYEE", orgAdmin: false, peopleTeam: false, agent: false, hasReports: false, status: "INACTIVE" };
    const c = { id: "x", section: "node" as const, kind: "item", objectId: "i", viewer, truth: "VIEW" as const, engine: "none" as const };
    expect(classifyNodeMismatch(c, { resolver: true, tables: true })).toBe("inactive-person-has-no-session");
    expect(classifyNodeMismatch({ ...c, viewer: { ...viewer, status: "ACTIVE" } }, { resolver: true, tables: true })).toBeNull();
  });
});
