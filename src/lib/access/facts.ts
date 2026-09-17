// loadFacts — every Prisma read the resolver needs, and nothing else.
//
// The split is deliberate (spec 5.1, graft G12): all I/O lives here so that
// decide() stays pure and the golden suite runs in vitest's node environment
// with no database and no mocking layer.
//
// Step 0 runs entirely over TODAY's schema. There is no AccessGrant table, no
// User.orgRole, no `restricted` and no `findable` column (all four verified
// absent in prisma/schema.prisma), so this loader DERIVES them:
//
//   grants      <- SpaceMember / FolderMember / BoardMember / SOPFolderAccess,
//                  mapped through the spec 3.1 table, plus EVERYONE rows
//                  synthesised from Visibility.ORG.
//   restricted  <- Visibility.PRIVATE on a Folder or a Board. Never on a Space:
//                  Space PRIVATE and WORKSPACE are indistinguishable at read
//                  time today (space.ts:194-204), so both map to "no EVERYONE
//                  grant" and nothing else.
//   findable    <- Visibility.ORG on a Space (the conservative backfill value
//                  spec 10 step 4.3 names).
//   orgRole     <- User.accessLevel through orgRoleOf() (see ./org-role.ts).
//   People team <- users at HR, until toggle 6 exists (spec 10 step 0).
//   HRSegment   <- ignored, as spec 10 step 0 says. It is dead code: nothing
//                  under src/app ever writes an HRSegment row, so ignoring it
//                  is behaviour-preserving by construction.
//
// Server-only: imports prisma. Never import this from a client component and
// never from resolve.test.ts (vitest resolves no "@/" alias and no database).

import { prisma } from "../prisma";
import { getActiveModuleAppKeys } from "../entitlements";
import {
  emptyRelationships,
  type AccessFacts,
  type AppKey,
  type ChainLink,
  type GrantFact,
  type ObjectFacts,
  type ObjectRef,
  type ObjectRole,
  type ObjectType,
  type OrgFacts,
  type Relationships,
  type Viewer,
} from "./types";
import { roleFromSpaceRole, roleFromSopRole } from "./id-sets";
import {
  APP_BY_OBJECT_TYPE,
  APP_RULES,
  MODULE_BY_OBJECT_TYPE,
  parseAccessSettings,
  parseOrgAppsConfig,
  roleFromDefaultPermission,
} from "./settings";
import {
  parseAnnouncementAudience,
  viewerInAnnouncementAudience,
} from "../announcement-audience";

/** Max ancestors the rule-10 walk will ever consider. */
const MAX_CHAIN = 8;

// ── Enum mapping (spec 3.1) ───────────────────────────────────────

// The two enum mappings live in ./id-sets (pure), so loadFacts and
// accessibleIds cannot drift apart on what a SpaceRole means. Re-exported here
// because this is the module the mapping historically belonged to.
export { roleFromSpaceRole, roleFromSopRole } from "./id-sets";

function userGrant(
  objectType: ObjectType,
  objectId: string,
  userId: string,
  role: ObjectRole,
  source: GrantFact["source"],
): GrantFact {
  return {
    objectType,
    objectId,
    subjectType: "USER",
    subjectId: userId,
    role,
    expiresAt: null,
    source,
  };
}

function everyoneGrant(objectType: ObjectType, objectId: string, role: ObjectRole): GrantFact {
  return {
    objectType,
    objectId,
    subjectType: "EVERYONE",
    subjectId: null,
    role,
    expiresAt: null,
    source: "Visibility",
  };
}

// ── Org facts ─────────────────────────────────────────────────────

/**
 * The org half of the facts, loaded once per request. Cheap enough to repeat
 * (three indexed reads), and viewer.ts memoises the Viewer around it.
 */
export async function loadOrgFacts(organizationId: string): Promise<OrgFacts> {
  const [org, pref, activeModuleKeys, hrUsers] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    prisma.orgPreference.findUnique({
      where: { organizationId },
      select: { sidebarDefault: true },
    }),
    getActiveModuleAppKeys(organizationId),
    // Spec 10 step 0: People team = users at HR until toggle 6 exists.
    prisma.user.findMany({
      where: { organizationId, accessLevel: "HR", deletedAt: null },
      select: { id: true },
    }),
  ]);

  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const access = parseAccessSettings(settings.access);
  const sidebar =
    pref?.sidebarDefault && typeof pref.sidebarDefault === "object" && !Array.isArray(pref.sidebarDefault)
      ? (pref.sidebarDefault as Record<string, unknown>)
      : {};
  // Validated, never cast: rule 2 calls .includes on `hidden` and indexes
  // `minAccess`, so a hand-edited blob must not be able to throw inside a gate.
  const apps = parseOrgAppsConfig(sidebar.apps);

  const seeded = hrUsers.map((u) => u.id);
  const configured = access.peopleTeamUserIds;
  return {
    access,
    activeModules: new Set(activeModuleKeys),
    apps,
    peopleTeamIds: configured.length > 0 ? configured : seeded,
  };
}

// ── Chain loading ─────────────────────────────────────────────────

interface FolderRow {
  id: string;
  name: string;
  spaceId: string;
  parentFolderId: string | null;
  ownerId: string | null;
  visibility: string;
  archivedAt: Date | null;
}

/**
 * A folder's ancestor chain in ONE recursive CTE, the pattern sop-access.ts
 * already uses. Today resolveFolder loops up to eight findUnique calls
 * (access.ts:177-187) and folderReadable does the same (folder.ts:188-197).
 * Nearest first, the folder itself excluded.
 */
async function folderAncestors(folderId: string): Promise<FolderRow[]> {
  const rows = await prisma.$queryRaw<Array<FolderRow & { depth: number }>>`
    WITH RECURSIVE chain AS (
      SELECT f.id, f.name, f."spaceId", f."parentFolderId", f."ownerId",
             f.visibility::text AS visibility, f."archivedAt", 0 AS depth
        FROM "Folder" f WHERE f.id = ${folderId}
      UNION ALL
      SELECT p.id, p.name, p."spaceId", p."parentFolderId", p."ownerId",
             p.visibility::text AS visibility, p."archivedAt", c.depth + 1
        FROM "Folder" p
        JOIN chain c ON c."parentFolderId" = p.id
       WHERE c.depth < ${MAX_CHAIN}
    )
    SELECT * FROM chain WHERE depth > 0 ORDER BY depth ASC
  `;
  return rows;
}

function folderLink(folder: FolderRow): ChainLink {
  return {
    type: "folder",
    id: folder.id,
    name: folder.name,
    ownerId: folder.ownerId,
    // Spec 3.1: Visibility.PRIVATE on a Folder becomes restricted.
    restricted: folder.visibility === "PRIVATE",
    findable: false, // Folders are never findable on their own (rule 14).
    archived: folder.archivedAt !== null,
  };
}

interface SpaceRow {
  id: string;
  name: string;
  ownerId: string | null;
  visibility: string;
  archivedAt: Date | null;
  settings: unknown;
  organizationId: string;
}

function spaceLink(space: SpaceRow): ChainLink {
  return {
    type: "space",
    id: space.id,
    name: space.name,
    ownerId: space.ownerId,
    // A Space is never `restricted`: PRIVATE and WORKSPACE are the same at
    // read time today, so both simply carry no EVERYONE grant.
    restricted: false,
    findable: space.visibility === "ORG",
    archived: space.archivedAt !== null,
  };
}

/** Every grant row the viewer could hold across a set of container ids. */
async function containerGrants(
  viewerId: string,
  spaceIds: string[],
  folderIds: string[],
  boardIds: string[],
  spaces: SpaceRow[],
  folders: FolderRow[],
  boards: Array<{ id: string; visibility: string }>,
): Promise<GrantFact[]> {
  const [spaceMembers, folderMembers, boardMembers] = await Promise.all([
    spaceIds.length
      ? prisma.spaceMember.findMany({
          where: { userId: viewerId, spaceId: { in: spaceIds } },
          select: { spaceId: true, role: true },
        })
      : Promise.resolve([]),
    folderIds.length
      ? prisma.folderMember.findMany({
          where: { userId: viewerId, folderId: { in: folderIds } },
          select: { folderId: true, role: true },
        })
      : Promise.resolve([]),
    boardIds.length
      ? prisma.boardMember.findMany({
          where: { userId: viewerId, boardId: { in: boardIds } },
          select: { boardId: true, role: true },
        })
      : Promise.resolve([]),
  ]);

  const out: GrantFact[] = [];
  for (const row of spaceMembers) {
    out.push(userGrant("space", row.spaceId, viewerId, roleFromSpaceRole(row.role), "SpaceMember"));
  }
  for (const row of folderMembers) {
    out.push(userGrant("folder", row.folderId, viewerId, roleFromSpaceRole(row.role), "FolderMember"));
  }
  for (const row of boardMembers) {
    out.push(userGrant("list", row.boardId, viewerId, roleFromSpaceRole(row.role), "BoardMember"));
  }
  // EVERYONE grants synthesised from Visibility.ORG (spec 3.1).
  for (const space of spaces) {
    if (space.visibility === "ORG") {
      out.push(everyoneGrant("space", space.id, roleFromDefaultPermission(space.settings)));
    }
  }
  for (const board of boards) {
    if (board.visibility === "ORG") out.push(everyoneGrant("list", board.id, "VIEW"));
  }
  // Folders have no ORG-visibility grant of their own: a WORKSPACE or ORG
  // folder is gated by its Space, which is exactly what folderVisibleTo says.
  void folders;
  return out;
}

// ── Container facts (space, folder, list, item and the anchored kinds) ──

interface ContainerResult {
  object: ObjectFacts;
  chain: ChainLink[];
  grants: GrantFact[];
}

async function loadSpaceFacts(viewer: Viewer, spaceId: string): Promise<ContainerResult> {
  const space = (await prisma.space.findUnique({
    where: { id: spaceId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      visibility: true,
      archivedAt: true,
      settings: true,
      organizationId: true,
    },
  })) as SpaceRow | null;

  if (!space) return missing("space", spaceId);

  const grants = await containerGrants(viewer.userId, [space.id], [], [], [space], [], []);
  return {
    object: {
      type: "space",
      id: space.id,
      organizationId: space.organizationId,
      ownerId: space.ownerId,
      restricted: false,
      findable: space.visibility === "ORG",
      archived: space.archivedAt !== null,
      name: space.name,
    },
    chain: [],
    grants,
  };
}

async function loadFolderFacts(viewer: Viewer, folderId: string): Promise<ContainerResult> {
  const folder = (await prisma.folder.findUnique({
    where: { id: folderId },
    select: {
      id: true,
      name: true,
      spaceId: true,
      parentFolderId: true,
      ownerId: true,
      visibility: true,
      archivedAt: true,
      organizationId: true,
    },
  })) as (FolderRow & { organizationId: string }) | null;

  if (!folder) return missing("folder", folderId);

  const ancestors = await folderAncestors(folder.id);
  const space = (await prisma.space.findUnique({
    where: { id: folder.spaceId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      visibility: true,
      archivedAt: true,
      settings: true,
      organizationId: true,
    },
  })) as SpaceRow | null;

  const chain: ChainLink[] = [...ancestors.map(folderLink)];
  if (space) chain.push(spaceLink(space));

  const grants = await containerGrants(
    viewer.userId,
    space ? [space.id] : [],
    [folder.id, ...ancestors.map((a) => a.id)],
    [],
    space ? [space] : [],
    ancestors,
    [],
  );

  return {
    object: {
      type: "folder",
      id: folder.id,
      organizationId: folder.organizationId,
      ownerId: folder.ownerId,
      restricted: folder.visibility === "PRIVATE",
      findable: false,
      archived: folder.archivedAt !== null,
      name: folder.name,
    },
    chain,
    grants,
  };
}

interface BoardRow {
  id: string;
  name: string;
  spaceId: string | null;
  folderId: string | null;
  ownerId: string | null;
  visibility: string;
  archivedAt: Date | null;
  organizationId: string;
  statuses: unknown;
}

async function loadBoardRow(boardId: string): Promise<BoardRow | null> {
  return (await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      name: true,
      spaceId: true,
      folderId: true,
      ownerId: true,
      visibility: true,
      archivedAt: true,
      organizationId: true,
      statuses: true,
    },
  })) as BoardRow | null;
}

/**
 * A List's chain: its Folder (and that folder's ancestors), then its Space. A
 * Board can have BOTH spaceId and folderId null (`onDelete: SetNull` on each),
 * in which case the chain is empty and only rules 4, 5, 6 and 8 can reach it.
 */
async function boardChain(board: BoardRow): Promise<{
  chain: ChainLink[];
  folders: FolderRow[];
  space: SpaceRow | null;
}> {
  let folders: FolderRow[] = [];
  if (board.folderId) {
    const own = (await prisma.folder.findUnique({
      where: { id: board.folderId },
      select: {
        id: true,
        name: true,
        spaceId: true,
        parentFolderId: true,
        ownerId: true,
        visibility: true,
        archivedAt: true,
      },
    })) as FolderRow | null;
    if (own) folders = [own, ...(await folderAncestors(own.id))];
  }
  const spaceId = board.spaceId ?? folders[0]?.spaceId ?? null;
  const space = spaceId
    ? ((await prisma.space.findUnique({
        where: { id: spaceId },
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          archivedAt: true,
          settings: true,
          organizationId: true,
        },
      })) as SpaceRow | null)
    : null;

  const chain: ChainLink[] = folders.map(folderLink);
  if (space) chain.push(spaceLink(space));
  return { chain, folders, space };
}

async function loadListFacts(viewer: Viewer, boardId: string): Promise<ContainerResult> {
  const board = await loadBoardRow(boardId);
  if (!board) return missing("list", boardId);

  const { chain, folders, space } = await boardChain(board);
  const grants = await containerGrants(
    viewer.userId,
    space ? [space.id] : [],
    folders.map((f) => f.id),
    [board.id],
    space ? [space] : [],
    folders,
    [{ id: board.id, visibility: board.visibility }],
  );

  return {
    object: {
      type: "list",
      id: board.id,
      organizationId: board.organizationId,
      ownerId: board.ownerId,
      restricted: board.visibility === "PRIVATE",
      findable: false,
      archived: board.archivedAt !== null,
      name: board.name,
      // Invariant 5: VIEW-for-context for an assignee-only viewer.
      context: { name: board.name, statuses: board.statuses },
    },
    chain,
    grants,
  };
}

function missing(type: ObjectType, id: string): ContainerResult {
  // organizationId null makes rule 1 return the standard 404 body.
  return {
    object: {
      type,
      id,
      organizationId: null,
      ownerId: null,
      restricted: false,
      findable: false,
      archived: false,
    },
    chain: [],
    grants: [],
  };
}

// ── Relationships ─────────────────────────────────────────────────

async function loadRelationships(
  viewer: Viewer,
  ref: ObjectRef,
  object: ObjectFacts,
  org: OrgFacts,
  boardId: string | null,
): Promise<Relationships> {
  const rel = emptyRelationships();
  rel.peopleTeam = org.peopleTeamIds.includes(viewer.userId);
  rel.isCreator = object.ownerId === viewer.userId;

  if (!("id" in ref)) return rel;
  const id = ref.id;

  switch (ref.type) {
    case "item": {
      const item = await prisma.item.findUnique({
        where: { id },
        select: { ownerId: true, assigneeIds: true },
      });
      rel.isAssignee =
        !!item && (item.ownerId === viewer.userId || item.assigneeIds.includes(viewer.userId));
      // Item has NO creator column and nothing writes one (verified across
      // src/app/api/items). Joining ItemActivity where action = 'CREATED'
      // would WIDEN access versus today, so isCreator stays false for tasks.
      rel.isCreator = false;
      break;
    }
    case "list": {
      // Invariant 5 / example B: an assignee of an Item inside sees the List
      // as a locked page with context, never as content.
      const assigned = await prisma.item.count({
        where: { boardId: id, archivedAt: null, assigneeIds: { has: viewer.userId } },
      });
      rel.hasAssignedItemInside = assigned > 0;
      break;
    }
    case "space":
    case "folder": {
      // Rule 14: the viewer holds a role on some descendant, so the container
      // renders as a bare label (example J).
      const folderGrants =
        ref.type === "space"
          ? await prisma.folderMember.count({
              where: { userId: viewer.userId, folder: { spaceId: id, archivedAt: null } },
            })
          : 0;
      const boardGrants = await prisma.boardMember.count({
        where: {
          userId: viewer.userId,
          board: ref.type === "space" ? { spaceId: id } : { folderId: id },
        },
      });
      rel.holdsDescendant = folderGrants + boardGrants > 0;
      // Rule 14 also makes a container discoverable when the viewer is an
      // assignee of an Item somewhere inside it (example B's Space Finance).
      if (!rel.holdsDescendant) {
        const assigned = await prisma.item.count({
          where: {
            archivedAt: null,
            assigneeIds: { has: viewer.userId },
            board: ref.type === "space" ? { spaceId: id } : { folderId: id },
          },
        });
        rel.hasAssignedItemInside = assigned > 0;
      }
      break;
    }
    case "person":
    case "person_card":
    case "timesheet": {
      let subjectId = id;
      if (ref.type === "timesheet") {
        const sheet = await prisma.timesheet.findUnique({
          where: { id },
          select: { userId: true },
        });
        subjectId = sheet?.userId ?? id;
      }
      rel.isSelfSubject = subjectId === viewer.userId;
      rel.managesSubject = !!viewer.reportTree?.has(subjectId);
      // Invariant 3's positive half: a Guest sees the card of anyone they
      // already share an object with, and nobody else. Computed only for
      // Guests, because every other viewer gets the directory from rule 9.
      if (ref.type === "person_card" && viewer.orgRole === "GUEST" && !rel.isSelfSubject) {
        rel.sharesObjectWithSubject = await sharesAnObject(viewer, subjectId);
      }
      break;
    }
    case "channel": {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: id, userId: viewer.userId } },
        select: { id: true },
      });
      rel.isConversationMember = !!member;
      break;
    }
    case "sop": {
      const sop = await prisma.sOP.findUnique({
        where: { id },
        select: { createdById: true },
      });
      rel.isSopAuthor = sop?.createdById === viewer.userId;
      const assignment = await prisma.sOPAssignment.findUnique({
        where: { sopId_userId: { sopId: id, userId: viewer.userId } },
        select: { id: true },
      });
      rel.isSopAssignee = !!assignment;
      break;
    }
    case "policy": {
      const assignment = await prisma.policyAssignment.findUnique({
        where: { policyId_userId: { policyId: id, userId: viewer.userId } },
        select: { id: true },
      });
      rel.isPolicyAssignee = !!assignment;
      break;
    }
    case "contract": {
      const party = await prisma.agreementParty.findFirst({
        where: { agreementId: id, userId: viewer.userId },
        select: { id: true },
      });
      rel.isContractParty = !!party;
      break;
    }
    case "goal": {
      const okr = await prisma.oKR.findUnique({ where: { id }, select: { ownerId: true } });
      const audience = await prisma.goalAssignee.findFirst({
        where: {
          okrId: id,
          OR: [
            { userId: viewer.userId },
            viewer.departmentId ? { departmentId: viewer.departmentId } : { departmentId: "__none__" },
            viewer.roleId ? { roleId: viewer.roleId } : { roleId: "__none__" },
          ],
        },
        select: { id: true },
      });
      rel.isGoalAudience = !!audience;
      rel.managesSubject = !!okr?.ownerId && !!viewer.reportTree?.has(okr.ownerId);
      break;
    }
    case "asset": {
      const asset = await prisma.asset.findUnique({
        where: { id },
        select: { assignedToId: true },
      });
      rel.isAssetAssignee = asset?.assignedToId === viewer.userId;
      rel.managesSubject = !!asset?.assignedToId && !!viewer.reportTree?.has(asset.assignedToId);
      break;
    }
    case "survey": {
      const survey = await prisma.pulseSurvey.findUnique({
        where: { id },
        select: {
          audienceType: true,
          userIds: true,
          departmentIds: true,
          officeIds: true,
          tagIds: true,
        },
      });
      if (survey) {
        rel.isSurveyTarget =
          survey.audienceType === "ALL" ||
          (survey.audienceType === "USERS" && survey.userIds.includes(viewer.userId)) ||
          (survey.audienceType === "DEPARTMENTS" &&
            !!viewer.departmentId &&
            survey.departmentIds.includes(viewer.departmentId)) ||
          (survey.audienceType === "OFFICES" &&
            !!viewer.officeId &&
            survey.officeIds.includes(viewer.officeId)) ||
          (survey.audienceType === "TAGS" &&
            (viewer.tagIds ?? []).some((t) => survey.tagIds.includes(t)));
      }
      break;
    }
    case "review_cycle": {
      // Spec 3.3: "subject self VIEW own; manager chain EDIT on their reports'
      // reviews." Both come from the Review rows hanging off the cycle.
      const [own, ofReports] = await Promise.all([
        prisma.review.count({ where: { cycleId: id, subjectId: viewer.userId } }),
        viewer.reportTree && viewer.reportTree.size > 0
          ? prisma.review.count({ where: { cycleId: id, subjectId: { in: [...viewer.reportTree] } } })
          : Promise.resolve(0),
      ]);
      rel.isReviewSubject = own > 0;
      rel.managesSubject = ofReports > 0;
      break;
    }
    case "candor": {
      // Spec 5.2.1: "every Member as a participant when invited to a session."
      // CandorResponse is deliberately anonymous (no userId column), so the
      // invitation is the session's audience: a department-scoped session
      // invites that department, an unscoped one invites the workspace.
      const session = await prisma.candorSession.findUnique({
        where: { id },
        select: { departmentId: true, createdBy: true },
      });
      if (session) {
        rel.isCandorParticipant =
          viewer.orgRole !== "GUEST" &&
          (session.departmentId === null ||
            (!!viewer.departmentId && session.departmentId === viewer.departmentId));
      }
      break;
    }
    case "announcement": {
      const row = await prisma.announcement.findUnique({
        where: { id },
        select: { targetAudience: true },
      });
      if (row) {
        rel.isAnnouncementAudience = viewerInAnnouncementAudience(
          parseAnnouncementAudience(row.targetAudience),
          { id: viewer.userId, departmentId: viewer.departmentId, officeId: viewer.officeId },
          viewer.tagIds ?? [],
        );
      }
      break;
    }
    default:
      break;
  }

  // A Doc anchored to a task inherits that task's assignee rule through its
  // chain, so nothing extra is needed here; boardId is carried for callers
  // that want to widen this later.
  void boardId;
  return rel;
}

/**
 * Invariant 3: "person_card VIEW for a Guest is true only for users in
 * accessibleUsers() of an object the Guest holds." This is the same question
 * asked from the other end: does the subject hold a row on any container or
 * conversation the Guest holds, or own one?
 *
 * Four indexed counts, and only ever run for a Guest asking about someone
 * else's card, which is the only place rule 9 reads the flag.
 */
async function sharesAnObject(viewer: Viewer, subjectId: string): Promise<boolean> {
  const org = viewer.organizationId;
  const [spaces, folders, boards, convos] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { userId: viewer.userId, space: { organizationId: org } },
      select: { spaceId: true },
    }),
    prisma.folderMember.findMany({
      where: { userId: viewer.userId, folder: { space: { organizationId: org } } },
      select: { folderId: true },
    }),
    prisma.boardMember.findMany({
      where: { userId: viewer.userId, board: { organizationId: org } },
      select: { boardId: true },
    }),
    prisma.conversationMember.findMany({
      where: { userId: viewer.userId, conversation: { organizationId: org } },
      select: { conversationId: true },
    }),
  ]);

  const spaceIds = spaces.map((s) => s.spaceId);
  const folderIds = folders.map((f) => f.folderId);
  const boardIds = boards.map((b) => b.boardId);
  const convoIds = convos.map((c) => c.conversationId);
  if (!spaceIds.length && !folderIds.length && !boardIds.length && !convoIds.length) return false;

  const counts = await Promise.all([
    spaceIds.length
      ? prisma.spaceMember.count({ where: { userId: subjectId, spaceId: { in: spaceIds } } })
      : Promise.resolve(0),
    spaceIds.length
      ? prisma.space.count({ where: { id: { in: spaceIds }, ownerId: subjectId } })
      : Promise.resolve(0),
    folderIds.length
      ? prisma.folderMember.count({ where: { userId: subjectId, folderId: { in: folderIds } } })
      : Promise.resolve(0),
    folderIds.length
      ? prisma.folder.count({ where: { id: { in: folderIds }, ownerId: subjectId } })
      : Promise.resolve(0),
    boardIds.length
      ? prisma.boardMember.count({ where: { userId: subjectId, boardId: { in: boardIds } } })
      : Promise.resolve(0),
    boardIds.length
      ? prisma.board.count({ where: { id: { in: boardIds }, ownerId: subjectId } })
      : Promise.resolve(0),
    convoIds.length
      ? prisma.conversationMember.count({
          where: { userId: subjectId, conversationId: { in: convoIds } },
        })
      : Promise.resolve(0),
  ]);
  return counts.some((n) => n > 0);
}

// ── Doc, table, whiteboard, file, sop folder ──────────────────────

async function loadDocFacts(viewer: Viewer, docId: string): Promise<ContainerResult> {
  const doc = await prisma.doc.findUnique({
    where: { id: docId },
    select: {
      id: true,
      title: true,
      organizationId: true,
      entityType: true,
      entityId: true,
      createdById: true,
      archivedAt: true,
    },
  });
  if (!doc) return missing("doc", docId);

  const base: ObjectFacts = {
    type: "doc",
    id: doc.id,
    organizationId: doc.organizationId,
    ownerId: doc.createdById,
    restricted: false,
    findable: false,
    archived: doc.archivedAt !== null,
    name: doc.title,
  };

  // Rule 3: a NOTEPAD doc is owner-only, with no Admin read-around. The
  // anchor's entityId IS the owner's userId (doc-access.ts:74-81).
  if (doc.entityType === "NOTEPAD") {
    return {
      object: { ...base, ownerOnly: "notepad", ownerOnlySubjectId: doc.entityId },
      chain: [],
      grants: [],
    };
  }

  if (!doc.entityType || !doc.entityId) {
    // Standalone doc. Spec 3.3: creator FULL, plus an optional EVERYONE grant
    // (the G5 backfill writes VIEW for today's org-visible docs). Until that
    // backfill runs the EVERYONE row is synthesised here so a standalone doc
    // keeps the org-wide read it has today.
    return { object: base, chain: [], grants: [everyoneGrant("doc", doc.id, "VIEW")] };
  }

  // Anchored: the doc inherits its anchor, which becomes the chain.
  const anchor = await anchorChain(viewer, doc.entityType, doc.entityId);
  return { object: base, chain: anchor.chain, grants: anchor.grants };
}

/** The chain and grants of whatever a Doc, Table or Whiteboard hangs off. */
async function anchorChain(
  viewer: Viewer,
  entityType: string,
  entityId: string,
): Promise<{ chain: ChainLink[]; grants: GrantFact[] }> {
  if (entityType === "SPACE") {
    const res = await loadSpaceFacts(viewer, entityId);
    return { chain: [objectAsLink(res.object), ...res.chain], grants: res.grants };
  }
  if (entityType === "FOLDER") {
    const res = await loadFolderFacts(viewer, entityId);
    return { chain: [objectAsLink(res.object), ...res.chain], grants: res.grants };
  }
  if (entityType === "BOARD") {
    const res = await loadListFacts(viewer, entityId);
    return { chain: [objectAsLink(res.object), ...res.chain], grants: res.grants };
  }
  if (entityType === "BOARD_ITEM" || entityType === "TASK" || entityType === "BOARD_ROW") {
    const item = await prisma.item.findUnique({
      where: { id: entityId },
      select: { boardId: true },
    });
    if (!item) return { chain: [], grants: [] };
    const res = await loadListFacts(viewer, item.boardId);
    return { chain: [objectAsLink(res.object), ...res.chain], grants: res.grants };
  }
  // Unknown anchor types (LEAD, future suite types) carry no chain.
  return { chain: [], grants: [] };
}

function objectAsLink(object: ObjectFacts): ChainLink {
  return {
    type: object.type,
    id: object.id,
    name: object.name ?? "",
    ownerId: object.ownerId,
    restricted: object.restricted,
    findable: object.findable,
    archived: object.archived,
  };
}

async function loadSpaceAnchoredFacts(
  viewer: Viewer,
  type: ObjectType,
  id: string,
  row: { organizationId: string; ownerId: string | null; spaceId: string | null; name: string; archived: boolean },
): Promise<ContainerResult> {
  const chainAndGrants = row.spaceId
    ? await (async () => {
        const res = await loadSpaceFacts(viewer, row.spaceId as string);
        return { chain: [objectAsLink(res.object), ...res.chain], grants: res.grants };
      })()
    : { chain: [] as ChainLink[], grants: [] as GrantFact[] };

  // An unanchored Table or Whiteboard is org-wide today; the G5 backfill
  // writes the EVERYONE EDIT row explicitly. Synthesised here until then.
  const grants = row.spaceId
    ? chainAndGrants.grants
    : [...chainAndGrants.grants, everyoneGrant(type, id, "EDIT")];

  return {
    object: {
      type,
      id,
      organizationId: row.organizationId,
      ownerId: row.ownerId,
      restricted: false,
      findable: false,
      archived: row.archived,
      name: row.name,
      moduleKey: MODULE_BY_OBJECT_TYPE[type] ?? null,
    },
    chain: chainAndGrants.chain,
    grants,
  };
}

async function loadSopFolderFacts(viewer: Viewer, folderId: string): Promise<ContainerResult> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; parentId: string | null; organizationId: string; depth: number }>
  >`
    WITH RECURSIVE chain AS (
      SELECT f.id, f.name, f."parentId", f."organizationId", 0 AS depth
        FROM "SOPFolder" f WHERE f.id = ${folderId}
      UNION ALL
      SELECT p.id, p.name, p."parentId", p."organizationId", c.depth + 1
        FROM "SOPFolder" p
        JOIN chain c ON c."parentId" = p.id
       WHERE c.depth < ${MAX_CHAIN}
    )
    SELECT * FROM chain ORDER BY depth ASC
  `;
  if (rows.length === 0) return missing("sop_folder", folderId);

  const ids = rows.map((r) => r.id);
  const access = await prisma.sOPFolderAccess.findMany({
    where: { userId: viewer.userId, folderId: { in: ids } },
    select: { folderId: true, role: true },
  });

  const grants: GrantFact[] = access.map((row) =>
    userGrant("sop_folder", row.folderId, viewer.userId, roleFromSopRole(row.role), "SOPFolderAccess"),
  );

  const self = rows[0];
  return {
    object: {
      type: "sop_folder",
      id: self.id,
      organizationId: self.organizationId,
      ownerId: null, // SOPFolder has no ownerId column.
      restricted: false,
      findable: false,
      archived: false, // SOPFolder has no archivedAt column.
      name: self.name,
    },
    chain: rows.slice(1).map((r) => ({
      type: "sop_folder" as ObjectType,
      id: r.id,
      name: r.name,
      ownerId: null,
      restricted: false,
      findable: false,
      archived: false,
    })),
    grants,
  };
}

// ── The entry point ───────────────────────────────────────────────

/**
 * loadFacts(viewer, ref) — read exactly what decide() needs, and nothing else.
 *
 * Rule 2 must be answerable before the object row is loaded, so a module-owned
 * ref returns early with nothing but its module key: `can()` then short-circuits
 * without ever confirming the id exists (invariant 14, example K).
 */
export async function loadFacts(viewer: Viewer, ref: ObjectRef): Promise<AccessFacts> {
  const org = await loadOrgFacts(viewer.organizationId);
  const now = Date.now();

  const shell = (object: ObjectFacts, chain: ChainLink[] = [], grants: GrantFact[] = []): AccessFacts => ({
    viewer,
    object,
    chain,
    grants,
    relationships: emptyRelationships(),
    org,
    now,
  });

  if (ref.type === "app") {
    return {
      ...shell(blankObject("space", "")),
      app: ref.key as AppKey,
      appShared: await guestHoldsSomethingFor(viewer, ref.key as AppKey),
    };
  }
  if (ref.type === "settings") {
    return { ...shell(blankObject("space", "")), settingsPage: ref.page };
  }
  if (ref.type === "org") {
    return { ...shell(blankObject("space", "")), orgAction: ref.action };
  }

  // Rule 2 before the object row: a Talk or Tables object while the module is
  // off never reaches a findUnique.
  const moduleKey = MODULE_BY_OBJECT_TYPE[ref.type];
  if (moduleKey && !org.activeModules.has(moduleKey)) {
    return shell({ ...blankObject(ref.type, ref.id), moduleKey });
  }

  const loaded = await loadObject(viewer, ref);
  // Rule 2's Apps-config half (spec 7.1: "a hidden app's routes lock, not just
  // its icon"). Without this the hide and floor stored on
  // OrgPreference.sidebarDefault.apps would govern the rail only, which is the
  // display-only behaviour the audit called out.
  const appKey = APP_BY_OBJECT_TYPE[ref.type];
  if (appKey) loaded.object.appKey = appKey;
  const relationships = await loadRelationships(viewer, ref, loaded.object, org, null);

  return {
    viewer,
    object: loaded.object,
    chain: loaded.chain,
    grants: loaded.grants,
    relationships,
    org,
    now,
  };
}

/**
 * Spec 5.2.1's `guest: "shared"` rows: the app renders for a Guest only when
 * something of that kind is shared with them. The question is answerable from
 * today's tables only for the kinds that carry their own membership row (Talk
 * channels, SOP folders). Docs, Tables, Forms and Library files have no
 * per-object share table before step 4, so those return undefined and
 * decideApp keeps the permissive answer rather than hiding a hub a Guest may
 * legitimately need (recorded in parity.ts UNMODELLED_DIFFERENCES).
 */
async function guestHoldsSomethingFor(viewer: Viewer, app: AppKey): Promise<boolean | undefined> {
  if (viewer.orgRole !== "GUEST") return undefined;
  if (APP_RULES[app]?.guest !== "shared") return undefined;

  switch (app) {
    case "chat": {
      const n = await prisma.conversationMember.count({
        where: { userId: viewer.userId, conversation: { organizationId: viewer.organizationId } },
      });
      return n > 0;
    }
    case "sops": {
      const n = await prisma.sOPFolderAccess.count({
        where: { userId: viewer.userId, folder: { organizationId: viewer.organizationId } },
      });
      return n > 0;
    }
    default:
      return undefined;
  }
}

function blankObject(type: ObjectType, id: string): ObjectFacts {
  return {
    type,
    id,
    organizationId: null,
    ownerId: null,
    restricted: false,
    findable: false,
    archived: false,
  };
}

async function loadObject(
  viewer: Viewer,
  ref: Extract<ObjectRef, { id: string }>,
): Promise<ContainerResult> {
  switch (ref.type) {
    case "space":
      return loadSpaceFacts(viewer, ref.id);
    case "folder":
      return loadFolderFacts(viewer, ref.id);
    case "list":
      return loadListFacts(viewer, ref.id);
    case "item": {
      const item = await prisma.item.findUnique({
        where: { id: ref.id },
        select: { id: true, title: true, boardId: true, ownerId: true, organizationId: true, archivedAt: true },
      });
      if (!item) return missing("item", ref.id);
      const list = await loadListFacts(viewer, item.boardId);
      return {
        object: {
          type: "item",
          id: item.id,
          organizationId: item.organizationId,
          // Item.ownerId is the primary assignee (the DRI), not a creator, so
          // rule 5 must not fire on it; rule 9's assignee rule covers it.
          ownerId: null,
          restricted: false,
          findable: false,
          archived: item.archivedAt !== null,
          name: item.title,
        },
        chain: [objectAsLink(list.object), ...list.chain],
        grants: list.grants,
      };
    }
    case "doc":
      return loadDocFacts(viewer, ref.id);
    case "table": {
      const table = await prisma.dataTable.findUnique({
        where: { id: ref.id },
        select: { id: true, name: true, organizationId: true, spaceId: true, createdById: true },
      });
      if (!table) return missing("table", ref.id);
      return loadSpaceAnchoredFacts(viewer, "table", table.id, {
        organizationId: table.organizationId,
        ownerId: table.createdById,
        spaceId: table.spaceId,
        name: table.name,
        archived: false,
      });
    }
    case "whiteboard": {
      const wb = await prisma.whiteboard.findUnique({
        where: { id: ref.id },
        select: { id: true, name: true, organizationId: true, spaceId: true, ownerId: true, archivedAt: true },
      });
      if (!wb) return missing("whiteboard", ref.id);
      return loadSpaceAnchoredFacts(viewer, "whiteboard", wb.id, {
        organizationId: wb.organizationId,
        ownerId: wb.ownerId,
        spaceId: wb.spaceId,
        name: wb.name,
        archived: wb.archivedAt !== null,
      });
    }
    case "sop_folder":
      return loadSopFolderFacts(viewer, ref.id);
    case "sop": {
      const sop = await prisma.sOP.findUnique({
        where: { id: ref.id },
        select: { id: true, title: true, organizationId: true, folderId: true, status: true, createdById: true },
      });
      if (!sop) return missing("sop", ref.id);
      const published = sop.status === "PUBLISHED";
      // An unfoldered SOP is org-visible today (schema comment at 1452-1454).
      const anchored = sop.folderId ? await loadSopFolderFacts(viewer, sop.folderId) : null;
      return {
        object: {
          type: "sop",
          id: sop.id,
          organizationId: sop.organizationId,
          ownerId: sop.createdById,
          restricted: false,
          findable: false,
          archived: false,
          name: sop.title,
          published,
          orgWide: !sop.folderId,
        },
        chain: anchored ? [objectAsLink(anchored.object), ...anchored.chain] : [],
        grants: anchored
          ? anchored.grants
          : published
            ? [everyoneGrant("sop", sop.id, "VIEW")]
            : [],
      };
    }
    case "channel": {
      const convo = await prisma.conversation.findUnique({
        where: { id: ref.id },
        select: { id: true, name: true, type: true, spaceId: true, organizationId: true, createdById: true },
      });
      if (!convo) return missing("channel", ref.id);
      // Conversation has no privacy column: DMs and GROUPs are owner-only by
      // type (rule 3); CHANNELs are the public kind today.
      const ownerOnly = convo.type === "DM" || convo.type === "GROUP" ? "dm" : null;
      const anchored = convo.spaceId ? await loadSpaceFacts(viewer, convo.spaceId) : null;
      return {
        object: {
          type: "channel",
          id: convo.id,
          organizationId: convo.organizationId,
          ownerId: convo.createdById,
          restricted: false,
          findable: convo.type === "CHANNEL",
          archived: false,
          name: convo.name ?? "",
          moduleKey: "chat",
          ownerOnly,
        },
        chain: anchored ? [objectAsLink(anchored.object), ...anchored.chain] : [],
        grants: anchored
          ? anchored.grants
          : convo.type === "CHANNEL"
            ? [everyoneGrant("channel", convo.id, "EDIT")]
            : [],
      };
    }
    case "person":
    case "person_card": {
      const user = await prisma.user.findUnique({
        where: { id: ref.id },
        select: { id: true, organizationId: true, firstName: true, lastName: true },
      });
      if (!user) return missing(ref.type, ref.id);
      return {
        object: {
          type: ref.type,
          id: user.id,
          organizationId: user.organizationId,
          ownerId: null,
          restricted: false,
          findable: false,
          archived: false,
          name: `${user.firstName} ${user.lastName}`.trim(),
        },
        chain: [],
        grants: [],
      };
    }
    case "timesheet": {
      const sheet = await prisma.timesheet.findUnique({
        where: { id: ref.id },
        select: { id: true, organizationId: true, userId: true },
      });
      if (!sheet) return missing("timesheet", ref.id);
      return {
        object: {
          type: "timesheet",
          id: sheet.id,
          organizationId: sheet.organizationId,
          ownerId: null,
          restricted: false,
          findable: false,
          archived: false,
        },
        chain: [],
        grants: [],
      };
    }
    default:
      // Every remaining section 3.3 row resolves through relationship rules
      // only. The object row is loaded generically so rule 1 can scope it.
      return loadGenericFacts(viewer, ref.type, ref.id);
  }
}

/**
 * Types whose access is a relationship rule with no container: policy,
 * contract, goal, kra, team, tool, asset, survey, announcement, review_cycle,
 * automation, form, template, kudos, candor, file, file_folder.
 */
async function loadGenericFacts(
  _viewer: Viewer,
  type: ObjectType,
  id: string,
): Promise<ContainerResult> {
  const base = (organizationId: string | null, ownerId: string | null, extra: Partial<ObjectFacts> = {}) => ({
    object: {
      type,
      id,
      organizationId,
      ownerId,
      restricted: false,
      findable: false,
      archived: false,
      moduleKey: MODULE_BY_OBJECT_TYPE[type] ?? null,
      ...extra,
    } as ObjectFacts,
    chain: [] as ChainLink[],
    grants: [] as GrantFact[],
  });

  switch (type) {
    case "policy": {
      const row = await prisma.policy.findUnique({
        where: { id },
        select: { organizationId: true, status: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, null, {
        published: row.status === "PUBLISHED",
        orgWide: true,
      });
    }
    case "contract": {
      const row = await prisma.agreement.findUnique({
        where: { id },
        select: { organizationId: true, createdById: true, archivedAt: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.createdById, { archived: row.archivedAt !== null });
    }
    case "goal": {
      const row = await prisma.oKR.findUnique({
        where: { id },
        select: { organizationId: true, ownerId: true, level: true },
      });
      if (!row) return missing(type, id);
      const result = base(row.organizationId, row.ownerId, { orgWide: row.level === "COMPANY" });
      if (row.level === "COMPANY") result.grants.push(everyoneGrant("goal", id, "VIEW"));
      return result;
    }
    case "kra": {
      const row = await prisma.kRA.findUnique({ where: { id }, select: { organizationId: true } });
      if (!row) return missing(type, id);
      return base(row.organizationId, null);
    }
    case "tool": {
      const row = await prisma.tool.findUnique({
        where: { id },
        select: { organizationId: true, addedBy: true },
      });
      if (!row) return missing(type, id);
      const result = base(row.organizationId, row.addedBy);
      const share = await prisma.toolShare.findUnique({
        where: { toolId_userId: { toolId: id, userId: _viewer.userId } },
        select: { id: true },
      });
      if (share) result.grants.push(userGrant("tool", id, _viewer.userId, "VIEW", "AccessGrant"));
      return result;
    }
    case "asset": {
      const row = await prisma.asset.findUnique({
        where: { id },
        select: { organizationId: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, null);
    }
    case "survey": {
      // PulseSurvey has no creator column, so rule 5 never fires on a survey
      // and its access is the People-team and audience rules only.
      const row = await prisma.pulseSurvey.findUnique({
        where: { id },
        select: { organizationId: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, null);
    }
    case "announcement": {
      const row = await prisma.announcement.findUnique({
        where: { id },
        select: { organizationId: true, authorId: true, targetAudience: true },
      });
      if (!row) return missing(type, id);
      // Spec 3.3: only an org-wide announcement is an EVERYONE VIEW. A targeted
      // one (targetAudience {type, ids}) reaches its audience through rule 9,
      // which is what announcement-audience.ts already enforces for the feed.
      const audience = parseAnnouncementAudience(row.targetAudience);
      return base(row.organizationId, row.authorId, { orgWide: audience.type === "ALL" });
    }
    case "review_cycle": {
      const row = await prisma.reviewCycle.findUnique({
        where: { id },
        select: { organizationId: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, null);
    }
    case "automation": {
      const row = await prisma.automationWorkflow.findUnique({
        where: { id },
        select: { organizationId: true, createdById: true, archivedAt: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.createdById, { archived: row.archivedAt !== null });
    }
    case "form": {
      const row = await prisma.formDefinition.findUnique({
        where: { id },
        select: { organizationId: true, createdById: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.createdById);
    }
    case "template": {
      const row = await prisma.template.findUnique({
        where: { id },
        select: { organizationId: true, createdById: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.createdById);
    }
    case "kudos": {
      const row = await prisma.kudos.findUnique({
        where: { id },
        select: { organizationId: true, giverId: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.giverId);
    }
    case "candor": {
      const row = await prisma.candorSession.findUnique({
        where: { id },
        select: { organizationId: true, createdBy: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.createdBy);
    }
    case "file": {
      const row = await prisma.fileEntry.findUnique({
        where: { id },
        select: { organizationId: true, uploadedById: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.uploadedById);
    }
    case "file_folder": {
      const row = await prisma.fileFolder.findUnique({
        where: { id },
        select: { organizationId: true, createdById: true },
      });
      if (!row) return missing(type, id);
      return base(row.organizationId, row.createdById);
    }
    default:
      return missing(type, id);
  }
}
