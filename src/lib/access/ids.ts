// accessibleIds — whole-list reads, as set arithmetic rather than N calls to
// can().
//
// The return type IS the security control (invariant 2). `readable` holds
// objects with a source at the object's own level or above; `containerOnly`
// holds ancestors the viewer sees only as labels because they hold something
// inside. Content endpoints (files, search, tables, whiteboards, entity links)
// may consume `readable` and nothing else: the `visibleSpaceIds` leak trap
// that lives as a comment at space.ts:165-171 becomes a type here.
//
// This file is the LOADER. Every decision about what a row means, and every
// `minRole` comparison, lives in ./id-sets.ts, which is pure and has a golden
// suite of its own. Nothing here may branch on a role. Before that split the
// whole two-set implementation had no test of any kind and four of its six
// branches ignored minRole outright, which is how a FULL-level call could hand
// a plain Member the org's boards to purge.
//
// Server-only: imports prisma.

import { prisma } from "../prisma";
import type { ObjectRef, ObjectRole, Viewer } from "./types";
import { MODULE_BY_OBJECT_TYPE } from "./settings";
import { loadOrgFacts } from "./facts";
import { RULE_1_DENIED_STATUSES } from "./resolve";
import {
  channelMembershipClears,
  emptyIds,
  folderSets,
  listSets,
  orgWideAnchorlessClears,
  sopFolderSets,
  spaceSets,
  type AccessibleIds,
} from "./id-sets";

export type { AccessibleIds } from "./id-sets";

function empty(): AccessibleIds {
  return emptyIds();
}

function isOrgAdmin(viewer: Viewer): boolean {
  return viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
}

/**
 * accessibleIds(viewer, type, minRole).
 *
 * Rule 2 runs first as set arithmetic: with a module off, every object of that
 * module's types returns empty sets, so search, the palette and every embed
 * show nothing (example K).
 */
export async function accessibleIds(
  viewer: Viewer,
  type: ObjectRef["type"],
  minRole: ObjectRole = "VIEW",
): Promise<AccessibleIds> {
  // Rule 1's viewer half, in full. Applying only `deleted` here (which is what
  // this function used to do) would let a viewer whose every per-object
  // decision is a 404 still receive fully populated readable sets from the set
  // arithmetic, so a list endpoint would answer where the per-object gate
  // refuses. decide() and accessibleIds must agree on rule 1 or they cannot
  // agree on anything (invariant 15).
  if (!viewer.userId || !viewer.organizationId) return empty();
  if (viewer.deleted) return empty();
  if (viewer.status && RULE_1_DENIED_STATUSES.has(viewer.status)) return empty();

  const moduleKey = MODULE_BY_OBJECT_TYPE[type as keyof typeof MODULE_BY_OBJECT_TYPE];
  if (moduleKey) {
    const org = await loadOrgFacts(viewer.organizationId);
    if (!org.activeModules.has(moduleKey)) return empty();
  }

  switch (type) {
    case "space":
      return spaceIds(viewer, minRole);
    case "folder":
      return folderIds(viewer, minRole);
    case "list":
      return listIds(viewer, minRole);
    case "channel":
      return channelIds(viewer, minRole);
    case "sop_folder":
      return sopFolderIds(viewer, minRole);
    case "table":
      return spaceAnchoredIds(viewer, "table", minRole);
    case "whiteboard":
      return spaceAnchoredIds(viewer, "whiteboard", minRole);
    default:
      // Every other type either has no list surface yet or is scoped by its
      // container's set. Step 3 widens this as each surface moves onto the
      // gate; returning empty sets here can only narrow, never leak.
      return empty();
  }
}

// ── Spaces ────────────────────────────────────────────────────────

async function spaceIds(viewer: Viewer, minRole: ObjectRole): Promise<AccessibleIds> {
  const orgId = viewer.organizationId;

  if (isOrgAdmin(viewer)) {
    const all = await prisma.space.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true },
    });
    return spaceSets({
      minRole,
      allIds: all.map((s) => s.id),
      orgVisible: [],
      memberships: [],
      descendantSpaceIds: [],
    });
  }

  const guest = viewer.orgRole === "GUEST";
  const [orgVisible, memberships, folderGrants, boardGrants] = await Promise.all([
    // Rule 8 excludes Guests from EVERYONE grants (invariant 3).
    guest
      ? Promise.resolve([])
      : prisma.space.findMany({
          where: { organizationId: orgId, archivedAt: null, visibility: "ORG" },
          select: { id: true, settings: true },
        }),
    prisma.spaceMember.findMany({
      where: { userId: viewer.userId, space: { organizationId: orgId, archivedAt: null } },
      select: { spaceId: true, role: true },
    }),
    prisma.folderMember.findMany({
      where: { userId: viewer.userId, folder: { archivedAt: null, space: { organizationId: orgId } } },
      select: { folder: { select: { spaceId: true } } },
    }),
    prisma.boardMember.findMany({
      where: { userId: viewer.userId, board: { organizationId: orgId, archivedAt: null } },
      select: { board: { select: { spaceId: true } } },
    }),
  ]);

  const descendantSpaceIds = [
    ...folderGrants.map((g) => g.folder.spaceId),
    ...boardGrants.map((g) => g.board.spaceId).filter((id): id is string => !!id),
  ];
  return spaceSets({ minRole, orgVisible, memberships, descendantSpaceIds });
}

// ── Folders ───────────────────────────────────────────────────────

async function folderIds(viewer: Viewer, minRole: ObjectRole): Promise<AccessibleIds> {
  const orgId = viewer.organizationId;

  if (isOrgAdmin(viewer)) {
    const all = await prisma.folder.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true },
    });
    return folderSets({
      minRole,
      allIds: all.map((f) => f.id),
      grants: [],
      ownedIds: [],
      inheritedIds: [],
      parents: [],
      containerOnlyIds: [],
    });
  }

  // Two Space passes, and the difference is the security control: the
  // INHERITANCE source must clear `minRole` (a folder inherited from a Space
  // the viewer only holds at VIEW is not FULL-readable), while `containerOnly`
  // is a labels-only set that is always computed at VIEW.
  const spaces = await spaceIds(viewer, minRole);
  const spaceLabels = minRole === "VIEW" ? spaces : await spaceIds(viewer, "VIEW");

  const [grants, owned, inSpaces] = await Promise.all([
    prisma.folderMember.findMany({
      where: { userId: viewer.userId, folder: { archivedAt: null, space: { organizationId: orgId } } },
      select: { folderId: true, role: true, folder: { select: { spaceId: true } } },
    }),
    prisma.folder.findMany({
      where: { organizationId: orgId, archivedAt: null, ownerId: viewer.userId },
      select: { id: true },
    }),
    spaces.readable.size
      ? prisma.folder.findMany({
          where: {
            organizationId: orgId,
            archivedAt: null,
            spaceId: { in: [...spaces.readable] },
            visibility: { not: "PRIVATE" },
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  // The parent map, for the downward cascade of a folder grant.
  const parents = grants.length
    ? await prisma.folder.findMany({
        where: {
          spaceId: { in: [...new Set(grants.map((g) => g.folder.spaceId))] },
          archivedAt: null,
        },
        select: { id: true, parentFolderId: true },
      })
    : [];

  return folderSets({
    minRole,
    grants: grants.map((g) => ({ folderId: g.folderId, role: g.role })),
    ownedIds: owned.map((f) => f.id),
    inheritedIds: inSpaces.map((f) => f.id),
    parents,
    containerOnlyIds: [...spaceLabels.containerOnly],
  });
}

// ── Lists ─────────────────────────────────────────────────────────

async function listIds(viewer: Viewer, minRole: ObjectRole): Promise<AccessibleIds> {
  const orgId = viewer.organizationId;

  if (isOrgAdmin(viewer)) {
    const all = await prisma.board.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true },
    });
    return listSets({
      minRole,
      allIds: all.map((b) => b.id),
      grants: [],
      ownedIds: [],
      inheritedIds: [],
      orgVisibleIds: [],
      containerOnlyIds: [],
    });
  }

  // Same rule as folderIds: the containers a board INHERITS from have to clear
  // minRole, or `readable` widens past the floor the caller asked for. Trash
  // (spec 5.2.1) calls accessibleIds(type, FULL) precisely to list what the
  // viewer may purge, and with a VIEW-level container set that would have been
  // every board in every Space they can see.
  const folders = await folderIds(viewer, minRole);
  const folderLabels = minRole === "VIEW" ? folders : await folderIds(viewer, "VIEW");
  const spaces = await spaceIds(viewer, minRole);
  const guest = viewer.orgRole === "GUEST";

  const [grants, owned, inContainers, orgVisible] = await Promise.all([
    prisma.boardMember.findMany({
      where: { userId: viewer.userId, board: { organizationId: orgId, archivedAt: null } },
      select: { boardId: true, role: true },
    }),
    prisma.board.findMany({
      where: { organizationId: orgId, archivedAt: null, ownerId: viewer.userId },
      select: { id: true },
    }),
    folders.readable.size || spaces.readable.size
      ? prisma.board.findMany({
          where: {
            organizationId: orgId,
            archivedAt: null,
            visibility: { not: "PRIVATE" },
            OR: [
              folders.readable.size ? { folderId: { in: [...folders.readable] } } : { id: "__none__" },
              spaces.readable.size
                ? { folderId: null, spaceId: { in: [...spaces.readable] } }
                : { id: "__none__" },
            ],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    guest
      ? Promise.resolve([])
      : prisma.board.findMany({
          where: { organizationId: orgId, archivedAt: null, visibility: "ORG" },
          select: { id: true },
        }),
  ]);

  return listSets({
    minRole,
    grants,
    ownedIds: owned.map((b) => b.id),
    inheritedIds: inContainers.map((b) => b.id),
    orgVisibleIds: orgVisible.map((b) => b.id),
    containerOnlyIds: [...folderLabels.containerOnly],
  });
}

// ── Channels, SOP folders, Space-anchored objects ─────────────────

/**
 * A Space-LINKED channel (`Conversation.spaceId`) inherits its Space and does
 * NOT carry the EVERYONE row: loadObject withholds it deliberately, so a
 * channel attached to a private Space must not come back here either, or it
 * would be absent from can() and present in search, the palette and every
 * other consumer of this set.
 */
async function channelIds(viewer: Viewer, minRole: ObjectRole): Promise<AccessibleIds> {
  const out = empty();
  if (!channelMembershipClears(minRole)) return out;

  const memberships = await prisma.conversationMember.findMany({
    where: { userId: viewer.userId, conversation: { organizationId: viewer.organizationId } },
    select: { conversationId: true },
  });
  for (const m of memberships) out.readable.add(m.conversationId);

  if (viewer.orgRole !== "GUEST") {
    const publicChannels = await prisma.conversation.findMany({
      where: { organizationId: viewer.organizationId, type: "CHANNEL", spaceId: null },
      select: { id: true },
    });
    for (const c of publicChannels) out.readable.add(c.id);

    // Space-linked channels come in through their Space, at the Space's role.
    const spaces = await spaceIds(viewer, minRole);
    if (spaces.readable.size > 0) {
      const linked = await prisma.conversation.findMany({
        where: {
          organizationId: viewer.organizationId,
          type: "CHANNEL",
          spaceId: { in: [...spaces.readable] },
        },
        select: { id: true },
      });
      for (const c of linked) out.readable.add(c.id);
    }
  }
  return out;
}

async function sopFolderIds(viewer: Viewer, minRole: ObjectRole): Promise<AccessibleIds> {
  if (isOrgAdmin(viewer)) {
    const all = await prisma.sOPFolder.findMany({
      where: { organizationId: viewer.organizationId },
      select: { id: true },
    });
    return sopFolderSets({ minRole, allIds: all.map((f) => f.id), grants: [], parents: [] });
  }
  const rows = await prisma.sOPFolderAccess.findMany({
    where: { userId: viewer.userId, folder: { organizationId: viewer.organizationId } },
    select: { folderId: true, role: true },
  });
  if (rows.length === 0) return sopFolderSets({ minRole, grants: [], parents: [] });

  // A SOP folder grant cascades to its children (schema comment 1523-1529).
  const all = await prisma.sOPFolder.findMany({
    where: { organizationId: viewer.organizationId },
    select: { id: true, parentId: true },
  });
  return sopFolderSets({ minRole, grants: rows, parents: all });
}

/**
 * Tables and Whiteboards anchor to a Space, or are org-wide when unanchored.
 *
 * `minRole` is honoured on every branch: the Space-anchored rows come from a
 * Space set that already cleared it, the unanchored rows carry an EVERYONE
 * EDIT grant (which is what /api/tables/[id] and /api/whiteboards/[id] enforce
 * today: the whole org may GET and PATCH one), and the creator's own rows are
 * FULL by rule 5. Discarding minRole, which is what `void minRole` used to do,
 * is what let accessibleIds(type, FULL) hand a plain Member every table in
 * every Space they can see.
 */
async function spaceAnchoredIds(
  viewer: Viewer,
  type: "table" | "whiteboard",
  minRole: ObjectRole,
): Promise<AccessibleIds> {
  const out = empty();
  const spaces = await spaceIds(viewer, minRole);
  const spaceLabels = minRole === "VIEW" ? spaces : await spaceIds(viewer, "VIEW");
  const guest = viewer.orgRole === "GUEST";
  const scoped = [...spaces.readable];

  const anchored = scoped.length ? { spaceId: { in: scoped } } : { id: "__none__" };
  const unanchored = orgWideAnchorlessClears(minRole, guest) ? { spaceId: null } : { id: "__none__" };

  if (type === "table") {
    const rows = await prisma.dataTable.findMany({
      where: {
        organizationId: viewer.organizationId,
        OR: [anchored, unanchored, { createdById: viewer.userId }],
      },
      select: { id: true },
    });
    for (const r of rows) out.readable.add(r.id);
  } else {
    const rows = await prisma.whiteboard.findMany({
      where: {
        organizationId: viewer.organizationId,
        archivedAt: null,
        OR: [anchored, unanchored, { ownerId: viewer.userId }],
      },
      select: { id: true },
    });
    for (const r of rows) out.readable.add(r.id);
  }

  for (const id of spaceLabels.containerOnly) out.containerOnly.add(id);
  return out;
}
