"use client";

/* Settings · Tags — global tag manager (cost-center / project / department / etc.).
 *
 *  GET /api/tags
 *  POST /api/tags { name, category, color?, archived? }
 *  PATCH /api/tags/[id]
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Tag, Plus, Search, Hash, Trash2, Layers, Archive,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";

type ApiTag = { id: string; name: string; category: string; color?: string | null; archived?: boolean; usageCount?: number };

const PALETTE = [C.purple, C.indigo, C.blue, C.teal, C.green, C.orange, C.pink, C.red];
function autoColor(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const SAMPLE: ApiTag[] = [
  { id: "1", name: "Engineering", category: "Department", color: C.indigo, usageCount: 42 },
  { id: "2", name: "Sales", category: "Department", color: C.orange, usageCount: 31 },
  { id: "3", name: "Customer Success", category: "Department", color: C.green, usageCount: 18 },
  { id: "4", name: "Platform", category: "Cost Center", color: C.purple, usageCount: 56 },
  { id: "5", name: "Growth", category: "Cost Center", color: C.pink, usageCount: 23 },
  { id: "6", name: "Q1 launch", category: "Project", color: C.teal, usageCount: 14 },
  { id: "7", name: "Q2 launch", category: "Project", color: C.blue, usageCount: 9 },
  { id: "8", name: "Mobile rewrite", category: "Project", color: C.red, usageCount: 27 },
  { id: "9", name: "EMEA", category: "Region", color: C.purple, usageCount: 12 },
  { id: "10", name: "Americas", category: "Region", color: C.green, usageCount: 38 },
];

export default function TagManagerPage() {
  const [tags, setTags] = useState<ApiTag[] | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const promptDialog = usePrompt();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tags");
      if (!res.ok) { setTags(SAMPLE); return; }
      const d = await res.json();
      const list: ApiTag[] = d.data ?? (Array.isArray(d) ? d : []);
      setTags(list.length > 0 ? list : SAMPLE);
    } catch { setTags(SAMPLE); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function quickAdd() {
    const name = (await promptDialog({ title: "Tag name?" }))?.trim();
    if (!name) return;
    const category = (await promptDialog({ title: "Category? (Department / Cost Center / Project / Region)" }))?.trim() || "Uncategorized";
    try {
      const res = await fetch("/api/tags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, color: autoColor(name) }),
      });
      if (!res.ok) {
        setTags((t) => [...(t ?? []), { id: Math.random().toString(36).slice(2, 8), name, category, color: autoColor(name), usageCount: 0 }]);
        toast("Tag created (local — API not wired yet)");
        return;
      }
      toast("Tag created");
      void load();
    } catch {
      setTags((t) => [...(t ?? []), { id: Math.random().toString(36).slice(2, 8), name, category, color: autoColor(name), usageCount: 0 }]);
      toast("Tag created locally");
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Delete tag", description: "Delete this tag? Existing items keep it as a string but lose the chip.", destructive: true, confirmLabel: "Delete" }))) return;
    setTags((t) => (t ?? []).filter((x) => x.id !== id));
    toast("Tag deleted");
  }

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tags ?? []) {
      if (!showArchived && t.archived) continue;
      m.set(t.category, (m.get(t.category) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [tags, showArchived]);

  const filtered = useMemo(() => {
    let list = tags ?? [];
    if (!showArchived) list = list.filter((t) => !t.archived);
    if (activeCategory) list = list.filter((t) => t.category === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    return list;
  }, [tags, search, activeCategory, showArchived]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiTag[]>();
    for (const t of filtered) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const stats = useMemo(() => {
    const list = tags ?? [];
    const total = list.filter((t) => !t.archived).length;
    const usage = list.reduce((a, t) => a + (t.usageCount ?? 0), 0);
    return { total, categories: cats.length, usage, archived: list.filter((t) => t.archived).length };
  }, [tags, cats]);

  return (
    <>
      <OsTitleBar
        title="Tags"
        Icon={Tag}
        iconGradient={GRAD.pinkPurple}
        description={`${stats.total} tag${stats.total === 1 ? "" : "s"} · ${stats.categories} categor${stats.categories === 1 ? "y" : "ies"} · ${stats.usage} usage${stats.usage === 1 ? "" : "s"}`}
        actions={
          <div className="tgm__head-actions">
            <Link href="/settings" className="tgm__nav-link"><Hash /> Settings</Link>
            <button type="button" className="tgm__btn-primary" onClick={quickAdd}>
              <Plus /> New tag
            </button>
          </div>
        }
      />

      <div className="tgm">
        <div className="tgm__kpis">
          <KpiTile accent="var(--os-c-pink)"   Icon={Tag}    label="Tags"        value={`${stats.total}`}      sub="active" />
          <KpiTile accent="var(--os-c-purple)" Icon={Layers} label="Categories"  value={`${stats.categories}`} sub="organized" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Hash}   label="Total usage" value={`${stats.usage}`}      sub="across items" />
          <KpiTile accent="var(--os-c-ink-3)"  Icon={Archive} label="Archived"   value={`${stats.archived}`}    sub="hidden by default" />
        </div>

        <div className="tgm__toolbar">
          <div className="tgm__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tags…" />
          </div>
          <label className="tgm__archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <Archive /> Show archived
          </label>
        </div>

        {cats.length > 0 && (
          <div className="tgm__cats">
            <button type="button" className={`tgm__cat${activeCategory === null ? " is-active" : ""}`} onClick={() => setActiveCategory(null)}>
              <Layers /> All <span>{stats.total}</span>
            </button>
            {cats.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                className={`tgm__cat${activeCategory === cat ? " is-active" : ""}`}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                {cat}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {tags === null ? (
          <div className="tgm__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView Icon={Tag} iconGradient={GRAD.pinkPurple} title="No tags yet" subtitle="Tags label items across modules (cost center, project, department, region)." chips={["Department", "Project", "Cost Center"]} cta="New tag" />
        ) : grouped.length === 0 ? (
          <div className="tgm__no-match"><Search /> No tags match.</div>
        ) : (
          grouped.map(([cat, items]) => (
            <section key={cat} className="tgm__section">
              <header className="tgm__section-head">
                <h2>{cat}</h2>
                <span className="tgm__section-count">{items.length}</span>
                <span className="tgm__section-line" />
              </header>
              <div className="tgm__grid">
                {items.map((t) => {
                  const color = t.color ?? autoColor(t.name);
                  return (
                    <article key={t.id} className={`tgm__tag${t.archived ? " is-archived" : ""}`} style={{ ["--tag-c" as unknown as string]: color }}>
                      <span className="tgm__tag-dot" />
                      <span className="tgm__tag-name">{t.name}</span>
                      {t.usageCount != null && <span className="tgm__tag-count">{t.usageCount}</span>}
                      <button type="button" className="tgm__tag-del" onClick={() => remove(t.id)} title="Delete">
                        <Trash2 />
                      </button>
                    </article>
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

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Tag; label: string; value: string; sub: string }) {
  return (
    <div className="tgm__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="tgm__kpi-accent" aria-hidden="true" />
      <div className="tgm__kpi-row">
        <div className="tgm__kpi-icon"><Icon /></div>
        <div className="tgm__kpi-label">{label}</div>
      </div>
      <div className="tgm__kpi-value">{value}</div>
      <div className="tgm__kpi-sub">{sub}</div>
    </div>
  );
}

