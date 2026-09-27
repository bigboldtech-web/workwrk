// The client half of GET /api/boards?readable=1: the ONE source every List and
// Space picker in Phase 5b reads (dashboard card sources, Add to another List,
// the link Move, connect column targets).
//
// It exists because ?all=1 answers "every List in a Space I can read", which is
// not the same as "every List I can read": it leaves out a List someone shared
// with me directly and an ORG-visible List in a Space I am not in, and it
// cannot say that a List inside a readable Space is private. The ?readable=1
// branch checks each candidate with getBoardForReader (or canContributeBoard
// for writable=1), so a picker built on it never names a List the viewer
// cannot open.
//
// Pure, no imports: both the dashboards package and the List features package
// build against it in parallel, and it must stay importable from any client or
// server file.

export interface ReadableListRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  spaceId: string | null;
  folderId: string | null;
  productSlug: string | null;
}

export interface ReadableSpace {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface ReadableListsResponse {
  boards: ReadableListRow[];
  spaces: ReadableSpace[];
  /** More candidates existed than the server checked; ask with a narrower q. */
  truncated: boolean;
}

export const READABLE_LISTS_DEFAULT_LIMIT = 50;
export const READABLE_LISTS_MAX_LIMIT = 100;
export const READABLE_LISTS_MAX_IDS = 50;
export const READABLE_LISTS_MAX_Q = 80;

/**
 * The URL for one ?readable=1 read. `ids` names Lists a host already holds
 * (a card's chosen Lists) so the picker can render their chips whatever page
 * of search results is loaded; `q` is the search box; `spaceId` narrows to one
 * Space; `targets` drops the Personal List (a task can never be linked into
 * it); `writable` asks for Lists the viewer may add tasks to.
 */
export function readableListsUrl(o: {
  q?: string;
  ids?: readonly string[];
  spaceId?: string | null;
  targets?: boolean;
  writable?: boolean;
  limit?: number;
}): string {
  const params: string[] = ["readable=1"];
  const q = (o.q ?? "").trim().slice(0, READABLE_LISTS_MAX_Q);
  if (q) params.push(`q=${encodeURIComponent(q)}`);
  if (o.ids && o.ids.length > 0) {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const raw of o.ids) {
      const id = typeof raw === "string" ? raw.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= READABLE_LISTS_MAX_IDS) break;
    }
    if (ids.length > 0) params.push(`ids=${ids.map(encodeURIComponent).join(",")}`);
  }
  if (o.spaceId) params.push(`spaceId=${encodeURIComponent(o.spaceId)}`);
  if (o.targets) params.push("targets=1");
  if (o.writable) params.push("writable=1");
  if (typeof o.limit === "number" && Number.isFinite(o.limit)) {
    const limit = Math.min(READABLE_LISTS_MAX_LIMIT, Math.max(1, Math.floor(o.limit)));
    params.push(`limit=${limit}`);
  }
  return `/api/boards?${params.join("&")}`;
}

export interface ReadableListGroup {
  key: string;
  label: string;
  spaceId: string | null;
  lists: ReadableListRow[];
}

/**
 * Picker sections, in the order the product's other List pickers use: the
 * Personal List first under "My work", then each Space in the order the server
 * sent them (the viewer's own Space order), then "Shared with you" for Lists
 * whose Space the viewer does not read in full (a direct grant, an ORG-visible
 * List in someone else's Space) and space-less Lists that are not the Personal
 * List. Empty groups are left out, so no header ever sits over nothing.
 */
export function groupReadableLists(res: ReadableListsResponse): ReadableListGroup[] {
  const personal: ReadableListRow[] = [];
  const bySpace = new Map<string, ReadableListRow[]>();
  const shared: ReadableListRow[] = [];
  const spaceIds = new Set(res.spaces.map((s) => s.id));
  const seen = new Set<string>();
  for (const row of res.boards) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.productSlug === "personal-list" && row.spaceId === null) {
      personal.push(row);
    } else if (row.spaceId && spaceIds.has(row.spaceId)) {
      const list = bySpace.get(row.spaceId) ?? [];
      list.push(row);
      bySpace.set(row.spaceId, list);
    } else {
      shared.push(row);
    }
  }
  const groups: ReadableListGroup[] = [];
  if (personal.length > 0) {
    groups.push({ key: "personal", label: "My work", spaceId: null, lists: personal });
  }
  for (const space of res.spaces) {
    const lists = bySpace.get(space.id);
    if (!lists || lists.length === 0) continue;
    groups.push({ key: `space:${space.id}`, label: space.name, spaceId: space.id, lists });
  }
  if (shared.length > 0) {
    groups.push({ key: "shared", label: "Shared with you", spaceId: null, lists: shared });
  }
  return groups;
}
