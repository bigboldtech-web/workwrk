// The pure half of accessibleIds.
//
// ids.ts issues the queries; this file decides what the rows mean. The split
// is the same one that lets decide() be hammered by the golden suite with no
// database (spec 5.1, graft G12), and it exists here for the same reason:
// invariant 2 ("full-read sets never widen by lower grants ... the
// visibleSpaceIds leak trap becomes a type") is the security control of the
// whole list path, and it needs a test that can actually fail. Before the
// split the entire two-set implementation had no test of any kind, and four of
// its six branches ignored `minRole` outright.
//
// Pure: imports ./types and ./settings only.

import { ROLE_RANK, type ObjectRole } from "./types";
import { roleFromDefaultPermission } from "./settings";

export interface AccessibleIds {
  /** Objects the viewer may read the CONTENT of. */
  readable: Set<string>;
  /** Ancestors rendered as bare container labels. Never a content scope. */
  containerOnly: Set<string>;
}

/** A fresh pair every time: the sets are mutable and must never be shared. */
export function emptyIds(): AccessibleIds {
  return { readable: new Set(), containerOnly: new Set() };
}

export function atLeast(role: ObjectRole, min: ObjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** SpaceRole on SpaceMember / FolderMember / BoardMember (spec 3.1). */
export function roleFromSpaceRole(role: string): ObjectRole {
  if (role === "OWNER" || role === "ADMIN") return "FULL";
  if (role === "MEMBER") return "EDIT";
  return "VIEW"; // GUEST
}

/** SOPFolderRole (spec 3.1). */
export function roleFromSopRole(role: string): ObjectRole {
  if (role === "OWNER") return "FULL";
  if (role === "EDITOR") return "EDIT";
  return "VIEW"; // VIEWER
}

// ── Spaces ────────────────────────────────────────────────────────

export interface SpaceSetInput {
  minRole: ObjectRole;
  /** Every Space in the org, for the org-admin short-circuit. */
  allIds?: string[];
  /** Visibility.ORG spaces, with their settings blob for the EVERYONE role. */
  orgVisible: Array<{ id: string; settings: unknown }>;
  /** The viewer's own SpaceMember rows. */
  memberships: Array<{ spaceId: string; role: string }>;
  /** Spaces reached ONLY through a grant on something inside them. */
  descendantSpaceIds: string[];
}

/**
 * `readable` = Spaces with a SPACE-LEVEL source: org admin, an EVERYONE grant
 * (Visibility.ORG today, at the role settings.defaultPermission maps to) or a
 * SpaceMember row whose mapped role clears `minRole`.
 *
 * A folder-only or board-only grant must NEVER widen this set. That is the
 * `visibleSpaceIds` leak trap (space.ts:165-171) stated as code: such a Space
 * lands in `containerOnly`, which content endpoints cannot consume.
 */
export function spaceSets(input: SpaceSetInput): AccessibleIds {
  const out = emptyIds();
  if (input.allIds) {
    for (const id of input.allIds) out.readable.add(id);
    return out;
  }
  for (const space of input.orgVisible) {
    if (atLeast(roleFromDefaultPermission(space.settings), input.minRole)) out.readable.add(space.id);
  }
  for (const m of input.memberships) {
    if (atLeast(roleFromSpaceRole(m.role), input.minRole)) out.readable.add(m.spaceId);
  }
  for (const id of input.descendantSpaceIds) {
    if (!out.readable.has(id)) out.containerOnly.add(id);
  }
  return out;
}

// ── Folders ───────────────────────────────────────────────────────

export interface FolderSetInput {
  minRole: ObjectRole;
  allIds?: string[];
  /** The viewer's own FolderMember rows. */
  grants: Array<{ folderId: string; role: string }>;
  /** Folders whose ownerId is the viewer (rule 5: always FULL). */
  ownedIds: string[];
  /**
   * Non-PRIVATE folders sitting inside a Space the viewer reads AT `minRole`.
   * The caller must have resolved that Space set at `minRole`, not at VIEW:
   * a folder inherited from a Space held at VIEW is not FULL-readable.
   */
  inheritedIds: string[];
  /** parentFolderId per folder, for the downward cascade of a folder grant. */
  parents: Array<{ id: string; parentFolderId: string | null }>;
  /** Container labels carried up from the Space set. */
  containerOnlyIds: string[];
}

export function folderSets(input: FolderSetInput): AccessibleIds {
  const out = emptyIds();
  if (input.allIds) {
    for (const id of input.allIds) out.readable.add(id);
    return out;
  }

  for (const id of input.ownedIds) out.readable.add(id);
  const seeds: string[] = [];
  for (const g of input.grants) {
    if (!atLeast(roleFromSpaceRole(g.role), input.minRole)) continue;
    out.readable.add(g.folderId);
    seeds.push(g.folderId);
  }
  for (const id of input.inheritedIds) out.readable.add(id);

  // A grant on a folder cascades to every folder inside it.
  for (const id of cascade(seeds, input.parents)) out.readable.add(id);

  for (const id of input.containerOnlyIds) {
    if (!out.readable.has(id)) out.containerOnly.add(id);
  }
  return out;
}

/** Every descendant of `seeds` in a parent map, seeds excluded. */
export function cascade(
  seeds: string[],
  rows: Array<{ id: string; parentFolderId: string | null }>,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentFolderId) continue;
    const arr = childrenByParent.get(row.parentFolderId) ?? [];
    arr.push(row.id);
    childrenByParent.set(row.parentFolderId, arr);
  }
  const out = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (out.has(child) || seeds.includes(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

// ── Lists ─────────────────────────────────────────────────────────

export interface ListSetInput {
  minRole: ObjectRole;
  allIds?: string[];
  /** The viewer's own BoardMember rows. */
  grants: Array<{ boardId: string; role: string }>;
  /** Boards whose ownerId is the viewer. */
  ownedIds: string[];
  /**
   * Non-PRIVATE boards inside a folder or Space the viewer reads AT `minRole`.
   * A PRIVATE (restricted) board is never in here: no Full-access ancestor
   * pierces it (invariant 6).
   */
  inheritedIds: string[];
  /** Visibility.ORG boards. Their EVERYONE grant is VIEW and nothing above. */
  orgVisibleIds: string[];
  containerOnlyIds: string[];
}

export function listSets(input: ListSetInput): AccessibleIds {
  const out = emptyIds();
  if (input.allIds) {
    for (const id of input.allIds) out.readable.add(id);
    return out;
  }

  for (const id of input.ownedIds) out.readable.add(id);
  for (const g of input.grants) {
    if (atLeast(roleFromSpaceRole(g.role), input.minRole)) out.readable.add(g.boardId);
  }
  for (const id of input.inheritedIds) out.readable.add(id);
  if (input.minRole === "VIEW") for (const id of input.orgVisibleIds) out.readable.add(id);

  for (const id of input.containerOnlyIds) {
    if (!out.readable.has(id)) out.containerOnly.add(id);
  }
  return out;
}

// ── SOP folders ───────────────────────────────────────────────────

export interface SopFolderSetInput {
  minRole: ObjectRole;
  allIds?: string[];
  grants: Array<{ folderId: string; role: string }>;
  /** parentId per SOP folder, for the cascade (schema comment 1523-1529). */
  parents: Array<{ id: string; parentId: string | null }>;
}

export function sopFolderSets(input: SopFolderSetInput): AccessibleIds {
  const out = emptyIds();
  if (input.allIds) {
    for (const id of input.allIds) out.readable.add(id);
    return out;
  }
  const seeds: string[] = [];
  for (const g of input.grants) {
    if (!atLeast(roleFromSopRole(g.role), input.minRole)) continue;
    out.readable.add(g.folderId);
    seeds.push(g.folderId);
  }
  const parents = input.parents.map((p) => ({ id: p.id, parentFolderId: p.parentId }));
  for (const id of cascade(seeds, parents)) out.readable.add(id);
  return out;
}

// ── Channels ──────────────────────────────────────────────────────

/**
 * A ConversationMember row is the grant at EDIT (spec 3.6) and a public
 * channel carries an EVERYONE EDIT grant, so both clear every minRole up to
 * EDIT and neither clears FULL.
 */
export function channelMembershipClears(minRole: ObjectRole): boolean {
  return atLeast("EDIT", minRole);
}

/**
 * An unanchored Table or Whiteboard carries an EVERYONE EDIT grant, which is
 * what /api/tables/[id] and /api/whiteboards/[id] enforce today (the whole org
 * may GET and PATCH one). Guests get no EVERYONE grant at all (rule 8).
 */
export function orgWideAnchorlessClears(minRole: ObjectRole, isGuest: boolean): boolean {
  return !isGuest && atLeast("EDIT", minRole);
}
