"use client";

/* Learning · Catalog — discover & self-enroll in courses.
 *
 * GET  /api/courses
 * GET  /api/enrollments?scope=mine
 * POST /api/enrollments  { courseId }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  GraduationCap, Clock, Search, BadgeAlert, CheckCircle2, ChevronRight, Hash,
  Layers, BookOpen, Play, Activity,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiCourse = {
  id: string; title: string; description?: string | null;
  category?: string | null; duration?: number | null; mandatory: boolean;
  _count?: { enrollments?: number };
};
type ApiEnrol = { id: string; courseId: string; progress: number; completedAt?: string | null };

const PALETTE = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
function categoryColor(name: string) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function CatalogPage() {
  const [courses, setCourses] = useState<ApiCourse[] | null>(null);
  const [mine, setMine] = useState<ApiEnrol[]>([]);
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [mandOnly, setMandOnly] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [cRes, eRes] = await Promise.all([
        fetch("/api/courses"),
        fetch("/api/enrollments?scope=mine&limit=200"),
      ]);
      if (!cRes.ok) throw new Error(`courses ${cRes.status}`);
      const c = await cRes.json();
      setCourses(c.data ?? (Array.isArray(c) ? c : []));
      if (eRes.ok) {
        const e = await eRes.json();
        setMine(e.data ?? (Array.isArray(e) ? e : []));
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("learning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const myMap = useMemo(() => new Map(mine.map((e) => [e.courseId, e])), [mine]);

  const filtered = useMemo(() => {
    let list = courses ?? [];
    if (activeCat) list = list.filter((c) => (c.category ?? "Uncategorized") === activeCat);
    if (mandOnly) list = list.filter((c) => c.mandatory);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q) ||
        (c.category ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [courses, activeCat, mandOnly, search]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of courses ?? []) {
      const k = c.category ?? "Uncategorized";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [courses]);

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

  async function enroll(courseId: string) {
    setBusyId(courseId);
    try {
      const res = await fetch("/api/enrollments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Enrolled — check My learning");
      void load();
    } catch { toast("Couldn't enroll"); }
    setBusyId(null);
  }

  const stats = useMemo(() => {
    const list = courses ?? [];
    const mandatory = list.filter((c) => c.mandatory).length;
    const enrolled = mine.length;
    const completed = mine.filter((e) => e.completedAt).length;
    return { total: list.length, mandatory, enrolled, completed };
  }, [courses, mine]);

  return (
    <>
      <OsTitleBar
        title="Course catalog"
        Icon={GraduationCap}
        iconGradient={GRAD.orangePink}
        description={courses === null ? "Loading…" : `${stats.total} course${stats.total === 1 ? "" : "s"} · ${stats.mandatory} mandatory · ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`}
        actions={
          <div className="lcat__head-actions">
            <Link href="/learning" className="lcat__nav-link"><Hash /> Learning</Link>
            <Link href="/learning/mine" className="lcat__nav-link"><BookOpen /> My learning</Link>
          </div>
        }
      />

      <div className="lcat">
        <div className="lcat__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={GraduationCap} label="Available"   value={`${stats.total}`}     sub="in catalog" />
          <KpiTile accent="var(--os-c-red)"    Icon={BadgeAlert}    label="Mandatory"   value={`${stats.mandatory}`} sub="required" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Play}          label="My active"   value={`${stats.enrolled - stats.completed}`} sub="in progress" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2}  label="My completed" value={`${stats.completed}`} sub="finished" />
        </div>

        <div className="lcat__toolbar">
          <div className="lcat__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses…" />
          </div>
          <label className="lcat__mand-toggle">
            <input type="checkbox" checked={mandOnly} onChange={(e) => setMandOnly(e.target.checked)} />
            <BadgeAlert /> Mandatory only
          </label>
          {(search.trim() || activeCat || mandOnly) && (
            <button type="button" className="lcat__clear" onClick={() => { setSearch(""); setActiveCat(null); setMandOnly(false); }}>
              Clear
            </button>
          )}
        </div>

        {cats.length > 0 && (
          <div className="lcat__cats">
            <button type="button" className={`lcat__cat${!activeCat ? " is-active" : ""}`} onClick={() => setActiveCat(null)}>
              <Layers /> All <span>{stats.total}</span>
            </button>
            {cats.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                className={`lcat__cat${activeCat === cat ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: categoryColor(cat) }}
                onClick={() => setActiveCat(activeCat === cat ? null : cat)}
              >
                <span className="lcat__cat-dot" />
                {cat}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={GraduationCap} iconGradient={GRAD.redPink} title="Couldn't load courses" subtitle={loadError} cta="Retry" />
        ) : courses === null ? (
          <div className="lcat__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={GraduationCap}
            iconGradient={GRAD.orangePink}
            title="No courses yet"
            subtitle="When admin publishes courses, they show up here for self-enrollment."
            chips={["Compliance", "Onboarding", "Security", "Leadership"]}
          />
        ) : grouped.length === 0 ? (
          <div className="lcat__no-match"><Search /> No courses match.</div>
        ) : (
          grouped.map((g) => (
            <section key={g.cat} className="lcat__section" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="lcat__section-head">
                <span className="lcat__section-dot" />
                <h2>{g.cat}</h2>
                <span className="lcat__section-count">{g.items.length} course{g.items.length === 1 ? "" : "s"}</span>
                <span className="lcat__section-line" />
              </header>
              <div className="lcat__grid">
                {g.items.map((c) => {
                  const e = myMap.get(c.id);
                  const isDone = e?.completedAt != null;
                  const inProgress = e && !isDone;
                  return (
                    <article key={c.id} className={`lcat__course${c.mandatory ? " is-mandatory" : ""}`} style={{ ["--card-c" as unknown as string]: g.color }}>
                      <header className="lcat__course-head">
                        <h3>{c.title}</h3>
                        {c.mandatory && <span className="lcat__course-mand"><BadgeAlert /> Mandatory</span>}
                      </header>
                      {c.description && <p className="lcat__course-desc">{c.description.length > 140 ? c.description.slice(0, 140) + "…" : c.description}</p>}
                      <div className="lcat__course-meta">
                        {c.duration && <span><Clock /> {c.duration}min</span>}
                        <span><Activity /> {c._count?.enrollments ?? 0} enrolled</span>
                      </div>
                      <footer className="lcat__course-foot">
                        {isDone ? (
                          <span className="lcat__course-done"><CheckCircle2 /> Completed</span>
                        ) : inProgress ? (
                          <Link href="/learning/mine" className="lcat__course-btn lcat__course-btn--continue">
                            Continue ({e.progress}%) <ChevronRight />
                          </Link>
                        ) : (
                          <button type="button" className="lcat__course-btn lcat__course-btn--primary" disabled={busyId === c.id} onClick={() => enroll(c.id)}>
                            {busyId === c.id ? "Enrolling…" : "Enroll"} <ChevronRight />
                          </button>
                        )}
                      </footer>
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

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof GraduationCap; label: string; value: string; sub: string }) {
  return (
    <div className="lcat__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="lcat__kpi-accent" aria-hidden="true" />
      <div className="lcat__kpi-row">
        <div className="lcat__kpi-icon"><Icon /></div>
        <div className="lcat__kpi-label">{label}</div>
      </div>
      <div className="lcat__kpi-value">{value}</div>
      <div className="lcat__kpi-sub">{sub}</div>
    </div>
  );
}
