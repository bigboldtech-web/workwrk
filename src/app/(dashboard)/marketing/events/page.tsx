"use client";

/* Marketing · Events — bespoke list with date hero.
 *
 *  GET  /api/marketing/events
 *  POST /api/marketing/events  { name }
 *
 * Layout:
 *   OsTitleBar with back + nav links + New event in actions.
 *   Featured next-event hero card with date tile + format chip + registration ring.
 *   KPI strip: Total · Upcoming · This month · Registered.
 *   Toolbar: search + format chips.
 *   Grouped sections: Upcoming · This week · This month · Past, each with date-tile rows.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays, Plus, Search, MapPin, Users as UsersIcon, ExternalLink,
  ArrowLeft, Sparkles, Globe, Building2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "PLANNING" | "PROMOTING" | "ACTIVE" | "COMPLETED" | "CANCELLED";

type ApiEvent = {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  format?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  capacity?: number | null;
  registeredCount?: number | null;
  attendedCount?: number | null;
  budget?: number | string | null;
  spent?: number | string | null;
  status: Status;
  url?: string | null;
};

const STATUS_COLORS: Record<Status, string> = {
  PLANNING: C.indigo, PROMOTING: C.orange, ACTIVE: C.green,
  COMPLETED: C.teal, CANCELLED: C.gray,
};
const STATUS_LABELS: Record<Status, string> = {
  PLANNING: "Planning", PROMOTING: "Promoting", ACTIVE: "Live", COMPLETED: "Completed", CANCELLED: "Cancelled",
};

const FORMAT_META: Record<string, { color: string; Icon: typeof Globe }> = {
  "in-person": { color: C.orange, Icon: Building2 },
  virtual:    { color: C.blue,   Icon: Globe },
  hybrid:     { color: C.purple, Icon: Sparkles },
};
function formatMeta(fmt?: string | null): { color: string; Icon: typeof Globe; label: string } {
  if (!fmt) return { color: C.gray, Icon: Globe, label: "—" };
  const k = fmt.toLowerCase();
  for (const key of Object.keys(FORMAT_META)) {
    if (k.includes(key)) return { ...FORMAT_META[key], label: fmt };
  }
  return { color: C.indigo, Icon: Globe, label: fmt };
}

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}
function fmtMoney(n: number, currency = "₹"): string {
  if (n >= 1_00_000) return `${currency}${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `${currency}${(n / 1_000).toFixed(0)}k`;
  return `${currency}${Math.round(n).toLocaleString()}`;
}

const MS_DAY = 86_400_000;
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
const TODAY = () => startOfDay(new Date()).getTime();

function dayDiff(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.round((startOfDay(new Date(iso)).getTime() - TODAY()) / MS_DAY);
}

function fmtSpan(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const s = new Date(start);
  const sStr = s.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (!end) return sStr;
  const e = new Date(end);
  if (s.toDateString() === e.toDateString()) return sStr;
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function dateTileParts(iso?: string | null): { day: string; month: string; weekday: string } {
  if (!iso) return { day: "—", month: "TBD", weekday: "" };
  const d = new Date(iso);
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

type Bucket = "upcoming-7" | "upcoming-30" | "later" | "past";
function bucketize(iso?: string | null): Bucket {
  const days = dayDiff(iso);
  if (days === null) return "later";
  if (days < 0) return "past";
  if (days <= 7) return "upcoming-7";
  if (days <= 30) return "upcoming-30";
  return "later";
}
const BUCKET_LABELS: Record<Bucket, string> = {
  "upcoming-7": "This week",
  "upcoming-30": "This month",
  later: "Later",
  past: "Past",
};
const BUCKET_COLORS: Record<Bucket, string> = {
  "upcoming-7": C.orange,
  "upcoming-30": C.indigo,
  later: C.purple,
  past: C.gray,
};
const BUCKET_ORDER: Bucket[] = ["upcoming-7", "upcoming-30", "later", "past"];

export default function EventsLibrary() {
  const [items, setItems] = useState<ApiEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFormat, setActiveFormat] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/events");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.events ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("marketing");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    try {
      const res = await fetch("/api/marketing/events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled event" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Event added");
      void load();
    } catch { toast("Couldn't add event"); }
  }

  // ─── Format filter chips ──────────────────────────────────
  const formats = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items ?? []) {
      if (!i.format) continue;
      m.set(i.format, (m.get(i.format) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (activeFormat) list = list.filter((i) => (i.format ?? "") === activeFormat);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        i.name.toLowerCase().includes(q) ||
        (i.location ?? "").toLowerCase().includes(q) ||
        (i.type ?? "").toLowerCase().includes(q) ||
        (i.format ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, activeFormat, search]);

  // ─── Next-up featured event ───────────────────────────────
  const featured = useMemo(() => {
    const upcoming = (items ?? [])
      .filter((i) => i.startDate && new Date(i.startDate).getTime() >= TODAY() && i.status !== "CANCELLED")
      .sort((a, b) => new Date(a.startDate ?? 0).getTime() - new Date(b.startDate ?? 0).getTime());
    return upcoming[0] ?? null;
  }, [items]);

  // ─── Grouped by bucket ────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<Bucket, ApiEvent[]>();
    for (const b of BUCKET_ORDER) map.set(b, []);
    for (const i of filtered) {
      // Skip featured from main list so it's only at top
      if (featured && i.id === featured.id) continue;
      const b = bucketize(i.startDate);
      map.get(b)!.push(i);
    }
    // Sort each bucket by startDate
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.startDate ?? 0).getTime() - new Date(b.startDate ?? 0).getTime());
    }
    return BUCKET_ORDER
      .map((b) => ({ bucket: b, label: BUCKET_LABELS[b], color: BUCKET_COLORS[b], items: map.get(b) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered, featured]);

  // ─── KPIs ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = items ?? [];
    const upcoming = list.filter((i) => i.startDate && new Date(i.startDate).getTime() >= TODAY() && i.status !== "CANCELLED");
    const thisMonth = upcoming.filter((i) => {
      const d = i.startDate ? new Date(i.startDate) : null;
      if (!d) return false;
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const totalReg = list.reduce((acc, i) => acc + (i.registeredCount ?? 0), 0);
    const totalSpent = list.reduce((acc, i) => acc + num(i.spent), 0);
    return { total: list.length, upcoming, thisMonth, totalReg, totalSpent };
  }, [items]);

  return (
    <>
      <OsTitleBar
        title="Events"
        Icon={CalendarDays}
        iconGradient={GRAD.indigoBlue}
        description={items === null
          ? "Loading events…"
          : `${stats.total} event${stats.total === 1 ? "" : "s"} · ${stats.upcoming.length} upcoming · ${stats.totalReg.toLocaleString()} registered`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.an]}
        morePeople={3}
        actions={
          <div className="evts__head-actions">
            <button type="button" className="evts__back" onClick={() => history.back()}>
              <ArrowLeft /> Marketing
            </button>
            <Link href="/marketing/campaigns" className="evts__nav-link">Campaigns</Link>
            <Link href="/marketing/content" className="evts__nav-link">Content</Link>
            <button type="button" className="evts__btn-primary" onClick={quickAdd}>
              <Plus /> New event
            </button>
          </div>
        }
      />

      <div className="evts">
        {/* Featured hero */}
        {featured && (
          <FeaturedEventCard event={featured} />
        )}

        {/* KPI strip */}
        <div className="evts__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={CalendarDays} label="Total"          value={`${stats.total}`}                    sub="all events" />
          <KpiTile accent="var(--os-c-orange)" Icon={Sparkles}     label="Upcoming"       value={`${stats.upcoming.length}`}          sub={`${stats.thisMonth.length} this month`} />
          <KpiTile accent="var(--os-c-purple)" Icon={UsersIcon}    label="Registered"     value={stats.totalReg.toLocaleString()}     sub="across all events" />
          <KpiTile accent="var(--os-c-green)"  Icon={MapPin}       label="Spent"          value={fmtMoney(stats.totalSpent)}          sub="event budget YTD" />
        </div>

        {/* Toolbar */}
        <div className="evts__toolbar">
          <div className="evts__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events, locations, types…"
              aria-label="Search events"
            />
          </div>
          {formats.length > 0 && (
            <div className="evts__chips">
              <FilterChip label="All formats" count={items?.length ?? 0} active={!activeFormat} onClick={() => setActiveFormat(null)} />
              {formats.map(([fmt, n]) => {
                const meta = formatMeta(fmt);
                return (
                  <FilterChip key={fmt} label={fmt} count={n} color={meta.color} active={activeFormat === fmt} onClick={() => setActiveFormat(fmt)} />
                );
              })}
            </div>
          )}
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={CalendarDays} iconGradient={GRAD.redPink} title="Couldn't load events" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : items === null ? (
          <div className="evts__loading">Loading events…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={CalendarDays}
            iconGradient={GRAD.indigoBlue}
            title="No events yet"
            subtitle="Conferences, webinars, customer dinners — track them all with registration, attendance, and budget."
            chips={["Conference", "Webinar", "Workshop", "Dinner"]}
            cta="New event"
          />
        ) : grouped.length === 0 && !featured ? (
          <div className="evts__empty">
            <Search />
            <div>No events match your filters.</div>
            <button type="button" className="evts__empty-reset" onClick={() => { setSearch(""); setActiveFormat(null); }}>Clear filters</button>
          </div>
        ) : (
          grouped.map((g) => (
            <section key={g.bucket} className="evts__group" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="evts__group-head">
                <span className="evts__group-dot" />
                <h2 className="evts__group-title">{g.label}</h2>
                <span className="evts__group-count">{g.items.length}</span>
                <span className="evts__group-line" aria-hidden="true" />
              </header>
              <div className="evts__list">
                {g.items.map((e) => <EventRow key={e.id} event={e} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function FeaturedEventCard({ event: e }: { event: ApiEvent }) {
  const tile = dateTileParts(e.startDate);
  const fmt = formatMeta(e.format);
  const FmtIcon = fmt.Icon;
  const days = dayDiff(e.startDate);
  const cap = e.capacity ?? 0;
  const reg = e.registeredCount ?? 0;
  const regPct = cap > 0 ? Math.min(100, Math.round((reg / cap) * 100)) : 0;
  const R = 30;
  const C2 = 2 * Math.PI * R;
  const dash = (regPct / 100) * C2;
  return (
    <Link href={`/marketing/events#${e.id}`} className="evts__featured" style={{ ["--feat-c" as unknown as string]: STATUS_COLORS[e.status] }}>
      <div className="evts__featured-date">
        <span className="evts__featured-month">{tile.month}</span>
        <span className="evts__featured-day">{tile.day}</span>
        <span className="evts__featured-weekday">{tile.weekday}</span>
      </div>
      <div className="evts__featured-body">
        <div className="evts__featured-tag">
          <Sparkles /> Next up
          {days !== null && days >= 0 && (
            <span className="evts__featured-countdown">
              {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} days`}
            </span>
          )}
        </div>
        <h2 className="evts__featured-title">{e.name}</h2>
        <div className="evts__featured-meta">
          {e.format && (
            <span className="evts__featured-format" style={{ ["--fmt-c" as unknown as string]: fmt.color }}>
              <FmtIcon /> {e.format}
            </span>
          )}
          {e.location && (
            <span className="evts__featured-loc">
              <MapPin /> {e.location}
            </span>
          )}
        </div>
        {e.description && <p className="evts__featured-desc">{e.description.length > 160 ? e.description.slice(0, 160) + "…" : e.description}</p>}
        {e.url && (
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="evts__featured-link" onClick={(ev) => ev.stopPropagation()}>
            <ExternalLink /> Event page
          </a>
        )}
      </div>
      {cap > 0 && (
        <div className="evts__featured-ring">
          <svg viewBox="0 0 72 72" className="evts__featured-ring-svg">
            <circle cx="36" cy="36" r={R} fill="none" stroke="var(--os-surface-1)" strokeWidth="8" />
            <circle cx="36" cy="36" r={R} fill="none" stroke="var(--os-brand)" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${dash} ${C2 - dash}`}
              transform="rotate(-90 36 36)" />
          </svg>
          <div className="evts__featured-ring-text">
            <strong>{regPct}%</strong>
            <span>{reg}/{cap}</span>
          </div>
        </div>
      )}
    </Link>
  );
}

function EventRow({ event: e }: { event: ApiEvent }) {
  const tile = dateTileParts(e.startDate);
  const fmt = formatMeta(e.format);
  const FmtIcon = fmt.Icon;
  const days = dayDiff(e.startDate);
  const cap = e.capacity ?? 0;
  const reg = e.registeredCount ?? 0;
  const regPct = cap > 0 ? Math.min(100, Math.round((reg / cap) * 100)) : 0;
  const budget = num(e.budget);
  const spent = num(e.spent);
  const spendPct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const statusColor = STATUS_COLORS[e.status];

  return (
    <article className="evts__row" id={e.id} style={{ ["--row-c" as unknown as string]: statusColor }}>
      <div className="evts__row-date" style={{ ["--date-c" as unknown as string]: statusColor }}>
        <span className="evts__row-date-month">{tile.month}</span>
        <span className="evts__row-date-day">{tile.day}</span>
        <span className="evts__row-date-weekday">{tile.weekday}</span>
      </div>

      <div className="evts__row-main">
        <div className="evts__row-name">{e.name}</div>
        <div className="evts__row-meta">
          {e.format && (
            <span className="evts__row-format" style={{ ["--fmt-c" as unknown as string]: fmt.color }}>
              <FmtIcon /> {e.format}
            </span>
          )}
          {e.type && <span className="evts__row-type">{e.type}</span>}
          {e.location && (
            <span className="evts__row-loc"><MapPin /> {e.location}</span>
          )}
        </div>
        <div className="evts__row-span">
          {fmtSpan(e.startDate, e.endDate)}
          {days !== null && days >= 0 && days <= 14 && (
            <span className="evts__row-count">{days === 0 ? "Today" : `in ${days}d`}</span>
          )}
        </div>
      </div>

      <div className="evts__row-stats">
        {cap > 0 && (
          <div className="evts__row-stat">
            <div className="evts__row-stat-head"><UsersIcon /> <span>Registered</span> <strong>{regPct}%</strong></div>
            <div className="evts__row-stat-bar"><div className="evts__row-stat-fill" style={{ width: `${regPct}%`, background: "var(--os-c-purple)" }} /></div>
            <div className="evts__row-stat-sub">{reg} / {cap}</div>
          </div>
        )}
        {budget > 0 && (
          <div className="evts__row-stat">
            <div className="evts__row-stat-head">$ <span>Spend</span> <strong>{spendPct}%</strong></div>
            <div className="evts__row-stat-bar"><div className="evts__row-stat-fill" style={{ width: `${spendPct}%`, background: spendPct > 90 ? "var(--os-c-red)" : "var(--os-c-blue)" }} /></div>
            <div className="evts__row-stat-sub">{fmtMoney(spent)} / {fmtMoney(budget)}</div>
          </div>
        )}
      </div>

      <div className="evts__row-side">
        <span className="evts__row-status" style={{ background: statusColor, color: "white" }}>
          {STATUS_LABELS[e.status]}
        </span>
        {e.url && (
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="evts__row-link">
            <ExternalLink /> Page
          </a>
        )}
      </div>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof CalendarDays; label: string; value: string; sub: string }) {
  return (
    <div className="evts__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="evts__kpi-accent" aria-hidden="true" />
      <div className="evts__kpi-row">
        <div className="evts__kpi-icon"><Icon /></div>
        <div className="evts__kpi-label">{label}</div>
      </div>
      <div className="evts__kpi-value">{value}</div>
      <div className="evts__kpi-sub">{sub}</div>
    </div>
  );
}

function FilterChip({ label, count, color, active, onClick }: { label: string; count: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`evts__chip${active ? " is-active" : ""}`}
      style={color ? { ["--chip-c" as unknown as string]: color } : undefined}
      onClick={onClick}
    >
      {color && <span className="evts__chip-dot" />}
      {label}
      <span className="evts__chip-count">{count}</span>
    </button>
  );
}
