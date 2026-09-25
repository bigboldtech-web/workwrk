// Which Lists of ONE Space a viewer can read and write, for dozens at once.
//
// Bird's eye, every cross-List Space tab, the Space header's count and
// GET /api/boards?spaceId= all need the same answer, and the per-List helpers
// (getBoardForReader, getBoardForReaderOrFolderGrantee, canContributeBoard)
// cost two or three queries per List. Sixty Lists would be well over a
// hundred round trips. So src/lib/space.ts loads the facts ONCE, in four
// queries, and this file hands them, List by List, to the very functions
// those helpers delegate to: the frozen transcriptions in parity.ts. The
// answers are therefore the helpers' answers, not a second opinion, and
// space-lists.test.ts holds the two side by side.
//
// Pure: no Prisma, no clock. It builds LegacyInputs, which names the legacy
// access signal, so it sits on eslint-access-allowlist.mjs next to
// src/lib/space.ts and leaves it with that file at access step 6.

import {
  legacyAllows,
  type LegacyBoard,
  type LegacyFolder,
  type LegacyInputs,
  type LegacySpace,
  type SpaceRoleValue,
  type VisibilityValue,
} from "@/lib/access/parity";

/** A live folder of the Space, as the four-query load reads it. */
export interface SpaceTreeFolder {
  id: string;
  parentFolderId: string | null;
  visibility: VisibilityValue | string;
  ownerId: string | null;
}

/** A live List of the Space, with the viewer's own BoardMember role on it. */
export interface SpaceTreeBoard {
  id: string;
  folderId: string | null;
  visibility: VisibilityValue | string;
  ownerId: string | null;
  memberRole: SpaceRoleValue | null;
}

export interface SpaceListsViewer {
  userId: string;
  organizationId: string;
  accessLevel: string | null | undefined;
}

/**
 * Lists in the Work sidebar's order, each with the folders above it (root
 * first, its own folder last).
 *
 * The tree draws root folders by position, inside each folder its child
 * folders first and then its Lists by name, and the Space's root Lists after
 * every folder (space-tree-row.tsx, the Space row and FolderTreeRow). The
 * caller hands folders sorted by (position, id) and Lists by (name, id); this
 * keeps those orders and walks any depth, so a List three folders down keeps
 * its place even though the tree itself only draws two sub-levels.
 *
 * A List whose folder cannot be reached from a root folder (an archived
 * folder is not in the input) is left out, exactly as the tree leaves it out.
 * The visited set is defence against a parentFolderId cycle written by an
 * older release.
 */
export function orderListsLikeSidebar<
  F extends { id: string; parentFolderId: string | null },
  L extends { folderId: string | null },
>(folders: readonly F[], lists: readonly L[]): Array<{ list: L; chain: F[] }> {
  const roots: F[] = [];
  const childrenOf = new Map<string, F[]>();
  for (const f of folders) {
    if (f.parentFolderId === null) {
      roots.push(f);
      continue;
    }
    const kids = childrenOf.get(f.parentFolderId);
    if (kids) kids.push(f);
    else childrenOf.set(f.parentFolderId, [f]);
  }
  const rootLists: L[] = [];
  const listsIn = new Map<string, L[]>();
  for (const l of lists) {
    if (l.folderId === null) {
      rootLists.push(l);
      continue;
    }
    const here = listsIn.get(l.folderId);
    if (here) here.push(l);
    else listsIn.set(l.folderId, [l]);
  }

  const out: Array<{ list: L; chain: F[] }> = [];
  const visited = new Set<string>();
  const walk = (folder: F, above: F[]) => {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    const chain = [...above, folder];
    for (const child of childrenOf.get(folder.id) ?? []) walk(child, chain);
    for (const list of listsIn.get(folder.id) ?? []) out.push({ list, chain });
  };
  for (const root of roots) walk(root, []);
  for (const list of rootLists) out.push({ list, chain: [] });
  return out;
}

function asVisibility(v: string): VisibilityValue {
  return v === "PRIVATE" || v === "ORG" ? v : "WORKSPACE";
}

/**
 * The shallow folder struct loadBoardInputs builds for the reader
 * (folderDepth "shallow"): the List's own folder row, no ancestor walk, and
 * no FolderMember role, because legacyGetBoardForReader reads only the
 * folder's visibility and ownerId.
 */
function shallowFolder(space: LegacySpace, f: SpaceTreeFolder): LegacyFolder {
  return {
    id: f.id,
    organizationId: space.organizationId,
    spaceId: space.id,
    parentFolderId: f.parentFolderId,
    visibility: asVisibility(f.visibility),
    ownerId: f.ownerId,
    memberRole: null,
  };
}

/**
 * The Lists of one Space this viewer reads, in sidebar order, each marked with
 * whether they may write in it; plus how many of the Space's folders they see.
 *
 * READ is exactly getBoardForReaderOrFolderGrantee (board.ts), the List
 * page's own gate: the reader transcription, or the List's folder in the
 * viewer's descendant-aware folder grants.
 *
 * WRITE is exactly canContributeBoard, whose loader reads no folder at all:
 * a Space GUEST, a folder grantee and a Space OWNER on someone's PRIVATE List
 * all read without writing.
 *
 * TREE. A List below a folder the viewer cannot see (a PRIVATE ancestor that
 * is not theirs) is left out, the way the Work tree and the old Space page
 * left it out, unless its own folder is granted (the grant set already covers
 * every folder under a granted one) or the viewer holds a BoardMember row on
 * it, the direct share that is meant to reach them wherever it sits.
 */
export function decideSpaceLists<B extends SpaceTreeBoard>(
  viewer: SpaceListsViewer,
  input: {
    space: LegacySpace;
    folders: readonly SpaceTreeFolder[];
    boards: readonly B[];
    granted: ReadonlySet<string>;
  },
): { lists: Array<B & { canContribute: boolean }>; visibleFolderCount: number } {
  const { space, folders, boards, granted } = input;
  const base: LegacyInputs = {
    userId: viewer.userId,
    organizationId: viewer.organizationId,
    accessLevel: viewer.accessLevel ?? null,
    space,
  };
  const seen = new Map<string, boolean>();
  const folderShown = (f: SpaceTreeFolder): boolean => {
    const known = seen.get(f.id);
    if (known !== undefined) return known;
    const shown = legacyAllows({ ...base, folder: shallowFolder(space, f) }, "folderVisibleTo");
    seen.set(f.id, shown);
    return shown;
  };

  const lists: Array<B & { canContribute: boolean }> = [];
  for (const { list, chain } of orderListsLikeSidebar(folders, boards)) {
    const own = chain.length > 0 ? chain[chain.length - 1] : null;
    const board: LegacyBoard = {
      id: list.id,
      organizationId: space.organizationId,
      spaceId: space.id,
      folderId: list.folderId,
      visibility: asVisibility(list.visibility),
      ownerId: list.ownerId,
      memberRole: list.memberRole,
    };
    const inputs: LegacyInputs = { ...base, folder: own ? shallowFolder(space, own) : null, board };
    const readable =
      legacyAllows(inputs, "getBoardForReader") || (list.folderId !== null && granted.has(list.folderId));
    if (!readable) continue;
    const treeShown = list.folderId === null || granted.has(list.folderId) || chain.every(folderShown);
    if (!treeShown && list.memberRole === null) continue;
    const canContribute = legacyAllows({ ...inputs, folder: null }, "canContributeBoard");
    lists.push({ ...list, canContribute });
  }

  // Folders the viewer sees anywhere in the tree: granted, or every folder of
  // the chain down to it visible. Unreachable folders are not in the tree, so
  // they are not counted either.
  let visibleFolderCount = 0;
  const roots = folders.filter((f) => f.parentFolderId === null);
  const childrenOf = new Map<string, SpaceTreeFolder[]>();
  for (const f of folders) {
    if (f.parentFolderId === null) continue;
    const kids = childrenOf.get(f.parentFolderId);
    if (kids) kids.push(f);
    else childrenOf.set(f.parentFolderId, [f]);
  }
  const visited = new Set<string>();
  const count = (f: SpaceTreeFolder, chainShown: boolean) => {
    if (visited.has(f.id)) return;
    visited.add(f.id);
    const shownHere = chainShown && folderShown(f);
    if (granted.has(f.id) || shownHere) visibleFolderCount += 1;
    for (const child of childrenOf.get(f.id) ?? []) count(child, shownHere);
  };
  for (const root of roots) count(root, true);

  return { lists, visibleFolderCount };
}
