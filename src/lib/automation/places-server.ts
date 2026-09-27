// Where an automation can run, as the viewer may see it: the Spaces, Folders
// and Lists the viewer can read (accessibleIds, VIEW), with names. The
// builder's "Where it runs" picker offers exactly these, and every place a
// saved scope names that the viewer cannot read is COUNTED, never named, so
// the Workflows list and the builder cannot leak a private List's name.

import { prisma } from "@/lib/prisma";
import { accessibleIds } from "@/lib/access/index";
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
  const [spaceIds, folderIds, listIds] = await Promise.all([
    accessibleIds(viewer, "space", "VIEW"),
    accessibleIds(viewer, "folder", "VIEW"),
    accessibleIds(viewer, "list", "VIEW"),
  ]);
  const [spaces, folders, lists] = await Promise.all([
    spaceIds.readable.size
      ? prisma.space.findMany({ where: { id: { in: [...spaceIds.readable] }, organizationId: orgId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    folderIds.readable.size
      ? prisma.folder.findMany({ where: { id: { in: [...folderIds.readable] }, organizationId: orgId, archivedAt: null }, select: { id: true, name: true, spaceId: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    listIds.readable.size
      ? prisma.board.findMany({
          where: { id: { in: [...listIds.readable] }, organizationId: orgId, archivedAt: null },
          select: { id: true, name: true, spaceId: true, folderId: true, ...(opts.withFields ? { schema: true, statuses: true } : {}) },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);
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

export interface ScopeSummary {
  /** "Everywhere", or the readable names, in the order the scope lists them. */
  names: string[];
  /** Places named by the scope the viewer cannot read. */
  hidden: number;
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
    const [rl, rf, rs] = await Promise.all([
      lists.size ? accessibleIds(viewer, "list", "VIEW") : null,
      folders.size ? accessibleIds(viewer, "folder", "VIEW") : null,
      spaces.size ? accessibleIds(viewer, "space", "VIEW") : null,
    ]);
    const okLists = [...lists].filter((id) => rl?.readable.has(id));
    const okFolders = [...folders].filter((id) => rf?.readable.has(id));
    const okSpaces = [...spaces].filter((id) => rs?.readable.has(id));
    const [bl, bf, bs] = await Promise.all([
      okLists.length ? prisma.board.findMany({ where: { id: { in: okLists }, organizationId: orgId }, select: { id: true, name: true } }) : [],
      okFolders.length ? prisma.folder.findMany({ where: { id: { in: okFolders }, organizationId: orgId }, select: { id: true, name: true } }) : [],
      okSpaces.length ? prisma.space.findMany({ where: { id: { in: okSpaces }, organizationId: orgId }, select: { id: true, name: true } }) : [],
    ]);
    for (const r of [...bl, ...bf, ...bs]) names.set(r.id, r.name);
  }
  return (s) => {
    const ids = [...s.spaceIds, ...s.folderIds, ...s.listIds];
    if (ids.length === 0) return { names: [], hidden: 0, everywhere: true };
    const shown = ids.map((id) => names.get(id)).filter((n): n is string => !!n);
    return { names: shown, hidden: ids.length - shown.length, everywhere: false };
  };
}

/**
 * A saved scope with every id that is not a Space, Folder or List of THIS
 * workspace dropped: a junk id, or one from another organization, would
 * otherwise be stored and then read back as "1 more you cannot see", a
 * place that does not exist. Ids the viewer cannot read are kept as they
 * are (they are real, and counted, never named).
 */
export async function scopeInOrg(orgId: string, scope: AutomationScope): Promise<AutomationScope> {
  const [lists, folders, spaces] = await Promise.all([
    scope.listIds.length ? prisma.board.findMany({ where: { id: { in: scope.listIds }, organizationId: orgId }, select: { id: true } }) : [],
    scope.folderIds.length ? prisma.folder.findMany({ where: { id: { in: scope.folderIds }, organizationId: orgId }, select: { id: true } }) : [],
    scope.spaceIds.length ? prisma.space.findMany({ where: { id: { in: scope.spaceIds }, organizationId: orgId }, select: { id: true } }) : [],
  ]);
  const keep = (rows: Array<{ id: string }>, ids: string[]) => {
    const ok = new Set(rows.map((r) => r.id));
    return ids.filter((id) => ok.has(id));
  };
  return { listIds: keep(lists, scope.listIds), folderIds: keep(folders, scope.folderIds), spaceIds: keep(spaces, scope.spaceIds) };
}

/**
 * The definition as it will be stored, with its scope pruned to this
 * workspace (scopeInOrg). Everywhere stays Everywhere; a scope that names
 * only places outside the workspace becomes Everywhere too, which is what
 * the engine would have run anyway (nothing ever matched the foreign id).
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
