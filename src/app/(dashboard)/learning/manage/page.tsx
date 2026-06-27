"use client";

/* Learning · Manage — admin's course catalog with adoption stats.
 *
 * GET  /api/courses
 * POST /api/courses
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Settings as SettingsIcon, Plus, BadgeAlert, Users as UsersIcon, ChevronRight,
  Search, Hash, GraduationCap, BookOpen, Trophy, Layers,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";

type ApiCourse = {
  id: string; title: string; description?: string | null;
  category?: string | null; duration?: number | null; mandatory: boolean;
  _count?: { enrollments?: number };
};
type ApiEnrol = { id: string; courseId: string; completedAt?: string | null; progress: number };

const PALETTE = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
function categoryColor(name: string) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function rateHue(pct: number) {
  if (pct >= 90) return "var(--os-c-green)";
  if (pct >= 70) return "var(--os-c-teal)";
  if (pct >= 40) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}

export default function LearningManagePage() {
  const [courses, setCourses] = useState<ApiCourse[] | null>(null);
  const [enrols, setEnrols] = useState<ApiEnrol[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const promptDialog = usePrompt();

  const load = useCallback(async () => {
    try {
      const [cRes, eRes] = await Promise.all([
        fetch("/api/courses"),
        fetch("/api/enrollments?scope=all&limit=500"),
      ]);
      if (!cRes.ok) throw new Error(`courses ${cRes.status}`);
      const c = await cRes.json();
      setCourses(c.data ?? (Array.isArray(c) ? c : []));
      if (eRes.ok) {
        const e = await eRes.json();
        setEnrols(e.data ?? (Array.isArray(e) ? e : []));
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("learning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const title = (await promptDialog({ title: "Course title?" }))?.trim();
    if (!title) return;
    const cat = (await promptDialog({ title: "Category? (optional)" }))?.trim() || undefined;
    const mand = await confirm({ title: "Mandatory for all employees?", confirmLabel: "Yes" });
    try {
      const res = await fetch("/api/courses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category: cat, mandatory: mand }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't create"); return; }
      toast("Course created");
      void load();
    } catch { toast("Couldn't create"); }
  }

  const courseStats = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const e of enrols) {
      if (!e.courseId) continue;
      if (!m.has(e.courseId)) m.set(e.courseId, { total: 0, done: 0 });
      const s = m.get(e.courseId)!;
      s.total += 1;
      if (e.completedAt) s.done += 1;
    }
    return m;
  }, [enrols]);

  const filtered = useMemo(() => {
    let list = courses ?? [];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q) ||
      (c.category ?? "").toLowerCase().includes(q));
    return list;
  }, [courses, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiCourse[]>();
    for (const c of filtered) {
      const k = c.category ?? "Uncategorized";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => ({ cat, color: categoryColor(cat), items: items.slice().sort((a, b) => a.title.localeCompare(b.title)) }));
  }, [filtered]);

  const stats = useMemo(() => {
    const total = courses?.length ?? 0;
    const mandatory = (courses ?? []).filter((c) => c.mandatory).length;
    const totalEnrols = enrols.length;
    const totalDone = enrols.filter((e) => e.completedAt).length;
    const rate = totalEnrols > 0 ? Math.round((totalDone / totalEnrols) * 100) : 0;
    return { total, mandatory, totalEnrols, totalDone, rate };
  }, [courses, enrols]);

  return (
    <>
      <OsTitleBar
        title="Manage courses"
        Icon={SettingsIcon}
        iconGradient={GRAD.purpleIndigo}
        description={courses === null ? "Loading…" : `${stats.total} course${stats.total === 1 ? "" : "s"} · ${stats.mandatory} mandatory · ${stats.totalEnrols} enrollments · ${stats.rate}% completion`}
        actions={
          <div className="lmgr__head-actions">
            <Link href="/learning" className="lmgr__nav-link"><Hash /> Learning</Link>
            <Link href="/learning/catalog" className="lmgr__nav-link"><Layers /> Catalog</Link>
            <button type="button" className="lmgr__btn-primary" onClick={quickAdd}>
              <Plus /> New course
            </button>
          </div>
        }
      />

      <div className="lmgr">
        <div className="lmgr__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={GraduationCap} label="Courses"     value={`${stats.total}`}        sub={`${stats.mandatory} mandatory`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={UsersIcon}     label="Enrollments" value={`${stats.totalEnrols}`} sub={`${stats.totalDone} completed`} />
          <KpiTile accent={rateHue(stats.rate)} Icon={Trophy}       label="Completion"  value={`${stats.rate}%`}        sub="org-wide" />
          <KpiTile accent="var(--os-c-purple)" Icon={BookOpen}      label="Categories"  value={`${grouped.length}`}     sub="organized" />
        </div>

        <div className="lmgr__toolbar">
          <div className="lmgr__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses, descriptions…" />
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={SettingsIcon} iconGradient={GRAD.redPink} title="Couldn't load" subtitle={loadError} cta="Retry" />
        ) : courses === null ? (
          <div className="lmgr__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={SettingsIcon}
            iconGradient={GRAD.purpleIndigo}
            title="No courses yet"
            subtitle="Add your first course — name it, give it a category, mark it mandatory if all employees must complete it."
            chips={["Compliance", "Onboarding", "Security", "Leadership"]}
            cta="New course"
          />
        ) : (
          grouped.map((g) => (
            <section key={g.cat} className="lmgr__section" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="lmgr__section-head">
                <span className="lmgr__section-dot" />
                <h2>{g.cat}</h2>
                <span className="lmgr__section-count">{g.items.length} course{g.items.length === 1 ? "" : "s"}</span>
                <span className="lmgr__section-line" />
              </header>
              <div className="lmgr__table">
                <div className="lmgr__row lmgr__row--head">
                  <span>Course</span>
                  <span className="text-right">Duration</span>
                  <span className="text-right">Enrolled</span>
                  <span>Completion</span>
                  <span></span>
                </div>
                {g.items.map((c) => {
                  const s = courseStats.get(c.id) ?? { total: 0, done: 0 };
                  const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
                  return (
                    <div key={c.id} className="lmgr__row">
                      <div className="lmgr__row-main">
                        <div className="lmgr__row-title">{c.title}{c.mandatory && <span className="lmgr__row-mand"><BadgeAlert /> Mandatory</span>}</div>
                        {c.description && <div className="lmgr__row-desc">{c.description.length > 100 ? c.description.slice(0, 100) + "…" : c.description}</div>}
                      </div>
                      <span className="lmgr__row-dur text-right">{c.duration ? `${c.duration}min` : "—"}</span>
                      <span className="lmgr__row-num text-right">{s.total}</span>
                      <div className="lmgr__row-compl">
                        <div className="lmgr__row-bar"><div className="lmgr__row-bar-fill" style={{ width: `${pct}%`, background: rateHue(pct) }} /></div>
                        <span style={{ color: rateHue(pct) }}>{pct}% <em>· {s.done}/{s.total}</em></span>
                      </div>
                      <ChevronRight className="lmgr__row-arrow" />
                    </div>
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

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof SettingsIcon; label: string; value: string; sub: string }) {
  return (
    <div className="lmgr__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="lmgr__kpi-accent" aria-hidden="true" />
      <div className="lmgr__kpi-row">
        <div className="lmgr__kpi-icon"><Icon /></div>
        <div className="lmgr__kpi-label">{label}</div>
      </div>
      <div className="lmgr__kpi-value">{value}</div>
      <div className="lmgr__kpi-sub">{sub}</div>
    </div>
  );
}
