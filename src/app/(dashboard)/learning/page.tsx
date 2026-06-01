"use client";

/* Learning hub — overview with KPI strip, category breakdown, and workspace tiles.
 *
 *  GET  /api/courses
 *  GET  /api/enrollments?scope=all
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  GraduationCap, BookOpen, Settings as SettingsIcon, Layers, Hash, ChevronRight,
  TrendingUp, Users as UsersIcon, BadgeAlert, Trophy, Activity, ClipboardCheck,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiCourse = {
  id: string;
  title: string;
  category?: string | null;
  duration?: number | null;
  mandatory: boolean;
  createdAt: string;
  _count?: { enrollments?: number };
};
type ApiEnrol = { id: string; courseId: string; completedAt?: string | null; progress: number };

function rateHue(pct: number) {
  if (pct >= 90) return "var(--os-c-green)";
  if (pct >= 70) return "var(--os-c-teal)";
  if (pct >= 40) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}

export default function LearningHubPage() {
  const [courses, setCourses] = useState<ApiCourse[] | null>(null);
  const [enrols, setEnrols] = useState<ApiEnrol[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [cR, eR] = await Promise.all([
        fetch("/api/courses"),
        fetch("/api/enrollments?scope=all&limit=500").catch(() => null),
      ]);
      if (!cR.ok) throw new Error(`courses ${cR.status}`);
      const c = await cR.json();
      setCourses(c.data ?? (Array.isArray(c) ? c : []));
      if (eR && eR.ok) {
        const e = await eR.json();
        setEnrols(e.data ?? (Array.isArray(e) ? e : []));
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("learning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = courses ?? [];
    const mandatory = list.filter((c) => c.mandatory).length;
    const enrolTotal = enrols.length;
    const done = enrols.filter((e) => e.completedAt).length;
    const completionRate = enrolTotal > 0 ? Math.round((done / enrolTotal) * 100) : 0;
    const cats = new Set(list.map((c) => c.category ?? "Uncategorized"));
    return { total: list.length, mandatory, enrolTotal, done, completionRate, catCount: cats.size };
  }, [courses, enrols]);

  const categories = useMemo(() => {
    const m = new Map<string, { courses: number; done: number; enrolled: number }>();
    for (const c of courses ?? []) {
      const k = c.category ?? "Uncategorized";
      if (!m.has(k)) m.set(k, { courses: 0, done: 0, enrolled: 0 });
      const e = m.get(k)!;
      e.courses += 1;
    }
    for (const e of enrols) {
      const course = (courses ?? []).find((c) => c.id === e.courseId);
      if (!course) continue;
      const k = course.category ?? "Uncategorized";
      const row = m.get(k);
      if (!row) continue;
      row.enrolled += 1;
      if (e.completedAt) row.done += 1;
    }
    return Array.from(m.entries())
      .sort(([, a], [, b]) => b.courses - a.courses)
      .slice(0, 6);
  }, [courses, enrols]);

  const recentCourses = useMemo(() => {
    return (courses ?? []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  }, [courses]);

  const loading = courses === null;

  return (
    <>
      <OsTitleBar
        title="Learning"
        Icon={GraduationCap}
        iconGradient={GRAD.indigoBlue}
        description={loading ? "Loading catalog…" : `${stats.total} course${stats.total === 1 ? "" : "s"} · ${stats.mandatory} mandatory · ${stats.completionRate}% completion rate`}
        actions={
          <div className="lhub__head-actions">
            <Link href="/learning/catalog" className="lhub__nav-link"><Layers /> Catalog</Link>
            <Link href="/learning/mine" className="lhub__nav-link"><BookOpen /> My learning</Link>
            <Link href="/learning/manage" className="lhub__btn-primary"><SettingsIcon /> Manage</Link>
          </div>
        }
      />

      <div className="lhub">
        {loadError ? (
          <OsEmptyView Icon={GraduationCap} iconGradient={GRAD.redPink} title="Couldn't load learning" subtitle={loadError} cta="Retry" />
        ) : (
          <>
            <div className="lhub__kpis">
              <KpiTile accent="var(--os-c-indigo)" Icon={GraduationCap} label="Courses"        value={`${stats.total}`}        sub={`${stats.catCount} categor${stats.catCount === 1 ? "y" : "ies"}`} />
              <KpiTile accent="var(--os-c-red)"    Icon={BadgeAlert}    label="Mandatory"      value={`${stats.mandatory}`}    sub="org-wide required" />
              <KpiTile accent="var(--os-c-blue)"   Icon={UsersIcon}     label="Enrollments"    value={`${stats.enrolTotal}`}   sub={`${stats.done} completed`} />
              <KpiTile accent={rateHue(stats.completionRate)} Icon={Trophy} label="Completion rate" value={`${stats.completionRate}%`} sub="org-wide" />
            </div>

            <section className="lhub__section">
              <header className="lhub__section-head">
                <h2><Hash /> Workspaces</h2>
                <span className="lhub__section-line" />
              </header>
              <div className="lhub__grid">
                <HubTile href="/learning/catalog" Icon={Layers} hue="var(--os-c-pink)"
                  title="Course catalog" stat={`${stats.total}`} sub="self-enroll" />
                <HubTile href="/learning/mine" Icon={BookOpen} hue="var(--os-c-teal)"
                  title="My learning" stat="In progress" sub="continue where you left off" />
                <HubTile href="/learning/manage" Icon={SettingsIcon} hue="var(--os-c-purple)"
                  title="Course admin" stat={`${stats.total}`} sub="create + assign" />
                <HubTile href="/onboarding" Icon={ClipboardCheck} hue="var(--os-c-orange)"
                  title="Onboarding" stat="Program" sub="new hire path" />
              </div>
            </section>

            {categories.length > 0 && (
              <section className="lhub__section">
                <header className="lhub__section-head">
                  <h2><TrendingUp /> Top categories</h2>
                  <span className="lhub__section-line" />
                </header>
                <div className="lhub__cats">
                  {categories.map(([cat, c]) => {
                    const pct = c.enrolled > 0 ? Math.round((c.done / c.enrolled) * 100) : 0;
                    return (
                      <article key={cat} className="lhub__cat-card">
                        <header>
                          <h3>{cat}</h3>
                          <span style={{ color: rateHue(pct) }}>{pct}%</span>
                        </header>
                        <div className="lhub__cat-bar">
                          <div className="lhub__cat-bar-fill" style={{ width: `${pct}%`, background: rateHue(pct) }} />
                        </div>
                        <div className="lhub__cat-meta">
                          <span>{c.courses} course{c.courses === 1 ? "" : "s"}</span>
                          <span>{c.enrolled} enrolled</span>
                          <span>{c.done} done</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {recentCourses.length > 0 && (
              <section className="lhub__section">
                <header className="lhub__section-head">
                  <h2><Activity /> Recently added</h2>
                  <span className="lhub__section-line" />
                  <Link href="/learning/catalog" className="lhub__section-more">all <ChevronRight /></Link>
                </header>
                <div className="lhub__recent">
                  {recentCourses.map((c) => (
                    <Link key={c.id} href="/learning/catalog" className="lhub__course">
                      <span className="lhub__course-icon"><GraduationCap /></span>
                      <div className="lhub__course-main">
                        <div className="lhub__course-title">{c.title}{c.mandatory && <span className="lhub__course-mand"><BadgeAlert /> Mandatory</span>}</div>
                        <div className="lhub__course-meta">
                          {c.category && <span>{c.category}</span>}
                          {c.duration && <span>· {c.duration}min</span>}
                          <span>· {c._count?.enrollments ?? 0} enrolled</span>
                          <span>· added {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        </div>
                      </div>
                      <ChevronRight className="lhub__course-arrow" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof GraduationCap; label: string; value: string; sub: string }) {
  return (
    <div className="lhub__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="lhub__kpi-accent" aria-hidden="true" />
      <div className="lhub__kpi-row">
        <div className="lhub__kpi-icon"><Icon /></div>
        <div className="lhub__kpi-label">{label}</div>
      </div>
      <div className="lhub__kpi-value">{value}</div>
      <div className="lhub__kpi-sub">{sub}</div>
    </div>
  );
}

function HubTile({ href, Icon, hue, title, stat, sub }: { href: string; Icon: typeof GraduationCap; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="lhub__tile" style={{ ["--tile-hue" as unknown as string]: hue }}>
      <span className="lhub__tile-icon"><Icon /></span>
      <div className="lhub__tile-body">
        <div className="lhub__tile-title">{title}</div>
        <div className="lhub__tile-stat">{stat}</div>
        <div className="lhub__tile-sub">{sub}</div>
      </div>
      <ChevronRight className="lhub__tile-chev" />
    </Link>
  );
}

