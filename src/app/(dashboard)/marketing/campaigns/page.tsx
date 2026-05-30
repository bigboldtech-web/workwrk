"use client";

/* Marketing · Campaigns — list with status pipeline header.
 *
 *  GET   /api/marketing/campaigns
 *  POST  /api/marketing/campaigns      { name }
 *  PATCH /api/marketing/campaigns      { id, status?, ... }
 *
 * Layout:
 *   OsTitleBar with back-to-Marketing + view nav + New campaign in actions.
 *   Status pipeline: horizontal bar showing each status segment (Planning →
 *     Approved → Active → Paused → Completed) with count + value width.
 *   Search + sort toolbar.
 *   Bespoke list rows: status accent, name + channel chip, goal progress, spend bar,
 *     date range, quick action (Launch/Pause/Resume/Complete).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Megaphone, Plus, Play, Pause, CheckCircle2, Target, DollarSign, CalendarRange,
  ArrowLeft, Search, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "PLANNING" | "APPROVED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

type ApiCampaign = {
  id: string;
  name: string;
  description?: string | null;
  status: Status;
  channel?: string | null;
  budget?: number | string | null;
  spent?: number | string | null;
  currency?: string;
  startDate?: string | null;
  endDate?: string | null;
  goalMetric?: string | null;
  goalTarget?: number | null;
  goalActual?: number | null;
  utmCampaign?: string | null;
  ownerId?: string | null;
  updatedAt?: string;
};

const STATUS_COLORS: Record<Status, string> = {
  PLANNING: C.indigo, APPROVED: C.yellow, ACTIVE: C.orange,
  PAUSED: C.brown, COMPLETED: C.green, CANCELLED: C.gray,
};
const STATUS_LABELS: Record<Status, string> = {
  PLANNING: "Planning", APPROVED: "Approved", ACTIVE: "Active",
  PAUSED: "Paused", COMPLETED: "Completed", CANCELLED: "Cancelled",
};

// Pipeline order — visualizes how campaigns flow left → right
const PIPELINE_STAGES: Status[] = ["PLANNING", "APPROVED", "ACTIVE", "PAUSED", "COMPLETED"];

const CHANNEL_COLORS: Record<string, string> = {
  email: C.blue, paid: C.orange, social: C.pink, outbound: C.indigo,
  event: C.purple, content: C.teal, seo: C.green, ads: C.red, webinar: C.purple,
};
function channelColor(ch?: string | null): string {
  if (!ch) return C.gray;
  const k = ch.toLowerCase();
  for (const key of Object.keys(CHANNEL_COLORS)) {
    if (k.includes(key)) return CHANNEL_COLORS[key];
  }
  return C.indigo;
}

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}
function fmtMoney(n: number, currency = "₹"): string {
  if (n >= 1_00_00_000) return `${currency}${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `${currency}${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `${currency}${(n / 1_000).toFixed(0)}k`;
  return `${currency}${Math.round(n).toLocaleString()}`;
}
const MS_DAY = 86_400_000;
function daysLeft(end?: string | null): number | null {
  if (!end) return null;
  return Math.ceil((new Date(end).getTime() - Date.now()) / MS_DAY);
}
function dateRange(start?: string | null, end?: string | null): string {
  const s = start ? new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const e = end ? new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  return `${s} → ${e}`;
}

type FilterKey = "all" | Status;
type SortKey = "recent" | "name" | "spend" | "goal";

export default function CampaignsPage() {
  const [items, setItems] = useState<ApiCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/campaigns");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.campaigns ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("marketing");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function patchStatus(id: string, status: Status) {
    setItems((prev) => prev?.map((c) => c.id === id ? { ...c, status } : c) ?? prev);
    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't update"); void load(); }
  }

  async function createCampaign() {
    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled campaign" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Campaign added");
      void load();
    } catch { toast("Couldn't create"); }
  }

  // ─── Counts + pipeline totals ─────────────────────────────
  const pipeline = useMemo(() => {
    const list = items ?? [];
    return PIPELINE_STAGES.map((s) => {
      const inStage = list.filter((c) => c.status === s);
      const value = inStage.reduce((acc, c) => acc + num(c.budget), 0);
      return { stage: s, color: STATUS_COLORS[s], count: inStage.length, value };
    });
  }, [items]);
  const pipelineMax = Math.max(1, ...pipeline.map((p) => p.count));

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      all: list.length,
      ...PIPELINE_STAGES.reduce<Record<Status, number>>((acc, s) => {
        acc[s] = list.filter((c) => c.status === s).length;
        return acc;
      }, {} as Record<Status, number>),
    };
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (filter !== "all") list = list.filter((c) => c.status === filter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => `${c.name} ${c.channel ?? ""} ${c.description ?? ""}`.toLowerCase().includes(q));
    }
    const sorted = list.slice();
    if (sortKey === "recent") sorted.sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
    else if (sortKey === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortKey === "spend") sorted.sort((a, b) => num(b.spent) - num(a.spent));
    else if (sortKey === "goal") {
      const pct = (c: ApiCampaign) => c.goalTarget ? ((c.goalActual ?? 0) / c.goalTarget) : 0;
      sorted.sort((a, b) => pct(b) - pct(a));
    }
    return sorted;
  }, [items, filter, query, sortKey]);

  const totalBudget = (items ?? []).reduce((acc, c) => acc + num(c.budget), 0);
  const totalSpent = (items ?? []).reduce((acc, c) => acc + num(c.spent), 0);

  return (
    <>
      <OsTitleBar
        title="Campaigns"
        Icon={Megaphone}
        iconGradient={GRAD.orangePink}
        description={items === null
          ? "Loading…"
          : `${counts.all} campaign${counts.all === 1 ? "" : "s"} · ${counts.ACTIVE} active · ${fmtMoney(totalSpent)} spent`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.an]}
        morePeople={3}
        actions={
          <div className="cmps__head-actions">
            <button type="button" className="cmps__back" onClick={() => history.back()}>
              <ArrowLeft /> Marketing
            </button>
            <Link href="/marketing/content" className="cmps__nav-link">Content</Link>
            <Link href="/marketing/events" className="cmps__nav-link">Events</Link>
            <button type="button" className="cmps__btn-primary" onClick={createCampaign}>
              <Plus /> New campaign
            </button>
          </div>
        }
      />

      <div className="cmps">
        {/* Pipeline visualization */}
        <section className="cmps__pipeline">
          <div className="cmps__pipeline-head">
            <span className="cmps__pipeline-title">Status pipeline</span>
            <span className="cmps__pipeline-sub">{counts.all} total · {fmtMoney(totalBudget)} total budget</span>
          </div>
          <div className="cmps__pipeline-bar">
            {pipeline.map((p, i) => (
              <div
                key={p.stage}
                className="cmps__pipeline-seg"
                style={{ ["--seg-c" as unknown as string]: p.color }}
              >
                <div className="cmps__pipeline-seg-head">
                  <span className="cmps__pipeline-seg-dot" />
                  <span className="cmps__pipeline-seg-name">{STATUS_LABELS[p.stage]}</span>
                </div>
                <div className="cmps__pipeline-seg-track">
                  <div
                    className="cmps__pipeline-seg-fill"
                    style={{ height: `${(p.count / pipelineMax) * 100}%` }}
                  />
                </div>
                <div className="cmps__pipeline-seg-foot">
                  <span className="cmps__pipeline-seg-count">{p.count}</span>
                  <span className="cmps__pipeline-seg-value">{fmtMoney(p.value)}</span>
                </div>
                {i < pipeline.length - 1 && <span className="cmps__pipeline-arrow" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </section>

        {/* Toolbar */}
        <div className="cmps__toolbar">
          <div className="cmps__search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, channel, description…"
              aria-label="Search campaigns"
            />
          </div>
          <div className="cmps__chips">
            <FilterChip label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
            {PIPELINE_STAGES.map((s) => (
              <FilterChip
                key={s}
                label={STATUS_LABELS[s]}
                count={counts[s]}
                color={STATUS_COLORS[s]}
                active={filter === s}
                onClick={() => setFilter(s)}
              />
            ))}
          </div>
          <div className="cmps__sort">
            <span className="cmps__sort-label">Sort</span>
            <div className="cmps__sort-tabs">
              <button type="button" className={sortKey === "recent" ? "is-active" : ""} onClick={() => setSortKey("recent")}>Recent</button>
              <button type="button" className={sortKey === "name" ? "is-active" : ""} onClick={() => setSortKey("name")}>A–Z</button>
              <button type="button" className={sortKey === "spend" ? "is-active" : ""} onClick={() => setSortKey("spend")}>Spend</button>
              <button type="button" className={sortKey === "goal" ? "is-active" : ""} onClick={() => setSortKey("goal")}>Goal %</button>
            </div>
          </div>
        </div>

        {/* List */}
        {loadError ? (
          <OsEmptyView Icon={Megaphone} iconGradient={GRAD.redPink} title="Couldn't load campaigns" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : items === null ? (
          <div className="cmps__loading">Loading campaigns…</div>
        ) : counts.all === 0 ? (
          <OsEmptyView
            Icon={Megaphone}
            iconGradient={GRAD.orangePink}
            title="No campaigns yet"
            subtitle="Plan your first campaign — track budget vs spend, goal vs actual, and pipeline impact."
            chips={["Email", "Paid search", "Social", "Outbound", "Event", "Content"]}
            cta="New campaign"
          />
        ) : filtered.length === 0 ? (
          <div className="cmps__empty">
            <Search />
            <div>No campaigns match your filters.</div>
            <button type="button" className="cmps__empty-reset" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>
          </div>
        ) : (
          <div className="cmps__list">
            {filtered.map((c) => <CampaignRow key={c.id} campaign={c} onAdvance={patchStatus} />)}
          </div>
        )}
      </div>
    </>
  );
}

function CampaignRow({ campaign: c, onAdvance }: { campaign: ApiCampaign; onAdvance: (id: string, s: Status) => void }) {
  const accent = STATUS_COLORS[c.status];
  const chColor = channelColor(c.channel);
  const budget = num(c.budget);
  const spent = num(c.spent);
  const spendPct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const target = c.goalTarget ?? 0;
  const actual = c.goalActual ?? 0;
  const goalPct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const left = daysLeft(c.endDate);
  const StatusIcon = c.status === "ACTIVE" ? Play : c.status === "PAUSED" ? Pause : c.status === "COMPLETED" ? CheckCircle2 : Loader2;

  return (
    <article className="cmps__row" style={{ ["--row-c" as unknown as string]: accent }}>
      <span className="cmps__row-accent" aria-hidden="true" />

      <div className="cmps__row-status">
        <span className="cmps__row-status-icon" style={{ background: accent }}>
          <StatusIcon />
        </span>
        <span className="cmps__row-status-label">{STATUS_LABELS[c.status]}</span>
      </div>

      <Link href={`/marketing/${c.id}`} className="cmps__row-main">
        <div className="cmps__row-name">{c.name}</div>
        <div className="cmps__row-meta">
          {c.channel && (
            <span className="cmps__row-channel" style={{ ["--ch-c" as unknown as string]: chColor }}>
              {c.channel}
            </span>
          )}
          {c.description && (
            <span className="cmps__row-desc">{c.description.length > 80 ? c.description.slice(0, 80) + "…" : c.description}</span>
          )}
        </div>
      </Link>

      <div className="cmps__row-metrics">
        {target > 0 && (
          <Metric Icon={Target} label="Goal" value={`${goalPct}%`} sub={`${actual.toLocaleString()} / ${target.toLocaleString()}`} pct={goalPct} color="var(--os-c-green)" />
        )}
        {budget > 0 && (
          <Metric Icon={DollarSign} label="Spend" value={`${spendPct}%`} sub={`${fmtMoney(spent, c.currency ?? "₹")} / ${fmtMoney(budget, c.currency ?? "₹")}`} pct={spendPct} color={spendPct > 90 ? "var(--os-c-red)" : "var(--os-c-blue)"} />
        )}
      </div>

      <div className="cmps__row-dates">
        <CalendarRange />
        <div>
          <div>{dateRange(c.startDate, c.endDate)}</div>
          {left !== null && left >= 0 && c.status === "ACTIVE" && (
            <span className="cmps__row-left">{left}d left</span>
          )}
        </div>
      </div>

      <div className="cmps__row-actions">
        {c.status === "APPROVED" && (
          <button type="button" className="cmps__act cmps__act--primary" onClick={() => onAdvance(c.id, "ACTIVE")} title="Launch">
            <Play />
          </button>
        )}
        {c.status === "ACTIVE" && (
          <button type="button" className="cmps__act" onClick={() => onAdvance(c.id, "PAUSED")} title="Pause">
            <Pause />
          </button>
        )}
        {c.status === "PAUSED" && (
          <button type="button" className="cmps__act cmps__act--primary" onClick={() => onAdvance(c.id, "ACTIVE")} title="Resume">
            <Play />
          </button>
        )}
        {(c.status === "ACTIVE" || c.status === "PAUSED") && (
          <button type="button" className="cmps__act cmps__act--win" onClick={() => onAdvance(c.id, "COMPLETED")} title="Complete">
            <CheckCircle2 />
          </button>
        )}
      </div>
    </article>
  );
}

function Metric({ Icon, label, value, sub, pct, color }: { Icon: typeof Target; label: string; value: string; sub: string; pct: number; color: string }) {
  return (
    <div className="cmps__metric" style={{ ["--metric-c" as unknown as string]: color }}>
      <div className="cmps__metric-head">
        <Icon /> <span>{label}</span> <strong>{value}</strong>
      </div>
      <div className="cmps__metric-bar">
        <div className="cmps__metric-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="cmps__metric-sub">{sub}</div>
    </div>
  );
}

function FilterChip({ label, count, color, active, onClick }: { label: string; count: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`cmps__chip${active ? " is-active" : ""}`}
      style={color ? { ["--chip-c" as unknown as string]: color } : undefined}
      onClick={onClick}
    >
      {color && <span className="cmps__chip-dot" />}
      {label}
      <span className="cmps__chip-count">{count}</span>
    </button>
  );
}
