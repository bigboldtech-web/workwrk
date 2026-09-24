"use client";

// The Favorites page body: one table of everything the viewer has starred.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/favorites).
//
// ONE CALL. `GET /api/me/favorites` answers all seven kinds, hydrated and
// access-filtered, in one request. The Work sidebar still fires its seven
// per-kind calls and nothing about that changes here.
//
// UNSTARRING GOES BACK THROUGH THE SEVEN. There is no aggregate write, and
// inventing one would mean two code paths deciding what a star is. Each row
// posts to the same endpoint its own star button posts to, with `on: false`,
// and the Undo toast posts `on: true`.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { Picker } from "@/components/ui/picker";
import { FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { EntityTile } from "@/components/ui/entity-tile";
import { DotsArt } from "@/components/ui/dots-art";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";

type FavoriteKind = "space" | "folder" | "list" | "doc" | "table" | "form" | "canvas" | "file";

interface FavoriteRow {
  kind: FavoriteKind;
  id: string;
  name: string;
  href: string;
  icon: string | null;
  color: string | null;
  spaceId: string | null;
  order: number;
}

interface FavoritesResponse {
  favorites: FavoriteRow[];
  spaces: Record<string, { id: string; slug: string; name: string }>;
  total: number;
  hiddenByAccess: number;
  hiddenByArchive: number;
}

/** The user's word for each kind, and the endpoint its star lives behind. */
const KINDS: ReadonlyArray<{ key: FavoriteKind; label: string; plural: string; path: string; field: string }> = [
  { key: "space", label: "Space", plural: "Spaces", path: "spaces", field: "spaceId" },
  { key: "folder", label: "Folder", plural: "Folders", path: "folders", field: "folderId" },
  { key: "list", label: "List", plural: "Lists", path: "boards", field: "boardId" },
  { key: "doc", label: "Doc", plural: "Docs", path: "docs", field: "docId" },
  { key: "table", label: "Table", plural: "Tables", path: "tables", field: "tableId" },
  { key: "form", label: "Form", plural: "Forms", path: "forms", field: "formId" },
  { key: "canvas", label: "Canvas", plural: "Canvases", path: "whiteboards", field: "whiteboardId" },
  { key: "file", label: "File", plural: "Files", path: "files", field: "fileId" },
];
const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<FavoriteKind, (typeof KINDS)[number]>;

const SORTS = [
  { value: "starred", label: "Recently starred" },
  { value: "name", label: "Name" },
  { value: "kind", label: "Kind" },
] as const;
type SortKey = (typeof SORTS)[number]["value"];

export function FavoritesClient({
  initialShowLocation,
  initialShowStarred,
}: {
  initialShowLocation: boolean;
  initialShowStarred: boolean;
}) {
  const { patchPrefs } = useOsShell();
  const { toast } = useOsToast();

  const [data, setData] = useState<FavoritesResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [kinds, setKinds] = useState<FavoriteKind[]>([]);
  const [sort, setSort] = useState<SortKey>("starred");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [showLocation, setShowLocation] = useState(initialShowLocation);
  const [showStarred, setShowStarred] = useState(initialShowStarred);

  const load = useCallback(async () => {
    const res = await apiFetch<FavoritesResponse>("/api/me/favorites", { cache: "no-store" });
    if (!res.ok) {
      // Never the empty state on a failed read: "you starred nothing" and "we
      // could not ask" are different sentences.
      setFailed(res.error);
      return;
    }
    setData(res.data);
    setFailed(null);
  }, []);

  useEffect(() => {
    // One refresh function for the first read and every re-read: starring
    // anything anywhere in the product fires `workwrk:favs-changed`, and the
    // pruning write fires `workwrk:prefs-changed`.
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("workwrk:favs-changed", refresh);
    window.addEventListener("workwrk:prefs-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("workwrk:favs-changed", refresh);
      window.removeEventListener("workwrk:prefs-changed", refresh);
    };
  }, [load]);

  const persistDisplay = useCallback(
    async (next: { location: boolean; starred: boolean }) => {
      const ok = await patchPrefs({
        home: { work: { surface: { favorites: { viewOptions: next } } } },
      });
      if (!ok) toast("Couldn't save your display options");
    },
    [patchPrefs, toast],
  );

  /** One star toggle, through the kind's own endpoint. */
  const setStar = useCallback(
    async (row: FavoriteRow, on: boolean) => {
      const kind = KIND_BY_KEY[row.kind];
      const res = await apiFetch(`/api/me/favorites/${kind.path}`, {
        method: "POST",
        json: { [kind.field]: row.id, on },
      });
      if (!res.ok) {
        toast(on ? "Couldn't star that" : "Couldn't unstar that", { tone: "danger", description: res.error });
        return;
      }
      window.dispatchEvent(new Event("workwrk:favs-changed"));
      void load();
    },
    [toast, load],
  );

  const unstar = useCallback(
    (row: FavoriteRow) => {
      void setStar(row, false);
      toast(`${row.name} unstarred`, { onUndo: () => void setStar(row, true) });
    },
    [setStar, toast],
  );

  const rows = useMemo(() => {
    const all = data?.favorites ?? [];
    const filtered = kinds.length ? all.filter((r) => kinds.includes(r.kind)) : all;
    const out = [...filtered];
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "kind") out.sort((a, b) => KIND_BY_KEY[a.kind].label.localeCompare(KIND_BY_KEY[b.kind].label) || a.name.localeCompare(b.name));
    else out.sort((a, b) => a.order - b.order);
    return out;
  }, [data, kinds, sort]);

  const countOf = useCallback(
    (kind: FavoriteKind) => (data?.favorites ?? []).filter((r) => r.kind === kind).length,
    [data],
  );

  useShortcut({ id: "favorites-filter", keys: "f", label: "Filter", scope: "page", run: () => setFilterOpen((v) => !v) });

  const loading = data === null && failed === null;

  return (
    <>
      <OsPageHeader
        title="Favorites"
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: kinds.length },
          sort: {
            onClick: () => setSortOpen((v) => !v),
            label: sort === "starred" ? "Sort" : SORTS.find((s) => s.value === sort)?.label,
            active: sort !== "starred",
          },
          // No blue button: starring happens on the objects themselves, and a
          // page with zero primaries is allowed (at most one, never a fake).
          menu: [{ label: "Display", onClick: () => setDisplayOpen(true) }],
        }}
      />

      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker
              open
              onClose={() => setSortOpen(false)}
              ariaLabel="Sort favorites"
              selected={sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(value) => { setSortOpen(false); setSort(value as SortKey); }}
            />
          </div>
        ) : null}
        {displayOpen ? (
          <div className="absolute end-6 top-0 z-40">
            <Picker
              open
              onClose={() => setDisplayOpen(false)}
              ariaLabel="Display options"
              align="end"
              width={280}
              multi
              selected={[...(showLocation ? ["location"] : []), ...(showStarred ? ["starred"] : [])]}
              sections={[
                {
                  label: "Columns",
                  options: [
                    { value: "location", label: "Show location column" },
                    { value: "starred", label: "Show starred date" },
                  ],
                },
              ]}
              onSelect={(value) => {
                const next = {
                  location: value === "location" ? !showLocation : showLocation,
                  starred: value === "starred" ? !showStarred : showStarred,
                };
                setShowLocation(next.location);
                setShowStarred(next.starred);
                void persistDisplay(next);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {filterOpen ? (
          <FilterPanel
            open
            onClose={() => setFilterOpen(false)}
            objects="favorites"
            activeCount={kinds.length}
            onClearAll={() => setKinds([])}
          >
            {KINDS.map((k) => (
              <FilterRow
                key={k.key}
                label={k.plural}
                count={countOf(k.key)}
                checked={kinds.includes(k.key)}
                onCheckedChange={(on) => setKinds((prev) => (on ? [...prev, k.key] : prev.filter((v) => v !== k.key)))}
              />
            ))}
          </FilterPanel>
        ) : null}

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {failed ? (
            <OsEmptyView
              variant="error"
              title="Couldn't load your favorites"
              hint={failed}
              action={{ label: "Retry", onClick: () => void load() }}
            />
          ) : loading ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            kinds.length > 0 ? (
              <div className="flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4 text-base text-ink-2">
                No results
                <button type="button" onClick={() => setKinds([])} className="font-medium text-brand-deep hover:underline">
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <DotsArt arrangement="row" size={64} />
                <p className="max-w-[46ch] text-base text-ink-2">
                  Nothing starred yet. Star a Space, List, Doc, Table, Canvas, Folder or File from its &ldquo;&hellip;&rdquo; menu.
                </p>
              </div>
            )
          ) : (
            <>
              <div className="os-row overflow-hidden rounded-lg border border-line bg-raised">
                <div className="flex h-9 items-center gap-3 border-b border-line bg-subtle px-4 text-xs font-medium uppercase tracking-wide text-ink-2">
                  <span className="min-w-0 flex-1">Name</span>
                  <span className="w-20 shrink-0">Kind</span>
                  {showLocation ? <span className="w-48 shrink-0">Location</span> : null}
                  {showStarred ? <span className="w-24 shrink-0">Starred</span> : null}
                  <span className="w-7 shrink-0" />
                </div>
                {rows.map((r) => {
                  const space = r.spaceId ? data?.spaces[r.spaceId] ?? null : null;
                  return (
                    <div
                      key={`${r.kind}-${r.id}`}
                      className="group flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover"
                      style={{ minHeight: "var(--os-row-h)" }}
                    >
                      <Link href={r.href} className="flex min-w-0 flex-1 items-center gap-2.5">
                        <EntityTile size="sm" icon={r.icon} color={r.color} name={r.name} />
                        <span className="min-w-0 flex-1 truncate font-medium text-ink group-hover:underline">{r.name}</span>
                      </Link>
                      <span className="w-20 shrink-0">
                        <span className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">
                          {KIND_BY_KEY[r.kind].label}
                        </span>
                      </span>
                      {showLocation ? (
                        <span className="w-48 shrink-0 truncate text-sm text-ink-2">
                          {space ? (
                            <Link href={`/spaces/${space.slug}`} className="hover:underline">{space.name}</Link>
                          ) : null}
                        </span>
                      ) : null}
                      {showStarred ? <span className="w-24 shrink-0 text-xs text-ink-2">{starredLabel(r.order)}</span> : null}
                      <button
                        type="button"
                        onClick={() => unstar(r)}
                        aria-label={`Unstar ${r.name}`}
                        title="Remove from favorites"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink hover:bg-active"
                      >
                        <Star className="h-4 w-4 fill-current" strokeWidth={1.5} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex h-11 items-center gap-4 px-1 text-sm text-ink-2">
                <span>Total records {rows.length}</span>
                {data && data.hiddenByArchive > 0 ? (
                  <span>{data.hiddenByArchive} archived, still starred</span>
                ) : null}
                {data && data.hiddenByAccess > 0 ? (
                  <span>{data.hiddenByAccess} you can no longer open</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The stored order IS the starred order (newest first), and no starred-at
 * timestamp is stored anywhere, so the column says the position honestly
 * rather than inventing a date. When the preference gains timestamps this
 * becomes a relative time and nothing else here changes.
 */
function starredLabel(order: number): string {
  if (order === 0) return "Most recent";
  return `#${order + 1}`;
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised" aria-busy="true" aria-label="Loading">
      <div className="h-9 border-b border-line bg-subtle" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0"
          style={{ height: "var(--os-row-h)" }}
        >
          <span className="os-skeleton-pulse h-5 w-5 rounded bg-skeleton" />
          <span className="os-skeleton-pulse h-3.5 rounded bg-skeleton" style={{ width: `${[55, 40, 70, 45, 60, 35][i]}%` }} />
        </div>
      ))}
    </div>
  );
}
