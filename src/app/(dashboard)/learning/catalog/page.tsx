"use client";

/* Learning · Catalog — discover & self-enrol in courses.
 *
 * Course cards grouped by category. Search + category-filter chips.
 * Each card: title, duration, mandatory badge, current enrolment
 * count, and a context-aware action button:
 *   - "Enrol"      if not enrolled
 *   - "Continue X%" if in progress
 *   - "Completed ✓" if done
 *
 * GET  /api/courses
 * GET  /api/enrollments?scope=mine
 * POST /api/enrollments  { courseId }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GraduationCap, Clock, Search, BadgeAlert, CheckCircle2, ChevronRight } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiCourse = {
  id: string; title: string; description?: string | null;
  category?: string | null; duration?: number | null; mandatory: boolean;
  _count?: { enrollments?: number };
};
type ApiEnrol = { id: string; courseId: string; progress: number; completedAt?: string | null };

export default function CatalogPage() {
  const [courses, setCourses] = useState<ApiCourse[] | null>(null);
  const [mine, setMine] = useState<ApiEnrol[]>([]);
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
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
    if (activeCat) list = list.filter((c) => (c.category ?? "Uncategorised") === activeCat);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q) ||
        (c.category ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [courses, activeCat, search]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of courses ?? []) {
      const k = c.category ?? "Uncategorised";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [courses]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiCourse[]>();
    for (const c of filtered) {
      const k = c.category ?? "Uncategorised";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function enrol(courseId: string) {
    setBusyId(courseId);
    try {
      const res = await fetch("/api/enrollments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Enrolled — check My learning");
      void load();
    } catch { toast("Couldn't enrol"); }
    setBusyId(null);
  }

  const total = courses?.length ?? 0;
  const mandatoryCount = (courses ?? []).filter((c) => c.mandatory).length;

  return (
    <div className="learn">
      <header className="learn__head">
        <div className="learn__head-l">
          <div className="learn__icon" style={{ background: "linear-gradient(135deg, var(--os-c-orange), var(--os-c-pink))" }}><GraduationCap /></div>
          <div>
            <h1 className="learn__title">Course catalog</h1>
            <div className="learn__sub">
              {courses === null ? "Loading…" : `${total} course${total === 1 ? "" : "s"} · ${mandatoryCount} mandatory · ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`}
            </div>
          </div>
        </div>
        <div className="learn__actions">
          <div className="learn__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses…" />
          </div>
          <Link href="/learning/mine" className="learn__link">My learning →</Link>
        </div>
      </header>

      <nav className="learn__cats">
        <button type="button" className={!activeCat ? "is-active" : ""} onClick={() => setActiveCat(null)}>All <em>{total}</em></button>
        {cats.map(([cat, n]) => (
          <button key={cat} type="button" className={activeCat === cat ? "is-active" : ""} onClick={() => setActiveCat(cat)}>{cat} <em>{n}</em></button>
        ))}
      </nav>

      {loadError ? (
        <div className="learn__error">{loadError}</div>
      ) : courses === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="learn__empty">
          <GraduationCap />
          <div>
            <h3>{search ? "Nothing matches that search." : "No courses yet"}</h3>
            <p>{search ? "Try a different term." : "When admin publishes courses, they show up here for self-enrolment."}</p>
          </div>
        </div>
      ) : (
        <div className="learn__sections">
          {grouped.map(([cat, items]) => (
            <section key={cat} className="learn__section">
              <header className="learn__section-head"><h2>{cat}</h2><span>{items.length}</span></header>
              <div className="learn__grid">
                {items.map((c) => {
                  const e = myMap.get(c.id);
                  const isDone = e?.completedAt != null;
                  const inProgress = e && !isDone;
                  return (
                    <article key={c.id} className={`course ${c.mandatory ? "is-mandatory" : ""}`}>
                      <header className="course__head">
                        <h3>{c.title}</h3>
                        {c.mandatory && <span className="course__mand"><BadgeAlert /> Mandatory</span>}
                      </header>
                      {c.description && <p className="course__desc">{c.description.length > 140 ? c.description.slice(0, 140) + "…" : c.description}</p>}
                      <div className="course__meta">
                        {c.duration && <span><Clock /> {c.duration}min</span>}
                        <span>{c._count?.enrollments ?? 0} enrolled</span>
                      </div>
                      <footer className="course__foot">
                        {isDone ? (
                          <span className="course__done"><CheckCircle2 /> Completed</span>
                        ) : inProgress ? (
                          <Link href="/learning/mine" className="course__btn course__btn--continue">
                            Continue ({e.progress}%) <ChevronRight />
                          </Link>
                        ) : (
                          <button type="button" className="course__btn course__btn--primary" disabled={busyId === c.id} onClick={() => enrol(c.id)}>
                            {busyId === c.id ? "Enrolling…" : "Enrol"}
                          </button>
                        )}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
