"use client";

// Teams > Kudos (spec-teams-performance /kudos): thank a colleague by name,
// and read what everyone else is thanking each other for.
//
//   views     All · Received · Given · Leaderboard (?view=)
//   toolbar   Filter (search the message, Company value, Person, Department,
//             Date range; Leaderboard: the period), Sort (Newest first, Most
//             reactions), the ONE blue Give kudos, "..." (Display: Show the
//             company value chip, Show reactions; Export CSV for the People
//             team and Admin, never an Agent)
//   body      a 720 feed of kudos cards grouped This week and Earlier, cursor
//             paged with "Load more"; the footer total comes from the server.
//             Leaderboard is a read-only TableCard.
//
// The give path (MA-1): Give kudos, the Teams "+" (?new=1) and a person's
// Kudos tab (?new=1&to={id}) all open the one KudosModal. A sent kudos can
// be undone for five seconds from its toast (the same DELETE the row "..."
// offers the giver and an Admin, so never offered to an Agent).
//
// Copy link is /kudos?kudos={id}: the page loads that one kudos by id and
// shows it first, whatever page of the feed it sits on (the older
// /kudos#kudos-{id} links land the same way).
//
// Keyboard: Up and Down move between cards, Enter on a card opens its
// reaction picker.
//
// Display switches and the Leaderboard's columns persist per viewer at
// home.teams.surface.kudos.viewOptions ({ showValueChip, showReactions,
// columns }). The Leaderboard pages 50 people at a time over everyone who
// gave or received, with the real totals.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Heart, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { useConfirm } from "@/components/ui/dialog-provider";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { KudosModal, type GivenKudos } from "@/components/kudos/kudos-modal";
import { KudosReactions } from "@/components/kudos/kudos-reactions";
import { ValueChip } from "@/components/culture/value-chip";
import { PeoplePickerField, PersonAvatar, personName, type PickPerson } from "@/components/people/person-bits";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useCultureValues } from "@/lib/use-culture";

type Person = { id: string; firstName: string | null; lastName: string | null; avatar: string | null; presenceStatus?: string | null; presenceUntil?: string | null };
type ApiKudos = {
  id: string;
  message: string;
  companyValue: string | null;
  createdAt: string;
  totalReactions: number;
  reactionCounts: { emoji: string; count: number }[];
  myReactions: string[];
  giver: Person;
  receiver: Person & { department?: { name?: string | null } | null };
  canDelete: boolean;
};
type FeedResponse = { data: ApiKudos[]; pagination: { total: number; nextCursor: string | null }; groups: { thisWeek: number; earlier: number }; reactions?: number };
type LeaderCol = "given" | "value" | "last";
const LEADER_COLS: Array<{ key: LeaderCol; label: string }> = [
  { key: "given", label: "Given" },
  { key: "value", label: "Top value" },
  { key: "last", label: "Last received" },
];
const BOARD_PAGE = 50;
type LeaderRow = { userId: string; firstName: string | null; lastName: string | null; avatar: string | null; received: number; given: number; topValue: string | null; lastReceived: string | null };

type View = "all" | "received" | "given" | "leaderboard";
const WEEK_MS = 7 * 86_400_000;

function readView(v: string | null | undefined): View {
  return v === "received" || v === "given" || v === "leaderboard" ? v : "all";
}

export default function KudosClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { prefs, patchPrefs, rowVersion } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const orgValues = useCultureValues();

  const view = readView(sp?.get("view"));
  const q = sp?.get("q") ?? "";
  const value = sp?.get("value") ?? "";
  const person = sp?.get("person") ?? "";
  const dept = sp?.get("dept") ?? "";
  // The date range is ?since=&until= in the page URL: ?to= is the Give
  // kudos receiver (a person's Kudos tab links /kudos?new=1&to={id}).
  const from = sp?.get("since") ?? "";
  const to = sp?.get("until") ?? "";
  const sort = sp?.get("sort") === "reactions" ? "reactions" : "recent";
  const period = sp?.get("period") === "quarter" ? "quarter" : sp?.get("period") === "all" ? "all" : "month";
  const filters = [q, value, person, dept, from, to].filter(Boolean).length;

  const viewer = boot.viewer as { id: string; orgRole?: string; isAgent?: boolean; peopleTeam?: boolean };
  const canExport = !viewer.isAgent && (viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN" || viewer.peopleTeam === true);

  // Display (home.teams.surface.kudos.viewOptions), defaults on.
  const stored = ((prefs.home as { teams?: { surface?: { kudos?: { viewOptions?: { showValueChip?: boolean; showReactions?: boolean; columns?: Record<string, boolean> } } } } } | undefined)?.teams?.surface?.kudos?.viewOptions) ?? {};
  const [colsLocal, setColsLocal] = useState<Partial<Record<LeaderCol, boolean>>>({});
  const leaderCols: Record<LeaderCol, boolean> = {
    given: colsLocal.given ?? stored.columns?.given ?? true,
    value: colsLocal.value ?? stored.columns?.value ?? true,
    last: colsLocal.last ?? stored.columns?.last ?? true,
  };
  const setLeaderCol = (k: LeaderCol, on: boolean) => {
    setColsLocal((c) => ({ ...c, [k]: on }));
    void patchPrefs({ home: { teams: { surface: { kudos: { viewOptions: { columns: { [k]: on } } } } } } }).then((ok) => {
      if (!ok) toast("Couldn't save that setting", { tone: "danger" });
    });
  };
  const [display, setDisplay] = useState<{ showValueChip?: boolean; showReactions?: boolean }>({});
  const showValueChip = display.showValueChip ?? stored.showValueChip ?? true;
  const showReactions = display.showReactions ?? stored.showReactions ?? true;
  const displayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDisplayOpt = (patch: { showValueChip?: boolean; showReactions?: boolean }) => {
    setDisplay((d) => ({ ...d, ...patch }));
    if (displayTimer.current) clearTimeout(displayTimer.current);
    const next = { showValueChip, showReactions, ...patch };
    displayTimer.current = setTimeout(() => {
      void patchPrefs({ home: { teams: { surface: { kudos: { viewOptions: next } } } } }).then((ok) => {
        if (!ok) toast("Couldn't save that setting", { tone: "danger" });
      });
    }, 400);
  };

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  // ── The give path ─────────────────────────────────────────────────
  const wantsNew = sp?.get("new") === "1";
  const toParam = sp?.get("to") ?? undefined;
  const [giveOpen, setGiveOpen] = useState(false);
  const [giveTo, setGiveTo] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!wantsNew) return;
    const t = setTimeout(() => { setGiveTo(toParam); setGiveOpen(true); }, 0);
    return () => clearTimeout(t);
  }, [wantsNew, toParam]);
  const closeGive = () => {
    setGiveOpen(false);
    if (wantsNew || toParam) setParams({ new: null, to: null });
  };

  // ── Feed ──────────────────────────────────────────────────────────
  const [feed, setFeed] = useState<ApiKudos[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; nextCursor: string | null; groups: { thisWeek: number; earlier: number }; reactions: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  // "This week" is measured from when the feed last loaded (a render never
  // reads the clock).
  const [now, setNow] = useState(() => Date.now());
  const [draftQ, setDraftQ] = useState(q);
  const [filterOpen, setFilterOpen] = useState(filters > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [personPick, setPersonPick] = useState<PickPerson | null>(null);
  const [depts, setDepts] = useState<Array<{ id: string; name: string }>>([]);
  const [menu, setMenu] = useState<{ k: ApiKudos; anchor: RefObject<HTMLElement | null> } | null>(null);

  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);

  const feedQs = useMemo(() => {
    const p = new URLSearchParams({ limit: "20" });
    if (view === "received" || view === "given") p.set("view", view);
    if (q) p.set("q", q);
    if (value) p.set("value", value);
    if (person) p.set("person", person);
    if (dept) p.set("dept", dept);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (sort === "reactions") p.set("sort", "reactions");
    return p.toString();
  }, [view, q, value, person, dept, from, to, sort]);

  const loadFeed = useCallback(async () => {
    if (view === "leaderboard") return;
    const r = await apiFetch<FeedResponse>(`/api/kudos?${feedQs}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load kudos"); return; }
    setError(null);
    setNow(Date.now());
    setFeed(r.data.data);
    setMeta({ total: r.data.pagination.total, nextCursor: r.data.pagination.nextCursor, groups: r.data.groups, reactions: r.data.reactions ?? null });
  }, [feedQs, view]);
  const loadMore = async () => {
    if (!meta?.nextCursor) return;
    setLoadingMore(true);
    const r = await apiFetch<FeedResponse>(`/api/kudos?${feedQs}&cursor=${meta.nextCursor}`, { cache: "no-store" });
    setLoadingMore(false);
    if (!r.ok) { toast(r.error || "Couldn't load more kudos", { tone: "danger", action: { label: "Try again", onClick: () => void loadMore() } }); return; }
    setFeed((f) => [...(f ?? []), ...r.data.data.filter((k) => !(f ?? []).some((x) => x.id === k.id))]);
    setMeta({ total: r.data.pagination.total, nextCursor: r.data.pagination.nextCursor, groups: r.data.groups, reactions: r.data.reactions ?? null });
  };

  // ── Leaderboard ───────────────────────────────────────────────────
  const [board, setBoard] = useState<{ rows: LeaderRow[]; totalKudos: number; people: number; offset: number; nextCursor: string | null } | null>(null);
  const [boardOffset, setBoardOffset] = useState(0);
  const [boardFor, setBoardFor] = useState(period);
  if (boardFor !== period) { setBoardFor(period); setBoardOffset(0); }
  const loadBoard = useCallback(async () => {
    if (view !== "leaderboard") return;
    const r = await apiFetch<{ leaderboard: LeaderRow[]; totalKudos: number; people?: number; offset?: number; nextCursor?: string | null }>(
      `/api/kudos/leaderboard?period=${period}&limit=${BOARD_PAGE}&cursor=${boardOffset}`,
      { cache: "no-store" },
    );
    if (!r.ok) { setError(r.error || "Couldn't load the leaderboard"); return; }
    setError(null);
    setBoard({ rows: r.data.leaderboard, totalKudos: r.data.totalKudos, people: r.data.people ?? r.data.leaderboard.length, offset: r.data.offset ?? boardOffset, nextCursor: r.data.nextCursor ?? null });
  }, [view, period, boardOffset]);

  const version = rowVersion("kudos");
  useEffect(() => {
    const t = setTimeout(() => { void loadFeed(); void loadBoard(); }, 0);
    return () => clearTimeout(t);
  }, [loadFeed, loadBoard, version]);
  useEffect(() => {
    const again = () => { void loadFeed(); void loadBoard(); };
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [loadFeed, loadBoard]);
  useEffect(() => {
    if (!filterOpen || depts.length) return;
    void apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }).then((d) => { if (d.ok && Array.isArray(d.data)) setDepts(d.data); });
  }, [filterOpen, depts.length]);

  const onGiven = (k: GivenKudos) => {
    const name = personName(k.receiver);
    setFresh(k.id);
    // The toast's Undo is the same DELETE the row "..." offers the giver.
    // An Agent may never delete (access 3.3, cap.agent.delete), so an Agent
    // is never offered the Undo the API would refuse.
    toast(`Kudos sent to ${name}`, viewer.isAgent ? undefined : {
      onUndo: () => {
        void apiFetch(`/api/kudos/${k.id}`, { method: "DELETE" }).then((r) => {
          if (!r.ok) toast(r.error || "Couldn't undo it", { tone: "danger" });
          void loadFeed();
        });
      },
    });
    void loadFeed();
  };

  async function remove(k: ApiKudos) {
    if (!(await confirm({ title: "Delete this kudos?", description: `${personName(k.receiver)} will no longer see it on the feed or their record.`, confirmLabel: "Delete", destructive: true }))) return;
    const r = await apiFetch(`/api/kudos/${k.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete it", { tone: "danger" }); return; }
    toast("Kudos deleted");
    setFeed((f) => (f ?? []).filter((x) => x.id !== k.id));
    setMeta((m) => (m ? { ...m, total: Math.max(0, m.total - 1) } : m));
  }

  const clearFilters = () => { setDraftQ(""); setPersonPick(null); setParams({ q: null, value: null, person: null, dept: null, since: null, until: null }); };
  const exportHref = () => { const p = new URLSearchParams(feedQs); p.delete("limit"); p.set("format", "csv"); return `/api/kudos?${p}`; };

  const thisWeek = sort === "recent" ? (feed ?? []).filter((k) => now - new Date(k.createdAt).getTime() <= WEEK_MS) : [];
  const earlier = sort === "recent" ? (feed ?? []).filter((k) => now - new Date(k.createdAt).getTime() > WEEK_MS) : feed ?? [];

  const valueOptions = useMemo(() => [...new Set([...orgValues, ...(value && value !== "none" ? [value] : [])])], [orgValues, value]);

  const leaderColumns: TableColumn<LeaderRow>[] = [
    { key: "person", label: "Person", title: true, width: "minmax(200px,1.6fr)", render: (r) => (
      <span className="flex min-w-0 items-center gap-2"><PersonAvatar person={{ id: r.userId, firstName: r.firstName, lastName: r.lastName, avatar: r.avatar }} size={28} /><span className="truncate">{personName(r)}</span></span>
    ) },
    { key: "received", label: "Received", width: "96px", numeric: true, align: "end", render: (r) => <span className="tabular-nums">{r.received}</span> },
    ...(leaderCols.given ? [{ key: "given", label: "Given", width: "80px", numeric: true, align: "end" as const, render: (r: LeaderRow) => <span className="tabular-nums">{r.given}</span> }] : []),
    ...(leaderCols.value ? [{ key: "value", label: "Top value", width: "minmax(140px,1fr)", hideBelow: 720, render: (r: LeaderRow) => (r.topValue ? <ValueChip value={r.topValue} /> : <span className="text-ink-3">None</span>) }] : []),
    ...(leaderCols.last ? [{ key: "last", label: "Last received", width: "130px", hideBelow: 900, render: (r: LeaderRow) => <span className="text-ink-2">{r.lastReceived ? formatDate(r.lastReceived, datePrefs, "date") : ""}</span> }] : []),
  ];

  // ── Linked kudos (Copy link: ?kudos={id}, or the older #kudos-{id}) ──
  const linkedParam = sp?.get("kudos") ?? null;
  const [linkedId, setLinkedId] = useState<string | null>(null);
  useEffect(() => {
    const fromHash = typeof window !== "undefined" ? /^#kudos-(.+)$/.exec(window.location.hash)?.[1] ?? null : null;
    const t = setTimeout(() => setLinkedId(linkedParam ?? fromHash), 0);
    return () => clearTimeout(t);
  }, [linkedParam]);
  const [linked, setLinked] = useState<ApiKudos | null | "missing">(null);
  useEffect(() => {
    if (!linkedId) return;
    let live = true;
    void apiFetch<FeedResponse>(`/api/kudos?id=${encodeURIComponent(linkedId)}&limit=1`, { cache: "no-store" }).then((r) => {
      if (!live) return;
      setLinked(r.ok && r.data.data[0] ? r.data.data[0] : "missing");
    });
    return () => { live = false; };
  }, [linkedId, version]);
  useEffect(() => {
    if (!linked || linked === "missing") return;
    document.getElementById(`kudos-link-${linked.id}`)?.scrollIntoView({ block: "center" });
  }, [linked]);
  const clearLinked = () => {
    setLinkedId(null);
    setLinked(null);
    if (linkedParam) setParams({ kudos: null });
    if (typeof window !== "undefined" && window.location.hash.startsWith("#kudos-")) history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  // Up and Down move between cards; Enter on a card opens its reactions.
  const onFeedKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.matches("article[data-kudos-card]")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("article[data-kudos-card]"));
      const i = cards.indexOf(target);
      const next = cards[e.key === "ArrowDown" ? i + 1 : i - 1];
      if (next) { e.preventDefault(); next.focus(); }
    } else if (e.key === "Enter") {
      const add = target.querySelector<HTMLButtonElement>('button[aria-label="Add reaction"]');
      if (add) { e.preventDefault(); add.click(); }
    }
  };

  const card = (k: ApiKudos, linkedCard = false) => (
    <article
      key={linkedCard ? `linked-${k.id}` : k.id}
      id={linkedCard ? `kudos-link-${k.id}` : `kudos-${k.id}`}
      data-kudos-card=""
      tabIndex={0}
      aria-label={`${personName(k.giver)} thanked ${personName(k.receiver)}`}
      className={`rounded-lg border bg-raised p-4 outline-none transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-focus)] ${linkedCard ? "border-[var(--os-brand)]" : "border-line"} ${fresh === k.id ? "animate-in fade-in" : ""}`}
    >
      <div className="flex items-start gap-2">
        <PersonAvatar person={k.giver} size={28} />
        <p className="m-0 min-w-0 flex-1 pt-1 text-row text-ink">
          <Link href={`/people/${k.giver.id}`} className="font-medium hover:underline">{personName(k.giver)}</Link>
          {" thanked "}
          <Link href={`/people/${k.receiver.id}`} className="font-medium hover:underline">{personName(k.receiver)}</Link>
        </p>
        <span className="shrink-0 pt-1.5 text-xs font-medium text-ink-2" title={formatDate(k.createdAt, datePrefs, "datetime")}>{formatRelative(k.createdAt, datePrefs)}</span>
        <button
          type="button"
          aria-label="Kudos actions"
          aria-haspopup="menu"
          onClick={(e) => setMenu({ k, anchor: { current: e.currentTarget } })}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      <Message text={k.message} />
      {(showValueChip && k.companyValue) || showReactions ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showValueChip && k.companyValue ? <ValueChip value={k.companyValue} /> : null}
          {showReactions ? <KudosReactions kudosId={k.id} initialCounts={k.reactionCounts} initialMine={k.myReactions} compact /> : null}
        </div>
      ) : null}
    </article>
  );

  const group = (label: string, count: number, rows: ApiKudos[]) => rows.length ? (
    <section className="flex flex-col gap-3">
      <div className="flex h-11 items-center gap-2 rounded-md bg-subtle px-3 text-sm font-medium text-ink">
        {label}<span className="text-xs font-medium tabular-nums text-ink-2">{count}</span>
      </div>
      {rows.map((k) => card(k))}
    </section>
  ) : null;

  const emptyFeed = view === "received"
    ? <OsEmptyView title="Nobody has thanked you yet" />
    : view === "given"
      ? <OsEmptyView title="You have not given kudos yet" action={{ label: "Give kudos", onClick: () => { setGiveTo(undefined); setGiveOpen(true); } }} />
      : <OsEmptyView title="No kudos yet" action={{ label: "Give the first kudos", onClick: () => { setGiveTo(undefined); setGiveOpen(true); } }} />;

  return (
    <>
      <Breadcrumb items={[{ label: "Kudos" }]} />
      <OsPageHeader
        title="Kudos"
        askAi
        views={
          <>
            <ViewTab label="All" active={view === "all"} onClick={() => setParams({ view: null })} />
            <ViewTab label="Received" active={view === "received"} onClick={() => setParams({ view: "received" })} />
            <ViewTab label="Given" active={view === "given"} onClick={() => setParams({ view: "given" })} />
            <ViewTab label="Leaderboard" active={view === "leaderboard"} onClick={() => setParams({ view: "leaderboard" })} />
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: view === "leaderboard" ? (period !== "month" ? 1 : 0) : filters },
          sort: view === "leaderboard" ? undefined : { onClick: () => setSortOpen((v) => !v), label: sort === "reactions" ? "Most reactions" : "Sort", active: sort === "reactions" },
          primary: { label: "Give kudos", icon: Heart, onClick: () => { setGiveTo(undefined); setGiveOpen(true); } },
          menu: [
            ...(view === "leaderboard"
              ? LEADER_COLS.map((c) => ({ label: `Show ${c.label}`, checked: leaderCols[c.key], keepOpen: true, onClick: () => setLeaderCol(c.key, !leaderCols[c.key]) }))
              : [
                  { label: "Show the company value chip", checked: showValueChip, keepOpen: true, onClick: () => setDisplayOpt({ showValueChip: !showValueChip }) },
                  { label: "Show reactions", checked: showReactions, keepOpen: true, onClick: () => setDisplayOpt({ showReactions: !showReactions }) },
                ]),
            ...(canExport
              ? [{ separator: true as const }, { label: "Export CSV", icon: Download, onClick: () => { window.location.href = view === "leaderboard" ? `/api/kudos/leaderboard?period=${period}&format=csv` : exportHref(); } }]
              : []),
          ],
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort kudos" selected={sort}
              sections={[{ options: [{ value: "recent", label: "Newest first" }, { value: "reactions", label: "Most reactions" }] }]}
              onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "reactions" ? "reactions" : null }); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="kudos"
          activeCount={view === "leaderboard" ? 0 : filters}
          onClearAll={view === "leaderboard" ? () => setParams({ period: null }) : clearFilters}
          search={view === "leaderboard" ? undefined : { value: draftQ, onChange: setDraftQ, placeholder: "Search messages" }}
        >
          {view === "leaderboard" ? (
            <FilterGroup label="Period">
              <FilterRow label="This month" checked={period === "month"} onCheckedChange={() => setParams({ period: null })} />
              <FilterRow label="This quarter" checked={period === "quarter"} onCheckedChange={() => setParams({ period: "quarter" })} />
              <FilterRow label="All time" checked={period === "all"} onCheckedChange={() => setParams({ period: "all" })} />
            </FilterGroup>
          ) : (
            <>
              <FilterGroup label="Company value">
                {valueOptions.map((v) => <FilterRow key={v} label={v} checked={value === v} onCheckedChange={(on) => setParams({ value: on ? v : null })} />)}
                <FilterRow label="No value" checked={value === "none"} onCheckedChange={(on) => setParams({ value: on ? "none" : null })} />
              </FilterGroup>
              <FilterGroup label="Person">
                <li className="px-1 py-1">
                  <PeoplePickerField
                    ariaLabel="Person"
                    value={person ? [person] : []}
                    people={personPick ? [personPick] : []}
                    placeholder="Anyone"
                    onChange={(ids, picked) => { setPersonPick(picked[0] ?? null); setParams({ person: ids[0] ?? null }); }}
                  />
                </li>
              </FilterGroup>
              {depts.length ? (
                <FilterGroup label="Department">
                  {depts.map((d) => <FilterRow key={d.id} label={d.name} checked={dept === d.id} onCheckedChange={(on) => setParams({ dept: on ? d.id : null })} />)}
                </FilterGroup>
              ) : null}
              <FilterGroup label="Date range">
                <li className="flex items-center gap-2 px-2 py-1 text-sm text-ink-2">
                  <input type="date" aria-label="From" value={from} onChange={(e) => setParams({ since: e.target.value || null })} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm text-ink" />
                  <span>to</span>
                  <input type="date" aria-label="To" value={to} onChange={(e) => setParams({ until: e.target.value || null })} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm text-ink" />
                </li>
              </FilterGroup>
            </>
          )}
        </FilterPanel>
        <div className="min-w-0 flex-1">
          {view === "leaderboard" ? (
            error && !board ? (
              <OsEmptyView variant="error" title="Couldn't load the leaderboard" hint={error} action={{ label: "Try again", onClick: () => void loadBoard() }} />
            ) : (
              <TableCard
                ariaLabel="Kudos leaderboard"
                columns={leaderColumns}
                rows={board?.rows ?? null}
                rowKey={(r) => r.userId}
                rowHref={(r) => `/people/${r.userId}`}
                empty={<span className="text-row text-ink-2">Nobody was thanked {period === "month" ? "this month" : period === "quarter" ? "this quarter" : "yet"}</span>}
                footer={board ? {
                  total: board.people,
                  noun: "people",
                  from: board.rows.length ? board.offset + 1 : 0,
                  to: board.offset + board.rows.length,
                  onPrev: board.offset > 0 ? () => setBoardOffset(Math.max(0, board.offset - BOARD_PAGE)) : undefined,
                  onNext: board.nextCursor ? () => setBoardOffset(Number(board.nextCursor)) : undefined,
                  extra: <span className="font-normal">· {board.totalKudos} kudos {period === "month" ? "this month" : period === "quarter" ? "this quarter" : "in all"}</span>,
                } : undefined}
              />
            )
          ) : (
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4" onKeyDown={onFeedKey}>
              {linked && linked !== "missing" ? (
                <section className="flex flex-col gap-3" aria-label="Linked kudos">
                  <div className="flex h-11 items-center gap-2 rounded-md bg-subtle px-3 text-sm font-medium text-ink">
                    <span className="flex-1">Linked kudos</span>
                    <button type="button" onClick={clearLinked} className="text-sm font-medium text-ink-2 hover:text-ink">Dismiss</button>
                  </div>
                  {card(linked, true)}
                </section>
              ) : linked === "missing" ? (
                <p className="text-row text-ink-2">That kudos is no longer here. It may have been deleted. · <button type="button" className="text-brand-deep hover:underline" onClick={clearLinked}>Dismiss</button></p>
              ) : null}
              {error && !feed ? (
                <OsEmptyView variant="error" title="Couldn't load kudos" hint={error} action={{ label: "Try again", onClick: () => void loadFeed() }} />
              ) : feed === null ? (
                <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading kudos">
                  {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[132px] w-full rounded-lg" />)}
                </div>
              ) : feed.length === 0 ? (
                filters > 0 ? (
                  <p className="text-row text-ink-2">No kudos match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></p>
                ) : emptyFeed
              ) : (
                <>
                  {sort === "recent" ? (
                    <>
                      {group("This week", meta?.groups.thisWeek ?? thisWeek.length, thisWeek)}
                      {group("Earlier", meta?.groups.earlier ?? earlier.length, earlier)}
                    </>
                  ) : (
                    <div className="flex flex-col gap-3">{earlier.map((k) => card(k))}</div>
                  )}
                  <div className="flex items-center justify-between text-sm text-ink-2">
                    <span className="font-medium tabular-nums">
                      Total kudos {meta?.total ?? feed.length}
                      {meta?.reactions != null ? <span className="font-normal"> · {meta.reactions} {meta.reactions === 1 ? "reaction" : "reactions"}</span> : null}
                    </span>
                    {meta?.nextCursor ? (
                      <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex h-8 items-center rounded-md px-3 font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50">
                        {loadingMore ? "Loading more" : "Load more"}
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={200} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Kudos actions">
            <MenuItem icon={Link2} label="Copy link" onClick={() => {
              const id = menu.k.id; setMenu(null);
              void navigator.clipboard.writeText(`${window.location.origin}/kudos?kudos=${encodeURIComponent(id)}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
            }} />
            {menu.k.canDelete ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} destructive label="Delete" onClick={() => { const k = menu.k; setMenu(null); void remove(k); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {giveOpen ? <KudosModal open preselectedUserId={giveTo} onClose={closeGive} onGiven={onGiven} /> : null}
    </>
  );
}

/** The message, up to four lines, then "Show more". */
function Message({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 4;
  return (
    <div className="mt-2 ps-9">
      <p className={`m-0 whitespace-pre-wrap text-row text-ink ${open || !long ? "" : "line-clamp-4"}`}>{text}</p>
      {long ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-sm font-medium text-brand-deep hover:underline">{open ? "Show less" : "Show more"}</button>
      ) : null}
    </div>
  );
}
