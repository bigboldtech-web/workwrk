"use client";

/* Learning · Mine — my enrolments + progress.
 *
 * Three sections: In progress (with progress bars) · Mandatory not
 * started (red flag) · Completed (with score chips). Each row shows
 * course title, category, duration, progress %, score, start/complete
 * dates. Continue button advances the user to the course player (v2;
 * for now it links to /learning/catalog).
 *
 * GET   /api/enrollments?scope=mine
 * GET   /api/courses (for mandatory cross-reference)
 * PATCH /api/enrollments/[id]  { progress, score? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, BadgeAlert, CheckCircle2, Clock, Play, Trophy } from "lucide-react";
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
  const completedScore = completed.reduce((acc, e) => acc + (e.score ?? 0), 0);
  const avgScore = completed.length > 0 ? completedScore / completed.length : 0;

  return (
    <div className="myl">
      <header className="myl__head">
        <div className="myl__head-l">
          <div className="myl__icon" style={{ background: "linear-gradient(135deg, var(--os-c-teal), var(--os-c-green))" }}><BookOpen /></div>
          <div>
            <h1 className="myl__title">My learning</h1>
            <div className="myl__sub">
              {enrols === null ? "Loading…" :
                `${inProgress.length} in progress · ${completed.length} completed${avgScore > 0 ? ` · avg score ${avgScore.toFixed(0)}%` : ""}${mandatoryNotStarted.length > 0 ? ` · ${mandatoryNotStarted.length} mandatory pending` : ""}`}
            </div>
          </div>
        </div>
        <Link href="/learning/catalog" className="myl__link">Browse catalog →</Link>
      </header>

      {loadError ? (
        <div className="myl__error">{loadError}</div>
      ) : enrols === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {mandatoryNotStarted.length > 0 && (
            <section className="myl__section myl__section--alert">
              <header><BadgeAlert /> <h2>Mandatory — not started yet</h2><span>{mandatoryNotStarted.length}</span></header>
              <div className="myl__list">
                {mandatoryNotStarted.map((c) => (
                  <div key={c.id} className="myl-row myl-row--alert">
                    <div className="myl-row__main">
                      <div className="myl-row__title">{c.title}</div>
                      <div className="myl-row__meta">{c.category ?? "—"}{c.duration ? ` · ${c.duration}min` : ""}</div>
                    </div>
                    <Link href="/learning/catalog" className="myl-row__btn myl-row__btn--alert"><Play /> Start now</Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="myl__section">
            <header><Play /> <h2>In progress</h2><span>{inProgress.length}</span></header>
            {inProgress.length === 0 ? (
              <div className="myl__empty">Nothing in progress. Browse the catalog to pick something up.</div>
            ) : (
              <div className="myl__list">
                {inProgress.map((e) => (
                  <article key={e.id} className="myl-row">
                    <div className="myl-row__main">
                      <div className="myl-row__title">{e.course?.title ?? "Untitled"}{e.course?.mandatory && <span className="myl-row__mand">Mandatory</span>}</div>
                      <div className="myl-row__meta">
                        <Clock /> {e.course?.duration ?? "?"}min · started {new Date(e.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                      <div className="myl-row__bar"><div className="myl-row__bar-fill" style={{ width: `${e.progress}%` }} /></div>
                    </div>
                    <div className="myl-row__right">
                      <span className="myl-row__pct">{e.progress}%</span>
                      <Link href="/learning/catalog" className="myl-row__btn"><Play /> Continue</Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {completed.length > 0 && (
            <section className="myl__section">
              <header><Trophy /> <h2>Completed</h2><span>{completed.length}</span></header>
              <div className="myl__list">
                {completed.slice(0, 12).map((e) => (
                  <article key={e.id} className="myl-row myl-row--done">
                    <CheckCircle2 className="myl-row__done-icon" />
                    <div className="myl-row__main">
                      <div className="myl-row__title">{e.course?.title ?? "Untitled"}</div>
                      <div className="myl-row__meta">Completed {e.completedAt ? new Date(e.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</div>
                    </div>
                    {e.score != null && (
                      <span className={`myl-row__score ${e.score >= 80 ? "is-pass" : e.score >= 60 ? "is-mid" : "is-low"}`}>
                        {e.score.toFixed(0)}%
                      </span>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
