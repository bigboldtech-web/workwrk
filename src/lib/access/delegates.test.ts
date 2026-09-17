// Step 1 of the migration order: the delegate suite.
//
// Every gate helper listed below now has a one-line body that loads its rows
// through ./legacy-facts and decides through ./parity. This file asserts the
// DECISION half answers what the helper answered before the pivot, for a
// representative set of inputs per branch, with the pre-pivot source quoted in
// each expectation so a reviewer can diff intent against git history.
//
// What this suite can and cannot reach. vitest here is node-only over
// src/lib/**/*.test.ts with no database and no "@/" alias, so the real async
// helpers (space.ts, board.ts, folder.ts, access.ts) cannot be imported: they
// pull in prisma through the alias. The suite therefore exercises the pure
// decision the delegates call, plus the three load-avoidance rules the loader
// relies on, which is the half that can silently change an answer. The loader
// half is covered by the step-2 parity job against a real database.
//
// The last describe block is the one that would catch a real regression in the
// loader: it proves that every row ./legacy-facts skips fetching cannot change
// the answer, so "fewer queries" can never quietly become "different answer".

import { describe, expect, it } from "vitest";
import {
  LEGACY_ADMIN_LEVELS,
  LEGACY_DIRECTOR_LEVELS,
  LEGACY_EMPLOYEE_LEVELS,
  LEGACY_HR_ADMIN_LEVELS,
  LEGACY_MANAGER_LEVELS,
  legacyIsAdminLevel,
  legacyIsDirectorLevel,
  legacyIsHrAdminLevel,
  legacyIsManagerLevel,
  legacyTierAllows,
  type LegacyTier,
} from "./legacy-levels";
import {
  EXPECTED_MISMATCHES,
  UNMODELLED_DIFFERENCES,
  legacyAllows,
  legacyResolveDetailed,
  type LegacyInputs,
  type SpaceRoleValue,
  type VisibilityValue,
} from "./parity";

// ── Fixtures ──────────────────────────────────────────────────────

const ME = "u-me";
const ORG = "org-1";
const OTHER = "u-other";

function world(over: Partial<LegacyInputs> = {}): LegacyInputs {
  return { userId: ME, organizationId: ORG, accessLevel: "EMPLOYEE", ...over };
}

function space(over: Partial<NonNullable<LegacyInputs["space"]>> = {}) {
  return {
    id: "s-1",
    organizationId: ORG,
    visibility: "WORKSPACE" as VisibilityValue,
    ownerId: OTHER,
    memberRole: null as SpaceRoleValue | null,
    ...over,
  };
}

function folder(over: Partial<NonNullable<LegacyInputs["folder"]>> = {}) {
  return {
    id: "f-1",
    organizationId: ORG,
    spaceId: "s-1",
    parentFolderId: null as string | null,
    visibility: "WORKSPACE" as VisibilityValue,
    ownerId: OTHER,
    memberRole: null as SpaceRoleValue | null,
    ...over,
  };
}

function board(over: Partial<NonNullable<LegacyInputs["board"]>> = {}) {
  return {
    id: "b-1",
    organizationId: ORG,
    spaceId: "s-1",
    folderId: null as string | null,
    visibility: "WORKSPACE" as VisibilityValue,
    ownerId: OTHER,
    memberRole: null as SpaceRoleValue | null,
    ...over,
  };
}

function item(over: Partial<NonNullable<LegacyInputs["item"]>> = {}) {
  return {
    id: "i-1",
    organizationId: ORG,
    boardId: "b-1",
    ownerId: OTHER,
    assigneeIds: [] as string[],
    ...over,
  };
}

function doc(
  entityType: string | null,
  entityId: string | null,
  over: { createdById?: string | null } = {},
) {
  return {
    id: "d-1",
    organizationId: ORG,
    createdById: over.createdById ?? OTHER,
    anchor: { entityType, entityId },
  };
}

/** Every value of prisma's AccessLevel enum, plus the three ways a caller can
 *  hand a gate no level at all. */
const ALL_LEVELS = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "VP",
  "DIRECTOR",
  "MANAGER",
  "TEAM_LEAD",
  "EMPLOYEE",
  "AGENT",
  "HR",
] as const;
const NO_LEVELS = [null, undefined, ""] as const;
const ROLES: SpaceRoleValue[] = ["OWNER", "ADMIN", "MEMBER", "GUEST"];

// ── 1. The ladder delegates ───────────────────────────────────────
//
// space.ts:14-17, board.ts:29, folder.ts:13, access.ts:68-70,
// api-helpers.ts:56-77, page-gates.ts:18-22, route-guard.ts:12-13 and
// access-tiers.ts:14-23 all had their own copy. These are the sets they held.

describe("legacy ladder delegates keep the pre-pivot membership", () => {
  const PRE_PIVOT_ADMIN = ["SUPER_ADMIN", "COMPANY_ADMIN"];
  const PRE_PIVOT_MANAGER = [
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "C_LEVEL",
    "VP",
    "DIRECTOR",
    "MANAGER",
    "TEAM_LEAD",
    "HR",
  ];
  const PRE_PIVOT_HR_ADMIN = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"];
  const PRE_PIVOT_DIRECTOR = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR"];
  const PRE_PIVOT_EMPLOYEE = ["EMPLOYEE", "AGENT"];

  it("holds exactly the same members as the sets it replaced", () => {
    expect([...LEGACY_ADMIN_LEVELS].sort()).toEqual([...PRE_PIVOT_ADMIN].sort());
    expect([...LEGACY_MANAGER_LEVELS].sort()).toEqual([...PRE_PIVOT_MANAGER].sort());
    expect([...LEGACY_HR_ADMIN_LEVELS].sort()).toEqual([...PRE_PIVOT_HR_ADMIN].sort());
    expect([...LEGACY_DIRECTOR_LEVELS].sort()).toEqual([...PRE_PIVOT_DIRECTOR].sort());
    expect([...LEGACY_EMPLOYEE_LEVELS].sort()).toEqual([...PRE_PIVOT_EMPLOYEE].sort());
  });

  it("answers every AccessLevel the way the hand-copied sets did", () => {
    for (const level of ALL_LEVELS) {
      expect(legacyIsAdminLevel(level)).toBe(PRE_PIVOT_ADMIN.includes(level));
      expect(legacyIsManagerLevel(level)).toBe(PRE_PIVOT_MANAGER.includes(level));
      expect(legacyIsHrAdminLevel(level)).toBe(PRE_PIVOT_HR_ADMIN.includes(level));
      expect(legacyIsDirectorLevel(level)).toBe(PRE_PIVOT_DIRECTOR.includes(level));
    }
  });

  it("treats a missing level as no, exactly as `!!accessLevel && SET.has(...)` did", () => {
    for (const none of NO_LEVELS) {
      expect(legacyIsAdminLevel(none)).toBe(false);
      expect(legacyIsManagerLevel(none)).toBe(false);
      expect(legacyIsHrAdminLevel(none)).toBe(false);
      expect(legacyIsDirectorLevel(none)).toBe(false);
    }
    expect(legacyIsAdminLevel("NOT_A_LEVEL")).toBe(false);
  });

  // access-tiers.ts:26-32, before the pivot, verbatim.
  function prePivotCanAccessTier(
    tier: LegacyTier | undefined,
    accessLevel: string | null | undefined,
  ): boolean {
    if (!tier) return true;
    if (!accessLevel) return false;
    if (tier === "manager") return PRE_PIVOT_MANAGER.includes(accessLevel);
    if (tier === "hr-admin") return PRE_PIVOT_HR_ADMIN.includes(accessLevel);
    return PRE_PIVOT_ADMIN.includes(accessLevel);
  }

  it("canAccessTier's delegate matches the body it replaced, tier by level", () => {
    const tiers: Array<LegacyTier | undefined> = [undefined, "manager", "hr-admin", "org-admin"];
    for (const tier of tiers) {
      for (const level of [...ALL_LEVELS, ...NO_LEVELS, "NOT_A_LEVEL"]) {
        // The `!tier` preamble stays at the call site, so mirror it here.
        const delegated = tier === undefined ? true : legacyTierAllows(tier, level);
        expect(delegated).toBe(prePivotCanAccessTier(tier, level));
      }
    }
  });
});

// ── 2. space.ts ───────────────────────────────────────────────────

describe("getSpaceForReader delegate (space.ts:194-204)", () => {
  it(":199 a missing space is null", () => {
    expect(legacyAllows(world(), "getSpaceForReader")).toBe(false);
  });

  it(":200 an org admin reads a PRIVATE space with no membership", () => {
    for (const level of LEGACY_ADMIN_LEVELS) {
      const w = world({ accessLevel: level, space: space({ visibility: "PRIVATE" }) });
      expect(legacyAllows(w, "getSpaceForReader")).toBe(true);
    }
  });

  it(":201 ORG visibility reads without a row", () => {
    expect(legacyAllows(world({ space: space({ visibility: "ORG" }) }), "getSpaceForReader")).toBe(
      true,
    );
  });

  it(":202 any SpaceMember role reads, GUEST included", () => {
    for (const role of ROLES) {
      const w = world({ space: space({ visibility: "PRIVATE", memberRole: role }) });
      expect(legacyAllows(w, "getSpaceForReader")).toBe(true);
    }
  });

  it(":203 WORKSPACE and PRIVATE are indistinguishable without a row", () => {
    for (const visibility of ["WORKSPACE", "PRIVATE"] as VisibilityValue[]) {
      expect(legacyAllows(world({ space: space({ visibility }) }), "getSpaceForReader")).toBe(false);
    }
  });

  it("does not scope by organization, as this helper never did", () => {
    const w = world({ space: space({ organizationId: "org-2", visibility: "ORG" }) });
    expect(legacyAllows(w, "getSpaceForReader")).toBe(true);
  });
});

describe("canEditSpace and canContributeSpace delegates (space.ts:210-232)", () => {
  it("canEditSpace is OWNER or ADMIN, or an org admin with no row at all", () => {
    const expected: Record<string, boolean> = { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false };
    for (const role of ROLES) {
      expect(legacyAllows(world({ space: space({ memberRole: role }) }), "canEditSpace")).toBe(
        expected[role],
      );
    }
    expect(legacyAllows(world({ space: space() }), "canEditSpace")).toBe(false);
    // The admin branch is first, which is what lets the delegate skip the query.
    expect(legacyAllows(world({ accessLevel: "COMPANY_ADMIN" }), "canEditSpace")).toBe(true);
  });

  it("canContributeSpace is any non-GUEST row, or an org admin", () => {
    const expected: Record<string, boolean> = { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false };
    for (const role of ROLES) {
      expect(
        legacyAllows(world({ space: space({ memberRole: role }) }), "canContributeSpace"),
      ).toBe(expected[role]);
    }
    expect(legacyAllows(world({ accessLevel: "SUPER_ADMIN" }), "canContributeSpace")).toBe(true);
  });

  it("an ORG-visibility space still does not let a non-member contribute", () => {
    const w = world({ space: space({ visibility: "ORG" }) });
    expect(legacyAllows(w, "getSpaceForReader")).toBe(true);
    expect(legacyAllows(w, "canContributeSpace")).toBe(false);
  });
});

// ── 3. board.ts ───────────────────────────────────────────────────

describe("getBoardForReader delegate (board.ts:605-665)", () => {
  it(":614 a missing board is null", () => {
    expect(legacyAllows(world(), "getBoardForReader")).toBe(false);
  });

  it(":617 an org admin reads a PRIVATE board", () => {
    const w = world({ accessLevel: "COMPANY_ADMIN", board: board({ visibility: "PRIVATE" }) });
    expect(legacyAllows(w, "getBoardForReader")).toBe(true);
  });

  it(":623-627 a direct BoardMember grant of ANY role reads, without Space membership", () => {
    for (const role of ROLES) {
      const w = world({ board: board({ visibility: "PRIVATE", memberRole: role }) });
      expect(legacyAllows(w, "getBoardForReader")).toBe(true);
    }
  });

  it(":632-637 a PRIVATE folder hides its boards from everyone but the folder OWNER ID", () => {
    const privateFolder = folder({ visibility: "PRIVATE", ownerId: OTHER });
    const w = world({ board: board({ folderId: "f-1", visibility: "ORG" }), folder: privateFolder });
    expect(legacyAllows(w, "getBoardForReader")).toBe(false);

    // A FolderMember grant does NOT rescue it here: this branch reads ownerId
    // only. That is audit 1.6 row c, an EXPECTED_MISMATCHES entry, not a bug to
    // fix inside the delegate.
    const granted = world({
      board: board({ folderId: "f-1", visibility: "ORG" }),
      folder: folder({ visibility: "PRIVATE", ownerId: OTHER, memberRole: "MEMBER" }),
    });
    expect(legacyAllows(granted, "getBoardForReader")).toBe(false);

    const owned = world({
      board: board({ folderId: "f-1", visibility: "ORG" }),
      folder: folder({ visibility: "PRIVATE", ownerId: ME }),
    });
    expect(legacyAllows(owned, "getBoardForReader")).toBe(true);
  });

  it(":640 ORG visibility reads", () => {
    expect(legacyAllows(world({ board: board({ visibility: "ORG" }) }), "getBoardForReader")).toBe(
      true,
    );
  });

  it(":644-658 PRIVATE: the board owner and a Space OWNER pass, a Space ADMIN does not", () => {
    expect(
      legacyAllows(world({ board: board({ visibility: "PRIVATE", ownerId: ME }) }), "getBoardForReader"),
    ).toBe(true);
    expect(
      legacyAllows(
        world({
          board: board({ visibility: "PRIVATE" }),
          space: space({ memberRole: "OWNER" }),
        }),
        "getBoardForReader",
      ),
    ).toBe(true);
    // Space ADMIN is refused: audit 1.6 row b, which the page resolver answers
    // the other way. Preserved on both sides until the flip.
    expect(
      legacyAllows(
        world({
          board: board({ visibility: "PRIVATE" }),
          space: space({ memberRole: "ADMIN" }),
        }),
        "getBoardForReader",
      ),
    ).toBe(false);
  });

  it(":661-664 WORKSPACE inherits the Space, and a space-less board is unreachable", () => {
    expect(
      legacyAllows(world({ board: board(), space: space({ visibility: "ORG" }) }), "getBoardForReader"),
    ).toBe(true);
    expect(legacyAllows(world({ board: board(), space: space() }), "getBoardForReader")).toBe(false);
    expect(legacyAllows(world({ board: board({ spaceId: null }) }), "getBoardForReader")).toBe(false);
  });

  it("canReadBoard is getBoardForReader as a boolean", () => {
    const worlds = [
      world({ board: board({ visibility: "ORG" }) }),
      world({ board: board({ visibility: "PRIVATE" }) }),
      world({ board: board(), space: space({ memberRole: "GUEST" }) }),
    ];
    for (const w of worlds) {
      expect(legacyAllows(w, "canReadBoard")).toBe(legacyAllows(w, "getBoardForReader"));
    }
  });
});

describe("canEditBoard delegate (board.ts:672-705)", () => {
  it("org admin and the board owner always manage", () => {
    expect(
      legacyAllows(world({ accessLevel: "SUPER_ADMIN", board: board() }), "canEditBoard"),
    ).toBe(true);
    expect(legacyAllows(world({ board: board({ ownerId: ME }) }), "canEditBoard")).toBe(true);
  });

  it("a BoardMember ADMIN manages a PRIVATE board but NOT a WORKSPACE one", () => {
    expect(
      legacyAllows(
        world({ board: board({ visibility: "PRIVATE", memberRole: "ADMIN" }) }),
        "canEditBoard",
      ),
    ).toBe(true);
    // :703-704 falls through to canEditSpace, which never looks at the board
    // grant. This asymmetry is the one board.ts is known for; it is preserved.
    expect(
      legacyAllows(
        world({ board: board({ visibility: "WORKSPACE", memberRole: "ADMIN" }), space: space() }),
        "canEditBoard",
      ),
    ).toBe(false);
  });

  it("PRIVATE: a Space OWNER manages, a Space ADMIN does not", () => {
    expect(
      legacyAllows(
        world({ board: board({ visibility: "PRIVATE" }), space: space({ memberRole: "OWNER" }) }),
        "canEditBoard",
      ),
    ).toBe(true);
    expect(
      legacyAllows(
        world({ board: board({ visibility: "PRIVATE" }), space: space({ memberRole: "ADMIN" }) }),
        "canEditBoard",
      ),
    ).toBe(false);
  });

  it("WORKSPACE defers to the Space's OWNER/ADMIN rule", () => {
    const expected: Record<string, boolean> = { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false };
    for (const role of ROLES) {
      expect(
        legacyAllows(world({ board: board(), space: space({ memberRole: role }) }), "canEditBoard"),
      ).toBe(expected[role]);
    }
  });
});

describe("canContributeBoard delegate (board.ts:716-747)", () => {
  it("a non-GUEST board grant writes; a GUEST grant does not subtract the Space's", () => {
    expect(
      legacyAllows(world({ board: board({ memberRole: "MEMBER" }) }), "canContributeBoard"),
    ).toBe(true);
    expect(
      legacyAllows(
        world({ board: board({ memberRole: "GUEST" }), space: space({ memberRole: "MEMBER" }) }),
        "canContributeBoard",
      ),
    ).toBe(true);
  });

  it("PRIVATE is board-grant-only: Space membership does not pierce it for writes", () => {
    expect(
      legacyAllows(
        world({ board: board({ visibility: "PRIVATE" }), space: space({ memberRole: "OWNER" }) }),
        "canContributeBoard",
      ),
    ).toBe(false);
  });

  it("a non-GUEST Space member writes on a WORKSPACE or ORG board", () => {
    const expected: Record<string, boolean> = { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false };
    for (const role of ROLES) {
      expect(
        legacyAllows(
          world({ board: board(), space: space({ memberRole: role }) }),
          "canContributeBoard",
        ),
      ).toBe(expected[role]);
    }
  });

  it("an ORG-visibility board is readable but not writable by a non-member", () => {
    const w = world({ board: board({ visibility: "ORG" }), space: space() });
    expect(legacyAllows(w, "getBoardForReader")).toBe(true);
    expect(legacyAllows(w, "canContributeBoard")).toBe(false);
  });
});

// ── 4. folder.ts ──────────────────────────────────────────────────

/** The adapter folder.ts's delegate applies, mirrored so the sync signature
 *  (a row, not an id) is covered end to end. */
function folderVisibleTo(
  row: { visibility: string | null; ownerId: string | null },
  userId: string | null | undefined,
  accessLevel: string | null | undefined,
): boolean {
  return legacyAllows(
    {
      userId: userId ?? "",
      organizationId: "",
      accessLevel: accessLevel ?? null,
      folder: {
        id: "",
        organizationId: "",
        spaceId: "",
        visibility: (row.visibility ?? "WORKSPACE") as VisibilityValue,
        ownerId: row.ownerId,
        memberRole: null,
      },
    },
    "folderVisibleTo",
  );
}

describe("folderVisibleTo delegate (folder.ts:21-29, and it stays synchronous)", () => {
  it(":26 anything not PRIVATE is visible, including a null visibility", () => {
    expect(folderVisibleTo({ visibility: "WORKSPACE", ownerId: OTHER }, ME, "EMPLOYEE")).toBe(true);
    expect(folderVisibleTo({ visibility: "ORG", ownerId: OTHER }, ME, "EMPLOYEE")).toBe(true);
    expect(folderVisibleTo({ visibility: null, ownerId: OTHER }, ME, "EMPLOYEE")).toBe(true);
  });

  it(":27 an org admin sees a PRIVATE folder", () => {
    expect(folderVisibleTo({ visibility: "PRIVATE", ownerId: OTHER }, ME, "COMPANY_ADMIN")).toBe(true);
  });

  it(":28 otherwise only the owner, and a null viewer is never the owner", () => {
    expect(folderVisibleTo({ visibility: "PRIVATE", ownerId: ME }, ME, "EMPLOYEE")).toBe(true);
    expect(folderVisibleTo({ visibility: "PRIVATE", ownerId: OTHER }, ME, "EMPLOYEE")).toBe(false);
    expect(folderVisibleTo({ visibility: "PRIVATE", ownerId: null }, null, "EMPLOYEE")).toBe(false);
    expect(folderVisibleTo({ visibility: "PRIVATE", ownerId: null }, undefined, null)).toBe(false);
  });
});

describe("folderReadable delegate (folder.ts:171-207)", () => {
  it(":176 org admin, :185 own grant or ownership", () => {
    expect(legacyAllows(world({ accessLevel: "SUPER_ADMIN" }), "folderReadable")).toBe(true);
    for (const role of ROLES) {
      expect(
        legacyAllows(world({ folder: folder({ visibility: "PRIVATE", memberRole: role }) }), "folderReadable"),
      ).toBe(true);
    }
    expect(
      legacyAllows(world({ folder: folder({ visibility: "PRIVATE", ownerId: ME }) }), "folderReadable"),
    ).toBe(true);
  });

  it(":184 a missing folder is false", () => {
    expect(legacyAllows(world(), "folderReadable")).toBe(false);
  });

  it(":188-197 a grant on any ancestor covers it", () => {
    const w = world({ folder: folder({ visibility: "PRIVATE", ancestorMemberRole: "GUEST" }) });
    expect(legacyAllows(w, "folderReadable")).toBe(true);
  });

  it(":200 a PRIVATE folder is never covered by mere space read", () => {
    const w = world({ folder: folder({ visibility: "PRIVATE" }), space: space({ visibility: "ORG" }) });
    expect(legacyAllows(w, "folderReadable")).toBe(false);
  });

  it(":201-206 a non-private folder inherits ORG visibility or a Space row", () => {
    expect(
      legacyAllows(world({ folder: folder(), space: space({ visibility: "ORG" }) }), "folderReadable"),
    ).toBe(true);
    expect(
      legacyAllows(world({ folder: folder(), space: space({ memberRole: "GUEST" }) }), "folderReadable"),
    ).toBe(true);
    expect(legacyAllows(world({ folder: folder(), space: space() }), "folderReadable")).toBe(false);
    expect(legacyAllows(world({ folder: folder() }), "folderReadable")).toBe(false);
  });
});

// ── 5. access.ts, permission AND reason ───────────────────────────
//
// GET /api/me/access serves `reason` verbatim, so the delegates must return
// the same strings, not only the same permission.

describe("resolveSpace delegate (access.ts:129-150)", () => {
  it("answers permission and reason per branch", () => {
    expect(legacyResolveDetailed(world(), "space")).toEqual({
      permission: "none",
      reason: "space not found in your org",
    });
    expect(
      legacyResolveDetailed(world({ space: space({ organizationId: "org-2" }) }), "space"),
    ).toEqual({ permission: "none", reason: "space not found in your org" });
    expect(
      legacyResolveDetailed(world({ accessLevel: "COMPANY_ADMIN", space: space() }), "space"),
    ).toEqual({ permission: "admin", reason: "org admin override" });
    expect(legacyResolveDetailed(world({ space: space({ memberRole: "OWNER" }) }), "space")).toEqual({
      permission: "edit",
      reason: "space owner",
    });
    expect(legacyResolveDetailed(world({ space: space({ memberRole: "ADMIN" }) }), "space")).toEqual({
      permission: "edit",
      reason: "space admin",
    });
    expect(legacyResolveDetailed(world({ space: space({ memberRole: "MEMBER" }) }), "space")).toEqual({
      permission: "read",
      reason: "space member",
    });
    expect(legacyResolveDetailed(world({ space: space({ memberRole: "GUEST" }) }), "space")).toEqual({
      permission: "read",
      reason: "space guest",
    });
    expect(legacyResolveDetailed(world({ space: space({ visibility: "ORG" }) }), "space")).toEqual({
      permission: "read",
      reason: "space is org-visible",
    });
    expect(legacyResolveDetailed(world({ space: space() }), "space")).toEqual({
      permission: "none",
      reason: "not a member of this space",
    });
  });
});

describe("resolveFolder delegate (access.ts:158-199)", () => {
  it("grant, ownership, ancestor, private, then the Space", () => {
    expect(legacyResolveDetailed(world({ folder: folder({ memberRole: "ADMIN" }) }), "folder")).toEqual(
      { permission: "edit", reason: "folder member (admin)" },
    );
    expect(legacyResolveDetailed(world({ folder: folder({ memberRole: "GUEST" }) }), "folder")).toEqual(
      { permission: "read", reason: "folder member (guest)" },
    );
    expect(legacyResolveDetailed(world({ folder: folder({ ownerId: ME }) }), "folder")).toEqual({
      permission: "edit",
      reason: "folder owner",
    });
    expect(
      legacyResolveDetailed(world({ folder: folder({ ancestorMemberRole: "MEMBER" }) }), "folder"),
    ).toEqual({ permission: "read", reason: "inherited folder grant (member)" });
    expect(
      legacyResolveDetailed(world({ folder: folder({ visibility: "PRIVATE" }) }), "folder"),
    ).toEqual({ permission: "none", reason: "folder is private" });
    // The Space's own reason flows through, which is what the pre-pivot
    // `return resolveSpace(...)` at :198 did.
    expect(
      legacyResolveDetailed(
        world({ folder: folder(), space: space({ visibility: "ORG" }) }),
        "folder",
      ),
    ).toEqual({ permission: "read", reason: "space is org-visible" });
    expect(legacyResolveDetailed(world({ folder: folder({ organizationId: "org-2" }) }), "folder")).toEqual(
      { permission: "none", reason: "folder not found in your org" },
    );
  });
});

describe("resolveBoard delegate (access.ts:201-227)", () => {
  it("never reads BoardMember, and demotes only a 'read' on a PRIVATE board", () => {
    // audit 1.6 row a: the direct grant is invisible to this resolver.
    expect(
      legacyResolveDetailed(
        world({ board: board({ memberRole: "ADMIN" }), space: space() }),
        "board",
      ),
    ).toEqual({ permission: "none", reason: "not a member of this space" });

    expect(legacyResolveDetailed(world({ board: board({ spaceId: null }) }), "board")).toEqual({
      permission: "none",
      reason: "board not attached to a space",
    });

    // audit 1.6 row b: a Space ADMIN keeps edit through a PRIVATE board here,
    // while board.ts refuses it.
    expect(
      legacyResolveDetailed(
        world({ board: board({ visibility: "PRIVATE" }), space: space({ memberRole: "ADMIN" }) }),
        "board",
      ),
    ).toEqual({ permission: "edit", reason: "space admin" });
    expect(
      legacyResolveDetailed(
        world({ board: board({ visibility: "PRIVATE" }), space: space({ memberRole: "MEMBER" }) }),
        "board",
      ),
    ).toEqual({ permission: "none", reason: "board is private to its owners" });

    // A board in a folder inherits the FOLDER, not the Space.
    expect(
      legacyResolveDetailed(
        world({
          board: board({ folderId: "f-1" }),
          folder: folder({ memberRole: "MEMBER" }),
        }),
        "board",
      ),
    ).toEqual({ permission: "read", reason: "folder member (member)" });
  });
});

describe("resolveItem delegate (access.ts:267-284)", () => {
  it("inherits the board and upgrades the item owner's read to edit", () => {
    expect(legacyResolveDetailed(world({ item: item() }), "item")).toEqual({
      permission: "none",
      reason: "board not found in your org",
    });
    expect(
      legacyResolveDetailed(
        world({ item: item({ ownerId: ME }), board: board(), space: space({ visibility: "ORG" }) }),
        "item",
      ),
    ).toEqual({ permission: "edit", reason: "you own this item" });
    expect(
      legacyResolveDetailed(
        world({ item: item(), board: board(), space: space({ visibility: "ORG" }) }),
        "item",
      ),
    ).toEqual({ permission: "read", reason: "space is org-visible" });
    expect(legacyResolveDetailed(world({ item: item({ organizationId: "org-2" }) }), "item")).toEqual({
      permission: "none",
      reason: "item not found in your org",
    });
  });
});

describe("resolveDoc delegate (access.ts:234-265)", () => {
  it("keeps the admin override AHEAD of the NOTEPAD rule, which is the known disagreement", () => {
    // doc-access.ts:74-82 denies this. access.ts:242 allows it. The pivot
    // changes neither: EXPECTED_MISMATCHES entry audit-notepad-admin-read-around.
    expect(
      legacyResolveDetailed(
        world({ accessLevel: "COMPANY_ADMIN", doc: doc("NOTEPAD", OTHER) }),
        "doc",
      ),
    ).toEqual({ permission: "admin", reason: "org admin override" });
    expect(legacyResolveDetailed(world({ doc: doc("NOTEPAD", ME) }), "doc")).toEqual({
      permission: "edit",
      reason: "your notepad",
    });
    expect(legacyResolveDetailed(world({ doc: doc("NOTEPAD", OTHER) }), "doc")).toEqual({
      permission: "none",
      reason: "someone else's notepad",
    });
  });

  it("creator, anchors, and the org-visible standalone fallthrough", () => {
    expect(
      legacyResolveDetailed(world({ doc: doc("SPACE", "s-1", { createdById: ME }) }), "doc"),
    ).toEqual({ permission: "edit", reason: "you created this doc" });
    expect(
      legacyResolveDetailed(
        world({ doc: doc("SPACE", "s-1"), space: space({ memberRole: "MEMBER" }) }),
        "doc",
      ),
    ).toEqual({ permission: "read", reason: "space member" });
    expect(legacyResolveDetailed(world({ doc: doc(null, null) }), "doc")).toEqual({
      permission: "read",
      reason: "standalone note, org-visible",
    });
    expect(legacyResolveDetailed(world({ doc: doc("LEAD", "lead-1") }), "doc")).toEqual({
      permission: "read",
      reason: "standalone note, org-visible",
    });
  });
});

// ── 6. docAccessible's leaves, which stay in doc-access.ts ────────

describe("docAccessible (NOT delegated; its leaves are)", () => {
  it("is open by default for a null anchor and for unknown anchor types", () => {
    expect(legacyAllows(world({ doc: doc(null, null) }), "docAccessible")).toBe(true);
    expect(legacyAllows(world({ doc: doc("LEAD", "lead-1") }), "docAccessible")).toBe(true);
  });

  it("is owner-only for a NOTEPAD, with no admin read-around", () => {
    expect(
      legacyAllows(world({ accessLevel: "SUPER_ADMIN", doc: doc("NOTEPAD", OTHER) }), "docAccessible"),
    ).toBe(false);
    expect(legacyAllows(world({ doc: doc("NOTEPAD", ME) }), "docAccessible")).toBe(true);
  });
});

// ── 7. The loader's load-avoidance rules ─────────────────────────
//
// legacy-facts.ts skips rows it does not need so a delegate is never more
// queries than the helper it replaced. Each skip is only safe because the
// branch above it returns first. These tests prove the skip cannot change an
// answer: same world, once with the skipped rows and once without.

describe("legacy-facts load-avoidance rules cannot change an answer", () => {
  // The loader always fetches the helper's OWN row, because three of these
  // functions test "row missing" before they test the admin ladder
  // (space.ts:199, board.ts:614) and would otherwise answer true for an id
  // that does not exist. Rule A skips only the PARENT rows.
  const BOARD_HELPERS = ["getBoardForReader", "canEditBoard", "canContributeBoard"] as const;

  it("rule A: for an org admin, a board answers the same with and without its folder and Space", () => {
    for (const level of LEGACY_ADMIN_LEVELS) {
      const primary = board({ visibility: "PRIVATE", folderId: "f-1" });
      const full = world({
        accessLevel: level,
        board: primary,
        folder: folder({ visibility: "PRIVATE" }),
        space: space({ visibility: "PRIVATE" }),
      });
      const stripped = world({ accessLevel: level, board: primary });
      for (const helper of BOARD_HELPERS) {
        expect(legacyAllows(stripped, helper)).toBe(legacyAllows(full, helper));
      }
      expect(legacyResolveDetailed(stripped, "board")).toEqual(legacyResolveDetailed(full, "board"));
    }
  });

  it("rule A: for an org admin, a folder answers the same with and without its ancestors and Space", () => {
    for (const level of LEGACY_ADMIN_LEVELS) {
      const primary = folder({ visibility: "PRIVATE" });
      const full = world({
        accessLevel: level,
        folder: { ...primary, ancestorMemberRole: "OWNER" },
        space: space({ visibility: "PRIVATE" }),
      });
      const stripped = world({ accessLevel: level, folder: primary });
      expect(legacyAllows(stripped, "folderReadable")).toBe(legacyAllows(full, "folderReadable"));
      expect(legacyResolveDetailed(stripped, "folder")).toEqual(
        legacyResolveDetailed(full, "folder"),
      );
    }
  });

  it("rule A never applies to a helper's own row: a missing row still answers false for an admin", () => {
    for (const level of LEGACY_ADMIN_LEVELS) {
      const none = world({ accessLevel: level });
      // space.ts:199 and board.ts:614 test "not found" first, so an org admin
      // is not handed access to an id that does not exist.
      expect(legacyAllows(none, "getSpaceForReader")).toBe(false);
      expect(legacyAllows(none, "getBoardForReader")).toBe(false);
      // folder.ts:176 is the exception: it answers true before it loads the
      // row, so the delegate must too. Preserved, and called out here so the
      // difference is deliberate rather than discovered later.
      expect(legacyAllows(none, "folderReadable")).toBe(true);
    }
  });

  it("rule B: with the folder's own grant or ownership, the ancestor and Space rows do not matter", () => {
    for (const own of [{ memberRole: "MEMBER" as SpaceRoleValue }, { ownerId: ME }]) {
      for (const visibility of ["PRIVATE", "WORKSPACE", "ORG"] as VisibilityValue[]) {
        const withParents = world({
          folder: folder({ ...own, visibility, ancestorMemberRole: "OWNER" }),
          space: space({ visibility: "ORG", memberRole: "OWNER" }),
        });
        const withoutParents = world({ folder: folder({ ...own, visibility }) });
        expect(legacyAllows(withoutParents, "folderReadable")).toBe(
          legacyAllows(withParents, "folderReadable"),
        );
        expect(legacyResolveDetailed(withoutParents, "folder")).toEqual(
          legacyResolveDetailed(withParents, "folder"),
        );
      }
    }
  });

  it("rule C: resolveDoc's anchor chain does not matter when it returns before reading it", () => {
    const chain = { space: space({ visibility: "ORG" }), board: board(), folder: folder() };
    const cases: Array<Partial<LegacyInputs>> = [
      { accessLevel: "COMPANY_ADMIN", doc: doc("SPACE", "s-1") },
      { doc: doc("NOTEPAD", ME) },
      { doc: doc("NOTEPAD", OTHER) },
      { doc: doc("SPACE", "s-1", { createdById: ME }) },
      { doc: doc(null, null) },
      { doc: { ...doc("SPACE", "s-1"), organizationId: "org-2" } },
    ];
    for (const c of cases) {
      expect(legacyResolveDetailed(world(c), "doc")).toEqual(
        legacyResolveDetailed(world({ ...c, ...chain }), "doc"),
      );
    }
  });

  it("folderDepth 'none': canEditBoard and canContributeBoard never read the folder row", () => {
    for (const visibility of ["PRIVATE", "WORKSPACE", "ORG"] as VisibilityValue[]) {
      for (const role of ROLES) {
        const withFolder = world({
          board: board({ visibility, folderId: "f-1", memberRole: role }),
          folder: folder({ visibility: "PRIVATE", ownerId: OTHER }),
          space: space({ memberRole: role }),
        });
        const withoutFolder = world({
          board: board({ visibility, folderId: "f-1", memberRole: role }),
          space: space({ memberRole: role }),
        });
        for (const helper of ["canEditBoard", "canContributeBoard"] as const) {
          expect(legacyAllows(withoutFolder, helper)).toBe(legacyAllows(withFolder, helper));
        }
      }
    }
  });

  it("getBoardForReader DOES read the folder row, which is why it keeps the shallow load", () => {
    const boardInPrivateFolder = board({ visibility: "ORG", folderId: "f-1" });
    const withFolder = world({
      board: boardInPrivateFolder,
      folder: folder({ visibility: "PRIVATE", ownerId: OTHER }),
    });
    const withoutFolder = world({ board: boardInPrivateFolder });
    expect(legacyAllows(withFolder, "getBoardForReader")).toBe(false);
    expect(legacyAllows(withoutFolder, "getBoardForReader")).toBe(true);
  });

  it("rule A again, for the space-only gates that skip their query entirely", () => {
    for (const level of LEGACY_ADMIN_LEVELS) {
      for (const helper of ["canEditSpace", "canContributeSpace"] as const) {
        expect(legacyAllows(world({ accessLevel: level }), helper)).toBe(true);
        expect(
          legacyAllows(world({ accessLevel: level, space: space({ memberRole: "GUEST" }) }), helper),
        ).toBe(true);
      }
    }
  });
});

// ── 8. The expectations file covers the un-delegated helpers too ──

describe("UNMODELLED_DIFFERENCES: what the pivot preserved but the harness cannot case", () => {
  it("names a source and a reason and a direction for each entry", () => {
    const keys = Object.keys(UNMODELLED_DIFFERENCES);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const entry = UNMODELLED_DIFFERENCES[key];
      expect(entry.source, key).toBeTruthy();
      expect(entry.reason.length, key).toBeGreaterThan(40);
      expect(["widens", "narrows"], key).toContain(entry.direction);
    }
  });

  it("does not duplicate a key the parity cases already carry", () => {
    const overlap = Object.keys(UNMODELLED_DIFFERENCES).filter((k) => k in EXPECTED_MISMATCHES);
    expect(overlap).toEqual([]);
  });

  it("still records every difference the harness cannot case", () => {
    // If one of these is delegated or resolved later, its entry here is what
    // should be deleted in the same commit.
    expect(Object.keys(UNMODELLED_DIFFERENCES).sort()).toEqual([
      "app-guest-shared-is-partly-unanswerable",
      "permission-matrix-stays-authoritative",
      "rail-apps-config-stays-display-only",
      "rail-talk-hub-survives-its-module-being-off",
      "standalone-doc-everyone-grant-is-view-not-edit",
      "team-grants-have-no-store-yet",
      "ungated-settings-and-app-pages",
      "use-role-loading-fallback-is-permissive",
    ]);
  });
});
