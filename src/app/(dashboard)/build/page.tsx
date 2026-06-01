"use client";

/* Build — AI-generated custom apps catalog.
 *
 *  GET  /api/build/apps
 *  POST /api/build/apps
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Hammer, Plus, Search, Hash, ChevronRight, Edit3, CheckCircle2, Sparkles,
  Activity, Code2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type AppStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type ApiApp = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  iconKey?: string | null;
  hue?: string | null;
  status: AppStatus;
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABEL: Record<AppStatus, string> = {
  DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived",
};
const STATUS_HUE: Record<AppStatus, string> = {
  DRAFT: "var(--os-c-indigo)", PUBLISHED: "var(--os-c-green)", ARCHIVED: "var(--os-ink-3)",
};
const STATUS_ICON: Record<AppStatus, typeof Edit3> = {
  DRAFT: Edit3, PUBLISHED: CheckCircle2, ARCHIVED: Activity,
};

const PALETTE = [C.purple, C.indigo, C.blue, C.teal, C.green, C.orange, C.pink, C.red];
function appHue(slug: string, fallback?: string | null) {
  if (fallback) return fallback;
  let h = 0; for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function BuildPage() {
  const [rows, setRows] = useState<ApiApp[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | AppStatus>("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/build/apps");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.apps ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("build");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<AppStatus, number> = { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const a of list) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return { total: list.length, counts };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (!showArchived) list = list.filter((a) => a.status !== "ARCHIVED");
    if (statusFilter !== "ALL") list = list.filter((a) => a.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.slug.toLowerCase().includes(q) ||
      (a.description ?? "").toLowerCase().includes(q));
    return list;
  }, [rows, search, statusFilter, showArchived]);

  return (
    <>
      <OsTitleBar
        title="Build"
        Icon={Hammer}
        iconGradient={GRAD.purpleIndigo}
        description={rows === null ? "Loading…" : `${stats.total} app${stats.total === 1 ? "" : "s"} · ${stats.counts.PUBLISHED} published · AI-generated`}
        actions={
          <div className="bld__head-actions">
            <Link href="/agents" className="bld__nav-link"><Code2 /> Agents</Link>
            <button type="button" className="bld__btn-primary" onClick={() => toast("Use the prompt panel in Sidekick to scaffold a new app")}>
              <Sparkles /> Generate app
            </button>
          </div>
        }
      />

      <div className="bld">
        <div className="bld__kpis">
          <KpiTile accent="var(--os-c-purple)" Icon={Hammer}      label="Apps"      value={`${stats.total}`}            sub="generated" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Published" value={`${stats.counts.PUBLISHED}`} sub="live in catalog" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Edit3}        label="Drafts"    value={`${stats.counts.DRAFT}`}     sub="not yet live" />
          <KpiTile accent="var(--os-c-pink)"   Icon={Sparkles}     label="Templates" value="—"                            sub="coming soon" />
        </div>

        <div className="bld__toolbar">
          <div className="bld__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search apps, slug, description…" />
          </div>
          <div className="bld__filters">
            {(["ALL", "PUBLISHED", "DRAFT"] as const).map((s) => {
              const Icon = s === "ALL" ? Hash : STATUS_ICON[s as AppStatus];
              return (
                <button
                  key={s}
                  type="button"
                  className={`bld__filter${statusFilter === s ? " is-active" : ""}`}
                  style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_HUE[s as AppStatus] } : undefined}
                  onClick={() => setStatusFilter(s)}
                >
                  <Icon /> {s === "ALL" ? "All" : STATUS_LABEL[s as AppStatus]}
                  <span>{s === "ALL" ? stats.total : stats.counts[s as AppStatus]}</span>
                </button>
              );
            })}
          </div>
          <label className="bld__archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>

        {loadError ? (
          <OsEmptyView Icon={Hammer} iconGradient={GRAD.redPink} title="Couldn't load apps" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="bld__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Hammer}
            iconGradient={GRAD.purpleIndigo}
            title="No custom apps yet"
            subtitle="Describe what you want — Claude scaffolds a real board with the right columns, status enum, and sample rows. Every app gets its own route."
            chips={["Prompt", "Schema", "Preview", "Publish"]}
            cta="Generate app"
          />
        ) : filtered.length === 0 ? (
          <div className="bld__no-match"><Search /> No apps match the filter.</div>
        ) : (
          <div className="bld__grid">
            {filtered.map((a) => {
              const StatusIcon = STATUS_ICON[a.status];
              const hue = appHue(a.slug, a.hue);
              return (
                <Link key={a.id} href={`/build/${a.slug}`} className={`bld__app${a.status === "ARCHIVED" ? " is-archived" : ""}`} style={{ ["--app-c" as unknown as string]: hue }}>
                  <header className="bld__app-head">
                    <span className="bld__app-icon"><Hammer /></span>
                    <span className="bld__app-status"><StatusIcon /> {STATUS_LABEL[a.status]}</span>
                  </header>
                  <h3 className="bld__app-name">{a.name}</h3>
                  <code className="bld__app-slug">/build/{a.slug}</code>
                  {a.description && <p className="bld__app-desc">{a.description.length > 140 ? a.description.slice(0, 140) + "…" : a.description}</p>}
                  <footer className="bld__app-foot">
                    <span>Updated {new Date(a.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <ChevronRight />
                  </footer>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Hammer; label: string; value: string; sub: string }) {
  return (
    <div className="bld__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="bld__kpi-accent" aria-hidden="true" />
      <div className="bld__kpi-row">
        <div className="bld__kpi-icon"><Icon /></div>
        <div className="bld__kpi-label">{label}</div>
      </div>
      <div className="bld__kpi-value">{value}</div>
      <div className="bld__kpi-sub">{sub}</div>
    </div>
  );
}
