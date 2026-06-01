"use client";

/* Tools — org tool catalog with shared credentials, grouped by category.
 *
 *  GET   /api/tools
 *  POST  /api/tools
 *  PATCH /api/tools/[id]
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wrench, Plus, Search, Hash, ChevronRight, ExternalLink, Lock, Users,
  Layers, Activity, Globe,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiTool = {
  id: string;
  name: string;
  description?: string | null;
  url: string;
  icon?: string | null;
  category?: string | null;
  shares?: Array<{ userId: string; sharedAt: string }>;
  sharedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  Productivity: C.blue, Design: C.pink, Engineering: C.purple,
  Marketing: C.orange, Finance: C.green, HR: C.teal, Sales: C.indigo,
  Support: C.red, Communication: C.brown, Uncategorized: C.gray,
};
function categoryColor(name: string) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
  return palette[h % palette.length];
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

export default function ToolsPage() {
  const [rows, setRows] = useState<ApiTool[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tools");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tools");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = window.prompt("Tool name?")?.trim();
    if (!name) return;
    const url = window.prompt("URL?")?.trim();
    if (!url) return;
    try {
      const res = await fetch("/api/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, category: "Uncategorized" }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Admin access required" : "Couldn't add"); return; }
      toast("Tool added");
      void load();
    } catch { toast("Couldn't add"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const sharedToMe = list.filter((t) => t.sharedAt).length;
    const withCreds = list.filter((t) => (t.shares?.length ?? 0) > 0).length;
    const cats = new Set(list.map((t) => t.category ?? "Uncategorized"));
    return { total: list.length, sharedToMe, withCreds, categories: cats.size };
  }, [rows]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of rows ?? []) {
      const k = t.category ?? "Uncategorized";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (activeCategory) list = list.filter((t) => (t.category ?? "Uncategorized") === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q) ||
      t.url.toLowerCase().includes(q));
    return list;
  }, [rows, search, activeCategory]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiTool[]>();
    for (const t of filtered) {
      const k = t.category ?? "Uncategorized";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => ({ cat, color: categoryColor(cat), items: items.slice().sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Tools"
        Icon={Wrench}
        iconGradient={GRAD.brownOrange}
        description={rows === null ? "Loading…" : `${stats.total} tool${stats.total === 1 ? "" : "s"} · ${stats.categories} categor${stats.categories === 1 ? "y" : "ies"} · ${stats.withCreds} with shared creds`}
        actions={
          <div className="tls__head-actions">
            <Link href="/settings" className="tls__nav-link"><Hash /> Settings</Link>
            <button type="button" className="tls__btn-primary" onClick={quickAdd}>
              <Plus /> Add tool
            </button>
          </div>
        }
      />

      <div className="tls">
        <div className="tls__kpis">
          <KpiTile accent="var(--os-c-brown)"  Icon={Wrench}    label="Tools"        value={`${stats.total}`}      sub="in catalog" />
          <KpiTile accent="var(--os-c-purple)" Icon={Layers}    label="Categories"   value={`${stats.categories}`} sub="organized" />
          <KpiTile accent="var(--os-c-orange)" Icon={Users}     label="With creds"   value={`${stats.withCreds}`}  sub="shared access" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Activity}  label="Shared to me" value={`${stats.sharedToMe}`} sub="you have access" />
        </div>

        <div className="tls__toolbar">
          <div className="tls__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools, URLs, descriptions…" />
          </div>
        </div>

        {cats.length > 0 && (
          <div className="tls__cats">
            <button type="button" className={`tls__cat${activeCategory === null ? " is-active" : ""}`} onClick={() => setActiveCategory(null)}>
              <Layers /> All <span>{stats.total}</span>
            </button>
            {cats.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                className={`tls__cat${activeCategory === cat ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: categoryColor(cat) }}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                <span className="tls__cat-dot" />
                {cat}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={Wrench} iconGradient={GRAD.redPink} title="Couldn't load tools" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="tls__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Wrench}
            iconGradient={GRAD.brownOrange}
            title="No tools yet"
            subtitle="Build the team's tool catalog. Add Figma, Notion, GitHub — share credentials with specific people, audit access."
            chips={["Productivity", "Design", "Engineering", "Marketing"]}
            cta="Add tool"
          />
        ) : grouped.length === 0 ? (
          <div className="tls__no-match"><Search /> No tools match.</div>
        ) : (
          grouped.map((g) => (
            <section key={g.cat} className="tls__section" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="tls__section-head">
                <span className="tls__section-dot" />
                <h2>{g.cat}</h2>
                <span className="tls__section-count">{g.items.length}</span>
                <span className="tls__section-line" />
              </header>
              <div className="tls__grid">
                {g.items.map((t) => {
                  const sharedCount = t.shares?.length ?? 0;
                  const isShared = !!t.sharedAt;
                  return (
                    <a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer" className="tls__tool" style={{ ["--t-c" as unknown as string]: g.color }}>
                      <header className="tls__tool-head">
                        <span className="tls__tool-icon"><Globe /></span>
                        <div className="tls__tool-id">
                          <h3>{t.name}</h3>
                          <span>{getDomain(t.url)}</span>
                        </div>
                        <ExternalLink className="tls__tool-ext" />
                      </header>
                      {t.description && <p className="tls__tool-desc">{t.description.length > 120 ? t.description.slice(0, 120) + "…" : t.description}</p>}
                      <footer className="tls__tool-foot">
                        {isShared ? (
                          <span className="tls__tool-shared"><Lock /> Shared with you</span>
                        ) : sharedCount > 0 ? (
                          <span className="tls__tool-team"><Users /> {sharedCount} member{sharedCount === 1 ? "" : "s"}</span>
                        ) : (
                          <span className="tls__tool-public"><Globe /> Public</span>
                        )}
                        <ChevronRight />
                      </footer>
                    </a>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Wrench; label: string; value: string; sub: string }) {
  return (
    <div className="tls__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="tls__kpi-accent" aria-hidden="true" />
      <div className="tls__kpi-row">
        <div className="tls__kpi-icon"><Icon /></div>
        <div className="tls__kpi-label">{label}</div>
      </div>
      <div className="tls__kpi-value">{value}</div>
      <div className="tls__kpi-sub">{sub}</div>
    </div>
  );
}
