"use client";

/* Candor — anonymous feedback sessions with KPI strip + status sections.
 *
 *  GET   /api/candor
 *  POST  /api/candor
 *  PATCH /api/candor
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MessageCircleHeart, Plus, Search, Hash, ChevronRight, Activity, CheckCircle2,
  Edit3, Lock, Eye, Users, MessageCircle, Building, Globe, Sparkles,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type CandorStatus = "DRAFT" | "ACTIVE" | "CLOSED";

type ApiCandor = {
  id: string;
  title: string;
  description?: string | null;
  prompts: string[] | unknown;
  status: CandorStatus;
  departmentId?: string | null;
  launchedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  createdBy: string;
  responseCount?: number;
  isOwner?: boolean;
};

const STATUS_LABEL: Record<CandorStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", CLOSED: "Closed",
};
const STATUS_HUE: Record<CandorStatus, string> = {
  DRAFT: "var(--os-c-indigo)", ACTIVE: "var(--os-c-orange)", CLOSED: "var(--os-c-green)",
};
const STATUS_ICON: Record<CandorStatus, typeof Edit3> = {
  DRAFT: Edit3, ACTIVE: Activity, CLOSED: CheckCircle2,
};
const GROUP_ORDER: CandorStatus[] = ["ACTIVE", "DRAFT", "CLOSED"];

function promptCount(c: ApiCandor): number {
  return Array.isArray(c.prompts) ? c.prompts.length : 0;
}

export default function CandorPage() {
  const [rows, setRows] = useState<ApiCandor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | CandorStatus>("ALL");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/candor");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("candor");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    try {
      const res = await fetch("/api/candor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled Candor",
          prompts: ["What's working well right now?", "What should we change?", "Anything else?"],
          status: "DRAFT",
        }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't create"); return; }
      toast("Draft created — add prompts then launch");
      void load();
    } catch { toast("Couldn't create"); }
  }

  async function transition(id: string, status: CandorStatus) {
    try {
      const res = await fetch("/api/candor", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) { toast("Couldn't update"); return; }
      toast(status === "ACTIVE" ? "Session launched" : "Session closed");
      void load();
    } catch { toast("Couldn't update"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<CandorStatus, number> = { DRAFT: 0, ACTIVE: 0, CLOSED: 0 };
    for (const c of list) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const responses = list.reduce((a, c) => a + (c.responseCount ?? 0), 0);
    const owned = list.filter((c) => c.isOwner).length;
    return { total: list.length, counts, responses, owned };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (statusFilter !== "ALL") list = list.filter((c) => c.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q));
    return list;
  }, [rows, search, statusFilter]);

  const grouped = useMemo(() => {
    const m = new Map<CandorStatus, ApiCandor[]>();
    for (const s of GROUP_ORDER) m.set(s, []);
    for (const c of filtered) m.get(c.status)?.push(c);
    return GROUP_ORDER.map((s) => ({ status: s, items: m.get(s) ?? [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Candor"
        Icon={MessageCircleHeart}
        iconGradient={GRAD.pinkPurple}
        description={rows === null ? "Loading…" : `${stats.total} session${stats.total === 1 ? "" : "s"} · ${stats.counts.ACTIVE} active · ${stats.responses} anonymous response${stats.responses === 1 ? "" : "s"}`}
        actions={
          <div className="cnd__head-actions">
            <Link href="/people" className="cnd__nav-link"><Users /> People</Link>
            <button type="button" className="cnd__btn-primary" onClick={quickAdd}>
              <Plus /> New Candor
            </button>
          </div>
        }
      />

      <div className="cnd">
        <div className="cnd__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Activity}     label="Active sessions" value={`${stats.counts.ACTIVE}`} sub="collecting feedback" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Edit3}         label="Drafts"          value={`${stats.counts.DRAFT}`}  sub="not yet launched" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2}  label="Closed"          value={`${stats.counts.CLOSED}`} sub="archived" />
          <KpiTile accent="var(--os-c-pink)"   Icon={MessageCircle} label="Responses"       value={`${stats.responses}`}     sub="100% anonymous" />
        </div>

        <div className="cnd__privacy-banner">
          <Lock />
          <span>
            <strong>Responses are anonymous by design.</strong> No identity, IP, or device data is stored against a response — just the prompt + reply text.
          </span>
        </div>

        <div className="cnd__toolbar">
          <div className="cnd__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sessions…" />
          </div>
          <div className="cnd__filters">
            {(["ALL", "ACTIVE", "DRAFT", "CLOSED"] as const).map((s) => {
              const Icon = s === "ALL" ? Hash : STATUS_ICON[s as CandorStatus];
              return (
                <button
                  key={s}
                  type="button"
                  className={`cnd__filter${statusFilter === s ? " is-active" : ""}`}
                  style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_HUE[s as CandorStatus] } : undefined}
                  onClick={() => setStatusFilter(s)}
                >
                  <Icon /> {s === "ALL" ? "All" : STATUS_LABEL[s as CandorStatus]}
                  <span>{s === "ALL" ? stats.total : stats.counts[s as CandorStatus]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={MessageCircleHeart} iconGradient={GRAD.redPink} title="Couldn't load sessions" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="cnd__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={MessageCircleHeart}
            iconGradient={GRAD.pinkPurple}
            title="No Candor sessions yet"
            subtitle="Run anonymous feedback rounds. Pick a scope (team or org), write 3-5 prompts, launch. Responses are 100% anonymous."
            chips={["Anonymous", "Department", "Org-wide"]}
            cta="New Candor"
          />
        ) : grouped.length === 0 ? (
          <div className="cnd__no-match"><Search /> No sessions match.</div>
        ) : (
          grouped.map((g) => {
            const Icon = STATUS_ICON[g.status];
            return (
              <section key={g.status} className="cnd__section" style={{ ["--s-c" as unknown as string]: STATUS_HUE[g.status] }}>
                <header className="cnd__section-head">
                  <span className="cnd__section-tag"><Icon /> {STATUS_LABEL[g.status]}</span>
                  <span className="cnd__section-count">{g.items.length}</span>
                  <span className="cnd__section-line" />
                </header>
                <div className="cnd__grid">
                  {g.items.map((c) => <CandorCard key={c.id} c={c} onLaunch={() => transition(c.id, "ACTIVE")} onClose={() => transition(c.id, "CLOSED")} />)}
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function CandorCard({ c, onLaunch, onClose }: { c: ApiCandor; onLaunch: () => void; onClose: () => void }) {
  const pCount = promptCount(c);
  const rCount = c.responseCount ?? 0;
  const ScopeIcon = c.departmentId ? Building : Globe;
  return (
    <article className="cnd__card" style={{ ["--c-c" as unknown as string]: STATUS_HUE[c.status] }}>
      <header className="cnd__card-head">
        <span className="cnd__card-scope"><ScopeIcon /> {c.departmentId ? "Department" : "Org-wide"}</span>
        {c.isOwner && <span className="cnd__card-owner"><Sparkles /> Owner</span>}
      </header>
      <h3 className="cnd__card-title">{c.title}</h3>
      {c.description && <p className="cnd__card-desc">{c.description.length > 120 ? c.description.slice(0, 120) + "…" : c.description}</p>}
      <div className="cnd__card-meta">
        <span><MessageCircle /> {pCount} prompt{pCount === 1 ? "" : "s"}</span>
        <span><Eye /> {rCount} response{rCount === 1 ? "" : "s"}</span>
        {c.launchedAt && <span>Launched {new Date(c.launchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
        {c.closedAt && <span>Closed {new Date(c.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
      </div>
      <footer className="cnd__card-foot">
        {c.isOwner && c.status === "DRAFT" && (
          <button type="button" className="cnd__card-btn cnd__card-btn--launch" onClick={onLaunch}>
            <Activity /> Launch
          </button>
        )}
        {c.isOwner && c.status === "ACTIVE" && (
          <button type="button" className="cnd__card-btn cnd__card-btn--close" onClick={onClose}>
            <CheckCircle2 /> Close
          </button>
        )}
        <Link href={`/candor/${c.id}`} className="cnd__card-open">
          View <ChevronRight />
        </Link>
      </footer>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof MessageCircleHeart; label: string; value: string; sub: string }) {
  return (
    <div className="cnd__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="cnd__kpi-accent" aria-hidden="true" />
      <div className="cnd__kpi-row">
        <div className="cnd__kpi-icon"><Icon /></div>
        <div className="cnd__kpi-label">{label}</div>
      </div>
      <div className="cnd__kpi-value">{value}</div>
      <div className="cnd__kpi-sub">{sub}</div>
    </div>
  );
}
