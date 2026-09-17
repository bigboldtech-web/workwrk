// The parity harness's own suite (spec 10 step 2, graft G6).
//
// One case per known difference, plus a body of cases where the two must
// agree. Two assertions carry the whole step:
//
//   1. runParity(CASES).unexpected is empty. An unexpected mismatch means the
//      engine changed an answer nobody decided to change, which is the exact
//      failure the week-long parity job exists to catch.
//   2. runParity(CASES).unusedExpectations is empty. An expectation no case
//      exercises is either a stale entry or a lost test, and both hide a
//      behaviour change.
//
// Nothing here is scheduled. Wiring this to a nightly job in staging and
// production is step 2's own work; step 0 ships the function and its cases.

import { describe, expect, it } from "vitest";

import {
  EXPECTED_MISMATCHES,
  UNMODELLED_DIFFERENCES,
  classifyMismatch,
  compareDecisions,
  engineAnswer,
  legacyAnswer,
  runParity,
  type LegacyInputs,
  type ParityCase,
} from "./parity";

const ORG = "org_acme";
const ME = "u_me";

function base(overrides: Partial<LegacyInputs> = {}): LegacyInputs {
  return {
    userId: ME,
    organizationId: ORG,
    accessLevel: "EMPLOYEE",
    ...overrides,
  };
}

const workspaceSpace = {
  id: "space_1",
  organizationId: ORG,
  visibility: "WORKSPACE" as const,
  ownerId: null,
  memberRole: null,
};

const plainBoard = {
  id: "board_1",
  organizationId: ORG,
  spaceId: "space_1",
  folderId: null,
  visibility: "WORKSPACE" as const,
  ownerId: null,
  memberRole: null,
};

// ─────────────────────────────────────────────────────────────────
// The expected differences: one case per entry in EXPECTED_MISMATCHES
// ─────────────────────────────────────────────────────────────────

const EXPECTED_CASES: ParityCase[] = [
  {
    id: "audit-1.6-a-direct-board-grant",
    expectKey: "audit-1.6-a-direct-board-grant",
    description:
      "Someone added straight to a List through the share dialog: the API reads it, the page 404s.",
    helper: "resolveBoard",
    input: base({ space: workspaceSpace, board: { ...plainBoard, memberRole: "MEMBER" } }),
  },
  {
    id: "audit-1.6-b-space-admin-private-board",
    expectKey: "audit-1.6-b-space-admin-private-board",
    description: "A Space ADMIN opens a PRIVATE board: the page renders, the items API 404s.",
    helper: "resolveBoard",
    input: base({
      space: { ...workspaceSpace, memberRole: "ADMIN" },
      board: { ...plainBoard, visibility: "PRIVATE" },
    }),
  },
  {
    id: "audit-1.6-c-folder-grantee-board",
    expectKey: "audit-1.6-c-folder-grantee-board",
    description: "A FolderMember grantee opens a board inside a PRIVATE folder.",
    helper: "getBoardForReader",
    input: base({
      space: workspaceSpace,
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: "u_someone_else",
        memberRole: "MEMBER",
      },
      board: { ...plainBoard, folderId: "folder_1" },
    }),
  },
  {
    id: "space-member-maps-to-edit",
    expectKey: "space-member-maps-to-edit",
    description: "A Space MEMBER writes tasks but cannot share the folder they write in.",
    helper: "resolveFolder",
    input: base({
      space: { ...workspaceSpace, memberRole: "MEMBER" },
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "WORKSPACE",
        ownerId: null,
        memberRole: null,
      },
    }),
  },
  {
    id: "audit-1.6-e-guest-owns-item",
    expectKey: "audit-1.6-e-guest-owns-item",
    description: "A GUEST-role member assigned their own task: the resolver allows, the API denies.",
    helper: "itemWrite",
    input: base({
      space: { ...workspaceSpace, memberRole: "GUEST" },
      board: { ...plainBoard, memberRole: "GUEST" },
      item: { id: "item_1", organizationId: ORG, boardId: "board_1", ownerId: ME, assigneeIds: [ME] },
    }),
  },
  {
    id: "audit-1.6-f-org-space-non-member-contributes",
    expectKey: "audit-1.6-f-org-space-non-member-contributes",
    description: "An ORG-visibility Space is read-only for non-members, with no UI saying so.",
    helper: "canContributeSpace",
    input: base({ space: { ...workspaceSpace, visibility: "ORG" } }),
  },
  {
    id: "audit-notepad-admin-read-around",
    expectKey: "audit-notepad-admin-read-around",
    description:
      "access.ts returns admin BEFORE the NOTEPAD check, so the resolver reaches someone else's notepad while doc-access.ts refuses.",
    helper: "resolveDoc",
    input: base({
      userId: "u_admin",
      accessLevel: "COMPANY_ADMIN",
      doc: {
        id: "doc_1",
        organizationId: ORG,
        createdById: "u_other",
        anchor: { entityType: "NOTEPAD", entityId: "u_other" },
      },
    }),
  },
  {
    id: "d15-create-child-at-edit",
    expectKey: "d15-create-child-at-edit",
    description:
      "POST /api/boards and POST /api/folders gate on canEditSpace (Space OWNER/ADMIN); create_child needs only EDIT.",
    helper: "canEditSpace@create_child",
    input: base({ space: { ...workspaceSpace, memberRole: "MEMBER" } }),
  },
  {
    id: "d7-space-owner-pierce-restricted-list",
    expectKey: "d7-space-owner-pierce-restricted-list",
    description: "A Space OWNER pierces a PRIVATE board today (board.ts:645-651).",
    helper: "getBoardForReader",
    input: base({
      space: { ...workspaceSpace, memberRole: "OWNER" },
      board: { ...plainBoard, visibility: "PRIVATE" },
    }),
  },
  {
    id: "tier-manager-is-report-tree",
    expectKey: "tier-manager-is-report-tree",
    description: "A DIRECTOR with no reports holds the manager tier today, by rung.",
    helper: "canAccessTier:manager",
    input: base({ accessLevel: "DIRECTOR", hasReports: false }),
  },
  {
    id: "tier-hr-admin-is-people-team",
    expectKey: "tier-hr-admin-is-people-team",
    description: "A plain Member an admin puts on the People team holds no hr-admin tier today.",
    helper: "canAccessTier:hr-admin",
    input: base({ accessLevel: "EMPLOYEE", peopleTeam: true }),
  },
  {
    id: "archived-cap-has-no-equivalent-today",
    expectKey: "archived-cap-has-no-equivalent-today",
    description: "An archived board is still writable today: no gate reads archivedAt.",
    helper: "canContributeBoard",
    input: base({
      space: { ...workspaceSpace, memberRole: "MEMBER" },
      board: { ...plainBoard, archived: true },
    }),
  },
  {
    id: "space-create-not-manager-tier",
    expectKey: "space-create-not-manager-tier",
    description: "Creating a Space is a manager-tier act today (api/spaces/route.ts:11).",
    helper: "createSpace",
    input: base({ accessLevel: "EMPLOYEE" }),
  },

  // Found while writing the step-1 delegates, not in the audit's list.
  {
    id: "pivot-container-gates-do-not-scope-by-org",
    expectKey: "pivot-container-gates-do-not-scope-by-org",
    description:
      "An ORG-visibility Space in another tenant reads true: the container gates never compare organizationId.",
    helper: "getSpaceForReader",
    input: base({
      space: { ...workspaceSpace, organizationId: "org_other", visibility: "ORG" },
    }),
  },
  {
    id: "pivot-doc-unknown-anchor-falls-open",
    expectKey: "pivot-doc-unknown-anchor-falls-open",
    description: "A doc anchored to a type the gate does not know (LEAD) is readable by the whole org.",
    helper: "docAccessible",
    input: base({
      doc: {
        id: "doc_lead",
        organizationId: ORG,
        createdById: "u_other",
        anchor: { entityType: "LEAD", entityId: "lead_1" },
      },
    }),
  },
  {
    id: "pivot-folder-visible-to-ignores-folder-grant",
    expectKey: "pivot-folder-visible-to-ignores-folder-grant",
    description: "folderVisibleTo hides a PRIVATE folder from the person it was shared with.",
    helper: "folderVisibleTo",
    input: base({
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: "u_other",
        memberRole: "MEMBER",
      },
    }),
  },
  {
    id: "pivot-folder-readable-admin-without-row",
    expectKey: "pivot-folder-readable-admin-without-row",
    description:
      "folderReadable answers true for an org admin before it loads the folder, so a folder id that does not exist reads true.",
    helper: "folderReadable",
    input: base({ userId: "u_admin", accessLevel: "COMPANY_ADMIN" }),
  },

  // ── Group 3: found by running the two halves against each other ──
  {
    id: "rule-1-status-follows-auth-not-the-literal-spec",
    expectKey: "rule-1-status-follows-auth-not-the-literal-spec",
    description:
      "No gate reads User.status today, so an INACTIVE row still answers; rule 1 makes it a 404.",
    helper: "getSpaceForReader",
    input: base({ status: "INACTIVE", space: { ...workspaceSpace, visibility: "ORG" } }),
  },
  {
    id: "agent-cap-clamps-full-to-edit",
    expectKey: "agent-cap-clamps-full-to-edit",
    description: "An AGENT who is a SpaceMember OWNER manages the Space today; rule 12 clamps them to EDIT.",
    helper: "canEditSpace",
    input: base({ accessLevel: "AGENT", space: { ...workspaceSpace, memberRole: "OWNER" } }),
  },
  {
    id: "missing-access-level-is-a-guest",
    expectKey: "missing-access-level-is-a-guest",
    description:
      "A viewer with no accessLevel is an EMPLOYEE to route-guard.ts and a GUEST to orgRoleOf, which carries the rule-12 caps.",
    helper: "canEditSpace",
    input: base({ accessLevel: null, space: { ...workspaceSpace, memberRole: "OWNER" } }),
  },
  {
    id: "container-owner-without-a-member-row",
    expectKey: "container-owner-without-a-member-row",
    description: "canEditSpace reads only SpaceMember, so a Space's own ownerId cannot manage it.",
    helper: "canEditSpace",
    input: base({ space: { ...workspaceSpace, ownerId: ME, memberRole: null } }),
  },
  {
    id: "board-owner-inside-a-private-folder",
    expectKey: "board-owner-or-org-visibility-inside-a-private-folder",
    description:
      "The private-folder cascade (board.ts:632-637) runs before the board's own owner check at :644.",
    helper: "getBoardForReader",
    input: base({
      space: workspaceSpace,
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: "u_other",
        memberRole: null,
      },
      board: { ...plainBoard, folderId: "folder_1", ownerId: ME },
    }),
  },
  {
    id: "org-board-inside-a-private-folder",
    expectKey: "board-owner-or-org-visibility-inside-a-private-folder",
    description: "The same cascade runs before the ORG-visibility branch at :640.",
    helper: "getBoardForReader",
    input: base({
      space: workspaceSpace,
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: "u_other",
        memberRole: null,
      },
      board: { ...plainBoard, folderId: "folder_1", visibility: "ORG" },
    }),
  },
  {
    id: "board-member-admin-manages-a-non-private-board",
    expectKey: "board-member-admin-manages-a-non-private-board",
    description:
      "canEditBoard consults BoardMember only inside its PRIVATE branch, so a BoardMember ADMIN manages a private List and not a public one.",
    helper: "canEditBoard",
    input: base({ space: workspaceSpace, board: { ...plainBoard, memberRole: "ADMIN" } }),
  },
  {
    id: "is-manager-is-the-report-tree",
    expectKey: "tier-manager-is-report-tree",
    description: "A TEAM_LEAD with no reports is a manager by rung today (api-helpers.ts:56-67).",
    helper: "isManager",
    input: base({ accessLevel: "TEAM_LEAD", hasReports: false }),
  },
  {
    id: "space-member-maps-to-edit-on-resolve-space",
    expectKey: "space-member-maps-to-edit",
    description: "The same MEMBER-to-EDIT change shows up on resolveSpace, not only resolveFolder.",
    helper: "resolveSpace",
    input: base({ space: { ...workspaceSpace, memberRole: "MEMBER" } }),
  },
];

// ─────────────────────────────────────────────────────────────────
// The agreement cases: everything the pivot must NOT change
// ─────────────────────────────────────────────────────────────────

const AGREEMENT_CASES: ParityCase[] = [
  {
    id: "agree-org-visible-space-is-readable",
    description: "An ORG-visibility Space reads for anyone in the org.",
    helper: "getSpaceForReader",
    input: base({ space: { ...workspaceSpace, visibility: "ORG" } }),
  },
  {
    id: "agree-workspace-space-needs-membership",
    description: "A WORKSPACE Space needs a SpaceMember row.",
    helper: "getSpaceForReader",
    input: base({ space: workspaceSpace }),
  },
  {
    id: "agree-space-member-reads",
    description: "Any SpaceMember row reads the Space, GUEST included.",
    helper: "getSpaceForReader",
    input: base({ space: { ...workspaceSpace, memberRole: "GUEST" } }),
  },
  {
    id: "agree-org-admin-reads-everything",
    description: "An org admin reads a Space with no membership.",
    helper: "getSpaceForReader",
    input: base({ accessLevel: "COMPANY_ADMIN", space: workspaceSpace }),
  },
  {
    id: "agree-space-owner-manages",
    description: "A Space OWNER manages the Space.",
    helper: "canEditSpace",
    input: base({ space: { ...workspaceSpace, memberRole: "OWNER" } }),
  },
  {
    id: "agree-space-admin-manages",
    description: "A Space ADMIN manages the Space.",
    helper: "canEditSpace",
    input: base({ space: { ...workspaceSpace, memberRole: "ADMIN" } }),
  },
  {
    id: "agree-space-member-does-not-manage",
    description: "A Space MEMBER does not manage the Space.",
    helper: "canEditSpace",
    input: base({ space: { ...workspaceSpace, memberRole: "MEMBER" } }),
  },
  {
    id: "agree-space-guest-does-not-contribute",
    description: "A GUEST SpaceMember row is read-only.",
    helper: "canContributeSpace",
    input: base({ space: { ...workspaceSpace, memberRole: "GUEST" } }),
  },
  {
    id: "agree-space-member-contributes",
    description: "A plain SpaceMember contributes content.",
    helper: "canContributeSpace",
    input: base({ space: { ...workspaceSpace, memberRole: "MEMBER" } }),
  },
  {
    id: "agree-workspace-board-inherits-space",
    description: "A WORKSPACE board defers entirely to its Space.",
    helper: "getBoardForReader",
    input: base({ space: { ...workspaceSpace, memberRole: "MEMBER" }, board: plainBoard }),
  },
  {
    id: "agree-workspace-board-denies-non-member",
    description: "A WORKSPACE board in a Space the viewer is not in stays closed.",
    helper: "getBoardForReader",
    input: base({ space: workspaceSpace, board: plainBoard }),
  },
  {
    id: "agree-org-board-reads-for-everyone",
    description: "An ORG-visibility board reads for anyone in the org.",
    helper: "getBoardForReader",
    input: base({ space: workspaceSpace, board: { ...plainBoard, visibility: "ORG" } }),
  },
  {
    id: "agree-private-board-owner-reads",
    description: "A PRIVATE board's owner reads it.",
    helper: "getBoardForReader",
    input: base({ space: workspaceSpace, board: { ...plainBoard, visibility: "PRIVATE", ownerId: ME } }),
  },
  {
    id: "agree-private-board-stranger-denied",
    description: "A PRIVATE board denies someone with nothing on it.",
    helper: "getBoardForReader",
    input: base({ space: workspaceSpace, board: { ...plainBoard, visibility: "PRIVATE" } }),
  },
  {
    id: "agree-board-owner-manages",
    description: "A board's owner manages it.",
    helper: "canEditBoard",
    input: base({ space: workspaceSpace, board: { ...plainBoard, ownerId: ME } }),
  },
  {
    id: "agree-board-member-writes",
    description: "A non-guest BoardMember contributes content (the 2026-09-09 decision).",
    helper: "canContributeBoard",
    input: base({ space: workspaceSpace, board: { ...plainBoard, memberRole: "MEMBER" } }),
  },
  {
    id: "agree-board-guest-grant-is-read-only",
    description: "A GUEST board grant does not write.",
    helper: "canContributeBoard",
    input: base({ space: workspaceSpace, board: { ...plainBoard, memberRole: "GUEST" } }),
  },
  {
    id: "agree-private-folder-hidden-from-space-members",
    description: "A PRIVATE folder is invisible to a mere Space member.",
    helper: "folderVisibleTo",
    input: base({
      space: { ...workspaceSpace, memberRole: "MEMBER" },
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: "u_other",
        memberRole: null,
      },
    }),
  },
  {
    id: "agree-private-folder-owner-sees-it",
    description: "A PRIVATE folder's owner sees it.",
    helper: "folderVisibleTo",
    input: base({
      space: workspaceSpace,
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: ME,
        memberRole: null,
      },
    }),
  },
  {
    id: "agree-folder-grantee-reads-their-folder",
    description: "A FolderMember reads the folder they were granted.",
    helper: "folderReadable",
    input: base({
      space: workspaceSpace,
      folder: {
        id: "folder_1",
        organizationId: ORG,
        spaceId: "space_1",
        visibility: "PRIVATE",
        ownerId: "u_other",
        memberRole: "MEMBER",
      },
    }),
  },
  {
    id: "agree-standalone-doc-is-org-visible",
    description: "A doc with no anchor is open to the org (doc-access.ts:46).",
    helper: "docAccessible",
    input: base({
      doc: {
        id: "doc_1",
        organizationId: ORG,
        createdById: "u_other",
        anchor: { entityType: null, entityId: null },
      },
    }),
  },
  {
    id: "agree-own-notepad-is-readable",
    description: "A viewer reads their own notepad.",
    helper: "docAccessible",
    input: base({
      doc: {
        id: "doc_1",
        organizationId: ORG,
        createdById: ME,
        anchor: { entityType: "NOTEPAD", entityId: ME },
      },
    }),
  },
  {
    id: "agree-someone-elses-notepad-is-not",
    description: "A Member never reads someone else's notepad.",
    helper: "docAccessible",
    input: base({
      doc: {
        id: "doc_1",
        organizationId: ORG,
        createdById: "u_other",
        anchor: { entityType: "NOTEPAD", entityId: "u_other" },
      },
    }),
  },
  {
    id: "agree-assignee-reads-their-task",
    description: "An assignee reads their task without any board grant.",
    helper: "itemRead",
    input: base({
      space: workspaceSpace,
      board: plainBoard,
      item: { id: "item_1", organizationId: ORG, boardId: "board_1", ownerId: null, assigneeIds: [ME] },
    }),
  },
  {
    id: "agree-cross-org-item-is-invisible",
    description: "A cross-org item is 404, never 403.",
    helper: "itemRead",
    input: base({
      space: workspaceSpace,
      board: plainBoard,
      item: { id: "item_1", organizationId: "org_other", boardId: "board_1", ownerId: ME, assigneeIds: [ME] },
    }),
  },
  {
    id: "agree-org-admin-predicate",
    description: "COMPANY_ADMIN is an org admin; EMPLOYEE is not.",
    helper: "isOrgAdmin",
    input: base({ accessLevel: "COMPANY_ADMIN" }),
  },
  {
    id: "agree-employee-is-not-org-admin",
    description: "An EMPLOYEE is not an org admin.",
    helper: "isOrgAdmin",
    input: base({ accessLevel: "EMPLOYEE" }),
  },
  {
    id: "agree-org-admin-tier",
    description: "The org-admin rail tier is the two admin levels.",
    helper: "canAccessTier:org-admin",
    input: base({ accessLevel: "COMPANY_ADMIN" }),
  },
  {
    id: "agree-employee-has-no-org-admin-tier",
    description: "An EMPLOYEE never holds the org-admin tier.",
    helper: "canAccessTier:org-admin",
    input: base({ accessLevel: "EMPLOYEE" }),
  },
  {
    id: "agree-hr-holds-the-hr-admin-tier",
    description: "An HR user holds the hr-admin tier before and after (People team is seeded from HR).",
    helper: "canAccessTier:hr-admin",
    input: base({ accessLevel: "HR" }),
  },
  {
    id: "agree-manager-with-reports-keeps-the-tier",
    description: "A MANAGER with reports holds the manager tier before and after.",
    helper: "canAccessTier:manager",
    input: base({ accessLevel: "MANAGER", hasReports: true }),
  },
  {
    id: "agree-employee-has-no-manager-tier",
    description: "An EMPLOYEE with no reports holds no manager tier.",
    helper: "canAccessTier:manager",
    input: base({ accessLevel: "EMPLOYEE", hasReports: false }),
  },
  {
    id: "agree-manager-predicate-for-admins",
    description: "An org admin counts as a manager in both models.",
    helper: "isManager",
    input: base({ accessLevel: "COMPANY_ADMIN" }),
  },
];

const CASES = [...EXPECTED_CASES, ...AGREEMENT_CASES];

// ─────────────────────────────────────────────────────────────────

describe("parity: the expected differences", () => {
  for (const testCase of EXPECTED_CASES) {
    it(`${testCase.id} differs, and the difference is the one we decided on`, () => {
      const mismatch = compareDecisions(testCase);
      expect(mismatch, `${testCase.id} no longer differs; remove it from EXPECTED_MISMATCHES`).not.toBeNull();
      expect(mismatch?.expected, `${testCase.id} is missing from EXPECTED_MISMATCHES`).toBeTruthy();
      expect(mismatch?.expected?.source).toBeTruthy();
      // The classifier has to pick the RIGHT entry, not just any entry: an
      // over-broad predicate that swallows a neighbouring case would
      // otherwise read as a pass.
      expect(mismatch?.expected?.key, `${testCase.id} matched the wrong classifier`).toBe(
        testCase.expectKey,
      );
    });
  }

  it("covers every entry in the expectations file", () => {
    const covered = new Set(EXPECTED_CASES.map((c) => c.expectKey));
    const uncovered = Object.keys(EXPECTED_MISMATCHES).filter((key) => !covered.has(key));
    expect(uncovered).toEqual([]);
  });

  it("keys every entry by its own classifier key", () => {
    for (const [key, entry] of Object.entries(EXPECTED_MISMATCHES)) {
      expect(entry.key).toBe(key);
    }
    for (const [key, entry] of Object.entries(UNMODELLED_DIFFERENCES)) {
      expect(entry.key).toBe(key);
    }
  });

  it("classifies by the world, not by the test-case name", () => {
    // The step-2 nightly job samples real (user, object) pairs, so its case
    // ids are things like "u_123:board_456". A classifier keyed on the case id
    // would file every known difference under `unexpected` and the flip
    // criterion could never be met. Same world, unrecognisable id, same
    // verdict.
    const known = EXPECTED_CASES[0];
    const sampled = { ...known, id: "u_123:board_456", description: "sampled pair" };
    expect(compareDecisions(sampled)?.expected?.key).toBe(known.expectKey);
  });

  it("reports an undecided difference as unexpected", () => {
    // The harness has to be able to FAIL. A world nobody classified must come
    // back unclassified rather than absorbed by a catch-all.
    const undecided = classifyMismatch({
      helper: "canContributeSpace",
      input: base({ accessLevel: "EMPLOYEE", space: { ...workspaceSpace, memberRole: "GUEST" } }),
      legacy: { kind: "boolean", value: false },
      engine: { kind: "boolean", value: true },
    });
    expect(undecided).toBeUndefined();
  });
});

describe("parity: everything the pivot must not change", () => {
  for (const testCase of AGREEMENT_CASES) {
    it(`${testCase.id} answers the same today and through the engine`, () => {
      const mismatch = compareDecisions(testCase);
      expect(
        mismatch,
        mismatch
          ? `${testCase.id}: today ${JSON.stringify(mismatch.legacy)} vs engine ${JSON.stringify(mismatch.engine)}`
          : "",
      ).toBeNull();
    });
  }
});

describe("parity: the report", () => {
  const report = runParity(CASES);

  it("has zero unexpected mismatches, which is the step-4 flip criterion", () => {
    expect(
      report.unexpected.map((m) => `${m.caseId} (${m.helper}): ${JSON.stringify(m.legacy)} vs ${JSON.stringify(m.engine)}`),
    ).toEqual([]);
  });

  it("has no stale expectation", () => {
    expect(report.unusedExpectations).toEqual([]);
  });

  it("counts what it compared", () => {
    expect(report.total).toBe(CASES.length);
    expect(report.expected).toHaveLength(EXPECTED_CASES.length);
    expect(report.agreed).toBe(AGREEMENT_CASES.length);
  });

  it("labels every expected difference as widening or narrowing", () => {
    const widens = report.expected.filter((m) => m.expected?.direction === "widens");
    const narrows = report.expected.filter((m) => m.expected?.direction === "narrows");
    expect(widens.length + narrows.length).toBe(report.expected.length);
    // Both directions exist: the pivot is neither a blanket loosening nor a
    // blanket tightening, which is exactly why it needs a week of watching.
    expect(widens.length).toBeGreaterThan(0);
    expect(narrows.length).toBeGreaterThan(0);
  });
});

describe("parity: the harness is a pure function", () => {
  it("gives the same answer twice for the same input", () => {
    for (const testCase of CASES) {
      expect(legacyAnswer(testCase.input, testCase.helper)).toEqual(
        legacyAnswer(testCase.input, testCase.helper),
      );
      expect(engineAnswer(testCase.input, testCase.helper)).toEqual(
        engineAnswer(testCase.input, testCase.helper),
      );
    }
  });

  it("never mutates the world it was given", () => {
    const input = base({ space: { ...workspaceSpace, memberRole: "MEMBER" } });
    const before = JSON.stringify(input);
    legacyAnswer(input, "canEditSpace");
    engineAnswer(input, "canEditSpace");
    expect(JSON.stringify(input)).toBe(before);
  });
});
