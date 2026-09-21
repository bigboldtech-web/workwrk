"use client";

// The /trash body: two tabs, one table, the same rows /spaces' Archived tab
// shows for Spaces.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/trash).
//
// WHAT CHANGED FROM THE OLD PAGE, line by line:
//   - "Trash is for managers" is gone: a Member sees what they deleted and
//     what they hold Full access on (work-tasks #11).
//   - Two tabs: Deleted (with a clock) and Archived (without one). Archiving a
//     Space, a Folder, a List or a task used to put it nowhere at all, while
//     the task detail said "You can restore it from Trash".
//   - Filter (Type, Deleted by, Location), Sort, bulk select and paging exist.
//   - The red "Nd left" pill is a word plus a glyph in --os-danger-text, and
//     only under seven days, so colour is never the only carrier.
//   - Delete permanently is Owner and Admin only and lives in the "…" menu, so
//     the one irreversible action is not a button beside Restore.
//   - `Dots` replaces the spinner; a failed load says so instead of rendering
//     the empty state.

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, RotateCcw, Search } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { DotsArt } from "@/components/ui/dots-art";
import { Dots } from "@/components/ui/dots";
import { Avatar } from "@/components/ui/avatar-stack";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { useShortcut } from "@/lib/shortcuts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import {
  TRASH_SORTS,
  TRASH_TYPES,
  isExpiringSoon,
  trashRowHref,
  type TrashSort,
  type TrashTab,
  type TrashTypeKey,
} from "@/lib/trash-view";

interface TrashRow {
  id: string;
  type: TrashTypeKey | null;
  typeLabel: string;
  name: string;
  location: string;
  spaceId: string | null;
  deletedBy: { id: string; name: string; firstName: string | null; lastName: string | null; avatar: string | null } | null;
  deletedAt: string;
  daysLeft: number | null;
  restorable: boolean;
  blockedReason: string | null;
  needsTarget: boolean;
  /** The object's own id (not the row id), for the restored row's URL. */
  entityId: string | null;
}

interface TrashPayload {
  rows: TrashRow[];
  total: number;
  nextCursor: number | null;
  retentionDays: number;
  canPurge: boolean;
  capped: boolean;
  /** The Filter panel's people, Spaces and "under 7 days" count. */
  facets: {
    people: Array<{ id: string; name: string; avatar: string | null; count: number }>;
    locations: Array<{ id: string; name: string; count: number }>;
    expiringSoon: number;
  };
}

const PAGE = 40;

/** The panel's field search: an empty query matches everything. */
function matchesField(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || label.toLowerCase().includes(q);
}

export function TrashClient({
  initialTab,
  initialType,
  initialQuery,
  canPurge,
}: {
  initialTab: TrashTab;
  initialType: TrashTypeKey | null;
  initialQuery: string;
  canPurge: boolean;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /**
   * Mirror a control into the URL, so a view is a link.
   *
   * The tab pills were local state only: switching to Archived changed the
   * table and left the URL on `/trash`, so the Archived cut could not be
   * linked, bookmarked or reached with Back. `?tab=` is already the route's
   * own contract (spec section 0), and the page reads it on the server.
   */
  const writeUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const qs = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) qs.delete(k); else qs.set(k, v);
      }
      const q = qs.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [tab, setTab] = useState<TrashTab>(initialTab);
  const [types, setTypes] = useState<TrashTypeKey[]>(initialType ? [initialType] : []);
  const [query, setQuery] = useState(initialQuery);
  // `?q=` was read from the URL, threaded into the request and then had no
  // control anywhere on the page: a person could arrive on a filtered list
  // with no way to see or clear the filter. `search` is what the box holds,
  // `query` what the request carries, so typing does not refetch per keystroke.
  const [search, setSearch] = useState(initialQuery);
  const [sort, setSort] = useState<TrashSort>("recent");
  const [cursor, setCursor] = useState(0);
  // The other three Filter groups the spec names. The route has always taken
  // `deletedBy` and `spaceId`; the panel offered neither, so both were
  // reachable only by editing the URL by hand.
  const [people, setPeople] = useState<string[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");

  const [data, setData] = useState<TrashPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ tab, sort, cursor: String(cursor), limit: String(PAGE) });
    // Every checked type goes to the server as a comma list, so the total, the
    // range and the paging are all over the same set the table shows. Filtering
    // the extra ones in the browser made the footer print the unfiltered total
    // and hid every match on a later page.
    if (types.length) qs.set("type", types.join(","));
    if (people.length) qs.set("deletedBy", people.join(","));
    if (places.length) qs.set("spaceId", places.join(","));
    if (expiringOnly) qs.set("expiring", "1");
    if (query.trim()) qs.set("q", query.trim());
    const res = await apiFetch<TrashPayload>(`/api/trash?${qs}`, { cache: "no-store" });
    if (!res.ok) {
      // "We could not ask" and "there is nothing here" are different sentences.
      setFailed(res.error);
      return;
    }
    setData(res.data);
    setFailed(null);
  }, [tab, sort, cursor, types, query, people, places, expiringOnly]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const qs = new URLSearchParams({ tab, sort, cursor: String(cursor), limit: String(PAGE) });
      if (types.length) qs.set("type", types.join(","));
      if (people.length) qs.set("deletedBy", people.join(","));
      if (places.length) qs.set("spaceId", places.join(","));
      if (expiringOnly) qs.set("expiring", "1");
      if (query.trim()) qs.set("q", query.trim());
      const res = await apiFetch<TrashPayload>(`/api/trash?${qs}`, { cache: "no-store" });
      // A response for a query the page has already moved on from must not
      // overwrite a newer one.
      if (!live) return;
      if (!res.ok) { setFailed(res.error); return; }
      setData(res.data);
      setFailed(null);
    })();
    return () => { live = false; };
  }, [tab, sort, cursor, types, query, people, places, expiringOnly]);

  // Refetch on focus and after every action, as the spec asks: another tab may
  // have restored the row you are looking at.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  const rows = data?.rows ?? [];

  // "Restore to...": which row is picking a new List, and the Lists to offer.
  const [retarget, setRetarget] = useState<TrashRow | null>(null);
  const [lists, setLists] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    if (!retarget || lists !== null) return;
    // `?editable=1`, not every List: offering one the viewer cannot write to
    // is a picker whose choice the restore would refuse.
    void apiFetch<{ boards: Array<{ id: string; name: string }> }>("/api/boards?editable=1", { cache: "no-store" }).then((res) => {
      if (res.ok) setLists(res.data.boards ?? []);
      else setLists([]);
    });
  }, [retarget, lists]);

  // Restoring ONE row offers Open, which is the whole point of TRASH_HREF:
  // before it took the row's id, a restored doc sent you to a page that listed
  // every doc and did not know which one had just come back. A bulk restore
  // gets no Open, because there is no single thing to open.
  const openAfterRestore = useCallback(
    (row: TrashRow | undefined) => {
      if (!row?.type || !row.entityId) return undefined;
      const href = trashRowHref(row.type, row.entityId);
      if (href === "/") return undefined;
      return { label: "Open", onClick: () => router.push(href) };
    },
    [router],
  );

  const restoreInto = useCallback(
    async (row: TrashRow, targetBoardId: string) => {
      setRetarget(null);
      setBusy(row.id);
      const res = await apiFetch<{ done: number; failed: Array<{ message: string }> }>("/api/trash/bulk", {
        method: "POST",
        json: { op: "restore", ids: [row.id], targetBoardId },
      });
      setBusy(null);
      if (!res.ok || res.data.failed.length > 0) {
        toast("Couldn't restore", { tone: "danger", description: res.ok ? res.data.failed[0].message : res.error });
        return;
      }
      toast(`Restored ${row.name}`, { action: openAfterRestore(row) });
      void load();
    },
    [toast, load, openAfterRestore],
  );

  const act = useCallback(
    async (op: "restore" | "purge", ids: string[], label: string) => {
      setBusy(ids[0] ?? op);
      const res = await apiFetch<{ done: number; failed: Array<{ message: string }> }>("/api/trash/bulk", {
        method: "POST",
        json: { op, ids },
      });
      setBusy(null);
      if (!res.ok) {
        toast(op === "restore" ? "Couldn't restore" : "Couldn't delete", { tone: "danger", description: res.error });
        return;
      }
      const { done, failed: bad } = res.data;
      const single = ids.length === 1 ? rows.find((r) => r.id === ids[0]) : undefined;
      if (done > 0) {
        toast(
          op === "restore" ? `Restored ${label}` : `Deleted ${label} permanently`,
          op === "restore" ? { action: openAfterRestore(single) } : undefined,
        );
      }
      // A partial batch says what did not land instead of claiming success.
      if (bad.length > 0) toast(`${bad.length} couldn't be ${op === "restore" ? "restored" : "deleted"}`, { tone: "danger", description: bad[0].message });
      setSelected(new Set());
      void load();
    },
    [toast, load, rows, openAfterRestore],
  );

  const emptyTrash = useCallback(async () => {
    const typed = await prompt({
      title: "Empty trash",
      description: "This permanently deletes everything on the Deleted tab for the whole workspace. Archived items are untouched. Type DELETE to confirm.",
      placeholder: "DELETE",
      submitLabel: "Empty trash",
      required: true,
    });
    if (typed !== "DELETE") {
      if (typed !== null) toast("Type DELETE exactly to empty the trash");
      return;
    }
    const res = await apiFetch<{ deleted: number }>("/api/trash/empty", { method: "POST", json: { confirm: "DELETE" } });
    if (!res.ok) { toast("Couldn't empty the trash", { tone: "danger", description: res.error }); return; }
    toast(`${res.data.deleted} item${res.data.deleted === 1 ? "" : "s"} deleted permanently`);
    void load();
  }, [prompt, toast, load]);

  useShortcut({ id: "trash-filter", keys: "f", label: "Filter", scope: "page", run: () => setFilterOpen((v) => !v) });

  const loading = data === null && failed === null;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // Every active filter goes on the export too, or "Export list" would hand
  // back a different set than the one on screen.
  const exportQs = new URLSearchParams({ tab });
  if (types.length) exportQs.set("type", types.join(","));
  if (people.length) exportQs.set("deletedBy", people.join(","));
  if (places.length) exportQs.set("spaceId", places.join(","));
  if (expiringOnly) exportQs.set("expiring", "1");
  if (query.trim()) exportQs.set("q", query.trim());

  const activeFilters = types.length + people.length + places.length + (expiringOnly ? 1 : 0);

  const clearFilters = () => {
    setTypes([]); setPeople([]); setPlaces([]); setExpiringOnly(false); setCursor(0);
  };

  const menu = canPurge
    ? [
        { label: "Export list", href: `/api/trash/export.csv?${exportQs}` },
        ...(tab === "deleted" ? [{ label: "Empty trash", destructive: true, onClick: () => void emptyTrash() }] : []),
      ]
    : undefined;

  return (
    <>
      <OsPageHeader
        title="Trash"
        views={
          <>
            <ViewTab label="Deleted" active={tab === "deleted"} onClick={() => { setTab("deleted"); setCursor(0); setSelected(new Set()); writeUrl({ tab: null }); }} />
            <ViewTab label="Archived" active={tab === "archived"} onClick={() => { setTab("archived"); setCursor(0); setSelected(new Set()); writeUrl({ tab: "archived" }); }} />
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          sort: {
            onClick: () => setSortOpen((v) => !v),
            label: sort === "recent" ? "Sort" : TRASH_SORTS.find((s) => s.value === sort)?.label,
            active: sort !== "recent",
          },
          left: (
            <form
              onSubmit={(e) => { e.preventDefault(); setQuery(search); setCursor(0); }}
              className="inline-flex h-9 min-w-0 items-center gap-2 rounded-lg border border-line px-3"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => { if (search !== query) { setQuery(search); setCursor(0); } }}
                placeholder="Search Trash"
                aria-label="Search Trash"
                className="w-[180px] min-w-0 bg-transparent text-base outline-none placeholder:text-ink-3"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setQuery(""); setCursor(0); }}
                  className="shrink-0 text-xs font-medium text-brand-deep hover:underline"
                >
                  Clear
                </button>
              ) : null}
            </form>
          ),
          // Nothing is created here, so there is no blue button at all.
          menu,
        }}
      />

      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker
              open
              onClose={() => setSortOpen(false)}
              ariaLabel="Sort trash"
              selected={sort}
              sections={[{
                options: TRASH_SORTS
                  // Time left means nothing where nothing expires.
                  .filter((s) => !(tab === "archived" && s.value === "expiry"))
                  .map((s) => ({ value: s.value, label: tab === "archived" && s.value === "recent" ? "Archived (newest)" : s.label })),
              }]}
              onSelect={(v) => { setSortOpen(false); setSort(v as TrashSort); setCursor(0); }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {filterOpen ? (
          <FilterPanel
            open
            onClose={() => setFilterOpen(false)}
            objects="items"
            activeCount={activeFilters}
            search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields…" }}
            onClearAll={clearFilters}
          >
            {/* Four groups under four labels (spec section 2: Type, Deleted by,
                Location, Time left). The panel used to be one unlabelled run
                of Type checkboxes, so nothing said which field a row belonged
                to and three of the four groups did not exist. */}
            {TRASH_TYPES.filter((t) => matchesField(t.label, filterSearch)).length ? (
              <FilterGroup label="Type">
                {TRASH_TYPES.filter((t) => matchesField(t.label, filterSearch)).map((t) => (
                  <FilterRow
                    key={t.key}
                    label={t.label}
                    checked={types.includes(t.key)}
                    onCheckedChange={(on) => {
                      setTypes((prev) => (on ? [...prev, t.key] : prev.filter((v) => v !== t.key)));
                      setCursor(0);
                    }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {(data?.facets.people ?? []).filter((p) => matchesField(p.name, filterSearch)).length ? (
              <FilterGroup label={tab === "archived" ? "Archived by" : "Deleted by"}>
                {(data?.facets.people ?? []).filter((p) => matchesField(p.name, filterSearch)).map((p) => (
                  <FilterRow
                    key={p.id}
                    label={
                      <span className="flex items-center gap-2">
                        <Avatar person={{ id: p.id, firstName: p.name, lastName: null, avatar: p.avatar }} size={20} />
                        <span className="truncate">{p.name}</span>
                      </span>
                    }
                    count={p.count}
                    checked={people.includes(p.id)}
                    onCheckedChange={(on) => {
                      setPeople((prev) => (on ? [...prev, p.id] : prev.filter((v) => v !== p.id)));
                      setCursor(0);
                    }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {(data?.facets.locations ?? []).filter((l) => matchesField(l.name, filterSearch)).length ? (
              <FilterGroup label="Location">
                {(data?.facets.locations ?? []).filter((l) => matchesField(l.name, filterSearch)).map((l) => (
                  <FilterRow
                    key={l.id}
                    label={l.name}
                    count={l.count}
                    checked={places.includes(l.id)}
                    onCheckedChange={(on) => {
                      setPlaces((prev) => (on ? [...prev, l.id] : prev.filter((v) => v !== l.id)));
                      setCursor(0);
                    }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {/* Nothing on the Archived tab expires, so the group is absent
                there rather than offered as a filter that matches nothing. */}
            {tab === "deleted" && matchesField("Under 7 days left", filterSearch) ? (
              <FilterGroup label="Time left">
                <FilterRow
                  label="Under 7 days left"
                  count={data?.facets.expiringSoon}
                  checked={expiringOnly}
                  onCheckedChange={(on) => { setExpiringOnly(on); setCursor(0); }}
                />
              </FilterGroup>
            ) : null}
          </FilterPanel>
        ) : null}

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {selected.size > 0 ? (
            <div className="os-row mb-3 flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4">
              <span className="text-base font-medium text-ink">{selected.size} selected</span>
              <button
                type="button"
                onClick={() => void act("restore", [...selected], `${selected.size} item${selected.size === 1 ? "" : "s"}`)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-base text-ink hover:bg-hover"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
              </button>
              {canPurge ? (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Delete permanently",
                      description:
                        tab === "archived"
                          // An archived container still holds live children.
                          // The server refuses those, and the confirm says so
                          // before the person clicks rather than after.
                          ? `Permanently delete ${selected.size} archived item${selected.size === 1 ? "" : "s"}? This cannot be undone. A Space, Folder or List that still holds anything you have not archived is refused, so archive or move those first.`
                          : `Permanently delete ${selected.size} item${selected.size === 1 ? "" : "s"}? This cannot be undone.`,
                      destructive: true,
                      confirmLabel: "Delete permanently",
                    });
                    if (ok) void act("purge", [...selected], `${selected.size} item${selected.size === 1 ? "" : "s"}`);
                  }}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-danger-text hover:bg-hover"
                >
                  Delete permanently
                </button>
              ) : null}
              <button type="button" onClick={() => setSelected(new Set())} className="ms-auto text-base text-ink-2 hover:underline">
                Clear
              </button>
            </div>
          ) : null}

          {failed ? (
            <OsEmptyView
              variant="error"
              title="Couldn't load Trash"
              hint={failed}
              action={{ label: "Retry", onClick: () => void load() }}
            />
          ) : loading ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            activeFilters > 0 || query.trim() ? (
              <div className="flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4 text-base text-ink-2">
                No results
                <button
                  type="button"
                  onClick={() => { clearFilters(); setSearch(""); setQuery(""); }}
                  className="font-medium text-brand-deep hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <DotsArt arrangement="row" size={64} />
                <p className="text-base font-medium text-ink">{tab === "deleted" ? "Trash is empty" : "Nothing archived"}</p>
              </div>
            )
          ) : (
            <>
              {/* The card scrolls inside itself; the page never scrolls
                  sideways (design-system: wide content owns its own overflow).
                  Without the min-width the Name column collapsed to seven
                  characters as soon as the Filter panel opened. */}
              <div className="os-row overflow-x-auto rounded-lg border border-line bg-raised">
                <div className="flex h-9 min-w-[940px] items-center gap-3 border-b border-line bg-subtle px-4 text-xs font-medium uppercase tracking-wide text-ink-2">
                  <span className="w-5 shrink-0">
                    <input
                      type="checkbox"
                      aria-label="Select every row on this page"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                      className="h-4 w-4"
                    />
                  </span>
                  <span className="min-w-0 flex-1">Name</span>
                  <span className="w-20 shrink-0">Type</span>
                  <span className="w-44 shrink-0">Location</span>
                  <span className="w-40 shrink-0">{tab === "archived" ? "Archived by" : "Deleted by"}</span>
                  <span className="w-24 shrink-0">{tab === "archived" ? "Archived" : "Deleted"}</span>
                  {tab === "deleted" ? <span className="w-24 shrink-0">Time left</span> : null}
                  <span className="w-28 shrink-0" />
                </div>

                {rows.map((r) => {
                  const soon = isExpiringSoon(r.daysLeft);
                  return (
                    <div
                      key={r.id}
                      className="flex min-w-[940px] items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover"
                      style={{ minHeight: "var(--os-row-h)" }}
                    >
                      <span className="w-5 shrink-0">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={selected.has(r.id)}
                          onChange={(e) => setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id); else next.delete(r.id);
                            return next;
                          })}
                          className="h-4 w-4"
                        />
                      </span>
                      {/* Not a link: a deleted object has no page to open. */}
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
                      <span className="w-20 shrink-0">
                        <span className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">{r.typeLabel}</span>
                      </span>
                      <span className="w-44 shrink-0 truncate text-sm text-ink-2">{r.location}</span>
                      <span className="flex w-40 shrink-0 items-center gap-1.5 truncate text-sm text-ink-2">
                        {r.deletedBy ? (
                          <>
                            <Avatar person={{ id: r.deletedBy.id, firstName: r.deletedBy.firstName, lastName: r.deletedBy.lastName, avatar: r.deletedBy.avatar }} size={20} />
                            <span className="truncate">{r.deletedBy.name}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="w-24 shrink-0 text-xs text-ink-2">{relativeDate(r.deletedAt)}</span>
                      {tab === "deleted" ? (
                        <span className={`inline-flex w-24 shrink-0 items-center gap-1 text-xs ${soon ? "text-danger-text" : "text-ink-2"}`}>
                          {soon ? <CircleAlert className="h-3 w-3 shrink-0" aria-hidden /> : null}
                          {r.daysLeft} day{r.daysLeft === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      <span className="flex w-28 shrink-0 justify-end">
                        {r.restorable ? (
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => void act("restore", [r.id], r.name)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-base text-ink hover:bg-hover disabled:opacity-60"
                          >
                            {busy === r.id ? <Dots variant="pending" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />} Restore
                          </button>
                        ) : r.needsTarget ? (
                          /* The spec's second half: the parent is gone, so the
                             row picks a new home instead of showing a sentence
                             and no control at all. */
                          <button
                            type="button"
                            onClick={() => setRetarget(r)}
                            title={r.blockedReason ?? undefined}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-base text-ink hover:bg-hover"
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore to…
                          </button>
                        ) : (
                          <span className="truncate text-xs text-ink-2" title={r.blockedReason ?? undefined}>{r.blockedReason}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 flex h-11 items-center gap-4 px-1 text-sm text-ink-2">
                <span>
                  Total records {data?.total ?? rows.length}
                  {data && data.total > rows.length ? ` · ${cursor + 1} to ${cursor + rows.length}` : ""}
                </span>
                {data?.capped ? (
                  /* The read takes 2000 rows per source. Past that the total
                     is a floor and the rows behind it are not reachable from
                     this page, so the page says so rather than showing a
                     number that looks complete. */
                  <span className="text-ink-3">Showing the most recent 2,000 items</span>
                ) : null}
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={cursor === 0}
                    onClick={() => setCursor((c) => Math.max(0, c - PAGE))}
                    className="inline-flex h-8 items-center rounded-md border border-line px-2 text-base text-ink hover:bg-hover disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={!data?.nextCursor}
                    onClick={() => setCursor(data?.nextCursor ?? cursor)}
                    className="inline-flex h-8 items-center rounded-md border border-line px-2 text-base text-ink hover:bg-hover disabled:opacity-40"
                  >
                    Next
                  </button>
                </span>
                {tab === "deleted" && data ? (
                  <span>Kept for {data.retentionDays} days</span>
                ) : (
                  <span>Archived items never expire</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {retarget ? (
        <Dialog open onOpenChange={(v) => { if (!v) setRetarget(null); }}>
          <DialogContent className="max-w-[400px]">
            <DialogHeader><DialogTitle>Restore to…</DialogTitle></DialogHeader>
            <p className="text-base text-ink-2">
              {/* "Standalone" is the placeholder for a row whose whole chain
                  is gone, not the name of a list, so it is never quoted as
                  one. */}
              {retarget.location && retarget.location !== "Standalone"
                ? <>The list it lived in (<span className="font-medium text-ink">{retarget.location}</span>) is gone, so pick where </>
                : <>The list it lived in is gone, so pick where </>}
              <span className="font-medium text-ink">{retarget.name}</span> should come back.
            </p>
            {lists === null ? (
              <div className="flex h-11 items-center gap-2 text-base text-ink-2"><Dots variant="pending" /> </div>
            ) : lists.length === 0 ? (
              <p className="text-base text-ink-2">You do not have edit access on any list yet.</p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto rounded-lg border border-line">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => void restoreInto(retarget, l.id)}
                    className="flex w-full items-center border-b border-line-soft px-3 text-start text-base text-ink last:border-b-0 hover:bg-hover"
                    style={{ minHeight: "var(--os-row-h)" }}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** Short and absolute past a week: "3 days ago" beats "on 12 Aug" and vice versa. */
function relativeDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised" aria-busy="true" aria-label="Loading">
      <div className="h-9 border-b border-line bg-subtle" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0" style={{ height: "var(--os-row-h)" }}>
          <span className="os-skeleton-pulse h-3.5 rounded bg-skeleton" style={{ width: `${[50, 38, 64, 44, 58, 33, 47, 55][i]}%` }} />
        </div>
      ))}
    </div>
  );
}
