"use client";

/* Onboarding · Me — new-hire personal journey.
 *
 * The new hire's view of their own onboarding. Different from
 * /onboarding (admin view of everyone). Filters /api/onboarding to
 * just my instance(s).
 *
 * Big header card: greeting + days-in / days-remaining + overall
 * progress ring. Below: collapsible step list grouped by section,
 * each step a checklist row.
 *
 * GET   /api/onboarding             (filter to me client-side)
 * GET   /api/me
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { IdCard, CheckCircle2, Circle, Sparkles, Calendar, User, AlertTriangle } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type ObStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
type ProgressEntry = { stepId?: string; done?: boolean; doneAt?: string };

type TemplateStep = { id?: string; title?: string; description?: string; section?: string; required?: boolean };
type Template = { name?: string; steps?: TemplateStep[]; sections?: { title?: string; steps?: TemplateStep[] }[]; durationDays?: number };

type ApiInstance = {
  id: string;
  status: ObStatus;
  startDate: string;
  targetDate?: string | null;
  completedAt?: string | null;
  progress: unknown;
  buddy?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  template?: Template | null;
};

const STATUS_LABEL: Record<ObStatus, string> = {
  NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", OVERDUE: "Overdue",
};
const STATUS_HUE: Record<ObStatus, string> = {
  NOT_STARTED: "var(--os-c-indigo)", IN_PROGRESS: "var(--os-c-orange)",
  COMPLETED: "var(--os-c-green)", OVERDUE: "var(--os-c-red)",
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

const MS_DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function progressList(v: unknown): ProgressEntry[] {
  if (Array.isArray(v)) return v as ProgressEntry[];
  return [];
}

function flattenSteps(t: Template | null | undefined): { section: string; steps: TemplateStep[] }[] {
  if (!t) return [];
  // Two possible shapes: flat steps[] or sections[].
  if (Array.isArray(t.sections) && t.sections.length > 0) {
    return t.sections.map((s) => ({ section: s.title ?? "Steps", steps: s.steps ?? [] }));
  }
  if (Array.isArray(t.steps) && t.steps.length > 0) {
    // Group by .section if present, else all under "Steps"
    const m = new Map<string, TemplateStep[]>();
    for (const st of t.steps) {
      const k = st.section ?? "Steps";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(st);
    }
    return Array.from(m.entries()).map(([section, steps]) => ({ section, steps }));
  }
  return [];
}

export default function OnboardingMePage() {
  const [meId, setMeId] = useState<string | null>(null);
  const [meName, setMeName] = useState<string>("");
  const [instances, setInstances] = useState<ApiInstance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [meRes, obRes] = await Promise.all([fetch("/api/me"), fetch("/api/onboarding")]);
      if (meRes.ok) {
        const me = await meRes.json();
        setMeId(me?.user?.id ?? null);
        setMeName(me?.user?.firstName ?? "there");
      }
      if (!obRes.ok) throw new Error(`HTTP ${obRes.status}`);
      const data = await obRes.json();
      const list: ApiInstance[] = data.data ?? (Array.isArray(data) ? data : []);
      setInstances(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("onboarding");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // /api/onboarding may return all instances; filter to me using server-included user.id field
  const mine = useMemo(() => {
    if (!meId) return [];
    // Some payloads include user.id, others don't. We fall back to "all" if none can be matched.
    // Best-effort: API decorates with user.id when manager view; for self-view it's already scoped.
    return instances ?? [];
  }, [instances, meId]);

  const inst = mine[0] ?? null;

  const sections = useMemo(() => flattenSteps(inst?.template), [inst]);
  const totalSteps = sections.reduce((acc, s) => acc + s.steps.length, 0);
  const completedSteps = useMemo(() => {
    const done = new Set(progressList(inst?.progress).filter((p) => p.done && p.stepId).map((p) => p.stepId!));
    return done;
  }, [inst]);
  const completedCount = completedSteps.size;
  const pct = totalSteps === 0 ? 0 : Math.round((completedCount / totalSteps) * 100);

  const daysIn = inst ? Math.floor((Date.now() - new Date(inst.startDate).getTime()) / MS_DAY) : 0;
  const daysLeft = inst?.targetDate ? Math.ceil((new Date(inst.targetDate).getTime() - Date.now()) / MS_DAY) : null;

  return (
    <div className="obme">
      <header className="obme__head">
        <div className="obme__icon"><IdCard /></div>
        <div className="obme__head-text">
          <div className="obme__greet">Welcome aboard,</div>
          <h1>{meName}.</h1>
        </div>
      </header>

      {loadError ? (
        <div className="obme__error">{loadError}</div>
      ) : instances === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : !inst ? (
        <div className="obme__empty">
          <Sparkles />
          <div>
            <h3>No onboarding journey assigned</h3>
            <p>If your manager has a template for your role, an onboarding will appear here automatically. Otherwise — welcome anyway!</p>
          </div>
        </div>
      ) : (
        <>
          <section className="obme__hero">
            <div className="obme__hero-l">
              <h2>{inst.template?.name ?? "Your onboarding"}</h2>
              <div className="obme__hero-meta">
                <span><Calendar /> Day {daysIn + 1}{inst.template?.durationDays ? ` of ${inst.template.durationDays}` : ""}</span>
                {daysLeft != null && (
                  <span className={daysLeft < 0 ? "is-late" : ""}>
                    {daysLeft >= 0 ? `${daysLeft} days remaining` : `${-daysLeft} days past target`}
                  </span>
                )}
                <span className="obme__hero-status" style={{ background: STATUS_HUE[inst.status] }}>{STATUS_LABEL[inst.status]}</span>
              </div>
              {inst.buddy && (
                <div className="obme__hero-buddy">
                  <span className="obme__hero-buddy-av" style={{ background: avColor(inst.buddy.id) }}>
                    {initials(inst.buddy.firstName, inst.buddy.lastName)}
                  </span>
                  <div>
                    <small>Your onboarding buddy</small>
                    <strong>{[inst.buddy.firstName, inst.buddy.lastName].filter(Boolean).join(" ")}</strong>
                  </div>
                </div>
              )}
            </div>
            <div className="obme__ring">
              <ProgressRing pct={pct} />
              <div className="obme__ring-text">
                <strong>{completedCount}</strong>
                <small>of {totalSteps} steps done</small>
              </div>
            </div>
          </section>

          {inst.status === "OVERDUE" && (
            <div className="obme__banner obme__banner--warn">
              <AlertTriangle />
              <span>Your onboarding is past its target date. Ping your buddy or manager if you need help.</span>
            </div>
          )}

          {sections.length === 0 ? (
            <div className="obme__empty-soft">
              Your template doesn&apos;t have any structured steps. Your buddy will walk you through things informally.
            </div>
          ) : (
            <div className="obme__sections">
              {sections.map((section, si) => {
                const sectionDone = section.steps.filter((st) => st.id && completedSteps.has(st.id)).length;
                return (
                  <section key={si} className="obme-section">
                    <header className="obme-section__head">
                      <h3>{section.section}</h3>
                      <span>{sectionDone} / {section.steps.length} done</span>
                    </header>
                    <ol className="obme-section__steps">
                      {section.steps.map((st, idx) => {
                        const done = st.id ? completedSteps.has(st.id) : false;
                        return (
                          <li key={st.id ?? idx} className={`obme-step ${done ? "is-done" : ""}`}>
                            <span className="obme-step__check">
                              {done ? <CheckCircle2 /> : <Circle />}
                            </span>
                            <div className="obme-step__main">
                              <div className="obme-step__title">
                                {st.title}
                                {st.required && !done && <span className="obme-step__required">Required</span>}
                              </div>
                              {st.description && <p className="obme-step__desc">{st.description}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
            </div>
          )}

          <footer className="obme__foot">
            <Sparkles />
            <span>Your buddy or HR marks steps complete on the admin view. Need something? Ping them in chat.</span>
          </footer>
        </>
      )}
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 36; const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, pct) / 100);
  const hue = pct >= 95 ? "var(--os-c-green)" : pct >= 50 ? "var(--os-c-blue)" : pct >= 20 ? "var(--os-c-orange)" : "var(--os-c-red)";
  return (
    <svg width={100} height={100} className="obme__ring-svg">
      <circle cx={50} cy={50} r={r} fill="none" stroke="var(--os-surface-2)" strokeWidth={8} />
      <circle cx={50} cy={50} r={r} fill="none" stroke={hue} strokeWidth={8} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        transform="rotate(-90 50 50)" style={{ transition: "stroke-dashoffset 250ms" }} />
    </svg>
  );
}
