"use client";

/* Marketing · Campaigns — performance grid.
 *
 * Each campaign is a richly-summarised card:
 *   - status pill, channel chip, goal vs actual bar (with %)
 *   - budget vs spent bar
 *   - date span + days remaining
 *   - one-click status flips (Pause / Resume / Complete)
 *
 * Top strip: filter chips by status, total budget / spent / pipeline contribution.
 *
 * GET   /api/marketing/campaigns
 * POST  /api/marketing/campaigns      { name, ... }
 * PATCH /api/marketing/campaigns      { id, status?, ... }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, Play, Pause, CheckCircle2, Target, DollarSign, CalendarRange } from "lucide-react";
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
};

const STATUS_HUE: Record<Status, string> = {
  PLANNING: "var(--os-c-indigo)", APPROVED: "var(--os-c-blue)",
  ACTIVE: "var(--os-c-green)", PAUSED: "var(--os-c-orange)",
  COMPLETED: "var(--os-c-teal)", CANCELLED: "var(--os-c-darkgray)",
};
const STATUS_LABEL: Record<Status, string> = {
  PLANNING: "Planning", APPROVED: "Approved", ACTIVE: "Active",
  PAUSED: "Paused", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const CHANNEL_HUE: Record<string, string> = {
  Email: "var(--os-c-blue)", "Paid Search": "var(--os-c-orange)",
  Social: "var(--os-c-pink)", Outbound: "var(--os-c-indigo)",
  Event: "var(--os-c-purple)", Content: "var(--os-c-teal)", Webinar: "var(--os-c-red)",
};

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}
function money(n: number, ccy = "USD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n); }
  catch { return `${ccy} ${n.toFixed(0)}`; }
}

const MS_DAY = 86_400_000;
function daysLeft(end?: string | null): number | null {
  if (!end) return null;
  return Math.ceil((new Date(end).getTime() - Date.now()) / MS_DAY);
}

type FilterKey = "all" | Status;

export default function CampaignsPage() {
  const [items, setItems] = useState<ApiCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/campaigns");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.campaigns ?? data.data ?? (Array.isArray(data) ? data : []));
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
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't update"); void load(); }
  }
  async function createCampaign() {
    const name = window.prompt("Campaign name?")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't create"); }
  }

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      all: list.length,
      PLANNING: list.filter((c) => c.status === "PLANNING").length,
      APPROVED: list.filter((c) => c.status === "APPROVED").length,
      ACTIVE: list.filter((c) => c.status === "ACTIVE").length,
      PAUSED: list.filter((c) => c.status === "PAUSED").length,
      COMPLETED: list.filter((c) => c.status === "COMPLETED").length,
      CANCELLED: list.filter((c) => c.status === "CANCELLED").length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    if (filter === "all") return list;
    return list.filter((c) => c.status === filter);
  }, [items, filter]);

  // Totals only count non-cancelled
  const totalBudget = (items ?? []).filter((c) => c.status !== "CANCELLED").reduce((acc, c) => acc + num(c.budget), 0);
  const totalSpent = (items ?? []).filter((c) => c.status !== "CANCELLED").reduce((acc, c) => acc + num(c.spent), 0);
  const totalActual = (items ?? []).filter((c) => c.status !== "CANCELLED").reduce((acc, c) => acc + (c.goalActual ?? 0), 0);

  return (
    <div className="mkt">
      <header className="mkt__head">
        <div className="mkt__head-l">
          <div className="mkt__icon"><Megaphone /></div>
          <div>
            <h1 className="mkt__title">Marketing campaigns</h1>
            <div className="mkt__sub">
              {items === null ? "Loading…" : `${counts.all} campaign${counts.all === 1 ? "" : "s"} · ${counts.ACTIVE} active · ${money(totalSpent)} spent of ${money(totalBudget)}`}
            </div>
          </div>
        </div>
        <button type="button" className="mkt__new" onClick={createCampaign}>
          <Plus /> New campaign
        </button>
      </header>

      <section className="mkt__stats">
        <div className="mkt-stat"><span>Active</span><strong>{counts.ACTIVE}</strong></div>
        <div className="mkt-stat"><span>Total budget</span><strong>{money(totalBudget)}</strong></div>
        <div className="mkt-stat"><span>Total spent</span><strong>{money(totalSpent)}</strong></div>
        <div className="mkt-stat"><span>Goal actuals</span><strong>{totalActual.toLocaleString()}</strong></div>
      </section>

      <nav className="mkt__filters">
        <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <em>{counts.all}</em></button>
        {(["ACTIVE", "PLANNING", "APPROVED", "PAUSED", "COMPLETED"] as Status[]).map((s) => (
          <button key={s} type="button" className={filter === s ? "is-active" : ""} onClick={() => setFilter(s)}>
            <span className="mkt__filter-dot" style={{ background: STATUS_HUE[s] }} />
            {STATUS_LABEL[s]} <em>{counts[s] ?? 0}</em>
          </button>
        ))}
      </nav>

      {loadError ? (
        <div className="mkt__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="mkt__empty">
          <Megaphone />
          <div>
            <h3>No campaigns in this view</h3>
            <p>Start a campaign — pick a channel, set a goal, give it a budget. Performance lands here.</p>
          </div>
        </div>
      ) : (
        <div className="mkt__grid">
          {filtered.map((c) => {
            const budget = num(c.budget); const spent = num(c.spent);
            const spentPct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
            const target = c.goalTarget ?? 0; const actual = c.goalActual ?? 0;
            const goalPct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
            const channelHue = c.channel ? CHANNEL_HUE[c.channel] ?? "var(--os-c-indigo)" : "var(--os-c-indigo)";
            const left = daysLeft(c.endDate);
            return (
              <article key={c.id} className="mkt-card" style={{ ["--card-hue" as string]: STATUS_HUE[c.status] }}>
                <header className="mkt-card__head">
                  <div>
                    <h3>{c.name}</h3>
                    <div className="mkt-card__sub-line">
                      {c.channel && <span className="mkt-card__channel" style={{ background: channelHue }}>{c.channel}</span>}
                      {c.utmCampaign && <code>{c.utmCampaign}</code>}
                    </div>
                  </div>
                  <span className="mkt-card__status" style={{ background: STATUS_HUE[c.status] }}>{STATUS_LABEL[c.status]}</span>
                </header>

                {c.description && <p className="mkt-card__desc">{c.description.length > 120 ? c.description.slice(0, 120) + "…" : c.description}</p>}

                <div className="mkt-card__meter">
                  <div className="mkt-card__meter-head">
                    <span><Target /> Goal{c.goalMetric ? ` · ${c.goalMetric}` : ""}</span>
                    <strong>{actual.toLocaleString()} <small>/ {target.toLocaleString() || "—"}</small></strong>
                  </div>
                  <div className="mkt-card__bar">
                    <div className="mkt-card__bar-fill mkt-card__bar-fill--goal" style={{ width: `${goalPct}%` }} />
                  </div>
                </div>

                <div className="mkt-card__meter">
                  <div className="mkt-card__meter-head">
                    <span><DollarSign /> Spend</span>
                    <strong>{money(spent, c.currency)} <small>/ {money(budget, c.currency)}</small></strong>
                  </div>
                  <div className="mkt-card__bar">
                    <div className={`mkt-card__bar-fill ${spentPct >= 100 ? "is-over" : spentPct >= 80 ? "is-warn" : ""}`} style={{ width: `${spentPct}%` }} />
                  </div>
                </div>

                <footer className="mkt-card__foot">
                  <span className="mkt-card__dates">
                    <CalendarRange />
                    {c.startDate ? new Date(c.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    {" → "}
                    {c.endDate ? new Date(c.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    {left != null && left >= 0 && c.status === "ACTIVE" && <em> · {left}d left</em>}
                  </span>
                  <div className="mkt-card__actions">
                    {c.status === "ACTIVE" && <button type="button" onClick={() => patchStatus(c.id, "PAUSED")} title="Pause"><Pause /></button>}
                    {c.status === "PAUSED" && <button type="button" onClick={() => patchStatus(c.id, "ACTIVE")} title="Resume"><Play /></button>}
                    {(c.status === "ACTIVE" || c.status === "PAUSED") && <button type="button" onClick={() => patchStatus(c.id, "COMPLETED")} title="Complete"><CheckCircle2 /></button>}
                    {c.status === "APPROVED" && <button type="button" onClick={() => patchStatus(c.id, "ACTIVE")} title="Launch" className="is-primary"><Play /></button>}
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
