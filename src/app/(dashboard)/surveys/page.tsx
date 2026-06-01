"use client";

/* Surveys — pulse surveys with KPI strip + status sections.
 *
 *  GET   /api/pulse-surveys
 *  POST  /api/pulse-surveys
 *  PATCH /api/pulse-surveys/[id]
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart, Plus, Search, Hash, ChevronRight, Activity, CheckCircle2, Edit3,
  Lock, Users, MessageCircle, AlertTriangle, Eye, Calendar as CalendarIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type SrStatus = "DRAFT" | "ACTIVE" | "CLOSED";

type ApiSurvey = {
  id: string;
  title: string;
  status: SrStatus;
  frequency?: string | null;
  audienceType: string;
  anonymous: boolean;
  questions?: unknown[];
  createdAt: string;
  closesAt?: string | null;
  closedAt?: string | null;
  responses?: { id: string }[];
  _count?: { responses?: number };
  audienceSize?: number;
  responseRate?: number;
};

const STATUS_LABEL: Record<SrStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", CLOSED: "Closed",
};
const STATUS_HUE: Record<SrStatus, string> = {
  DRAFT: "var(--os-c-indigo)", ACTIVE: "var(--os-c-orange)", CLOSED: "var(--os-c-green)",
};
const STATUS_ICON: Record<SrStatus, typeof Edit3> = {
  DRAFT: Edit3, ACTIVE: Activity, CLOSED: CheckCircle2,
};
const GROUP_ORDER: SrStatus[] = ["ACTIVE", "DRAFT", "CLOSED"];

function questionCount(s: ApiSurvey): number {
  return Array.isArray(s.questions) ? s.questions.length : 0;
}

export default function SurveysPage() {
  const [rows, setRows] = useState<ApiSurvey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | SrStatus>("ALL");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pulse-surveys");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("surveys");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    try {
      const res = await fetch("/api/pulse-surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled pulse",
          questions: [{ id: "q1", text: "How was your week?", type: "rating" }],
          audienceType: "ALL",
          anonymous: true,
        }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't create"); return; }
      toast("Draft created");
      void load();
    } catch { toast("Couldn't create"); }
  }

  async function launch(id: string) {
    try {
      const res = await fetch(`/api/pulse-surveys/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      });
      if (!res.ok) { toast("Couldn't launch"); return; }
      toast("Survey launched");
      void load();
    } catch { toast("Couldn't launch"); }
  }

  async function close(id: string) {
    try {
      const res = await fetch(`/api/pulse-surveys/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CLOSED" }),
      });
      if (!res.ok) { toast("Couldn't close"); return; }
      toast("Survey closed");
      void load();
    } catch { toast("Couldn't close"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<SrStatus, number> = { DRAFT: 0, ACTIVE: 0, CLOSED: 0 };
    for (const s of list) counts[s.status] = (counts[s.status] ?? 0) + 1;
    const totalResponses = list.reduce((a, s) => a + (s._count?.responses ?? s.responses?.length ?? 0), 0);
    const avgRate = list.length ? Math.round(list.reduce((a, s) => {
      const r = s._count?.responses ?? s.responses?.length ?? 0;
      const aud = s.audienceSize ?? 0;
      return a + (aud > 0 ? (r / aud) * 100 : 0);
    }, 0) / list.length) : 0;
    return { total: list.length, counts, totalResponses, avgRate };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (statusFilter !== "ALL") list = list.filter((s) => s.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) => s.title.toLowerCase().includes(q) || s.audienceType.toLowerCase().includes(q));
    return list;
  }, [rows, search, statusFilter]);

  const grouped = useMemo(() => {
    const m = new Map<SrStatus, ApiSurvey[]>();
    for (const s of GROUP_ORDER) m.set(s, []);
    for (const s of filtered) m.get(s.status)?.push(s);
    return GROUP_ORDER.map((s) => ({ status: s, items: m.get(s) ?? [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Surveys"
        Icon={BarChart}
        iconGradient={GRAD.bluePurple}
        description={rows === null ? "Loading…" : `${stats.total} survey${stats.total === 1 ? "" : "s"} · ${stats.counts.ACTIVE} active · ${stats.totalResponses} response${stats.totalResponses === 1 ? "" : "s"}${stats.avgRate > 0 ? ` · ${stats.avgRate}% avg rate` : ""}`}
        actions={
          <div className="srv__head-actions">
            <Link href="/candor" className="srv__nav-link"><Lock /> Candor</Link>
            <Link href="/people" className="srv__nav-link"><Users /> People</Link>
            <button type="button" className="srv__btn-primary" onClick={quickAdd}>
              <Plus /> New pulse
            </button>
          </div>
        }
      />

      <div className="srv">
        <div className="srv__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Activity}     label="Active"      value={`${stats.counts.ACTIVE}`}  sub="collecting" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Edit3}        label="Drafts"      value={`${stats.counts.DRAFT}`}   sub="not yet launched" />
          <KpiTile accent="var(--os-c-blue)"   Icon={MessageCircle} label="Responses"  value={`${stats.totalResponses}`} sub="across surveys" />
          <KpiTile accent={stats.avgRate >= 70 ? "var(--os-c-green)" : stats.avgRate >= 40 ? "var(--os-c-orange)" : "var(--os-c-red)"} Icon={BarChart} label="Avg rate" value={`${stats.avgRate}%`} sub="participation" />
        </div>

        <div className="srv__toolbar">
          <div className="srv__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search surveys…" />
          </div>
          <div className="srv__filters">
            {(["ALL", "ACTIVE", "DRAFT", "CLOSED"] as const).map((s) => {
              const Icon = s === "ALL" ? Hash : STATUS_ICON[s as SrStatus];
              return (
                <button
                  key={s}
                  type="button"
                  className={`srv__filter${statusFilter === s ? " is-active" : ""}`}
                  style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_HUE[s as SrStatus] } : undefined}
                  onClick={() => setStatusFilter(s)}
                >
                  <Icon /> {s === "ALL" ? "All" : STATUS_LABEL[s as SrStatus]}
                  <span>{s === "ALL" ? stats.total : stats.counts[s as SrStatus]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={BarChart} iconGradient={GRAD.redPink} title="Couldn't load" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="srv__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={BarChart}
            iconGradient={GRAD.bluePurple}
            title="No surveys yet"
            subtitle="Launch your first pulse. Anonymous by default so people speak freely."
            chips={["Rating", "NPS", "Free text", "Multiple choice"]}
            cta="New pulse"
          />
        ) : grouped.length === 0 ? (
          <div className="srv__no-match"><AlertTriangle /> No surveys match.</div>
        ) : (
          grouped.map((g) => {
            const Icon = STATUS_ICON[g.status];
            return (
              <section key={g.status} className="srv__section" style={{ ["--s-c" as unknown as string]: STATUS_HUE[g.status] }}>
                <header className="srv__section-head">
                  <span className="srv__section-tag"><Icon /> {STATUS_LABEL[g.status]}</span>
                  <span className="srv__section-count">{g.items.length}</span>
                  <span className="srv__section-line" />
                </header>
                <div className="srv__grid">
                  {g.items.map((s) => <SurveyCard key={s.id} s={s} onLaunch={() => launch(s.id)} onClose={() => close(s.id)} />)}
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function SurveyCard({ s, onLaunch, onClose }: { s: ApiSurvey; onLaunch: () => void; onClose: () => void }) {
  const responses = s._count?.responses ?? s.responses?.length ?? 0;
  const audience = s.audienceSize ?? 0;
  const pct = audience > 0 ? Math.round((responses / audience) * 100) : 0;
  const qCount = questionCount(s);
  const rateHue = pct >= 70 ? "var(--os-c-green)" : pct >= 40 ? "var(--os-c-orange)" : "var(--os-c-red)";
  return (
    <article className="srv__card" style={{ ["--c-c" as unknown as string]: STATUS_HUE[s.status] }}>
      <header className="srv__card-head">
        <span className="srv__card-aud">{s.audienceType}</span>
        {s.anonymous && <span className="srv__card-anon"><Lock /> Anonymous</span>}
      </header>
      <h3 className="srv__card-title">{s.title}</h3>
      <div className="srv__card-meta">
        <span><MessageCircle /> {qCount} question{qCount === 1 ? "" : "s"}</span>
        <span><Eye /> {responses} response{responses === 1 ? "" : "s"}</span>
        {s.closesAt && <span><CalendarIcon /> closes {new Date(s.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
      </div>
      {audience > 0 && (
        <div className="srv__card-rate">
          <div className="srv__card-rate-label">
            <span>Participation</span>
            <strong style={{ color: rateHue }}>{pct}%</strong>
          </div>
          <div className="srv__card-rate-track">
            <div className="srv__card-rate-fill" style={{ width: `${pct}%`, background: rateHue }} />
          </div>
          <div className="srv__card-rate-sub">{responses} of {audience}</div>
        </div>
      )}
      <footer className="srv__card-foot">
        {s.status === "DRAFT" && (
          <button type="button" className="srv__card-btn srv__card-btn--launch" onClick={onLaunch}>
            <Activity /> Launch
          </button>
        )}
        {s.status === "ACTIVE" && (
          <button type="button" className="srv__card-btn srv__card-btn--close" onClick={onClose}>
            <CheckCircle2 /> Close
          </button>
        )}
        <Link href={`/surveys/${s.id}`} className="srv__card-open">
          View <ChevronRight />
        </Link>
      </footer>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof BarChart; label: string; value: string; sub: string }) {
  return (
    <div className="srv__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="srv__kpi-accent" aria-hidden="true" />
      <div className="srv__kpi-row">
        <div className="srv__kpi-icon"><Icon /></div>
        <div className="srv__kpi-label">{label}</div>
      </div>
      <div className="srv__kpi-value">{value}</div>
      <div className="srv__kpi-sub">{sub}</div>
    </div>
  );
}
