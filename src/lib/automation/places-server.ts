// Where an automation can run, as the viewer may see it: the Spaces, Folders
// and Lists the viewer can read (Can view or higher from the one node
// resolver, node-access), with names. The builder's "Where it runs" picker
// offers exactly these, and a place a saved scope names that the viewer
// cannot read is never named or counted (node-rules: "a node the viewer
// cannot open is never listed, named or counted"), so neither the Workflows
// list nor the builder can leak a private List's name or how many there are.

import { prisma } from "@/lib/prisma";
import { nodeCtxFromViewer, nodeRoles } from "@/lib/access/node-access";
import { refKey, roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import type { Viewer } from "@/lib/access/types";
import { parseBoardSchema } from "@/lib/field-catalog";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { isEverywhere, readScope, type AutomationScope } from "./definition";
import { SETTABLE_FIELD_TYPES } from "./set-field";

export interface PlaceSpace { id: string; name: string }
export interface PlaceFolder { id: string; name: string; spaceId: string }
export interface PlaceField { key: string; label: string; type: string; choices?: Array<{ value: string; label: string }> }
export interface PlaceList { id: string; name: string; spaceId: string | null; folderId: string | null; fields?: PlaceField[]; statuses?: Array<{ value: string; label: string }> }

export interface Places {
  spaces: PlaceSpace[];
  folders: PlaceFolder[];
  lists: PlaceList[];
}

/** The fields a set-field action and a field-change trigger may name. */
export { SETTABLE_FIELD_TYPES };

export async function loadPlaces(viewer: Viewer, orgId: string, opts: { withFields?: boolean } = {}): Promise<Places> {
  // Every live place of the workspace is a candidate, and ONE world decides
  // them all (never a check per row), as /api/lists/pick does.
  const [allSpaces, allFolders, allLists] = await Promise.all([
    prisma.space.findMany({ where: { organizationId: orgId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.folder.findMany({ where: { organizationId: orgId, archivedAt: null }, select: { id: true, name: true, spaceId: true }, orderBy: { name: "asc" } }),
    prisma.board.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, spaceId: true, folderId: true, ...(opts.withFields ? { schema: true, statuses: true } : {}) },
      orderBy: { name: "asc" },
    }),
  ]);
  const readable = await readableRefs(viewer, [
    ...allSpaces.map((r) => ({ kind: "space" as const, id: r.id })),
    ...allFolders.map((r) => ({ kind: "folder" as const, id: r.id })),
    ...allLists.map((r) => ({ kind: "list" as const, id: r.id })),
  ]);
  const spaces = allSpaces.filter((r) => readable.has(refKey({ kind: "space", id: r.id })));
  const folders = allFolders.filter((r) => readable.has(refKey({ kind: "folder", id: r.id })));
  const lists = allLists.filter((r) => readable.has(refKey({ kind: "list", id: r.id })));
  return {
    spaces,
    folders,
    lists: lists.map((l) => {
      const base: PlaceList = { id: l.id, name: l.name, spaceId: l.spaceId, folderId: l.folderId };
      if (!opts.withFields) return base;
      const schema = parseBoardSchema((l as { schema?: unknown }).schema);
      return {
        ...base,
        // The List's own statuses, so a status condition or "Change status"
        // offers the words that List uses.
        statuses: getBoardStatuses(l as { statuses?: unknown }).map((st) => ({ value: st.value, label: st.label })),
        fields: schema.fields
          .filter((f) => SETTABLE_FIELD_TYPES.has(String(f.type)))
          .map((f) => ({
            key: f.key,
            label: f.label,
            type: String(f.type),
            ...(f.options?.choices?.length ? { choices: f.options.choices.map((c) => ({ value: String(c.value), label: String(c.label) })) } : {}),
          })),
      };
    }),
  };
}

/** The refs, as refKey strings, this viewer holds Can view or higher on. */
async function readableRefs(viewer: Viewer, refs: NodeRef[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (refs.length === 0) return out;
  const decisions = await nodeRoles(nodeCtxFromViewer(viewer), refs);
  for (const [key, d] of decisions) if (roleAtLeast(d.role, "VIEW")) out.add(key);
  return out;
}

/**
 * Can this viewer open each place the scopes name (Can view, the bar the
 * picker, the chips, the summary and the save all share)? One read.
 */
export async function scopeReadable(viewer: Viewer, scopes: AutomationScope[]): Promise<(kind: "list" | "folder" | "space", id: string) => boolean> {
  const refs: NodeRef[] = [];
  for (const sc of scopes) {
    sc.listIds.forEach((id) => refs.push({ kind: "list", id }));
    sc.folderIds.forEach((id) => refs.push({ kind: "folder", id }));
    sc.spaceIds.forEach((id) => refs.push({ kind: "space", id }));
  }
  const readable = await readableRefs(viewer, refs);
  return (kind, id) => readable.has(refKey({ kind, id }));
}

export interface ScopeSummary {
  /** "Everywhere", or the readable names, in the order the scope lists them. */
  names: string[];
  everywhere: boolean;
}

/** The readable names of every place a set of scopes names, in one read. */
export async function scopeNamer(viewer: Viewer, orgId: string, scopes: AutomationScope[]): Promise<(s: AutomationScope) => ScopeSummary> {
  const lists = new Set<string>();
  const folders = new Set<string>();
  const spaces = new Set<string>();
  for (const s of scopes) {
    s.listIds.forEach((id) => lists.add(id));
    s.folderIds.forEach((id) => folders.add(id));
    s.spaceIds.forEach((id) => spaces.add(id));
  }
  const names = new Map<string, string>();
  if (lists.size + folders.size + spaces.size > 0) {
    const readable = await readableRefs(viewer, [
      ...[...lists].map((id) => ({ kind: "list" as const, id })),
      ...[...folders].map((id) => ({ kind: "folder" as const, id })),
      ...[...spaces].map((id) => ({ kind: "space" as const, id })),
    ]);
    const okLists = [...lists].filter((id) => readable.has(refKey({ kind: "list", id })));
    const okFolders = [...folders].filter((id) => readable.has(refKey({ kind: "folder", id })));
    const okSpaces = [...spaces].filter((id) => readable.has(refKey({ kind: "space", id })));
    const [bl, bf, bs] = await Promise.all([
      okLists.length ? prisma.board.findMany({ where: { id: { in: okLists }, organizationId: orgId }, select: { id: true, name: true } }) : [],
      okFolders.length ? prisma.folder.findMany({ where: { id: { in: okFolders }, organizationId: orgId }, select: { id: true, name: true } }) : [],
      okSpaces.length ? prisma.space.findMany({ where: { id: { in: okSpaces }, organizationId: orgId }, select: { id: true, name: true } }) : [],
    ]);
    for (const r of [...bl, ...bf, ...bs]) names.set(r.id, r.name);
  }
  return (s) => {
    const ids = [...s.spaceIds, ...s.folderIds, ...s.listIds];
    if (ids.length === 0) return { names: [], everywhere: true };
    // A place the viewer cannot open is left out, not counted: there is no
    // "2 more you can't open" (node-rules, never listed, named or counted).
    const shown = ids.map((id) => names.get(id)).filter((n): n is string => !!n);
    return { names: shown, everywhere: false };
  };
}

/**
 * A saved scope with every id that is not a Space, Folder or List of THIS
 * workspace dropped: a junk id, or one from another organization, is never
 * stored. Ids the viewer cannot read are kept as they are (they are real,
 * and kept on the server: never listed, named or counted to that viewer).
 */
export async function scopeInOrg(orgId: string, scope: AutomationScope): Promise<AutomationScope> {
  const all = [...scope.listIds, ...scope.folderIds, ...scope.spaceIds];
  const [lists, folders, spaces, trashed] = await Promise.all([
    scope.listIds.length ? prisma.board.findMany({ where: { id: { in: scope.listIds }, organizationId: orgId }, select: { id: true } }) : [],
    scope.folderIds.length ? prisma.folder.findMany({ where: { id: { in: scope.folderIds }, organizationId: orgId }, select: { id: true } }) : [],
    scope.spaceIds.length ? prisma.space.findMany({ where: { id: { in: scope.spaceIds }, organizationId: orgId }, select: { id: true } }) : [],
    // A place moved to this workspace's Trash keeps its id there, and a
    // restore brings back the same id: it stays in the scope (matching
    // nothing meanwhile) so restoring the List brings it back into the
    // automation, and the automation never loses the place for good.
    all.length
      ? prisma.trashItem.findMany({ where: { organizationId: orgId, entityType: { in: ["board", "folder", "space"] }, entityId: { in: all } }, select: { entityId: true } })
      : [],
  ]);
  const inTrash = new Set(trashed.map((t) => t.entityId));
  const keep = (rows: Array<{ id: string }>, ids: string[]) => {
    const ok = new Set(rows.map((r) => r.id));
    return ids.filter((id) => ok.has(id) || inTrash.has(id));
  };
  const pruned = { listIds: keep(lists, scope.listIds), folderIds: keep(folders, scope.folderIds), spaceIds: keep(spaces, scope.spaceIds) };
  // Never wider than asked: pruning a scope that named places down to
  // nothing would read as Everywhere and run the automation on every task
  // in the workspace. Such a scope (places gone with a whole Space, say) is
  // kept as it was and simply matches nothing.
  return isEverywhere(pruned) && !isEverywhere(scope) ? scope : pruned;
}

/**
 * The definition as it will be stored, with its scope pruned to this
 * workspace (scopeInOrg). Everywhere stays Everywhere, and a scope that named
 * places never becomes Everywhere: scopeMatches never matches a place that
 * is gone, while Everywhere matches every task.
 */
export async function definitionWithScopeInOrg(orgId: string, definition: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!("scope" in definition)) return definition;
  const pruned = await scopeInOrg(orgId, readScope(definition));
  const rest = { ...definition };
  delete rest.scope;
  return isEverywhere(pruned) ? rest : { ...rest, scope: pruned };
}

/** The Lists and Folders inside a container, for the Workflows list's "..." menu filter. */
export async function containerContents(orgId: string, kind: "list" | "folder" | "space", id: string): Promise<{ name: string | null; listIds: string[]; folderIds: string[] } | null> {
  if (kind === "list") {
    const b = await prisma.board.findFirst({ where: { id, organizationId: orgId }, select: { name: true } });
    return b ? { name: b.name, listIds: [id], folderIds: [] } : null;
  }
  if (kind === "folder") {
    const f = await prisma.folder.findFirst({ where: { id, organizationId: orgId }, select: { name: true } });
    if (!f) return null;
    const boards = await prisma.board.findMany({ where: { folderId: id, organizationId: orgId }, select: { id: true } });
    return { name: f.name, listIds: boards.map((b) => b.id), folderIds: [id] };
  }
  const s = await prisma.space.findFirst({ where: { id, organizationId: orgId }, select: { name: true } });
  if (!s) return null;
  const [boards, folders] = await Promise.all([
    prisma.board.findMany({ where: { spaceId: id, organizationId: orgId }, select: { id: true } }),
    prisma.folder.findMany({ where: { spaceId: id, organizationId: orgId }, select: { id: true } }),
  ]);
  return { name: s.name, listIds: boards.map((b) => b.id), folderIds: folders.map((f) => f.id) };
}
