"use client";

/* Announcements: broadcast feed grouped by priority with KPI strip + ack tracking.
 *
 *  GET   /api/announcements
 *  POST  /api/announcements
 *  PATCH /api/announcements/[id]
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Megaphone,
  Search,
  Hash,
  ChevronRight,
  Pin,
  AlertTriangle,
  CheckCircle2,
  Info,
  PartyPopper,
  ShieldCheck,
  CalendarRange,
  Bell,
  Clock,
  Users2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { usePermission } from "@/hooks/use-permission";
import { AnnouncementComposer } from "./composer-dialog";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useFormat } from "@/lib/format/use-date-prefs";

type AnnType = "INFO" | "WARNING" | "CELEBRATION" | "POLICY" | "EVENT";
type AnnPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type ApiAnn = {
  id: string;
  title: string;
  content: string;
  type: AnnType;
  priority: AnnPrio;
  pinned: boolean;
  mustAcknowledge: boolean;
  publishedAt?: string | null;
  expiresAt?: string | null;
  authorId: string;
  createdAt: string;
  ackedByMe?: boolean;
};

const TYPE_LABEL: Record<AnnType, string> = {
  INFO: "Info", WARNING: "Warning", CELEBRATION: "Celebration",
  POLICY: "Policy", EVENT: "Event",
};
const TYPE_HUE: Record<AnnType, string> = {
  INFO: C.blue, WARNING: C.red, CELEBRATION: C.pink, POLICY: C.purple, EVENT: C.orange,
};
const TYPE_ICON: Record<AnnType, typeof Info> = {
  INFO: Info, WARNING: AlertTriangle, CELEBRATION: PartyPopper,
  POLICY: ShieldCheck, EVENT: CalendarRange,
};

const PRIO_LABEL: Record<AnnPrio, string> = {
  LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent",
};
const PRIO_HUE: Record<AnnPrio, string> = {
  URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.teal,
};
const PRIO_ORDER: AnnPrio[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

/* The list route answers one page at a time and hands back a cursor for the
 * next, so the browser has to ask for the rest. PAGE_SIZE is the route's own
 * MAX_PAGE, which makes the ordinary workspace a single round trip, and
 * MAX_REQUESTS is a stop rather than a limit: the route reads a 500-row
 * window, so five requests already exhaust everything it can see. */
const PAGE_SIZE = 100;
const MAX_REQUESTS = 10;

/** The shape the list route answers with. It used to answer with a bare
 *  array, which a tab still running the previous bundle will receive. */
type FeedCounts = { toAck: number; total: number };
type FeedResponse = { data?: ApiAnn[]; next?: string | null; counts?: FeedCounts };

// Past a week this falls back to a calendar date, and that date is the
// VIEWER'S (home.locale), not the machine's and not en-US. The same bug is
// why an announcement expiring on 31 December read "Expires Jan 1" to a
// reader five and a half hours ahead of UTC.
function relativeDate(iso: string, fmt: ReturnType<typeof useFormat>, nowMs: number | null): string {
  if (nowMs === null) return fmt.date(iso, "date");
  const ms = nowMs - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return fmt.date(iso, "date");
}

export default function AnnouncementsPage() {
  const fmt = useFormat();
  // The clock, sampled after mount so no component reads it during render
  // and the server and the first client render agree.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  const [rows, setRows] = useState<ApiAnn[] | null>(null);
  // The route's own tally of the whole visible feed, kept apart from the rows
  // so the KPI strip quotes the workspace rather than the browser's copy.
  const [feedCounts, setFeedCounts] = useState<FeedCounts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | AnnType>("ALL");
  const [composerOpen, setComposerOpen] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  // Mirrors the POST /api/announcements gate (requirePermission
  // "announcements","create") so the composer + ack-status view only
  // surface for admins/HR/managers. null while the matrix loads, and the
  // raw value is kept because the ?new=1 effect below has to tell "not
  // answered yet" apart from "no".
  const managePerm = usePermission("announcements", "create");
  const canManage = managePerm === true;

  // /announcements?new=1 opens the composer. It is the destination of the
  // Talk hub "+" row "New announcement" (spec-talk section 1) and of the
  // /tlk toolbar's "..." square (2.1), both of which had nowhere to go
  // before this. The parameter is consumed once and stripped, so a refresh
  // or a back does not re-open the dialog on top of the list.
  const searchParams = useSearchParams();
  const router = useRouter();
  const wantsNew = searchParams.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    // Hold the intent until the matrix answers. On a cold load (cmd-click,
    // middle-click, or a pasted or bookmarked link) the permission fetch is
    // still in flight on the first commit, so stripping the parameter here
    // threw the request away before anyone had said yes to it and the
    // manager landed on the list with the composer shut and no explanation.
    if (managePerm === null) return;
    if (managePerm) setComposerOpen(true);
    router.replace("/announcements", { scroll: false });
  }, [wantsNew, managePerm, router]);

  // Read the feed to the end, not just its first page. Everything on this
  // screen is computed in the browser over the rows it holds: the search box,
  // the type chips, the priority sections, and the Pinned section, which the
  // route does not hoist ahead of the page boundary, so a post pinned
  // precisely so it stays visible is the first thing a half-read feed drops.
  // The cursor loop follows the route's own `next` until it runs out, which
  // its 500-row scan window bounds at five requests and an ordinary
  // workspace settles in one.
  const load = useCallback(async () => {
    try {
      const all: ApiAnn[] = [];
      const seen = new Set<string>();
      let totals: FeedCounts | null = null;
      let cursor: string | null = null;
      for (let i = 0; i < MAX_REQUESTS; i++) {
        const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) qs.set("cursor", cursor);
        const res = await fetch(`/api/announcements?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: ApiAnn[] | FeedResponse = await res.json();
        // Cursor paging by offset can hand back a row twice when two posts
        // share an instant and the tie breaks differently between requests,
        // and a repeat would be a duplicate key in the lists below, so the
        // id decides what is already held.
        for (const a of Array.isArray(body) ? body : (body.data ?? [])) {
          if (seen.has(a.id)) continue;
          seen.add(a.id);
          all.push(a);
        }
        if (Array.isArray(body)) break;
        if (body.counts) totals = body.counts;
        const nextCursor = typeof body.next === "string" ? body.next : null;
        // A cursor that does not move would spin here, so it ends the read.
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      setRows(all);
      setFeedCounts(totals);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("announcements");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function ack(id: string) {
    try {
      const res = await fetch(`/api/announcements/${id}/acknowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) { toast("Couldn't acknowledge"); return; }
      toast("Acknowledged");
      void load();
    } catch { toast("Couldn't acknowledge"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<AnnType, number> = { INFO: 0, WARNING: 0, CELEBRATION: 0, POLICY: 0, EVENT: 0 };
    for (const a of list) counts[a.type] = (counts[a.type] ?? 0) + 1;
    const pinned = list.filter((a) => a.pinned).length;
    const urgent = list.filter((a) => a.priority === "URGENT").length;
    // The two totals the route hands back are counted over the whole visible
    // feed before it is paged, so they are the workspace's numbers and not a
    // count of what this browser happens to be holding. The derived values
    // behind them answer the route's older bare-array reply, which carried
    // no counts at all.
    const total = feedCounts?.total ?? list.length;
    const ackPending = feedCounts?.toAck ?? list.filter((a) => a.mustAcknowledge && !a.ackedByMe).length;
    return { total, counts, pinned, ackPending, urgent };
  }, [rows, feedCounts]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (typeFilter !== "ALL") list = list.filter((a) => a.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) =>
      a.title.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q));
    return list;
  }, [rows, search, typeFilter]);

  const pinned = filtered.filter((a) => a.pinned);
  const others = filtered.filter((a) => !a.pinned);

  const byPriority = useMemo(() => {
    const m = new Map<AnnPrio, ApiAnn[]>();
    for (const p of PRIO_ORDER) m.set(p, []);
    for (const a of others) m.get(a.priority)?.push(a);
    return PRIO_ORDER.map((p) => ({ prio: p, items: m.get(p) ?? [] })).filter((g) => g.items.length > 0);
  }, [others]);

  return (
    <>
      <OsPageHeader
        title="Announcements"
        primary={canManage ? { label: "New announcement", onClick: () => setComposerOpen(true) } : undefined}
      />

      <div className="ann">
        <div className="ann__kpis">
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="Urgent"      value={`${stats.urgent}`}    sub="needs attention" />
          <KpiTile accent="var(--os-c-orange)" Icon={Bell}          label="Ack pending" value={`${stats.ackPending}`} sub="from you" />
          <KpiTile accent="var(--os-brand)" Icon={Pin}           label="Pinned"      value={`${stats.pinned}`}    sub="always on top" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Megaphone}     label="Total"       value={`${stats.total}`}     sub="org-wide" />
        </div>

        {stats.ackPending > 0 && (
          <div className="ann__banner">
            <Bell />
            <span><strong>{stats.ackPending} announcement{stats.ackPending === 1 ? "" : "s"}</strong> {stats.ackPending === 1 ? "requires" : "require"} your acknowledgment.</span>
          </div>
        )}

        <div className="ann__toolbar">
          <div className="ann__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, content…" />
          </div>
          <div className="ann__filters">
            {(["ALL", "INFO", "WARNING", "POLICY", "EVENT", "CELEBRATION"] as const).map((t) => {
              const Icon = t === "ALL" ? Hash : TYPE_ICON[t as AnnType];
              return (
                <button
                  key={t}
                  type="button"
                  className={`ann__filter${typeFilter === t ? " is-active" : ""}`}
                  style={t !== "ALL" ? { ["--f-c" as unknown as string]: TYPE_HUE[t as AnnType] } : undefined}
                  onClick={() => setTypeFilter(t)}
                >
                  <Icon /> {t === "ALL" ? "All" : TYPE_LABEL[t as AnnType]}
                  <span>{t === "ALL" ? stats.total : stats.counts[t as AnnType]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView variant="error" title="Couldn't load" hint={loadError} action={{ label: "Try again", onClick: () => { void load(); } }} />
        ) : rows === null ? (
          <SkeletonRows />
        ) : stats.total === 0 ? (
          <OsEmptyView
            context="list"
            title="No announcements yet"
            hint="Broadcast updates to the whole workspace."
            action={!canManage ? undefined : { label: "New announcement", onClick: () => setComposerOpen(true) }}
          />
        ) : filtered.length === 0 ? (
          <div className="ann__no-match"><Search /> No announcements match the filter.</div>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="ann__section">
                <header className="ann__section-head">
                  <span className="ann__section-tag"><Pin /> Pinned</span>
                  <span className="ann__section-count">{pinned.length}</span>
                  <span className="ann__section-line" />
                </header>
                <div className="ann__list">
                  {pinned.map((a) => <AnnCard key={a.id} a={a} onAck={() => ack(a.id)} canManage={canManage} fmt={fmt} nowMs={nowMs} />)}
                </div>
              </section>
            )}

            {byPriority.map((g) => (
              <section key={g.prio} className="ann__section" style={{ ["--s-c" as unknown as string]: PRIO_HUE[g.prio] }}>
                <header className="ann__section-head">
                  <span className="ann__section-tag ann__section-tag--prio">{PRIO_LABEL[g.prio]}</span>
                  <span className="ann__section-count">{g.items.length}</span>
                  <span className="ann__section-line" />
                </header>
                <div className="ann__list">
                  {g.items.map((a) => <AnnCard key={a.id} a={a} onAck={() => ack(a.id)} canManage={canManage} fmt={fmt} nowMs={nowMs} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      {canManage && (
        <AnnouncementComposer
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onCreated={(msg) => { toast(msg); void load(); }}
        />
      )}
    </>
  );
}

function AnnCard({ a, onAck, canManage, fmt, nowMs }: { a: ApiAnn; onAck: () => void; canManage: boolean; fmt: ReturnType<typeof useFormat>; nowMs: number | null }) {
  const TypeIcon = TYPE_ICON[a.type];
  return (
    <article className={`ann__card ann__card--${a.type.toLowerCase()}`} style={{ ["--c-c" as unknown as string]: TYPE_HUE[a.type], ["--p-c" as unknown as string]: PRIO_HUE[a.priority] }}>
      <header className="ann__card-head">
        <span className="ann__card-type"><TypeIcon /> {TYPE_LABEL[a.type]}</span>
        <span className="ann__card-prio">{PRIO_LABEL[a.priority]}</span>
        {a.pinned && <span className="ann__card-pin"><Pin /> Pinned</span>}
        <span className="ann__card-time"><Clock /> {relativeDate(a.publishedAt ?? a.createdAt, fmt, nowMs)}</span>
      </header>
      <h3 className="ann__card-title">
        <Link href={`/announcements/${a.id}`} className="text-inherit no-underline hover:underline">{a.title}</Link>
      </h3>
      <p className="ann__card-content">{a.content}</p>
      <footer className="ann__card-foot">
        {a.expiresAt && (
          <span className="ann__card-expires">Expires {fmt.date(a.expiresAt, "date")}</span>
        )}
        {/* One roster, on the post's own page. This used to open a second
            roster dialog for the same job (ack-status-dialog.tsx), which is
            now gone: the Acknowledgments tab is the one place who-has-and-
            who-has-not lives, and it has a URL. */}
        {a.mustAcknowledge && canManage && (
          <Link
            href={`/announcements/${a.id}`}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-sm text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Users2 className="w-3.5 h-3.5" /> Ack status
          </Link>
        )}
        {a.mustAcknowledge && (
          a.ackedByMe ? (
            <span className="ann__card-acked"><CheckCircle2 /> You&apos;ve acked</span>
          ) : (
            <button type="button" className="ann__card-ack-btn" onClick={onAck}>
              <Bell /> Acknowledge
            </button>
          )
        )}
        <ChevronRight className="ann__card-arrow" />
      </footer>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Megaphone; label: string; value: string; sub: string }) {
  return (
    <div className="ann__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="ann__kpi-accent" aria-hidden="true" />
      <div className="ann__kpi-row">
        <div className="ann__kpi-icon"><Icon /></div>
        <div className="ann__kpi-label">{label}</div>
      </div>
      <div className="ann__kpi-value">{value}</div>
      <div className="ann__kpi-sub">{sub}</div>
    </div>
  );
}
