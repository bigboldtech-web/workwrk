// SOP taxonomy mirrors — the SOPFolder tree is the ONE taxonomy (top-level
// folder = Category, child = Subcategory). The legacy SOP.category /
// SOP.subcategory strings are display mirrors of the folder chain, consumed
// by list grouping, chips and filters. Every write that changes WHICH folder
// an SOP sits in, or what that folder chain is NAMED, must re-mirror the
// affected SOPs — otherwise the library keeps grouping under stale names
// (the exact bug: rename "HR" → "People" and /sops still shows "HR").

import { prisma } from "@/lib/prisma";

export interface CategoryChain {
  category: string | null;
  subcategory: string | null;
}

/** The mirrored strings for one folder id (null folder = uncategorized). */
export async function categoryChainFor(orgId: string, folderId: string | null): Promise<CategoryChain> {
  if (!folderId) return { category: null, subcategory: null };
  const folders = await prisma.sOPFolder.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(folders.map((f) => [f.id, f]));
  const node = byId.get(folderId);
  if (!node) return { category: null, subcategory: null };
  let top = node;
  while (top.parentId && byId.has(top.parentId)) top = byId.get(top.parentId)!;
  return { category: top.name, subcategory: top.id === node.id ? null : node.name };
}

/**
 * Recompute the mirrored strings for every SOP in a folder's subtree
 * (the folder itself + all descendants). Called after a rename or a
 * re-parent: both change what the chain reads for every SOP under it.
 */
export async function resyncFolderSubtreeMirrors(orgId: string, rootId: string): Promise<number> {
  const folders = await prisma.sOPFolder.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(folders.map((f) => [f.id, f]));
  const childrenOf = new Map<string | null, string[]>();
  for (const f of folders) {
    const arr = childrenOf.get(f.parentId) ?? [];
    arr.push(f.id);
    childrenOf.set(f.parentId, arr);
  }

  // Subtree = root + descendants (BFS).
  const affected: string[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (!byId.has(id)) continue;
    affected.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  if (affected.length === 0) return 0;

  const ops = affected.map((fid) => {
    let top = byId.get(fid)!;
    while (top.parentId && byId.has(top.parentId)) top = byId.get(top.parentId)!;
    const node = byId.get(fid)!;
    return prisma.sOP.updateMany({
      where: { folderId: fid, organizationId: orgId },
      data: { category: top.name, subcategory: top.id === node.id ? null : node.name },
    });
  });
  const results = await prisma.$transaction(ops);
  return results.reduce((n, r) => n + r.count, 0);
}
