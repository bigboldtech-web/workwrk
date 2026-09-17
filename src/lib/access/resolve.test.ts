// The golden suite for the access engine.
//
// Spec 5.1 says this file "encodes every row of audit table 1.6, worked
// examples A to K, the section 3.5 field table, the section 5.2.1 app table
// and every section 11 invariant as AccessFacts fixtures". That is what is
// below, in that order, each test named after the rule, invariant or example
// it encodes.
//
// WHAT IS A CONTRACT HERE. `allowed`, `role`, `via`, `discoverable` and the
// presence of `context` are the contract: a future refactor that changes any
// of them fails a test by name. `reason` and `enforcedAt` are English for the
// LockedPage and the audit row: they are asserted only where the spec quotes
// them (example H's Billing sentence), never as a general shape.
//
// This file imports only the pure half of the engine. vitest here is node-only
// over src/lib/**/*.test.ts and resolves no "@/" alias, so nothing it touches
// may reach prisma, next-auth or a React component.

import { describe, expect, it } from "vitest";

import { decide, explainSources, hasReports, shortCircuit } from "./resolve";
import {
  emptyRelationships,
  ROLE_RANK,
  maxRole,
  meetsRole,
  minRole,
  type AccessFacts,
  type AccessSettings,
  type Action,
  type AppKey,
  type ChainLink,
  type GrantFact,
  type ObjectFacts,
  type ObjectRole,
  type ObjectType,
  type OrgAction,
  type OrgRole,
  type Relationships,
  type SettingsPageKey,
  type Viewer,
  ACTIONS,
  OBJECT_TYPES,
  ORG_ACTIONS,
} from "./types";
import {
  APP_KEYS,
  APP_RULES,
  DEFAULT_ACCESS_SETTINGS,
  LOCK_IT_DOWN_ACCESS_SETTINGS,
  SETTINGS_PAGE_GATES,
  TODAY_EQUIVALENT_ACCESS_SETTINGS,
  parseAccessSettings,
} from "./settings";
import { ENFORCED_AT, REQUIRED_ENFORCEMENT_KEYS } from "./enforcement";
import { spaceSets } from "./id-sets";
import { APP_BY_OBJECT_TYPE, parseOrgAppsConfig } from "./settings";
import { accessLevelMirror, adminScopesOf, isAgentOf, orgRoleOf } from "./org-role";
import { OBJECT_ROLE_BLURB, OBJECT_ROLE_LABEL, ORG_ROLE_ORDER } from "./labels";
import {
  DENIAL_SAMPLE_WINDOW_MS,
  adminOwnsGuard,
  orgRolePromotionGuard,
  invitationOrgRoleFor,
  lastFullHolderGuard,
  lastOwnerGuard,
  mayMintSignedUrl,
  peopleFieldAccess,
  publicLinkRole,
  shouldLogDenial,
  transferTargetFor,
  writeBumpsTokenVersion,
  type PeopleRelationship,
} from "./guards";
import {
  EXPECTED_MISMATCHES,
  LEGACY_HELPERS,
  classifyMismatch,
  compareDecisions,
  engineAnswer,
  legacyAnswer,
  runParity,
  type LegacyInputs,
  type ParityCase,
} from "./parity";

// ── Fixtures ──────────────────────────────────────────────────────

const ORG = "org_acme";
const NOW = 1_700_000_000_000;

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: "u_me",
    organizationId: ORG,
    orgRole: "MEMBER",
    isAgent: false,
    adminScopes: [],
    status: "ACTIVE",
    reportTree: new Set(),
    peopleTeam: false,
    departmentId: null,
    officeId: null,
    roleId: null,
    teamIds: [],
    tagIds: [],
    ...overrides,
  };
}

function object(type: ObjectType, overrides: Partial<ObjectFacts> = {}): ObjectFacts {
  return {
    type,
    id: `${type}_1`,
    organizationId: ORG,
    ownerId: null,
    restricted: false,
    findable: false,
    archived: false,
    ...overrides,
  };
}

function link(type: ObjectType, id: string, overrides: Partial<ChainLink> = {}): ChainLink {
  return {
    type,
    id,
    name: id,
    ownerId: null,
    restricted: false,
    findable: false,
    archived: false,
    ...overrides,
  };
}

function grant(
  objectType: ObjectType,
  objectId: string,
  role: ObjectRole,
  overrides: Partial<GrantFact> = {},
): GrantFact {
  return {
    objectType,
    objectId,
    subjectType: "USER",
    subjectId: "u_me",
    role,
    expiresAt: null,
    ...overrides,
  };
}

function everyone(objectType: ObjectType, objectId: string, role: ObjectRole): GrantFact {
  return { objectType, objectId, subjectType: "EVERYONE", subjectId: null, role, expiresAt: null };
}

interface FactOverrides {
  viewer?: Viewer;
  object?: ObjectFacts;
  chain?: ChainLink[];
  grants?: GrantFact[];
  relationships?: Partial<Relationships>;
  access?: Partial<AccessSettings>;
  activeModules?: string[];
  apps?: AccessFacts["org"]["apps"];
  peopleTeamIds?: string[];
  app?: AppKey;
  settingsPage?: SettingsPageKey;
  orgAction?: OrgAction;
  now?: number;
}

function facts(o: FactOverrides = {}): AccessFacts {
  return {
    viewer: o.viewer ?? viewer(),
    object: o.object ?? object("list"),
    chain: o.chain ?? [],
    grants: o.grants ?? [],
    relationships: { ...emptyRelationships(), ...(o.relationships ?? {}) },
    org: {
      access: { ...DEFAULT_ACCESS_SETTINGS, ...(o.access ?? {}) },
      activeModules: new Set(o.activeModules ?? ["chat", "tables"]),
      apps: o.apps ?? {},
      peopleTeamIds: o.peopleTeamIds ?? [],
    },
    now: o.now ?? NOW,
    app: o.app,
    settingsPage: o.settingsPage,
    orgAction: o.orgAction,
  };
}

// ─────────────────────────────────────────────────────────────────
// 1. The ladder itself
// ─────────────────────────────────────────────────────────────────

describe("the one ladder (spec 3.1)", () => {
  it("ranks FULL > EDIT > COMMENT > VIEW > none", () => {
    expect(ROLE_RANK.FULL).toBeGreaterThan(ROLE_RANK.EDIT);
    expect(ROLE_RANK.EDIT).toBeGreaterThan(ROLE_RANK.COMMENT);
    expect(ROLE_RANK.COMMENT).toBeGreaterThan(ROLE_RANK.VIEW);
    expect(ROLE_RANK.VIEW).toBeGreaterThan(ROLE_RANK.none);
  });

  it("maxRole is rule 11 and minRole is rule 12", () => {
    expect(maxRole("VIEW", "EDIT")).toBe("EDIT");
    expect(maxRole("none", "VIEW")).toBe("VIEW");
    expect(minRole("FULL", "VIEW")).toBe("VIEW");
    expect(meetsRole("EDIT", "COMMENT")).toBe(true);
    expect(meetsRole("COMMENT", "EDIT")).toBe(false);
  });

  it("carries exactly one copy of the labels and blurbs", () => {
    expect(OBJECT_ROLE_LABEL.FULL).toBe("Full access");
    expect(OBJECT_ROLE_LABEL.EDIT).toBe("Can edit");
    expect(OBJECT_ROLE_LABEL.COMMENT).toBe("Can comment");
    expect(OBJECT_ROLE_LABEL.VIEW).toBe("Can view");
    expect(OBJECT_ROLE_BLURB.FULL).toBe("Change settings, sharing, delete and transfer.");
    expect(OBJECT_ROLE_BLURB.VIEW).toBe("Read only.");
  });
});

describe("orgRoleOf (spec 2.1 mapping table)", () => {
  const rows: Array<[string | null, OrgRole]> = [
    ["SUPER_ADMIN", "OWNER"],
    ["COMPANY_ADMIN", "ADMIN"],
    ["C_LEVEL", "MEMBER"],
    ["VP", "MEMBER"],
    ["DIRECTOR", "MEMBER"],
    ["MANAGER", "MEMBER"],
    ["TEAM_LEAD", "MEMBER"],
    ["HR", "MEMBER"],
    ["EMPLOYEE", "MEMBER"],
    ["AGENT", "MEMBER"],
    [null, "GUEST"],
  ];

  for (const [level, expected] of rows) {
    it(`maps ${level ?? "(none)"} to ${expected}`, () => {
      expect(orgRoleOf({ accessLevel: level })).toBe(expected);
    });
  }

  it("promotes the earliest COMPANY_ADMIN to Owner", () => {
    expect(orgRoleOf({ accessLevel: "COMPANY_ADMIN", isEarliestAdmin: true })).toBe("OWNER");
  });

  it("AGENT becomes a Member carrying the Agent flag", () => {
    expect(orgRoleOf({ accessLevel: "AGENT" })).toBe("MEMBER");
    expect(isAgentOf("AGENT")).toBe(true);
    expect(isAgentOf("EMPLOYEE")).toBe(false);
  });

  it("keeps the written mirror round-tripping (spec 10 step 0)", () => {
    expect(accessLevelMirror("OWNER", false)).toBe("SUPER_ADMIN");
    expect(accessLevelMirror("ADMIN", false)).toBe("COMPANY_ADMIN");
    expect(accessLevelMirror("MEMBER", true)).toBe("AGENT");
    expect(accessLevelMirror("MEMBER", false)).toBe("EMPLOYEE");
  });

  it("gives an Owner both admin scopes implicitly", () => {
    expect(adminScopesOf("OWNER", null)).toEqual(["billing", "security"]);
    expect(adminScopesOf("ADMIN", null)).toEqual([]);
    expect(adminScopesOf("ADMIN", ["billing", "nonsense"])).toEqual(["billing"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. The fourteen rules, one test each
// ─────────────────────────────────────────────────────────────────

describe("rule 1: org scoping first", () => {
  it("404s a cross-org id with no role and no discoverability", () => {
    const d = decide(facts({ object: object("list", { organizationId: "org_other" }) }), "view");
    expect(d).toMatchObject({ allowed: false, role: "none", discoverable: false });
  });

  it("404s a soft-deleted viewer", () => {
    const d = decide(facts({ viewer: viewer({ deleted: true, orgRole: "OWNER" }) }), "view");
    expect(d.allowed).toBe(false);
    expect(d.discoverable).toBe(false);
  });

  it("admits every status that can hold a session, and 404s the ones that cannot", () => {
    // Spec rule 1 words this as "status not ACTIVE or PROBATION". Taken
    // literally that locks ON_LEAVE, PIP and NOTICE_PERIOD employees out of
    // the whole product, which contradicts auth.ts:148-156: it signs all five
    // in and says they "are still employed and keep their access". No gate in
    // the codebase reads status at all today, so the literal reading would be
    // an unrecorded narrowing of real people's access. The engine denies the
    // set that cannot hold a session, and the deviation from the spec's
    // wording is recorded in EXPECTED_MISMATCHES under
    // "rule-1-status-follows-auth-not-the-literal-spec".
    for (const status of ["ACTIVE", "PROBATION", "ON_LEAVE", "PIP", "NOTICE_PERIOD"] as const) {
      const d = decide(
        facts({ viewer: viewer({ status, orgRole: "ADMIN" }), object: object("space") }),
        "view",
      );
      expect(d.allowed, `${status} should keep its access`).toBe(true);
    }
    const d = decide(
      facts({ viewer: viewer({ status: "INACTIVE", orgRole: "ADMIN" }), object: object("space") }),
      "view",
    );
    expect(d.allowed).toBe(false);
    expect(d.discoverable).toBe(false);
  });
});

describe("rule 2: module off, before the Admin rule", () => {
  it("returns module-off for an Admin and stays discoverable", () => {
    const d = decide(
      facts({
        viewer: viewer({ orgRole: "ADMIN" }),
        object: object("channel", { moduleKey: "chat" }),
        activeModules: [],
      }),
      "view",
    );
    expect(d).toMatchObject({ allowed: false, role: "none", via: "module-off", discoverable: true });
    expect(d.context).toEqual({ module: "chat" });
  });

  it("returns app-off when the org hid the app", () => {
    const d = decide(facts({ app: "kudos", apps: { hidden: ["kudos"] } }), "view");
    expect(d).toMatchObject({ via: "app-off", allowed: false, discoverable: true });
  });

  it("never floors an alwaysPinned app", () => {
    const d = decide(
      facts({ app: "settings", apps: { hidden: ["settings"], minAccess: { settings: "org-admin" } } }),
      "view",
    );
    expect(d.allowed).toBe(true);
  });

  it("honours the org Apps floor for a plain Member", () => {
    const member = decide(facts({ app: "goals", apps: { minAccess: { goals: "org-admin" } } }), "view");
    expect(member.via).toBe("app-off");
    const admin = decide(
      facts({ viewer: viewer({ orgRole: "ADMIN" }), app: "goals", apps: { minAccess: { goals: "org-admin" } } }),
      "view",
    );
    expect(admin.allowed).toBe(true);
  });

  it("locks the OBJECTS of a hidden or floored app, not just its rail icon", () => {
    // Spec 7.1: "A hidden app or a floor is enforced by rule 2, so a hidden
    // app's routes lock, not just its icon." Rule 2 reads object.appKey, so
    // every object type whose app row is unambiguous carries one.
    const assetRef = object("asset", { id: "asset_1", appKey: "assets" });
    const hidden = decide(facts({ object: assetRef, apps: { hidden: ["assets"] } }), "view");
    expect(hidden.via).toBe("app-off");
    expect(hidden.role).toBe("none");

    const floored = decide(
      facts({ object: assetRef, apps: { minAccess: { assets: "org-admin" } } }),
      "view",
    );
    expect(floored.via).toBe("app-off");

    // And it beats the Admin rule for a floor the Admin does clear, which is
    // the point of rule 2 sitting ahead of rule 4.
    const admin = decide(
      facts({
        viewer: viewer({ orgRole: "ADMIN" }),
        object: assetRef,
        apps: { minAccess: { assets: "org-admin" } },
      }),
      "view",
    );
    expect(admin.allowed).toBe(true);

    // With no Apps config the object resolves normally.
    const open = decide(facts({ object: assetRef, relationships: { peopleTeam: true } }), "view");
    expect(open.allowed).toBe(true);
  });

  it("names an app for every object type whose Apps row governs it", () => {
    // The table is what makes the half above reachable from a real ref: with
    // no entry, loadFacts leaves appKey null and the Apps config is display
    // only for that type.
    for (const type of [
      "asset",
      "survey",
      "review_cycle",
      "candor",
      "kudos",
      "tool",
      "policy",
      "contract",
      "announcement",
      "automation",
      "goal",
      "timesheet",
      "sop",
      "sop_folder",
      "file",
      "file_folder",
      "channel",
      "table",
      "form",
    ] as const) {
      const key = APP_BY_OBJECT_TYPE[type];
      expect(key, type).toBeTruthy();
      expect(APP_RULES[key as AppKey], `${type} -> ${key}`).toBeTruthy();
    }
    // A Space, Folder, List, Item or Doc belongs to no single app: they are
    // the Work OS itself and are reachable from several hubs.
    for (const type of ["space", "folder", "list", "item", "doc"] as const) {
      expect(APP_BY_OBJECT_TYPE[type], type).toBeUndefined();
    }
  });

  it("tolerates a hand-edited Apps blob instead of throwing inside the gate", () => {
    // parseOrgAppsConfig is what stands between rule 2 and a 500: a stored
    // number under `hidden` would make `.includes` throw, and a stored string
    // would substring-match app keys.
    const parsed = parseOrgAppsConfig({
      order: ["home", 7, null],
      hidden: "goals",
      minAccess: { goals: "org-admin", planner: "nonsense", docs: 3 },
    });
    expect(parsed.hidden).toBeUndefined();
    expect(parsed.order).toEqual(["home"]);
    expect(parsed.minAccess).toEqual({ goals: "org-admin" });
    expect(parseOrgAppsConfig(null)).toEqual({});
    expect(parseOrgAppsConfig("nope")).toEqual({});

    const d = decide(facts({ app: "goals", apps: parseOrgAppsConfig({ hidden: 5 }) }), "view");
    expect(d.allowed).toBe(true);
  });
});

describe("rule 3: the owner-only hard rule, before the Admin rule", () => {
  it("gives the notepad owner FULL", () => {
    const d = decide(
      facts({
        object: object("doc", { ownerOnly: "notepad", ownerOnlySubjectId: "u_me" }),
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: true, role: "FULL", via: "owner" });
  });

  it("denies an Owner someone else's notepad, with no discoverability", () => {
    const d = decide(
      facts({
        viewer: viewer({ orgRole: "OWNER" }),
        object: object("doc", { ownerOnly: "notepad", ownerOnlySubjectId: "u_other" }),
      }),
      "view",
    );
    expect(d).toMatchObject({ allowed: false, role: "none", discoverable: false });
  });

  it("gives a private channel's creator FULL, so they can manage what they made", () => {
    // Spec 3.6: "Private channels and group DMs: ConversationMember rows are
    // the grant at EDIT; creator FULL." Rule 3 short-circuits before rule 5
    // ever runs, so the creator has to be recognised here or they can never
    // rename or archive their own channel.
    const creator = facts({
      object: object("channel", { ownerOnly: "private-channel", moduleKey: "chat", ownerId: "u_me" }),
      relationships: { isConversationMember: true },
    });
    expect(decide(creator, "manage")).toMatchObject({ allowed: true, role: "FULL", via: "owner" });

    const member = facts({
      object: object("channel", {
        ownerOnly: "private-channel",
        moduleKey: "chat",
        ownerId: "u_other",
      }),
      relationships: { isConversationMember: true },
    });
    expect(decide(member, "edit").allowed).toBe(true);
    expect(decide(member, "manage").allowed).toBe(false);
  });

  it("gives a DM member EDIT and everyone else nothing", () => {
    const member = decide(
      facts({
        object: object("channel", { ownerOnly: "dm", moduleKey: "chat" }),
        relationships: { isConversationMember: true },
      }),
      "edit",
    );
    expect(member).toMatchObject({ allowed: true, role: "EDIT" });

    const admin = decide(
      facts({
        viewer: viewer({ orgRole: "ADMIN" }),
        object: object("channel", { ownerOnly: "dm", moduleKey: "chat" }),
      }),
      "view",
    );
    expect(admin).toMatchObject({ allowed: false, role: "none", discoverable: false });
  });
});

describe("rule 4: org Owner and Admin short-circuit to FULL", () => {
  it("gives an Admin FULL on a Space they hold nothing on", () => {
    const d = decide(facts({ viewer: viewer({ orgRole: "ADMIN" }), object: object("space") }), "manage");
    expect(d).toMatchObject({ allowed: true, role: "FULL", via: "org-admin" });
  });
});

describe("rule 5: the object's owner", () => {
  it("gives the owner FULL", () => {
    const d = decide(facts({ object: object("list", { ownerId: "u_me" }) }), "manage");
    expect(d).toMatchObject({ allowed: true, role: "FULL", via: "owner" });
  });

  it("does not fire on an Item, whose ownerId is the assignee not a creator", () => {
    // Item.ownerId is the DRI and is kept in sync with assigneeIds[0]
    // (schema.prisma:4432-4436); loadFacts sets ObjectFacts.ownerId to null
    // for items and the assignee rule covers it instead.
    const d = decide(facts({ object: object("item") }), "edit");
    expect(d.allowed).toBe(false);
  });
});

describe("rules 6, 7 and 8: user, group and EVERYONE grants", () => {
  it("honours a direct user grant", () => {
    const d = decide(facts({ grants: [grant("list", "list_1", "EDIT")] }), "edit");
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "shared" });
  });

  it("honours a department grant", () => {
    const d = decide(
      facts({
        viewer: viewer({ departmentId: "dept_eng" }),
        grants: [
          { objectType: "list", objectId: "list_1", subjectType: "DEPARTMENT", subjectId: "dept_eng", role: "COMMENT", expiresAt: null },
        ],
      }),
      "comment",
    );
    expect(d).toMatchObject({ allowed: true, role: "COMMENT", via: "department" });
  });

  it("ignores a group grant the viewer is not in", () => {
    const d = decide(
      facts({
        viewer: viewer({ departmentId: "dept_sales" }),
        grants: [
          { objectType: "list", objectId: "list_1", subjectType: "DEPARTMENT", subjectId: "dept_eng", role: "EDIT", expiresAt: null },
        ],
      }),
      "view",
    );
    expect(d.role).toBe("none");
  });

  it("gives a Member an EVERYONE grant and a Guest nothing", () => {
    const member = decide(facts({ grants: [everyone("list", "list_1", "VIEW")] }), "view");
    expect(member).toMatchObject({ allowed: true, via: "everyone" });

    const guest = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), grants: [everyone("list", "list_1", "VIEW")] }),
      "view",
    );
    expect(guest.role).toBe("none");
  });
});

describe("rule 9: relationships are rules, not rows", () => {
  it("gives an Item assignee EDIT", () => {
    const d = decide(facts({ object: object("item"), relationships: { isAssignee: true } }), "edit");
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "assigned" });
  });

  it("gives the manager chain EDIT on people data", () => {
    const d = decide(
      facts({ object: object("person", { id: "u_report" }), relationships: { managesSubject: true } }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "manager-chain" });
  });

  it("gives the People team EDIT on people data", () => {
    const d = decide(
      facts({ object: object("person", { id: "u_anyone" }), peopleTeamIds: ["u_me"] }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "people-team" });
  });

  it("gives a SOP author EDIT on their draft and nothing extra once published", () => {
    const draft = decide(
      facts({ object: object("sop", { published: false }), relationships: { isSopAuthor: true } }),
      "edit",
    );
    expect(draft.allowed).toBe(true);

    const published = decide(
      facts({ object: object("sop", { published: true, ownerId: "u_me" }), relationships: { isSopAuthor: true } }),
      "edit",
    );
    expect(published.allowed).toBe(false);
  });

  it("gives a Policy assignee COMMENT to acknowledge, never EDIT", () => {
    const f = facts({ object: object("policy"), relationships: { isPolicyAssignee: true } });
    expect(decide(f, "comment").allowed).toBe(true);
    expect(decide(f, "edit").allowed).toBe(false);
  });

  it("gives a contract party VIEW and nobody else anything", () => {
    expect(
      decide(facts({ object: object("contract"), relationships: { isContractParty: true } }), "view").allowed,
    ).toBe(true);
    expect(decide(facts({ object: object("contract") }), "view").allowed).toBe(false);
  });
});

describe("rule 10: inheritance, stopped by Restricted", () => {
  it("inherits a folder grant down to a list inside it", () => {
    const d = decide(
      facts({
        object: object("list"),
        chain: [link("folder", "folder_1", { name: "Client X" }), link("space", "space_1")],
        grants: [grant("folder", "folder_1", "EDIT")],
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "inherited" });
    expect(d.viaObject).toMatchObject({ type: "folder", id: "folder_1", name: "Client X" });
  });

  it("never leaks upward: a grant on a list gives nothing on its space", () => {
    const d = decide(
      facts({
        object: object("space", { id: "space_1" }),
        grants: [grant("list", "list_1", "FULL")],
      }),
      "view",
    );
    expect(d.role).toBe("none");
  });

  it("stops at a Restricted object", () => {
    const d = decide(
      facts({
        object: object("list", { restricted: true }),
        chain: [link("space", "space_1")],
        grants: [grant("space", "space_1", "FULL")],
      }),
      "view",
    );
    expect(d.role).toBe("none");
  });

  it("evaluates a Restricted ancestor's own grants and then stops", () => {
    const d = decide(
      facts({
        object: object("list"),
        chain: [link("folder", "folder_1", { restricted: true }), link("space", "space_1")],
        grants: [grant("folder", "folder_1", "EDIT"), grant("space", "space_1", "FULL")],
      }),
      "edit",
    );
    expect(d.role).toBe("EDIT"); // the folder grant applies, the space FULL does not
  });

  it("walks at most eight hops", () => {
    const chain = Array.from({ length: 12 }, (_, n) => link("folder", `folder_${n}`));
    const d = decide(
      facts({ object: object("list"), chain, grants: [grant("folder", "folder_9", "FULL")] }),
      "view",
    );
    expect(d.role).toBe("none");
  });
});

describe("rule 11: the maximum of every source", () => {
  it("takes the highest role, never the first or the last", () => {
    const d = decide(
      facts({
        object: object("list"),
        chain: [link("space", "space_1")],
        grants: [grant("list", "list_1", "VIEW"), grant("space", "space_1", "EDIT")],
      }),
      "edit",
    );
    expect(d.role).toBe("EDIT");
  });

  it("a direct grant is a floor, never a ceiling (add, never subtract)", () => {
    const d = decide(
      facts({
        object: object("list"),
        chain: [link("space", "space_1")],
        grants: [grant("list", "list_1", "VIEW"), grant("space", "space_1", "FULL")],
      }),
      "manage",
    );
    expect(d.role).toBe("FULL");
  });
});

describe("rule 12: the caps, in order", () => {
  it("caps a Guest at EDIT unless they own the object", () => {
    const shared = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), grants: [grant("list", "list_1", "FULL")] }),
      "view",
    );
    expect(shared.role).toBe("EDIT");

    const owned = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), object: object("list", { ownerId: "u_me" }) }),
      "view",
    );
    expect(owned.role).toBe("FULL");
  });

  it("caps an Agent at EDIT and always denies delete, export and create_space", () => {
    const agent = viewer({ isAgent: true });
    const f = facts({ viewer: agent, object: object("list", { ownerId: "u_me" }) });
    expect(decide(f, "view").role).toBe("EDIT");
    expect(decide(f, "delete").allowed).toBe(false);
    expect(decide(f, "export").allowed).toBe(false);
    expect(decide(facts({ viewer: agent, orgAction: "create_space" }), "view").allowed).toBe(false);
  });

  it("caps an acting-as principal at min(live level, cap)", () => {
    const key = viewer({ actingAs: { type: "api-key", id: "key_1", cap: "EDIT" } });
    const d = decide(facts({ viewer: key, grants: [grant("list", "list_1", "FULL")] }), "manage");
    expect(d.role).toBe("EDIT");
    expect(d.allowed).toBe(false);
  });

  it("caps everyone at VIEW on an archived object, except a FULL holder", () => {
    const editor = decide(
      facts({ object: object("list", { archived: true }), grants: [grant("list", "list_1", "EDIT")] }),
      "edit",
    );
    expect(editor).toMatchObject({ allowed: false, role: "VIEW" });

    const full = decide(
      facts({ object: object("list", { archived: true, ownerId: "u_me" }) }),
      "archive",
    );
    expect(full).toMatchObject({ allowed: true, role: "FULL" });
  });

  it("does not let the archive escape hatch defeat the Agent, Guest or acting-as caps", () => {
    // The escape hatch exists so a FULL holder can restore an archived object.
    // It must be measured against the role AFTER the principal caps, never
    // against the uncapped one: an Agent who owns a Space, or an EDIT-capped
    // API key acting for an Owner, has FULL before rule 12 and EDIT after, and
    // rule 13 needs FULL for `archive`.
    const archived = { archived: true, ownerId: "u_me" };

    const agent = facts({ viewer: viewer({ isAgent: true }), object: object("list", archived) });
    expect(decide(agent, "manage").allowed).toBe(false);
    expect(decide(agent, "archive").allowed).toBe(false);

    const guest = facts({
      viewer: viewer({ orgRole: "GUEST" }),
      object: object("list", { archived: true }),
      grants: [grant("list", "list_1", "FULL")],
    });
    expect(decide(guest, "archive").allowed).toBe(false);

    const key = facts({
      viewer: viewer({ orgRole: "OWNER", actingAs: { type: "api-key", id: "k", cap: "EDIT" } }),
      object: object("list", { archived: true }),
    });
    expect(decide(key, "manage").allowed).toBe(false);
    expect(decide(key, "archive").allowed).toBe(false);

    // And the hatch still works for the person it is for.
    const owner = facts({ object: object("list", archived) });
    expect(decide(owner, "archive").allowed).toBe(true);
  });

  it("applies the acting-as cap to settings, app and org refs too", () => {
    // Spec 2.5: "no cron path holds FULL." An EDIT-capped key acting for an
    // Owner must not reach Billing, Security or API keys at FULL just because
    // those refs resolve on their own table instead of through finish().
    const key = viewer({ orgRole: "OWNER", actingAs: { type: "api-key", id: "k", cap: "EDIT" } });
    for (const page of ["billing", "security", "api"] as const) {
      const d = decide(facts({ viewer: key, settingsPage: page }), "manage");
      expect(d.role, page).toBe("EDIT");
      expect(d.allowed, page).toBe(false);
    }
    // A personal page is capped the same way.
    const personal = decide(facts({ viewer: key, settingsPage: "account/security" }), "manage");
    expect(personal.role).toBe("EDIT");
    expect(personal.allowed).toBe(false);

    // An app ref resolves at VIEW for a Member, which the cap does not lower.
    const app = decide(facts({ viewer: key, app: "home" }), "view");
    expect(app.allowed).toBe(true);

    // The admin-shaped org verbs are refused outright.
    for (const action of ["invite_member", "invite_guest", "archive_channel"] as const) {
      const d = decide(facts({ viewer: key, orgAction: action }), "view");
      expect(d.allowed, action).toBe(false);
    }
  });

  it("never lets an agent run share or read someone else's people data", () => {
    // Spec 2.5: agents "never share, never export, never read people data
    // beyond the acting user".
    const agentRun = viewer({ actingAs: { type: "agent", id: "run_1", cap: "EDIT" } });
    const shareable = facts({
      viewer: agentRun,
      object: object("list", { ownerId: "u_me" }),
      access: { editorsCanShare: true },
    });
    expect(decide(shareable, "share").allowed).toBe(false);
    expect(decide(shareable, "export").allowed).toBe(false);

    const other = facts({
      viewer: agentRun,
      object: object("person", { id: "u_other" }),
      relationships: { managesSubject: true },
    });
    expect(decide(other, "view").allowed).toBe(false);

    const self = facts({
      viewer: agentRun,
      object: object("person", { id: "u_me" }),
      relationships: { isSelfSubject: true },
    });
    expect(decide(self, "view").allowed).toBe(true);
  });

  it("never lets a Guest invite another Guest, even on something they created", () => {
    // Spec 2.3: a Guest "cannot ... invit[e] anyone". Rule 12 preserves FULL on
    // their own creations, so without a hard denial that FULL would clear
    // rule 13's invite_guest bar under toggle 5's default.
    const d = decide(
      facts({
        viewer: viewer({ orgRole: "GUEST" }),
        object: object("list", { ownerId: "u_me" }),
        access: { whoCanInviteGuests: "full_access" },
      }),
      "invite_guest",
    );
    expect(d.role).toBe("FULL");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("Guests never invite");
  });

  it("caps through an archived ancestor too", () => {
    const d = decide(
      facts({
        object: object("list"),
        chain: [link("folder", "folder_1", { archived: true }), link("space", "space_1")],
        grants: [grant("space", "space_1", "EDIT")],
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: false, role: "VIEW" });
  });
});

describe("rule 13: the action check", () => {
  const table: Array<[Action, ObjectRole, boolean]> = [
    ["view", "VIEW", true],
    ["comment", "VIEW", false],
    ["comment", "COMMENT", true],
    ["edit", "COMMENT", false],
    ["edit", "EDIT", true],
    ["create_child", "EDIT", true],
    ["manage", "EDIT", false],
    ["manage", "FULL", true],
    ["restrict", "FULL", true],
    ["findable", "FULL", true],
    ["move", "FULL", true],
    ["archive", "FULL", true],
    ["transfer", "FULL", true],
    ["delete", "FULL", true],
    ["export", "EDIT", true],
  ];

  for (const [action, role, expected] of table) {
    it(`${action} at ${role} is ${expected ? "allowed" : "denied"}`, () => {
      const d = decide(facts({ grants: [grant("list", "list_1", role)] }), action);
      expect(d.allowed).toBe(expected);
    });
  }

  it("share needs FULL, or EDIT under toggle 4", () => {
    const off = facts({ grants: [grant("list", "list_1", "EDIT")], access: { editorsCanShare: false } });
    expect(decide(off, "share").allowed).toBe(false);
    const on = facts({ grants: [grant("list", "list_1", "EDIT")], access: { editorsCanShare: true } });
    expect(decide(on, "share").allowed).toBe(true);
  });

  it("delete needs FULL and toggle 8", () => {
    const f = facts({
      object: object("list", { ownerId: "u_me" }),
      access: { whoCanDelete: "admins" },
    });
    expect(decide(f, "delete").allowed).toBe(false);
    const admin = decide(
      facts({ viewer: viewer({ orgRole: "ADMIN" }), access: { whoCanDelete: "admins" } }),
      "delete",
    );
    expect(admin.allowed).toBe(true);
  });

  it("publish needs EDIT, or Admin and the People team under toggle 7", () => {
    const editors = facts({
      object: object("sop"),
      grants: [grant("sop", "sop_1", "EDIT")],
      access: { whoCanPublish: "editors" },
    });
    expect(decide(editors, "publish").allowed).toBe(true);

    const locked = facts({
      object: object("sop"),
      grants: [grant("sop", "sop_1", "EDIT")],
      access: { whoCanPublish: "admins_people_team" },
    });
    expect(decide(locked, "publish").allowed).toBe(false);

    const peopleTeam = facts({
      object: object("sop"),
      grants: [grant("sop", "sop_1", "EDIT")],
      access: { whoCanPublish: "admins_people_team" },
      peopleTeamIds: ["u_me"],
    });
    expect(decide(peopleTeam, "publish").allowed).toBe(true);
  });

  it("treats toggle 7 as a restriction, not as a grant on things you cannot see", () => {
    // The toggle narrows WHO may publish; it does not hand publish rights on
    // an object the viewer holds nothing on. Without the role check the
    // decision would come back { allowed: true, role: "none" }, which is
    // incoherent, and every People-team member would be able to publish every
    // SOP in the org including ones in folders they hold no row on.
    const noRole = facts({
      object: object("sop"),
      access: { whoCanPublish: "admins_people_team" },
      peopleTeamIds: ["u_me"],
    });
    const d = decide(noRole, "publish");
    expect(d.role).toBe("none");
    expect(d.allowed).toBe(false);
  });

  it("invite_guest needs FULL and toggle 5", () => {
    const full = facts({ object: object("list", { ownerId: "u_me" }) });
    expect(decide(full, "invite_guest").allowed).toBe(true);
    const nobody = facts({
      object: object("list", { ownerId: "u_me" }),
      access: { whoCanInviteGuests: "nobody" },
    });
    expect(decide(nobody, "invite_guest").allowed).toBe(false);
  });
});

describe("rule 14: discoverable is separate from accessible", () => {
  it("makes a findable Space discoverable to a Member with no role", () => {
    const d = decide(facts({ object: object("space", { findable: true }) }), "view");
    expect(d).toMatchObject({ allowed: false, role: "none", discoverable: true });
  });

  it("obeys the master switch (toggle 3)", () => {
    const d = decide(
      facts({ object: object("space", { findable: true }), access: { findableSpaces: false } }),
      "view",
    );
    expect(d.discoverable).toBe(false);
  });

  it("inherits findability as a ceiling", () => {
    const d = decide(
      facts({
        object: object("channel", { findable: true, moduleKey: "chat" }),
        chain: [link("space", "space_1", { findable: false })],
      }),
      "view",
    );
    expect(d.discoverable).toBe(false);
  });

  it("never makes a Folder or a List findable on its own", () => {
    for (const type of ["folder", "list"] as const) {
      const d = decide(facts({ object: object(type, { findable: true }) }), "view");
      expect(d.discoverable).toBe(false);
    }
  });

  it("makes a container discoverable when the viewer holds something inside", () => {
    const d = decide(
      facts({ object: object("space"), relationships: { holdsDescendant: true } }),
      "view",
    );
    expect(d.discoverable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. The worked examples, A to K (spec 4.1)
// ─────────────────────────────────────────────────────────────────

describe("example A: a Guest shared on a List", () => {
  const ravi = viewer({ userId: "u_ravi", orgRole: "GUEST" });
  const listFacts = (o: FactOverrides = {}) =>
    facts({
      viewer: ravi,
      object: object("list", { id: "list_website" }),
      chain: [link("folder", "folder_q4", { name: "Q4" }), link("space", "space_marketing", { name: "Marketing", findable: true })],
      grants: [grant("list", "list_website", "EDIT", { subjectId: "u_ravi" })],
      ...o,
    });

  it("can edit the List", () => {
    expect(decide(listFacts(), "edit")).toMatchObject({ allowed: true, role: "EDIT", via: "shared" });
  });

  it("sees the Folder as a container label, not content", () => {
    const d = decide(
      facts({
        viewer: ravi,
        object: object("folder", { id: "folder_q4" }),
        chain: [link("space", "space_marketing")],
        relationships: { holdsDescendant: true },
      }),
      "view",
    );
    // Worked example A, verbatim: "rule 14: descendant role, discoverable as
    // a container label ... Folder page renders LockedPage: 'You have access
    // to 1 list in this folder.'" Rule 14's "(never a Guest)" clause belongs
    // to the FINDABLE branch, which is why the same example makes the findable
    // Marketing Space a 404 for the same Guest two lines later, and why spec
    // 2.3's Guest sidebar shows "their containers as bare labels".
    expect(d.role).toBe("none");
    expect(d.discoverable).toBe(true);
  });

  it("still never discovers a findable Space it holds nothing inside", () => {
    const d = decide(
      facts({
        viewer: ravi,
        object: object("space", { id: "space_marketing", findable: true }),
        access: { findableSpaces: true },
      }),
      "view",
    );
    // "/spaces/marketing is a 404 for him even though Marketing is findable
    // (Guests never discover)" - example A. This is the half invariant 3 owns.
    expect(d.role).toBe("none");
    expect(d.discoverable).toBe(false);
  });

  it("cannot share the List, even with toggle 4 on", () => {
    const d = decide(listFacts({ access: { editorsCanShare: true } }), "share");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("Guests never share");
  });

  it("inherits EDIT onto an Item in that List", () => {
    const d = decide(
      facts({
        viewer: ravi,
        object: object("item", { id: "item_1" }),
        chain: [link("list", "list_website"), link("folder", "folder_q4"), link("space", "space_marketing")],
        grants: [grant("list", "list_website", "EDIT", { subjectId: "u_ravi" })],
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "inherited" });
  });

  it("404s on the findable Marketing Space (Guests never discover)", () => {
    const d = decide(
      facts({ viewer: ravi, object: object("space", { id: "space_marketing", findable: true }) }),
      "view",
    );
    expect(d).toMatchObject({ role: "none", discoverable: false });
  });
});

describe("example B: a Member assigned a task in a Space they are not in", () => {
  const maya = viewer({ userId: "u_maya" });

  it("can edit the Item through the assignee rule", () => {
    const d = decide(
      facts({
        viewer: maya,
        object: object("item", { id: "item_invoice" }),
        chain: [link("list", "list_backlog"), link("space", "space_finance")],
        relationships: { isAssignee: true },
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "assigned" });
  });

  it("gets the List locked, discoverable, with VIEW-for-context", () => {
    const d = decide(
      facts({
        viewer: maya,
        object: object("list", {
          id: "list_backlog",
          context: { name: "Backlog", statuses: ["todo", "done"] },
        }),
        chain: [link("space", "space_finance")],
        relationships: { hasAssignedItemInside: true },
      }),
      "view",
    );
    expect(d).toMatchObject({ allowed: false, role: "none", discoverable: true });
    expect(d.context).toMatchObject({ name: "Backlog" });
  });

  it("cannot create a task in that List (EDIT on the item is not EDIT on the List)", () => {
    const d = decide(
      facts({
        viewer: maya,
        object: object("list", { id: "list_backlog" }),
        relationships: { hasAssignedItemInside: true },
      }),
      "create_child",
    );
    expect(d.allowed).toBe(false);
  });

  it("sees the Space as a discoverable label", () => {
    const d = decide(
      facts({
        viewer: maya,
        object: object("space", { id: "space_finance" }),
        relationships: { hasAssignedItemInside: true },
      }),
      "view",
    );
    expect(d).toMatchObject({ role: "none", discoverable: true });
  });
});

describe("example C: a manager viewing a report's KRAs", () => {
  it("gives a manager and a skip-level manager EDIT on people data", () => {
    for (const who of ["anita", "karan"]) {
      const d = decide(
        facts({
          viewer: viewer({ userId: `u_${who}`, reportTree: new Set(["u_dev"]) }),
          object: object("person", { id: "u_dev" }),
          relationships: { managesSubject: true },
        }),
        "edit",
      );
      expect(d).toMatchObject({ allowed: true, via: "manager-chain" });
    }
  });

  it("gives a report nothing on their manager's people data, only the card", () => {
    const data = decide(
      facts({ viewer: viewer({ userId: "u_dev" }), object: object("person", { id: "u_anita" }) }),
      "view",
    );
    expect(data.role).toBe("none");

    const card = decide(
      facts({ viewer: viewer({ userId: "u_dev" }), object: object("person_card", { id: "u_anita" }) }),
      "view",
    );
    expect(card).toMatchObject({ allowed: true, role: "VIEW" });
  });

  it("gives a manager nothing on someone outside their chain", () => {
    const d = decide(
      facts({
        viewer: viewer({ userId: "u_anita", reportTree: new Set(["u_dev"]) }),
        object: object("person", { id: "u_priya" }),
      }),
      "view",
    );
    expect(d.role).toBe("none");
  });
});

describe("example D: People team versus a department head", () => {
  const sunita = viewer({ userId: "u_sunita" });
  const rahul = viewer({ userId: "u_rahul", reportTree: new Set(["u_a", "u_b"]) });

  it("gives the People team EDIT on every person and FULL on policies", () => {
    const person = decide(
      facts({ viewer: sunita, object: object("person", { id: "u_anyone" }), peopleTeamIds: ["u_sunita"] }),
      "edit",
    );
    expect(person).toMatchObject({ allowed: true, via: "people-team" });

    const policy = decide(
      facts({ viewer: sunita, object: object("policy"), peopleTeamIds: ["u_sunita"] }),
      "manage",
    );
    expect(policy).toMatchObject({ allowed: true, role: "FULL" });
  });

  it("gives the People team no Workspace settings page", () => {
    const d = decide(
      facts({ viewer: sunita, settingsPage: "identity", peopleTeamIds: ["u_sunita"] }),
      "view",
    );
    expect(d.allowed).toBe(false);
  });

  it("gives a department head their chain and nothing else", () => {
    const mine = decide(
      facts({ viewer: rahul, object: object("person", { id: "u_a" }), relationships: { managesSubject: true } }),
      "edit",
    );
    expect(mine.allowed).toBe(true);

    const theirs = decide(facts({ viewer: rahul, object: object("person", { id: "u_sunita" }) }), "view");
    expect(theirs.role).toBe("none");
  });
});

describe("example E: a Space Full holder versus a Restricted List", () => {
  it("does not pierce, and the List is not discoverable", () => {
    const d = decide(
      facts({
        viewer: viewer({ userId: "u_nia" }),
        object: object("list", { id: "list_L", restricted: true }),
        chain: [link("space", "space_S")],
        grants: [grant("space", "space_S", "FULL", { subjectId: "u_nia" })],
      }),
      "view",
    );
    expect(d).toMatchObject({ allowed: false, role: "none", discoverable: false });
  });

  it("the G5 backfill's explicit grant restores the reach", () => {
    const d = decide(
      facts({
        viewer: viewer({ userId: "u_nia" }),
        object: object("list", { id: "list_L", restricted: true }),
        chain: [link("space", "space_S")],
        grants: [
          grant("space", "space_S", "FULL", { subjectId: "u_nia" }),
          grant("list", "list_L", "FULL", { subjectId: "u_nia" }),
        ],
      }),
      "manage",
    );
    expect(d).toMatchObject({ allowed: true, role: "FULL" });
  });
});

describe("example F: an API key after its creator was demoted", () => {
  it("resolves at min(live level, cap) and 403s the write", () => {
    const key = viewer({
      userId: "u_omar",
      orgRole: "MEMBER",
      actingAs: { type: "api-key", id: "key_K", cap: "EDIT" },
    });
    const d = decide(
      facts({
        viewer: key,
        object: object("list", { id: "list_in_S" }),
        chain: [link("space", "space_S")],
        grants: [grant("space", "space_S", "VIEW", { subjectId: "u_omar" })],
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: false, role: "VIEW" });
  });

  it("an ADMIN-scope key still cannot exceed a demoted creator", () => {
    const key = viewer({
      userId: "u_omar",
      orgRole: "MEMBER",
      actingAs: { type: "api-key", id: "key_K", cap: "FULL" },
    });
    const d = decide(
      facts({
        viewer: key,
        object: object("list", { id: "list_in_S" }),
        chain: [link("space", "space_S")],
        grants: [grant("space", "space_S", "VIEW", { subjectId: "u_omar" })],
      }),
      "manage",
    );
    expect(d.role).toBe("VIEW");
  });
});

describe("example G: an archived Folder", () => {
  it("drops an inherited EDIT to VIEW", () => {
    const d = decide(
      facts({
        viewer: viewer({ userId: "u_priya" }),
        object: object("list"),
        chain: [link("folder", "folder_F", { archived: true }), link("space", "space_1")],
        grants: [grant("space", "space_1", "EDIT", { subjectId: "u_priya" })],
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: false, role: "VIEW" });
  });

  it("leaves a FULL holder able to restore", () => {
    const d = decide(
      facts({
        viewer: viewer({ userId: "u_priya" }),
        object: object("list"),
        chain: [link("folder", "folder_F", { archived: true }), link("space", "space_1")],
        grants: [grant("space", "space_1", "FULL", { subjectId: "u_priya" })],
      }),
      "archive",
    );
    expect(d).toMatchObject({ allowed: true, role: "FULL" });
  });
});

describe("example H: an Admin opening Billing", () => {
  it("denies it, keeps it discoverable, and says who owns it", () => {
    const ken = viewer({ userId: "u_ken", orgRole: "ADMIN", adminScopes: [] });
    const d = decide(facts({ viewer: ken, settingsPage: "billing" }), "view");
    expect(d).toMatchObject({ allowed: false, role: "none", discoverable: true });
    expect(d.reason).toBe("Billing is managed by workspace Owners.");
  });

  it("opens it once an Owner delegates the billing scope", () => {
    const ken = viewer({ userId: "u_ken", orgRole: "ADMIN", adminScopes: ["billing"] });
    const d = decide(facts({ viewer: ken, settingsPage: "billing" }), "view");
    expect(d).toMatchObject({ allowed: true, role: "FULL" });
  });

  it("an Owner opens every Workspace page", () => {
    const owner = viewer({ orgRole: "OWNER", adminScopes: ["billing", "security"] });
    for (const page of Object.keys(SETTINGS_PAGE_GATES) as SettingsPageKey[]) {
      expect(decide(facts({ viewer: owner, settingsPage: page }), "view").allowed).toBe(true);
    }
  });
});

describe("example I: a Member types an outside email into the share dialog", () => {
  it("allows the guest invite from a Full holder under toggle 5", () => {
    const zoe = viewer({ userId: "u_zoe" });
    const d = decide(
      facts({
        viewer: zoe,
        object: object("list", { id: "list_L", ownerId: "u_zoe" }),
        access: { whoCanInviteGuests: "full_access" },
      }),
      "invite_guest",
    );
    expect(d.allowed).toBe(true);
  });

  it("mints a Guest for an outside-domain email typed by a Member", () => {
    expect(
      invitationOrgRoleFor({
        email: "sam@agency.io",
        allowedDomains: ["acme.com"],
        inviterOrgRole: "MEMBER",
        requestedOrgRole: "MEMBER",
      }),
    ).toBe("GUEST");
  });
});

describe("example J: a shared Folder inside an unshared Space", () => {
  const tom = viewer({ userId: "u_tom" });
  const folderGrant = grant("folder", "folder_clientx", "EDIT", { subjectId: "u_tom" });

  it("gives Tom EDIT on the Folder and create_child inside it (D15)", () => {
    const f = facts({
      viewer: tom,
      object: object("folder", { id: "folder_clientx", name: "Client X" }),
      chain: [link("space", "space_agency", { name: "Agency" })],
      grants: [folderGrant],
    });
    expect(decide(f, "edit")).toMatchObject({ allowed: true, role: "EDIT", via: "shared" });
    expect(decide(f, "create_child").allowed).toBe(true);
  });

  it("inherits EDIT onto the Lists inside, naming the Folder", () => {
    const d = decide(
      facts({
        viewer: tom,
        object: object("list", { id: "list_brief" }),
        chain: [link("folder", "folder_clientx", { name: "Client X" }), link("space", "space_agency")],
        grants: [folderGrant],
      }),
      "edit",
    );
    expect(d).toMatchObject({ allowed: true, role: "EDIT", via: "inherited" });
    expect(d.viaObject?.name).toBe("Client X");
  });

  it("404s the Restricted List Rates", () => {
    const d = decide(
      facts({
        viewer: tom,
        object: object("list", { id: "list_rates", restricted: true }),
        chain: [link("folder", "folder_clientx"), link("space", "space_agency")],
        grants: [folderGrant],
      }),
      "view",
    );
    expect(d).toMatchObject({ role: "none", discoverable: false });
  });

  it("shows the Space as a discoverable container label with no role", () => {
    const d = decide(
      facts({
        viewer: tom,
        object: object("space", { id: "space_agency", findable: false }),
        grants: [folderGrant],
        relationships: { holdsDescendant: true },
      }),
      "view",
    );
    expect(d).toMatchObject({ role: "none", discoverable: true });
  });

  it("lets Tom share the Folder under toggle 4, at his own level or below", () => {
    const d = decide(
      facts({
        viewer: tom,
        object: object("folder", { id: "folder_clientx" }),
        chain: [link("space", "space_agency")],
        grants: [folderGrant],
        access: { editorsCanShare: true },
      }),
      "share",
    );
    expect(d.allowed).toBe(true);
  });
});

describe("example K: a premium module turned off", () => {
  const channel = object("channel", { id: "c_clientx", moduleKey: "chat" });

  it("hides the hub from an Admin, a Member and a Guest alike", () => {
    for (const role of ["ADMIN", "MEMBER", "GUEST"] as OrgRole[]) {
      const d = decide(facts({ viewer: viewer({ orgRole: role }), app: "chat", activeModules: [] }), "view");
      expect(d.allowed).toBe(false);
      expect(d.via).toBe("module-off");
    }
  });

  it("gives an Admin and a Member module-off with discoverability, a Guest a 404", () => {
    const ken = decide(
      facts({ viewer: viewer({ orgRole: "ADMIN" }), object: channel, activeModules: [] }),
      "view",
    );
    expect(ken).toMatchObject({ via: "module-off", discoverable: true });

    const maya = decide(facts({ object: channel, activeModules: [] }), "view");
    expect(maya).toMatchObject({ via: "module-off", discoverable: true });

    const ravi = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), object: channel, activeModules: [] }),
      "view",
    );
    expect(ravi).toMatchObject({ via: "module-off", discoverable: false });
  });

  it("never names the object, so an id that does not exist answers the same", () => {
    const real = decide(facts({ object: channel, activeModules: [] }), "view");
    const fake = decide(
      facts({ object: object("channel", { id: "c_nonexistent", organizationId: null, moduleKey: "chat" }), activeModules: [] }),
      "view",
    );
    expect(fake.via).toBe(real.via);
    expect(fake.reason).toBe(real.reason);
    expect(fake.context).toEqual(real.context);
  });

  it("returns to normal the moment the switch flips, with no grant touched", () => {
    const on = decide(
      facts({
        viewer: viewer({ orgRole: "ADMIN" }),
        object: object("channel", { id: "c_clientx", moduleKey: "chat" }),
        activeModules: ["chat"],
      }),
      "view",
    );
    expect(on).toMatchObject({ allowed: true, role: "FULL", via: "org-admin" });
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. The twenty-two security invariants (spec 11)
// ─────────────────────────────────────────────────────────────────

describe("invariant 1: org scoping first", () => {
  it("answers a cross-org id exactly as a nonexistent one, for every type", () => {
    for (const type of OBJECT_TYPES) {
      const crossOrg = decide(facts({ object: object(type, { organizationId: "org_other" }) }), "view");
      const nonexistent = decide(facts({ object: object(type, { organizationId: null }) }), "view");
      expect(crossOrg).toMatchObject({ allowed: false, role: "none", discoverable: false });
      expect(crossOrg.reason).toBe(nonexistent.reason);
    }
  });

  it("runs before the Admin rule", () => {
    const d = decide(
      facts({ viewer: viewer({ orgRole: "OWNER" }), object: object("space", { organizationId: "org_other" }) }),
      "view",
    );
    expect(d.allowed).toBe(false);
  });
});

describe("invariant 2: full-read sets never widen by lower grants", () => {
  it("a folder-only grantee has no Space-level role, so no readable Space", () => {
    const d = decide(
      facts({
        object: object("space", { id: "space_agency" }),
        grants: [grant("folder", "folder_clientx", "EDIT")],
        relationships: { holdsDescendant: true },
      }),
      "view",
    );
    expect(d.role).toBe("none");
    expect(d.discoverable).toBe(true);
  });

  it("and the set arithmetic agrees: the Space is containerOnly, never readable", () => {
    // The same world through accessibleIds' pure half. decide() answering
    // "none" and spaceSets() putting the id in `readable` would be exactly the
    // page-vs-API split this engine exists to end, so both halves are asserted
    // on the same facts. id-sets.test.ts covers the rest of that module.
    const sets = spaceSets({
      minRole: "VIEW",
      orgVisible: [],
      memberships: [],
      descendantSpaceIds: ["space_agency"],
    });
    expect([...sets.readable]).toEqual([]);
    expect([...sets.containerOnly]).toEqual(["space_agency"]);
  });

  it("never lets a lower grant clear a higher minRole", () => {
    // A Space held at EDIT through its EVERYONE row is not FULL-readable, so
    // Trash (accessibleIds(type, FULL)) cannot reach it.
    const input = {
      orgVisible: [{ id: "space_open", settings: { defaultPermission: "edit" } }],
      memberships: [],
      descendantSpaceIds: [],
    };
    expect([...spaceSets({ ...input, minRole: "EDIT" }).readable]).toEqual(["space_open"]);
    expect([...spaceSets({ ...input, minRole: "FULL" }).readable]).toEqual([]);
  });
});

describe("invariant 3: Guests never see the directory", () => {
  it("denies a Guest a person_card for someone they share nothing with", () => {
    const d = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), object: object("person_card", { id: "u_other" }) }),
      "view",
    );
    expect(d.role).toBe("none");
  });

  it("allows a Guest the card of someone on a shared object", () => {
    const d = decide(
      facts({
        viewer: viewer({ orgRole: "GUEST" }),
        object: object("person_card", { id: "u_other" }),
        relationships: { sharesObjectWithSubject: true },
      }),
      "view",
    );
    expect(d).toMatchObject({ allowed: true, role: "VIEW" });
  });

  it("never expands EVERYONE for a Guest and never gives them discoverability", () => {
    const everyoneGrantCase = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), grants: [everyone("list", "list_1", "EDIT")] }),
      "view",
    );
    expect(everyoneGrantCase.role).toBe("none");

    const findable = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), object: object("space", { findable: true }) }),
      "view",
    );
    expect(findable.discoverable).toBe(false);
  });
});

describe("invariant 4: Guests never hold Full access they did not create, and never share", () => {
  it("caps a granted FULL at EDIT", () => {
    const d = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), grants: [grant("list", "list_1", "FULL")] }),
      "view",
    );
    expect(d.role).toBe("EDIT");
  });

  it("keeps FULL on their own creation but still refuses share", () => {
    const own = facts({ viewer: viewer({ orgRole: "GUEST" }), object: object("doc", { ownerId: "u_me" }) });
    expect(decide(own, "view").role).toBe("FULL");
    expect(decide(own, "share").allowed).toBe(false);
  });
});

describe("invariant 5: assignment grants the row, not the List", () => {
  it("gives EDIT on the Item and a locked List with context", () => {
    const item = decide(
      facts({ object: object("item"), relationships: { isAssignee: true } }),
      "edit",
    );
    expect(item.allowed).toBe(true);

    const list = decide(
      facts({
        object: object("list", { context: { name: "Backlog" } }),
        relationships: { hasAssignedItemInside: true },
      }),
      "view",
    );
    expect(list.role).toBe("none");
    expect(list.context).toBeTruthy();
  });

  it("does not fire the assignee rule on a List ref", () => {
    const d = decide(facts({ object: object("list"), relationships: { isAssignee: true } }), "edit");
    expect(d.allowed).toBe(false);
  });
});

describe("invariant 6: Restricted stops inheritance for everyone but the owner and org admins", () => {
  it("stops a Full-access ancestor", () => {
    const d = decide(
      facts({
        object: object("list", { restricted: true }),
        chain: [link("space", "space_1")],
        grants: [grant("space", "space_1", "FULL")],
      }),
      "view",
    );
    expect(d.role).toBe("none");
  });

  it("does not stop the object's own owner", () => {
    const d = decide(
      facts({ object: object("list", { restricted: true, ownerId: "u_me" }) }),
      "manage",
    );
    expect(d.role).toBe("FULL");
  });

  it("does not stop an org Owner or Admin", () => {
    const d = decide(
      facts({ viewer: viewer({ orgRole: "ADMIN" }), object: object("list", { restricted: true }) }),
      "manage",
    );
    expect(d).toMatchObject({ allowed: true, role: "FULL", via: "org-admin" });
  });

  it("keeps a direct grant on the Restricted object working", () => {
    const d = decide(
      facts({ object: object("list", { restricted: true }), grants: [grant("list", "list_1", "EDIT")] }),
      "edit",
    );
    expect(d.allowed).toBe(true);
  });
});

describe("invariant 7: Notepads, DMs and private channels have no Admin read-around", () => {
  it("denies an Admin someone else's Notepad", () => {
    const d = decide(
      facts({
        viewer: viewer({ orgRole: "ADMIN" }),
        object: object("doc", { ownerOnly: "notepad", ownerOnlySubjectId: "u_other" }),
      }),
      "view",
    );
    expect(d.allowed).toBe(false);
  });

  it("denies an Owner a private channel they are not in", () => {
    const d = decide(
      facts({
        viewer: viewer({ orgRole: "OWNER" }),
        object: object("channel", { ownerOnly: "private-channel", moduleKey: "chat" }),
      }),
      "view",
    );
    expect(d.allowed).toBe(false);
  });

  it("puts rule 3 before rule 4, which is what makes both true", () => {
    const admin = viewer({ orgRole: "ADMIN" });
    const notepad = decide(
      facts({ viewer: admin, object: object("doc", { ownerOnly: "notepad", ownerOnlySubjectId: "u_x" }) }),
      "view",
    );
    const ordinaryDoc = decide(facts({ viewer: admin, object: object("doc") }), "view");
    expect(notepad.allowed).toBe(false);
    expect(ordinaryDoc.allowed).toBe(true);
  });
});

describe("invariant 8: module off means none, before Admin", () => {
  it("beats the Owner short-circuit", () => {
    const d = decide(
      facts({
        viewer: viewer({ orgRole: "OWNER" }),
        object: object("table", { moduleKey: "tables" }),
        activeModules: [],
      }),
      "view",
    );
    expect(d).toMatchObject({ allowed: false, via: "module-off" });
  });
});

describe("invariant 9: non-human principals never exceed the acting human", () => {
  it("caps an agent run at EDIT even for an Owner", () => {
    const agentRun = viewer({
      orgRole: "OWNER",
      actingAs: { type: "agent", id: "run_1", cap: "EDIT" },
    });
    const d = decide(facts({ viewer: agentRun, object: object("list") }), "manage");
    expect(d.role).toBe("EDIT");
    expect(d.allowed).toBe(false);
  });

  it("denies every acting-as principal the export action", () => {
    for (const type of ["api-key", "agent", "cron"] as const) {
      const v = viewer({ orgRole: "OWNER", actingAs: { type, id: "x", cap: "EDIT" } });
      expect(decide(facts({ viewer: v }), "export").allowed).toBe(false);
    }
  });
});

describe("invariant 10: at least one Owner per org, always", () => {
  it("refuses to demote the last Owner", () => {
    const r = lastOwnerGuard({ ownerIds: ["u_a"], targetUserId: "u_a", newOrgRole: "ADMIN" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("last_owner");
  });

  it("allows the demotion when another Owner remains", () => {
    expect(lastOwnerGuard({ ownerIds: ["u_a", "u_b"], targetUserId: "u_a", newOrgRole: "ADMIN" }).ok).toBe(true);
  });
});

describe("invariant 11: last Full holder guard on every object", () => {
  it("refuses a non-admin and lets an Owner through with a confirmation and an audit row", () => {
    const member = lastFullHolderGuard({
      fullHolderIds: ["u_a"],
      targetUserId: "u_a",
      actorOrgRole: "MEMBER",
    });
    expect(member.ok).toBe(false);

    const owner = lastFullHolderGuard({
      fullHolderIds: ["u_a"],
      targetUserId: "u_a",
      actorOrgRole: "OWNER",
    });
    expect(owner).toMatchObject({ ok: true, requiresConfirmation: true });
    expect(owner.audit).toMatchObject({ displacedUserId: "u_a" });
  });
});

describe("invariant 12: Admin never silently owns", () => {
  it("requires a confirmation and names the owner in the audit row", () => {
    const unconfirmed = adminOwnsGuard({
      actorUserId: "u_admin",
      actorOrgRole: "ADMIN",
      objectOwnerId: "u_owner",
      confirmed: false,
    });
    expect(unconfirmed).toMatchObject({ ok: false, requiresConfirmation: true });

    const confirmed = adminOwnsGuard({
      actorUserId: "u_admin",
      actorOrgRole: "ADMIN",
      objectOwnerId: "u_owner",
      confirmed: true,
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.audit).toMatchObject({ ownerId: "u_owner" });
  });

  it("never lets a Member with NO object role act on an object they do not own", () => {
    expect(
      adminOwnsGuard({
        actorUserId: "u_m",
        actorOrgRole: "MEMBER",
        objectOwnerId: "u_owner",
        actorRole: "EDIT",
        confirmed: true,
      }).ok,
    ).toBe(false);
    expect(
      adminOwnsGuard({
        actorUserId: "u_m",
        actorOrgRole: "MEMBER",
        objectOwnerId: "u_owner",
        confirmed: true,
      }).ok,
    ).toBe(false);
  });

  it("does let a FULL holder act, because invariant 12 is about Admins only", () => {
    // Spec 3.1 and rule 13 give delete, transfer, move and archive to anyone
    // holding FULL, ownership or not (toggle 8 is the only extra gate).
    // Refusing them here, which is what this guard used to do, meant a Member
    // granted Full access on a List they did not create was told "only the
    // owner can do that".
    const fullHolder = adminOwnsGuard({
      actorUserId: "u_m",
      actorOrgRole: "MEMBER",
      objectOwnerId: "u_owner",
      actorRole: "FULL",
      confirmed: false,
    });
    expect(fullHolder.ok).toBe(true);
    expect(fullHolder.requiresConfirmation).toBeUndefined();
  });

  it("keeps Owner promotion an Owner's act, per value and not per field", () => {
    // Spec 3.5's Role row: "Owner: all; Admin: orgRole except Owner", and spec
    // 2.1 lists "Promote to Owner" under what an Admin cannot do. The field
    // whitelist cannot express a per-VALUE limit, so this guard carries it.
    expect(
      orgRolePromotionGuard({
        actorRelationship: "admin",
        currentOrgRole: "MEMBER",
        newOrgRole: "OWNER",
      }),
    ).toMatchObject({ ok: false, code: "owner_only" });

    expect(
      orgRolePromotionGuard({
        actorRelationship: "admin",
        currentOrgRole: "OWNER",
        newOrgRole: "ADMIN",
      }),
    ).toMatchObject({ ok: false, code: "owner_only" });

    expect(
      orgRolePromotionGuard({
        actorRelationship: "admin",
        currentOrgRole: "MEMBER",
        newOrgRole: "ADMIN",
      }).ok,
    ).toBe(true);

    expect(
      orgRolePromotionGuard({
        actorRelationship: "owner",
        currentOrgRole: "MEMBER",
        newOrgRole: "OWNER",
      }).ok,
    ).toBe(true);

    // And the field whitelist keeps adminScopes to the Owner, because
    // delegating an Admin scope is an Owner delegating their own reach.
    expect(peopleFieldAccess("adminScopes", "admin")).toBe("read");
    expect(peopleFieldAccess("adminScopes", "owner")).toBe("write");
    expect(peopleFieldAccess("orgRole", "admin")).toBe("write");
  });
});

describe("invariant 13: deactivation transfers owned objects, nothing is left ownerless", () => {
  it("prefers the manager, then the acting admin, then the first Owner", () => {
    expect(
      transferTargetFor({
        subjectOrgRole: "MEMBER",
        managerId: "u_mgr",
        actingAdminId: "u_admin",
        firstOwnerId: "u_owner",
        automated: false,
      }),
    ).toMatchObject({ userId: "u_mgr" });

    expect(
      transferTargetFor({
        subjectOrgRole: "MEMBER",
        managerId: null,
        actingAdminId: "u_admin",
        firstOwnerId: "u_owner",
        automated: false,
      }),
    ).toMatchObject({ userId: "u_admin" });

    expect(
      transferTargetFor({
        subjectOrgRole: "MEMBER",
        managerId: null,
        actingAdminId: null,
        firstOwnerId: "u_owner",
        automated: true,
      }),
    ).toMatchObject({ userId: "u_owner" });
  });

  it("sends a removed Guest's creations to the nearest container's owner", () => {
    expect(
      transferTargetFor({
        subjectOrgRole: "GUEST",
        managerId: null,
        actingAdminId: "u_admin",
        firstOwnerId: "u_owner",
        nearestContainerOwnerId: "u_container",
        automated: false,
      }),
    ).toMatchObject({ userId: "u_container" });
  });
});

describe("invariant 14: reads never 403 about an object", () => {
  it("gives a not-discoverable denial and a discoverable one different shapes", () => {
    const hidden = decide(facts({ object: object("list") }), "view");
    expect(hidden).toMatchObject({ allowed: false, discoverable: false });

    const locked = decide(
      facts({ object: object("space", { findable: true }) }),
      "view",
    );
    expect(locked).toMatchObject({ allowed: false, discoverable: true });
  });

  it("keeps the rule-2 403 about the module, never the id", () => {
    const d = decide(
      facts({ object: object("channel", { id: "anything", moduleKey: "chat" }), activeModules: [] }),
      "view",
    );
    expect(d.context).toEqual({ module: "chat" });
    expect(JSON.stringify(d)).not.toContain("anything");
  });
});

describe("invariant 15: page and API agree", () => {
  it("answers the page-shaped and API-shaped questions with one function", () => {
    // The two shapes today are access.ts resolveBoard (pages) and
    // board.ts getBoardForReader (APIs). Through the engine they are the same
    // decide() call, so they can never disagree again.
    const world: LegacyInputs = {
      userId: "u_me",
      organizationId: ORG,
      accessLevel: "EMPLOYEE",
      space: {
        id: "space_1",
        organizationId: ORG,
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: null,
      },
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: null,
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: "MEMBER",
      },
    };
    // Today's two answers DISAGREE on this world, which is audit 1.6 row a:
    // board.ts:623-627 reads the direct BoardMember grant, access.ts:201-227
    // never looks at BoardMember at all. That disagreement is the failure S4
    // names, and it is what makes this assertion able to fail.
    const legacyPage = legacyAnswer(world, "resolveBoard");
    const legacyApi = legacyAnswer(world, "getBoardForReader");
    expect(legacyPage.value === "none").not.toBe(legacyApi.value === false);

    // Through the engine they are one decide() call over one ObjectRef, so
    // they agree. A change that reintroduced a page-only or API-only rule
    // (a resolver that ignored a grant source, say) would break this.
    const page = engineAnswer(world, "resolveBoard");
    const api = engineAnswer(world, "getBoardForReader");
    expect(page.value === "none").toBe(api.value === false);
    expect(page).toEqual({ kind: "permission", value: "edit" });
    expect(api).toEqual({ kind: "boolean", value: true });
  });

  it("gives the same answer for every helper pair that shares an ObjectRef", () => {
    // Six worlds, and in each one the page-shaped helper and the API-shaped
    // helper must agree about whether there is any access at all. Any future
    // divergence between resolve* and get*ForReader lands here.
    const space = {
      id: "space_1",
      organizationId: ORG,
      visibility: "WORKSPACE" as const,
      ownerId: null,
      memberRole: null,
    };
    const board = {
      id: "board_1",
      organizationId: ORG,
      spaceId: "space_1",
      folderId: null,
      visibility: "WORKSPACE" as const,
      ownerId: null,
      memberRole: null,
    };
    const worlds: LegacyInputs[] = [
      { userId: "u_me", organizationId: ORG, accessLevel: "EMPLOYEE", space, board },
      {
        userId: "u_me",
        organizationId: ORG,
        accessLevel: "EMPLOYEE",
        space: { ...space, memberRole: "MEMBER" },
        board,
      },
      {
        userId: "u_me",
        organizationId: ORG,
        accessLevel: "EMPLOYEE",
        space: { ...space, visibility: "ORG" },
        board,
      },
      {
        userId: "u_me",
        organizationId: ORG,
        accessLevel: "EMPLOYEE",
        space,
        board: { ...board, visibility: "PRIVATE", ownerId: "u_me" },
      },
      {
        userId: "u_me",
        organizationId: ORG,
        accessLevel: "EMPLOYEE",
        space,
        board: { ...board, visibility: "PRIVATE" },
      },
      { userId: "u_me", organizationId: ORG, accessLevel: "COMPANY_ADMIN", space, board },
    ];
    for (const world of worlds) {
      const page = engineAnswer(world, "resolveBoard");
      const api = engineAnswer(world, "getBoardForReader");
      expect(page.value === "none", JSON.stringify(world)).toBe(api.value === false);
    }
  });
});

describe("invariant 16: denials on discoverable objects are logged, sampled", () => {
  it("logs the first denial and then nothing for ten minutes", () => {
    expect(shouldLogDenial({ discoverable: true, lastLoggedAt: null, now: NOW })).toBe(true);
    expect(shouldLogDenial({ discoverable: true, lastLoggedAt: NOW, now: NOW + 1000 })).toBe(false);
    expect(
      shouldLogDenial({ discoverable: true, lastLoggedAt: NOW, now: NOW + DENIAL_SAMPLE_WINDOW_MS }),
    ).toBe(true);
  });

  it("never logs an id probe", () => {
    expect(shouldLogDenial({ discoverable: false, lastLoggedAt: null, now: NOW })).toBe(false);
  });
});

describe("invariant 17: invitations are domain-locked", () => {
  const rows: Array<[string, OrgRole, OrgRole, OrgRole]> = [
    ["sam@agency.io", "MEMBER", "MEMBER", "GUEST"],
    ["sam@agency.io", "ADMIN", "MEMBER", "MEMBER"],
    ["zoe@acme.com", "MEMBER", "MEMBER", "MEMBER"],
    ["zoe@acme.com", "OWNER", "ADMIN", "ADMIN"],
    ["sam@agency.io", "OWNER", "GUEST", "GUEST"],
  ];

  for (const [email, inviter, requested, expected] of rows) {
    it(`${inviter} inviting ${email} as ${requested} yields ${expected}`, () => {
      expect(
        invitationOrgRoleFor({
          email,
          allowedDomains: ["acme.com"],
          inviterOrgRole: inviter,
          requestedOrgRole: requested,
        }),
      ).toBe(expected);
    });
  }
});

describe("invariant 18: signed file URLs only after can(view, file)", () => {
  it("mints only from an allowed decision", () => {
    const allowed = decide(facts({ object: object("file"), grants: [grant("file", "file_1", "VIEW")] }), "view");
    expect(mayMintSignedUrl(allowed)).toBe(true);

    const denied = decide(facts({ object: object("file") }), "view");
    expect(mayMintSignedUrl(denied)).toBe(false);
  });
});

describe("invariant 19: public links are off by default and never exceed VIEW", () => {
  it("is off in the defaults", () => {
    expect(DEFAULT_ACCESS_SETTINGS.publicLinks).toBe("off");
    expect(publicLinkRole(DEFAULT_ACCESS_SETTINGS)).toBeNull();
  });

  it("serves VIEW and nothing more when switched on", () => {
    expect(publicLinkRole({ ...DEFAULT_ACCESS_SETTINGS, publicLinks: "view" })).toBe("VIEW");
  });

  it("stays off under the Lock it down preset", () => {
    expect(publicLinkRole(LOCK_IT_DOWN_ACCESS_SETTINGS)).toBeNull();
  });
});

describe("invariant 20: grant expiry is honoured by the loader, not a cleanup job", () => {
  it("ignores an expired grant", () => {
    const d = decide(
      facts({ grants: [grant("list", "list_1", "FULL", { expiresAt: NOW - 1 })] }),
      "view",
    );
    expect(d.role).toBe("none");
  });

  it("honours a grant that has not expired yet", () => {
    const d = decide(
      facts({ grants: [grant("list", "list_1", "EDIT", { expiresAt: NOW + 1 })] }),
      "edit",
    );
    expect(d.allowed).toBe(true);
  });
});

describe("invariant 21: nothing configurable is decorative", () => {
  it("names an enforcement point for every Action, OrgAction, toggle, rule, cap, type, app and settings page", () => {
    const missing = REQUIRED_ENFORCEMENT_KEYS.filter((key) => !ENFORCED_AT[key]);
    expect(missing).toEqual([]);
  });

  it("exercises every Action in at least one golden case", () => {
    // Each Action is decided here, which is the half of invariant 21 a test
    // can assert: an Action nobody can reach would throw on the switch below.
    const f = facts({ object: object("list", { ownerId: "u_me" }) });
    for (const action of ACTIONS) {
      const d = decide(f, action as Action);
      expect(typeof d.allowed).toBe("boolean");
      expect(d.enforcedAt.length).toBeGreaterThan(0);
    }
  });

  it("exercises every OrgAction", () => {
    for (const action of ORG_ACTIONS) {
      const d = decide(facts({ viewer: viewer({ orgRole: "OWNER" }), orgAction: action }), "view");
      expect(typeof d.allowed).toBe("boolean");
    }
  });

  it("makes every toggle change at least one answer", () => {
    const owned = object("list", { ownerId: "u_me" });
    expect(decide(facts({ orgAction: "create_space", access: { whoCanCreateSpaces: "admins" } }), "view").allowed).toBe(false);
    expect(decide(facts({ object: owned, access: { whoCanDelete: "admins" } }), "delete").allowed).toBe(false);
    expect(decide(facts({ object: owned, access: { whoCanInviteGuests: "nobody" } }), "invite_guest").allowed).toBe(false);
    expect(
      decide(facts({ grants: [grant("list", "list_1", "EDIT")], access: { editorsCanShare: false } }), "share").allowed,
    ).toBe(false);
    expect(
      decide(facts({ object: object("space", { findable: true }), access: { findableSpaces: false } }), "view")
        .discoverable,
    ).toBe(false);
    expect(
      decide(
        facts({
          object: object("sop"),
          grants: [grant("sop", "sop_1", "EDIT")],
          access: { whoCanPublish: "admins_people_team" },
        }),
        "publish",
      ).allowed,
    ).toBe(false);
    expect(decide(facts({ object: object("person", { id: "u_x" }), peopleTeamIds: ["u_me"] }), "edit").allowed).toBe(true);
    // Toggle 2 (newSpaceDefault) and toggle 9 (guestExpiryDays) are write-time
    // settings read by grants.ts, not by decide(); toggle 10 is invariant 19.
    expect(DEFAULT_ACCESS_SETTINGS.newSpaceDefault).toBe("everyone_edit");
    expect(DEFAULT_ACCESS_SETTINGS.guestExpiryDays).toBe(0);
  });
});

describe("invariant 22: SUPER_ADMIN never appears in any tenant UI or API input", () => {
  it("keeps the org-role vocabulary to four names", () => {
    expect(ORG_ROLE_ORDER).toEqual(["OWNER", "ADMIN", "MEMBER", "GUEST"]);
    expect(ORG_ROLE_ORDER).not.toContain("SUPER_ADMIN");
  });

  it("maps the legacy SUPER_ADMIN level to Owner and never surfaces it", () => {
    expect(orgRoleOf({ accessLevel: "SUPER_ADMIN" })).toBe("OWNER");
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. The audit's table 1.6, row by row
// ─────────────────────────────────────────────────────────────────

describe("audit table 1.6: where today's systems disagree with each other", () => {
  const base = {
    userId: "u_me",
    organizationId: ORG,
    accessLevel: "EMPLOYEE" as string | null,
  };

  const workspaceSpace = {
    id: "space_1",
    organizationId: ORG,
    visibility: "WORKSPACE" as const,
    ownerId: null,
    memberRole: null,
  };

  it("row 1: a direct List grant now answers the same on the page and in the API", () => {
    const world: LegacyInputs = {
      ...base,
      space: workspaceSpace,
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: null,
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: "MEMBER",
      },
    };
    // Today: the API reads it, the page 404s.
    expect(legacyAnswer(world, "getBoardForReader")).toEqual({ kind: "boolean", value: true });
    expect(legacyAnswer(world, "resolveBoard")).toEqual({ kind: "permission", value: "none" });
    // The engine: one answer, and it is the one the share dialog promises.
    expect(engineAnswer(world, "getBoardForReader")).toEqual({ kind: "boolean", value: true });
    expect(engineAnswer(world, "resolveBoard")).toEqual({ kind: "permission", value: "edit" });
  });

  it("row 2: a Space ADMIN no longer pierces a PRIVATE board", () => {
    const world: LegacyInputs = {
      ...base,
      space: { ...workspaceSpace, memberRole: "ADMIN" },
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: null,
        visibility: "PRIVATE",
        ownerId: null,
        memberRole: null,
      },
    };
    expect(legacyAnswer(world, "getBoardForReader")).toEqual({ kind: "boolean", value: false });
    expect(legacyAnswer(world, "resolveBoard")).toEqual({ kind: "permission", value: "edit" });
    expect(engineAnswer(world, "getBoardForReader")).toEqual({ kind: "boolean", value: false });
    expect(engineAnswer(world, "resolveBoard")).toEqual({ kind: "permission", value: "none" });
  });

  it("row 3: a folder-only grantee reaches the boards in their folder", () => {
    const world: LegacyInputs = {
      ...base,
      space: workspaceSpace,
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: "u_someone_else",
        memberRole: "MEMBER",
      },
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: "folder_1",
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: null,
      },
    };
    // Today: the page reads it through the folder grant, the items API 404s.
    expect(legacyAnswer(world, "getBoardForReader")).toEqual({ kind: "boolean", value: false });
    expect(legacyAnswer(world, "resolveBoard")).toEqual({ kind: "permission", value: "read" });
    // The engine: rule 10 inherits the folder grant for both surfaces.
    expect(engineAnswer(world, "getBoardForReader")).toEqual({ kind: "boolean", value: true });
  });

  it("row 4: a Space MEMBER who writes tasks can also share the folder", () => {
    const world: LegacyInputs = {
      ...base,
      space: { ...workspaceSpace, memberRole: "MEMBER" },
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: null,
      },
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: null,
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: null,
      },
    };
    expect(legacyAnswer(world, "canContributeBoard")).toEqual({ kind: "boolean", value: true });
    expect(legacyAnswer(world, "resolveFolder")).toEqual({ kind: "permission", value: "read" });
    expect(engineAnswer(world, "resolveFolder")).toEqual({ kind: "permission", value: "edit" });
  });

  it("row 5: a GUEST who is assigned their own item can edit it", () => {
    const world: LegacyInputs = {
      ...base,
      accessLevel: "EMPLOYEE",
      space: { ...workspaceSpace, memberRole: "GUEST" },
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: null,
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: "GUEST",
      },
      item: {
        id: "item_1",
        organizationId: ORG,
        boardId: "board_1",
        ownerId: "u_me",
        assigneeIds: ["u_me"],
      },
    };
    expect(legacyAnswer(world, "canContributeBoard")).toEqual({ kind: "boolean", value: false });
    expect(legacyAnswer(world, "resolveItem")).toEqual({ kind: "permission", value: "edit" });
    expect(engineAnswer(world, "itemWrite")).toEqual({ kind: "boolean", value: true });
  });

  it("row 6: an ORG-visibility Space is genuinely open, not read-only", () => {
    const world: LegacyInputs = {
      ...base,
      space: { ...workspaceSpace, visibility: "ORG" },
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: null,
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: null,
      },
    };
    expect(legacyAnswer(world, "canContributeBoard")).toEqual({ kind: "boolean", value: false });
    expect(engineAnswer(world, "canContributeBoard")).toEqual({ kind: "boolean", value: true });
  });

  it("row 7: BoardMember MEMBER writes, and the schema comment is what is stale", () => {
    const world: LegacyInputs = {
      ...base,
      space: workspaceSpace,
      board: {
        id: "board_1",
        organizationId: ORG,
        spaceId: "space_1",
        folderId: null,
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: "MEMBER",
      },
    };
    expect(legacyAnswer(world, "canContributeBoard")).toEqual({ kind: "boolean", value: true });
    expect(engineAnswer(world, "canContributeBoard")).toEqual({ kind: "boolean", value: true });
  });

  it("row 8: the NOTEPAD admin read-around closes, in favour of doc-access.ts", () => {
    const world: LegacyInputs = {
      userId: "u_admin",
      organizationId: ORG,
      accessLevel: "COMPANY_ADMIN",
      doc: {
        id: "doc_1",
        organizationId: ORG,
        createdById: "u_other",
        anchor: { entityType: "NOTEPAD", entityId: "u_other" },
      },
    };
    expect(legacyAnswer(world, "docAccessible")).toEqual({ kind: "boolean", value: false });
    expect(engineAnswer(world, "docAccessible")).toEqual({ kind: "boolean", value: false });
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. The section 3.5 people-data field table
// ─────────────────────────────────────────────────────────────────

describe("spec 3.5: the people-data field table", () => {
  const rows: Array<[string, PeopleRelationship, "write" | "read" | "none"]> = [
    ["firstName", "self", "write"],
    ["firstName", "manager-chain", "read"],
    ["firstName", "people-team", "read"],
    ["firstName", "admin", "write"],
    ["firstName", "owner", "write"],
    ["firstName", "none", "none"],
    ["departmentId", "self", "read"],
    // Today a manager in the reporting line may write these; that ends.
    ["departmentId", "manager-chain", "read"],
    ["departmentId", "people-team", "write"],
    ["departmentId", "admin", "write"],
    ["managerId", "manager-chain", "read"],
    ["weeklyCapacityHours", "people-team", "write"],
    ["status", "self", "read"],
    ["status", "manager-chain", "none"],
    ["status", "people-team", "read"],
    ["status", "admin", "write"],
    ["isAgent", "admin", "write"],
    ["orgRole", "people-team", "read"],
    ["orgRole", "admin", "write"],
    // Spec 3.5's Role row: "Owner: all; Admin: orgRole except Owner". The
    // exception is per VALUE, so adminScopes (an Owner delegating to an Admin)
    // is the Owner's alone and the OWNER value is orgRolePromotionGuard's.
    ["adminScopes", "admin", "read"],
    ["adminScopes", "owner", "write"],
    ["adminScopes", "manager-chain", "none"],
    ["email", "admin", "read"],
    ["email", "owner", "read"],
    ["email", "self", "read"],
  ];

  for (const [field, relationship, expected] of rows) {
    it(`${relationship} on ${field} is ${expected}`, () => {
      expect(peopleFieldAccess(field, relationship)).toBe(expected);
    });
  }

  it("bumps tokenVersion on every Membership (A) and Role write", () => {
    expect(writeBumpsTokenVersion("status")).toBe(true);
    expect(writeBumpsTokenVersion("isAgent")).toBe(true);
    expect(writeBumpsTokenVersion("orgRole")).toBe(true);
    expect(writeBumpsTokenVersion("adminScopes")).toBe(true);
    expect(writeBumpsTokenVersion("firstName")).toBe(false);
    expect(writeBumpsTokenVersion("departmentId")).toBe(false);
  });

  it("refuses a field outside the table rather than dropping it silently", () => {
    expect(peopleFieldAccess("salary", "owner")).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. The section 5.2.1 app table
// ─────────────────────────────────────────────────────────────────

describe("spec 5.2.1: the app rule table", () => {
  const owner = viewer({ orgRole: "OWNER" });
  const member = viewer();
  const managerMember = viewer({ reportTree: new Set(["u_report"]) });
  const peopleTeamMember = viewer({ userId: "u_pt" });
  const guest = viewer({ orgRole: "GUEST" });

  it("has a row for every app key, and the key list is the union of hubs, folded apps and the four route-only keys", () => {
    expect(APP_KEYS.length).toBe(31);
    for (const key of APP_KEYS) expect(APP_RULES[key]).toBeTruthy();
  });

  it("opens Work and Settings to everyone signed in, Guests included", () => {
    for (const key of ["home", "settings"] as AppKey[]) {
      expect(decide(facts({ viewer: guest, app: key }), "view").allowed).toBe(true);
      expect(decide(facts({ viewer: member, app: key }), "view").allowed).toBe(true);
    }
  });

  it("hides every Guest-none app from a Guest", () => {
    for (const key of APP_KEYS) {
      if (APP_RULES[key].guest !== "none") continue;
      const d = decide(facts({ viewer: guest, app: key }), "view");
      expect(d.allowed).toBe(false);
      expect(d.discoverable).toBe(false);
    }
  });

  it("opens every plain-Member app to a Member", () => {
    for (const key of APP_KEYS) {
      if (APP_RULES[key].audience !== "member") continue;
      expect(decide(facts({ viewer: member, app: key }), "view").allowed).toBe(true);
    }
  });

  it("opens the people-ops apps to anyone with reports, the People team and admins, and nobody else", () => {
    const peopleOps = APP_KEYS.filter((k) => APP_RULES[k].audience === "reports-people-team-admin");
    expect(peopleOps).toEqual(
      expect.arrayContaining(["reviews", "talent", "analytics", "rollup", "candor", "assets"]),
    );
    for (const key of peopleOps) {
      expect(decide(facts({ viewer: member, app: key }), "view").allowed).toBe(false);
      expect(decide(facts({ viewer: managerMember, app: key }), "view").allowed).toBe(true);
      expect(
        decide(facts({ viewer: peopleTeamMember, app: key, peopleTeamIds: ["u_pt"] }), "view").allowed,
      ).toBe(true);
      expect(decide(facts({ viewer: owner, app: key }), "view").allowed).toBe(true);
    }
  });

  it("keeps Build to Owners and Admins", () => {
    expect(decide(facts({ viewer: member, app: "build" }), "view").allowed).toBe(false);
    expect(decide(facts({ viewer: managerMember, app: "build" }), "view").allowed).toBe(false);
    expect(decide(facts({ viewer: owner, app: "build" }), "view").allowed).toBe(true);
  });

  it("gives Tools and Trash to every Member, which is the widening the spec names", () => {
    for (const key of ["tools", "trash"] as AppKey[]) {
      expect(decide(facts({ viewer: member, app: key }), "view").allowed).toBe(true);
    }
  });

  it("gates the two module hubs on rule 2", () => {
    expect(decide(facts({ viewer: owner, app: "chat", activeModules: [] }), "view").via).toBe("module-off");
    expect(decide(facts({ viewer: owner, app: "tables", activeModules: [] }), "view").via).toBe("module-off");
    expect(decide(facts({ viewer: owner, app: "chat", activeModules: ["chat"] }), "view").allowed).toBe(true);
  });

  it("404s an app key with no row", () => {
    const d = decide(facts({ app: "nonexistent" as AppKey }), "view");
    expect(d).toMatchObject({ allowed: false, discoverable: false });
  });
});

// ─────────────────────────────────────────────────────────────────
// 8. Settings, toggles and the rest of the surface
// ─────────────────────────────────────────────────────────────────

describe("spec 6.6: the settings page table", () => {
  it("keeps Billing, Security and API to Owners or a delegated scope", () => {
    const admin = viewer({ orgRole: "ADMIN" });
    for (const page of ["billing", "security", "api"] as SettingsPageKey[]) {
      expect(decide(facts({ viewer: admin, settingsPage: page }), "view").allowed).toBe(false);
    }
    const scoped = viewer({ orgRole: "ADMIN", adminScopes: ["security"] });
    expect(decide(facts({ viewer: scoped, settingsPage: "api" }), "view").allowed).toBe(true);
    expect(decide(facts({ viewer: scoped, settingsPage: "billing" }), "view").allowed).toBe(false);
  });

  it("gives the People team read on exactly four Workspace pages", () => {
    const pt = viewer({ userId: "u_pt" });
    const readable = (Object.keys(SETTINGS_PAGE_GATES) as SettingsPageKey[]).filter(
      (page) => decide(facts({ viewer: pt, settingsPage: page, peopleTeamIds: ["u_pt"] }), "view").allowed,
    );
    expect(readable.sort()).toEqual(
      [
        "access",
        "account/connections",
        "account/notifications",
        "account/preferences",
        "account/profile",
        "account/security",
        "account/shortcuts",
        "members",
        "scoring",
        "structure",
      ].sort(),
    );
  });

  it("gives every signed-in person the personal door", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "GUEST"] as OrgRole[]) {
      expect(
        decide(facts({ viewer: viewer({ orgRole: role }), settingsPage: "account/profile" }), "view").allowed,
      ).toBe(true);
    }
  });

  it("never makes a Workspace page discoverable to a Member", () => {
    expect(decide(facts({ settingsPage: "identity" }), "view").discoverable).toBe(false);
  });
});

describe("spec 8: the ten toggles", () => {
  it("defaults exactly as the spec says a fresh org behaves", () => {
    expect(DEFAULT_ACCESS_SETTINGS).toEqual({
      whoCanCreateSpaces: "everyone",
      newSpaceDefault: "everyone_edit",
      findableSpaces: true,
      editorsCanShare: true,
      whoCanInviteGuests: "full_access",
      peopleTeamUserIds: [],
      peopleTeamDepartmentId: null,
      whoCanPublish: "editors",
      whoCanDelete: "full_access",
      guestExpiryDays: 0,
      publicLinks: "off",
    });
  });

  it("recovers from a malformed settings blob without failing open", () => {
    const parsed = parseAccessSettings({ whoCanDelete: "admins", findableSpaces: "yes please", nonsense: 1 });
    expect(parsed.whoCanDelete).toBe("admins");
    expect(parsed.findableSpaces).toBe(DEFAULT_ACCESS_SETTINGS.findableSpaces);
  });

  it("returns the defaults for a missing or non-object blob", () => {
    expect(parseAccessSettings(undefined)).toEqual(DEFAULT_ACCESS_SETTINGS);
    expect(parseAccessSettings("nope")).toEqual(DEFAULT_ACCESS_SETTINGS);
    expect(parseAccessSettings([])).toEqual(DEFAULT_ACCESS_SETTINGS);
  });

  it("tightens every relevant toggle under Lock it down", () => {
    expect(LOCK_IT_DOWN_ACCESS_SETTINGS.whoCanCreateSpaces).toBe("admins");
    expect(LOCK_IT_DOWN_ACCESS_SETTINGS.newSpaceDefault).toBe("private");
    expect(LOCK_IT_DOWN_ACCESS_SETTINGS.findableSpaces).toBe(false);
    expect(LOCK_IT_DOWN_ACCESS_SETTINGS.editorsCanShare).toBe(false);
    expect(LOCK_IT_DOWN_ACCESS_SETTINGS.whoCanInviteGuests).toBe("admins");
  });

  it("keeps the parity baseline narrower than the spec defaults where today is narrower", () => {
    expect(TODAY_EQUIVALENT_ACCESS_SETTINGS.findableSpaces).toBe(false);
    expect(TODAY_EQUIVALENT_ACCESS_SETTINGS.editorsCanShare).toBe(false);
  });
});

describe("org actions", () => {
  it("lets every Member create a Space by default and nobody under Admins only", () => {
    expect(decide(facts({ orgAction: "create_space" }), "view").allowed).toBe(true);
    expect(
      decide(facts({ orgAction: "create_space", access: { whoCanCreateSpaces: "admins" } }), "view").allowed,
    ).toBe(false);
  });

  it("never lets a Guest or an Agent create a Space", () => {
    expect(decide(facts({ viewer: viewer({ orgRole: "GUEST" }), orgAction: "create_space" }), "view").allowed).toBe(false);
    expect(decide(facts({ viewer: viewer({ isAgent: true }), orgAction: "create_space" }), "view").allowed).toBe(false);
  });

  it("keeps member invitations with Owners and Admins", () => {
    expect(decide(facts({ orgAction: "invite_member" }), "view").allowed).toBe(false);
    expect(
      decide(facts({ viewer: viewer({ orgRole: "ADMIN" }), orgAction: "invite_member" }), "view").allowed,
    ).toBe(true);
  });

  it("lets every Member create a workflow", () => {
    expect(decide(facts({ orgAction: "create_automation" }), "view").allowed).toBe(true);
    expect(
      decide(facts({ viewer: viewer({ isAgent: true }), orgAction: "create_automation" }), "view").allowed,
    ).toBe(true);
  });
});

describe("explain(): every source, not just the maximum", () => {
  it("lists the owner, the grant and the inherited grant separately", () => {
    const sources = explainSources(
      facts({
        object: object("list", { ownerId: "u_me" }),
        chain: [link("space", "space_1")],
        grants: [grant("list", "list_1", "VIEW"), grant("space", "space_1", "EDIT")],
      }),
    );
    expect(sources.map((s) => s.via).sort()).toEqual(["inherited", "owner", "shared"]);
  });

  it("collapses to one row for an org admin", () => {
    const sources = explainSources(facts({ viewer: viewer({ orgRole: "ADMIN" }) }));
    expect(sources).toEqual([
      { role: "FULL", via: "org-admin", reason: "You administer this workspace." },
    ]);
  });

  it("reports NO source when a short-circuit fired, whoever is asking", () => {
    // The Check-access panel is this function's consumer. Skipping rules 1, 2
    // and 3 is how it came to answer "org-admin: FULL" for another tenant's
    // object id, and "everyone: EDIT" for another tenant's org-visible Space.
    const crossOrgAdmin = facts({
      viewer: viewer({ orgRole: "ADMIN" }),
      object: object("space", { organizationId: "org_other" }),
    });
    expect(explainSources(crossOrgAdmin)).toEqual([]);
    expect(shortCircuit(crossOrgAdmin, "view")).toMatchObject({ role: "none", discoverable: false });

    const crossOrgMember = facts({
      object: object("space", { organizationId: "org_other" }),
      grants: [everyone("space", "space_1", "EDIT")],
    });
    expect(explainSources(crossOrgMember)).toEqual([]);

    const moduleOff = facts({
      viewer: viewer({ orgRole: "ADMIN" }),
      object: object("channel", { moduleKey: "chat" }),
      activeModules: [],
    });
    expect(explainSources(moduleOff)).toEqual([]);

    const someoneElsesNotepad = facts({
      viewer: viewer({ orgRole: "OWNER" }),
      object: object("doc", { ownerOnly: "notepad", ownerOnlySubjectId: "u_other" }),
    });
    expect(explainSources(someoneElsesNotepad)).toEqual([]);

    const deleted = facts({ viewer: viewer({ deleted: true }) });
    expect(explainSources(deleted)).toEqual([]);
  });

  it("still lists sources when nothing short-circuited", () => {
    const ok = facts({ object: object("list", { ownerId: "u_me" }) });
    expect(shortCircuit(ok, "view")).toBeNull();
    expect(explainSources(ok).map((x) => x.via)).toEqual(["owner"]);
  });
});

describe("rule 9: the announcement audience", () => {
  it("gives an org-wide announcement to every Member and a targeted one to its audience", () => {
    // Spec 3.3: "org-wide = EVERYONE VIEW (never Guests); Space-scoped = VIEW
    // for anyone with VIEW on the Space." Hard-coding orgWide: true, which is
    // what loadGenericFacts used to do, made every targeted announcement
    // readable by the whole org.
    const orgWide = decide(facts({ object: object("announcement", { orgWide: true }) }), "view");
    expect(orgWide).toMatchObject({ allowed: true, role: "VIEW", via: "everyone" });

    const targetedAtMe = decide(
      facts({
        object: object("announcement", { orgWide: false }),
        relationships: { isAnnouncementAudience: true },
      }),
      "view",
    );
    expect(targetedAtMe).toMatchObject({ allowed: true, role: "VIEW", via: "assigned" });

    const targetedElsewhere = decide(
      facts({ object: object("announcement", { orgWide: false }) }),
      "view",
    );
    expect(targetedElsewhere.role).toBe("none");

    const guest = decide(
      facts({ viewer: viewer({ orgRole: "GUEST" }), object: object("announcement", { orgWide: true }) }),
      "view",
    );
    expect(guest.role).toBe("none");
  });

  it("gives a review cycle's subject VIEW of their own and the manager chain EDIT", () => {
    const subject = decide(
      facts({ object: object("review_cycle"), relationships: { isReviewSubject: true } }),
      "view",
    );
    expect(subject).toMatchObject({ allowed: true, role: "VIEW" });

    const manager = decide(
      facts({ object: object("review_cycle"), relationships: { managesSubject: true } }),
      "edit",
    );
    expect(manager.allowed).toBe(true);

    const stranger = decide(facts({ object: object("review_cycle") }), "view");
    expect(stranger.role).toBe("none");
  });

  it("lets a Candor participant respond and nobody else", () => {
    const participant = decide(
      facts({ object: object("candor"), relationships: { isCandorParticipant: true } }),
      "comment",
    );
    expect(participant).toMatchObject({ allowed: true, role: "COMMENT" });
    expect(decide(facts({ object: object("candor") }), "comment").allowed).toBe(false);
  });
});

describe("spec 5.2.1: what a Guest gets from an app row", () => {
  it("hides a guest:none app and shows a guest:always one", () => {
    const guest = viewer({ orgRole: "GUEST" });
    expect(decide(facts({ viewer: guest, app: "planner" }), "view").allowed).toBe(false);
    expect(decide(facts({ viewer: guest, app: "home" }), "view").allowed).toBe(true);
    expect(decide(facts({ viewer: guest, app: "settings" }), "view").allowed).toBe(true);
  });

  it("hides a guest:shared app when the engine can prove nothing is shared", () => {
    // "shared" means the row renders only when something of that kind is
    // shared with them. loadFacts answers that for the app keys with their own
    // membership row and leaves it undefined for the rest, and undefined keeps
    // the permissive answer rather than inventing a narrowing.
    const guest = viewer({ orgRole: "GUEST" });
    const nothingShared = { ...facts({ viewer: guest, app: "chat" }), appShared: false };
    expect(decide(nothingShared, "view").allowed).toBe(false);

    const shared = { ...facts({ viewer: guest, app: "chat" }), appShared: true };
    expect(decide(shared, "view").allowed).toBe(true);

    const unanswerable = facts({ viewer: guest, app: "docs" });
    expect(unanswerable.appShared).toBeUndefined();
    expect(decide(unanswerable, "view").allowed).toBe(true);
  });
});

describe("hasReports: manager is a fact about the org chart", () => {
  it("is true for anyone with a report and false for a rung", () => {
    expect(hasReports(viewer({ reportTree: new Set(["u_a"]) }))).toBe(true);
    expect(hasReports(viewer({ reportTree: new Set() }))).toBe(false);
    expect(hasReports(viewer({ orgRole: "OWNER" }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// 9. The parity harness itself
// ─────────────────────────────────────────────────────────────────

describe("the parity harness (spec 10 step 2)", () => {
  const world: LegacyInputs = {
    userId: "u_me",
    organizationId: ORG,
    accessLevel: "EMPLOYEE",
    space: {
      id: "space_1",
      organizationId: ORG,
      visibility: "ORG",
      ownerId: null,
      memberRole: null,
    },
  };

  it("agrees with today on a plain org-visible Space read", () => {
    const testCase: ParityCase = {
      id: "sanity-org-visible-space",
      description: "an ORG-visibility Space is readable by anyone in the org",
      helper: "getSpaceForReader",
      input: world,
    };
    expect(compareDecisions(testCase)).toBeNull();
  });

  it("reports a known difference as expected, not as a regression", () => {
    const testCase: ParityCase = {
      id: "audit-1.6-f-org-space-non-member-contributes",
      description: "an ORG-visibility Space is read-only for non-members today",
      helper: "canContributeSpace",
      input: world,
    };
    const mismatch = compareDecisions(testCase);
    expect(mismatch).not.toBeNull();
    expect(mismatch?.expected?.direction).toBe("widens");
    const report = runParity([testCase]);
    expect(report.unexpected).toEqual([]);
    expect(report.expected).toHaveLength(1);
  });

  it("reports an unknown difference as unexpected", () => {
    // The classifier is a predicate over the world, so this asserts on the
    // predicate rather than on a case id: a world no classifier recognises
    // must come back unclassified, and runParity must file it as unexpected.
    // A catch-all classifier would make the whole harness useless, and this is
    // the assertion that would catch one.
    const ctx = {
      helper: "canContributeSpace" as const,
      input: {
        userId: "u_me",
        organizationId: ORG,
        accessLevel: "EMPLOYEE",
        space: {
          id: "space_1",
          organizationId: ORG,
          visibility: "WORKSPACE" as const,
          ownerId: null,
          memberRole: "GUEST" as const,
        },
      },
      legacy: { kind: "boolean" as const, value: false },
      engine: { kind: "boolean" as const, value: true },
    };
    expect(classifyMismatch(ctx)).toBeUndefined();

    const report = runParity([
      {
        id: "u_123:space_456",
        description: "a sampled pair nobody wrote down",
        helper: ctx.helper,
        input: { ...ctx.input, space: { ...ctx.input.space, memberRole: null } },
      },
    ]);
    // That world genuinely agrees, so nothing is reported at all; the point of
    // this half is that runParity never invents an expectation.
    expect(report.expected).toEqual([]);
    expect(report.unexpected).toEqual([]);
  });

  it("names every legacy helper the pivot will delegate", () => {
    expect(LEGACY_HELPERS.length).toBeGreaterThanOrEqual(21);
    for (const helper of LEGACY_HELPERS) {
      expect(() => legacyAnswer(world, helper)).not.toThrow();
      expect(() => engineAnswer(world, helper)).not.toThrow();
    }
  });

  it("keeps every expectation sourced and directional", () => {
    for (const [id, expectation] of Object.entries(EXPECTED_MISMATCHES)) {
      expect(expectation.source, id).toBeTruthy();
      expect(expectation.reason.length, id).toBeGreaterThan(40);
      expect(["widens", "narrows"]).toContain(expectation.direction);
    }
  });
});
