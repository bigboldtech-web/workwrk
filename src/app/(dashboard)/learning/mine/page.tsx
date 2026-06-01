"use client";

/* Learning · Mine — my enrollments + progress.
 *
 * GET   /api/enrollments?scope=mine
 * GET   /api/courses (for mandatory cross-reference)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen, BadgeAlert, CheckCircle2, Clock, Play, Trophy, Hash, ChevronRight,
  Layers, Activity, GraduationCap,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiEnrol = {
  id: string; progress: number; score?: number | null;
  startedAt: string; completedAt?: string | null;
  course?: { id: string; title: string; mandatory: boolean; duration?: number | null; category?: string | null } | null;
};
type ApiCourse = { id: string; title: string; mandatory: boolean; category?: string | null; duration?: number | null };

export default function MyLearningPage() {
  const [enrols, setEnrols] = useState<ApiEnrol[] | null>(null);
  const [courses, setCourses] = useState<ApiCourse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [eRes, cRes] = await Promise.all([
        fetch("/api/enrollments?scope=mine&limit=200"),
        fetch("/api/courses"),
      ]);
      if (!eRes.ok) throw new Error(`enrols ${eRes.status}`);
      const e = await eRes.json();
      setEnrols(e.data ?? (Array.isArray(e) ? e : []));
      if (cRes.ok) {
        const c = await cRes.json();
        setCourses(c.data ?? (Array.isArray(c) ? c : []));
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("learning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const enrolledIds = useMemo(() => new Set((enrols ?? []).map((e) => e.course?.id).filter(Boolean) as string[]), [enrols]);
  const mandatoryNotStarted = useMemo(() => (courses ?? []).filter((c) => c.mandatory && !enrolledIds.has(c.id)), [courses, enrolledIds]);

  const inProgress = (enrols ?? []).filter((e) => !e.completedAt);
  const completed = (enrols ?? []).filter((e) => e.completedAt);
  const avgScore = completed.length > 0 ? completed.reduce((a, e) => a + (e.score ?? 0), 0) / completed.length : 0;
  const avgProgress = inProgress.length > 0 ? Math.round(inProgress.reduce((a, e) => a + (e.progress ?? 0), 0) / inProgress.length) : 0;

  return (
    <>
      <OsTitleBar
        title="My learning"
        Icon={BookOpen}
        iconGradient={GRAD.tealGreen}
        description={enrols === null ? "Loading…" :
          `${inProgress.length} in progress · ${completed.length} completed${avgScore > 0 ? ` · avg ${avgScore.toFixed(0)}%` : ""}${mandatoryNotStarted.length > 0 ? ` · ${mandatoryNotStarted.length} mandatory pending` : ""}`}
        actions={
          <div className="myl__head-actions">
            <Link href="/learning" className="myl__nav-link"><Hash /> Learning</Link>
            <Link href="/learning/catalog" className="myl__nav-link"><Layers /> Catalog</Link>
          </div>
        }
      />

      <div className="myl">
        <div className="myl__kpis">
          <KpiTile accent="var(--os-c-red)"    Icon={BadgeAlert}   label="Mandatory pending" value={`${mandatoryNotStarted.length}`} sub="not started" />
          <KpiTile accent="var(--os-c-orange)" Icon={Play}         label="In progress"      value={`${inProgress.length}`}  sub={`avg ${avgProgress}%`} />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Completed"        value={`${completed.length}`}    sub="all time" />
          <KpiTile accent="var(--os-c-purple)" Icon={Trophy}       label="Avg score"        value={avgScore > 0 ? `${avgScore.toFixed(0)}%` : "—"} sub={completed.length > 0 ? "across completed" : "no scores yet"} />
        </div>

        {loadError ? (
          <OsEmptyView Icon={BookOpen} iconGradient={GRAD.redPink} title="Couldn't load" subtitle={loadError} cta="Retry" />
        ) : enrols === null ? (
          <div className="myl__loading">Loading…</div>
        ) : enrols.length === 0 && mandatoryNotStarted.length === 0 ? (
          <OsEmptyView
            Icon={BookOpen}
            iconGradient={GRAD.tealGreen}
            title="Nothing in your learning queue yet"
            subtitle="Browse the catalog to enroll in courses. Mandatory courses show up here automatically."
            chips={["Catalog", "Mandatory", "Optional"]}
            cta="Browse catalog"
          />
        ) : (
          <>
            {mandatoryNotStarted.length > 0 && (
              <section className="myl__section">
                <header className="myl__section-head">
                  <span className="myl__section-tag myl__section-tag--alert"><BadgeAlert /> Mandatory — not started</span>
                  <span className="myl__section-count">{mandatoryNotStarted.length}</span>
                  <span className="myl__section-line" />
                </header>
                <div className="myl__list">
                  {mandatoryNotStarted.map((c) => (
                    <article key={c.id} className="myl__row myl__row--alert">
                      <span className="myl__row-icon"><BadgeAlert /></span>
                      <div className="myl__row-main">
                        <div className="myl__row-title">{c.title}</div>
                        <div className="myl__row-meta">
                          {c.category && <span>{c.category}</span>}
                          {c.duration && <span>· {c.duration}min</span>}
                        </div>
                      </div>
                      <Link href="/learning/catalog" className="myl__row-btn myl__row-btn--alert">
                        <Play /> Start now
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {inProgress.length > 0 && (
              <section className="myl__section">
                <header className="myl__section-head">
                  <span className="myl__section-tag"><Activity /> In progress</span>
                  <span className="myl__section-count">{inProgress.length}</span>
                  <span className="myl__section-line" />
                </header>
                <div className="myl__list">
                  {inProgress.map((e) => (
                    <article key={e.id} className="myl__row">
                      <span className="myl__row-icon"><GraduationCap /></span>
                      <div className="myl__row-main">
                        <div className="myl__row-title">
                          {e.course?.title ?? "Untitled"}
                          {e.course?.mandatory && <span className="myl__row-mand"><BadgeAlert /> Mandatory</span>}
                        </div>
                        <div className="myl__row-meta">
                          <Clock /> {e.course?.duration ?? "?"}min · started {new Date(e.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                        <div className="myl__row-bar"><div className="myl__row-bar-fill" style={{ width: `${e.progress}%` }} /></div>
                      </div>
                      <div className="myl__row-right">
                        <span className="myl__row-pct">{e.progress}%</span>
                        <Link href="/learning/catalog" className="myl__row-btn">
                          <Play /> Continue
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {completed.length > 0 && (
              <section className="myl__section">
                <header className="myl__section-head">
                  <span className="myl__section-tag myl__section-tag--done"><Trophy /> Completed</span>
                  <span className="myl__section-count">{completed.length}</span>
                  <span className="myl__section-line" />
                </header>
                <div className="myl__list">
                  {completed.slice(0, 12).map((e) => (
                    <article key={e.id} className="myl__row myl__row--done">
                      <span className="myl__row-icon"><CheckCircle2 /></span>
                      <div className="myl__row-main">
                        <div className="myl__row-title">{e.course?.title ?? "Untitled"}</div>
                        <div className="myl__row-meta">Completed {e.completedAt ? new Date(e.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</div>
                      </div>
                      {e.score != null && (
                        <span className={`myl__row-score ${e.score >= 80 ? "is-pass" : e.score >= 60 ? "is-mid" : "is-low"}`}>
                          {e.score.toFixed(0)}%
                        </span>
                      )}
                      <ChevronRight className="myl__row-arrow" />
                    </article>
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

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof BookOpen; label: string; value: string; sub: string }) {
  return (
    <div className="myl__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="myl__kpi-accent" aria-hidden="true" />
      <div className="myl__kpi-row">
        <div className="myl__kpi-icon"><Icon /></div>
        <div className="myl__kpi-label">{label}</div>
      </div>
      <div className="myl__kpi-value">{value}</div>
      <div className="myl__kpi-sub">{sub}</div>
    </div>
  );
}
