"use client";

/* Learning · Manage — admin's course catalog.
 *
 * Course table with adoption stats (enrolled / completed / completion %)
 * grouped by category. Mandatory badge, quick-create via prompt.
 *
 * GET  /api/courses
 * POST /api/courses  { title, category?, duration?, mandatory? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Settings as SettingsIcon, Plus, BadgeAlert, Users as UsersIcon, ChevronRight } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiCourse = {
  id: string; title: string; description?: string | null;
  category?: string | null; duration?: number | null; mandatory: boolean;
  _count?: { enrollments?: number };
};
type ApiEnrol = { id: string; courseId: string; completedAt?: string | null; progress: number };

export default function LearningManagePage() {
  const [courses, setCourses] = useState<ApiCourse[] | null>(null);
  const [enrols, setEnrols] = useState<ApiEnrol[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

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
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("learning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const title = window.prompt("Course title?")?.trim();
    if (!title) return;
    const cat = window.prompt("Category? (optional)")?.trim() || undefined;
    const mand = window.confirm("Mandatory for all employees?");
    try {
      const res = await fetch("/api/courses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category: cat, mandatory: mand }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't create course"); }
  }

  const stats = useMemo(() => {
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

  const grouped = useMemo(() => {
    const m = new Map<string, ApiCourse[]>();
    for (const c of courses ?? []) {
      const k = c.category ?? "Uncategorised";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [courses]);

  const total = courses?.length ?? 0;
  const mandatoryCount = (courses ?? []).filter((c) => c.mandatory).length;
  const totalEnrols = enrols.length;
  const totalDone = enrols.filter((e) => e.completedAt).length;

  return (
    <div className="lmgmt">
      <header className="lmgmt__head">
        <div className="lmgmt__head-l">
          <div className="lmgmt__icon" style={{ background: "linear-gradient(135deg, var(--os-c-indigo), var(--os-c-purple))" }}><SettingsIcon /></div>
          <div>
            <h1 className="lmgmt__title">Manage courses</h1>
            <div className="lmgmt__sub">
              {courses === null ? "Loading…" : `${total} courses · ${mandatoryCount} mandatory · ${totalEnrols} enrolments · ${totalDone} completions`}
            </div>
          </div>
        </div>
        <div className="lmgmt__actions">
          <Link href="/learning/catalog" className="lmgmt__link">Catalog →</Link>
          <button type="button" className="lmgmt__new" onClick={quickAdd}><Plus /> New course</button>
        </div>
      </header>

      {loadError ? (
        <div className="lmgmt__error">{loadError}</div>
      ) : courses === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="lmgmt__empty">
          <SettingsIcon />
          <div>
            <h3>No courses yet</h3>
            <p>Add your first course — name it, give it a category, mark it mandatory if all employees must complete it.</p>
          </div>
        </div>
      ) : (
        <div className="lmgmt__sections">
          {grouped.map(([cat, items]) => (
            <section key={cat} className="lmgmt__section">
              <header><h2>{cat}</h2><span>{items.length} course{items.length === 1 ? "" : "s"}</span></header>
              <div className="lmgmt__table">
                <div className="lmgmt__row lmgmt__row--head">
                  <span>Course</span>
                  <span>Duration</span>
                  <span>Enrolled</span>
                  <span>Completion</span>
                  <span></span>
                </div>
                {items.map((c) => {
                  const s = stats.get(c.id) ?? { total: 0, done: 0 };
                  const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
                  return (
                    <div key={c.id} className="lmgmt__row">
                      <div>
                        <div className="lmgmt__title-cell">{c.title}{c.mandatory && <span className="lmgmt__mand"><BadgeAlert /> Mandatory</span>}</div>
                        {c.description && <div className="lmgmt__desc">{c.description.length > 100 ? c.description.slice(0, 100) + "…" : c.description}</div>}
                      </div>
                      <span className="lmgmt__dur">{c.duration ? `${c.duration}min` : "—"}</span>
                      <span className="lmgmt__num"><UsersIcon /> {s.total}</span>
                      <div className="lmgmt__compl">
                        <div className="lmgmt__bar"><div className="lmgmt__bar-fill" style={{ width: `${pct}%` }} /></div>
                        <span>{pct}% <em>· {s.done}/{s.total}</em></span>
                      </div>
                      <span className="lmgmt__chev"><ChevronRight /></span>
                    </div>
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
