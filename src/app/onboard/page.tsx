"use client";

/* New-user onboarding wizard — 4 steps:
 *   0. Welcome
 *   1. "What brings you here?" → use-case router
 *   2. "Pick your apps" → the REAL apps from apps-catalog (the same ones the
 *      rail uses), pre-checked from the use case. Selecting pins them.
 *   3. Ready → "Go to my workspace"
 *
 * On finish: POST /api/setup marks onboarding complete (+ installs the
 * department's product modules), and PATCH /api/preferences pins the chosen
 * apps to the rail. Visuals come from os.css (.workwrk-os scope, light-pinned).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowRight, ArrowLeft, Check, Sparkles, Users, BarChart3,
  Headphones, Megaphone, Calculator, Code2, Scale, Boxes, Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  CATALOG_APPS, CATEGORY_ORDER, ALWAYS_PINNED_KEYS, DEFAULT_PINNED_KEYS,
  canAccessApp, type AppEntry,
} from "@/components/layout/os/apps-catalog";

// ─── Use-case router ────────────────────────────────────────
interface DepartmentOption { id: string; label: string; description: string; Icon: LucideIcon; gradient: string }
const DEPARTMENTS: DepartmentOption[] = [
  { id: "hr",          label: "People & HR",      description: "Hiring, onboarding, reviews, time-off",       Icon: Users,      gradient: "linear-gradient(135deg, #FF158A, #A25DDC)" },
  { id: "sales",       label: "Sales & Customers",description: "Pipelines, deals, renewals, contracts",       Icon: BarChart3,  gradient: "linear-gradient(135deg, #00C875, #66CCC2)" },
  { id: "operations",  label: "Operations",       description: "Tools, assets, SOPs, forms",                  Icon: Boxes,      gradient: "linear-gradient(135deg, #7F5347, #FDAB3D)" },
  { id: "finance",     label: "Finance",          description: "Dashboards, contracts, expenses tracking",    Icon: Calculator, gradient: "linear-gradient(135deg, #14787E, #00C875)" },
  { id: "it",          label: "IT",               description: "Tools, assets, access policies, SOPs",        Icon: Wrench,     gradient: "linear-gradient(135deg, #579BFC, #A25DDC)" },
  { id: "marketing",   label: "Marketing",        description: "Content, forms, clips, dashboards",           Icon: Megaphone,  gradient: "linear-gradient(135deg, #FDAB3D, #FF158A)" },
  { id: "engineering", label: "Engineering",      description: "Goals, docs, SOPs, dashboards",               Icon: Code2,      gradient: "linear-gradient(135deg, #5559DF, #579BFC)" },
  { id: "legal",       label: "Legal",            description: "Contracts, policies, SOPs, docs",             Icon: Scale,      gradient: "linear-gradient(135deg, #A25DDC, #5559DF)" },
  { id: "support",     label: "Customer Support", description: "SOPs, forms, docs, recognition",              Icon: Headphones, gradient: "linear-gradient(135deg, #FDAB3D, #FF158A)" },
  { id: "all-in-one",  label: "The whole company",description: "Workday-style all-in-one — give me everything",Icon: Sparkles,  gradient: "linear-gradient(135deg, #FF158A, #A25DDC, #579BFC)" },
];

// Per-use-case recommended app keys (real apps-catalog keys).
const DEPT_RECS: Record<string, string[]> = {
  hr:          ["teams", "recruiting", "onboarding", "reviews", "time-off", "timesheets", "learning", "kudos", "candor", "surveys", "announcements", "policies", "sops"],
  sales:       ["goals", "dashboards", "docs", "forms", "agreements"],
  operations:  ["tools", "assets", "sops", "forms", "dashboards"],
  finance:     ["dashboards", "docs", "agreements", "tools"],
  it:          ["tools", "assets", "sops", "policies"],
  marketing:   ["docs", "forms", "clips", "dashboards", "announcements"],
  engineering: ["goals", "docs", "sops", "dashboards", "build"],
  legal:       ["agreements", "policies", "sops", "docs"],
  support:     ["sops", "forms", "docs", "kudos"],
};

// Short taglines for the picker cards (keyed by app key).
const TAGLINES: Record<string, string> = {
  home: "Your daily home base", planner: "Calendar & scheduling", ai: "AI workspace & agents",
  teams: "People & org chart", docs: "Notes & docs", dashboards: "Dashboards & reports",
  library: "Files, notes & whiteboards", forms: "Collect data with forms", clips: "Record quick videos",
  goals: "OKRs, KRAs & KPIs", timesheets: "Track time", recruiting: "Jobs, candidates, interviews",
  onboarding: "Onboard new hires", reviews: "Performance reviews", candor: "1:1s & feedback",
  announcements: "Company announcements", kudos: "Recognition & kudos", surveys: "Pulse surveys",
  "time-off": "Time-off & leave", tools: "Tool & credential keeper", assets: "Asset & device tracking",
  sops: "Process docs & SOPs", policies: "Policies & compliance", agreements: "Contracts & e-signature",
  learning: "Courses & training", build: "Low-code app builder",
};

// Icon gradient per category — keeps the picker colorful + on-brand.
const CATEGORY_GRADIENT: Record<string, string> = {
  Core: "linear-gradient(135deg, #0073EA, #5559DF)",
  People: "linear-gradient(135deg, #FF158A, #A25DDC)",
  "Time & Pay": "linear-gradient(135deg, #14787E, #00C875)",
  Knowledge: "linear-gradient(135deg, #FDAB3D, #FF158A)",
  "Build & Extend": "linear-gradient(135deg, #5559DF, #A25DDC)",
  Sales: "linear-gradient(135deg, #00C875, #66CCC2)",
  Marketing: "linear-gradient(135deg, #FDAB3D, #FF158A)",
  Service: "linear-gradient(135deg, #FDAB3D, #E2445C)",
  Finance: "linear-gradient(135deg, #14787E, #00C875)",
  Dev: "linear-gradient(135deg, #5559DF, #579BFC)",
  Workspace: "linear-gradient(135deg, #323338, #676879)",
};

// Apps that aren't user-pickable in onboarding (always-available utilities).
const ONBOARD_EXCLUDE = new Set(["settings", "trash", "store"]);

const STEPS = [
  { id: "welcome",    label: "Welcome" },
  { id: "department", label: "What brings you here?" },
  { id: "apps",       label: "Pick your apps" },
  { id: "ready",      label: "Ready" },
];

export default function OnboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [department, setDepartment] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Redirect if already onboarded.
  useEffect(() => {
    fetch("/api/setup").then((r) => r.json()).then((d) => { if (d.setupCompleted) router.push("/today"); }).catch(() => {});
  }, [router]);

  // The real apps the user can access, in catalog order.
  const apps = useMemo<AppEntry[]>(
    () => CATALOG_APPS.filter((a) => !ONBOARD_EXCLUDE.has(a.key) && canAccessApp(a, accessLevel)),
    [accessLevel],
  );

  const recommended = useMemo(() => {
    if (department === "all-in-one") return apps.map((a) => a.key);
    return DEPT_RECS[department] ?? [];
  }, [department, apps]);
  const recommendedSet = useMemo(() => new Set(recommended), [recommended]);

  // Pre-select: always-pinned + default-pinned + Core category + use-case recs.
  useEffect(() => {
    if (!department) return;
    const core = apps.filter((a) => a.category === "Core").map((a) => a.key);
    setSelected(new Set([...ALWAYS_PINNED_KEYS, ...DEFAULT_PINNED_KEYS, ...core, ...recommended]));
  }, [department, recommended, apps]);

  function toggleApp(key: string) {
    if (ALWAYS_PINNED_KEYS.includes(key)) return; // Home etc. can't be unpinned
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Group the accessible apps by category, in CATEGORY_ORDER.
  const grouped = useMemo(() => {
    const m = new Map<string, AppEntry[]>();
    for (const a of apps) {
      const c = a.category ?? "Workspace";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(a);
    }
    const order = [...CATEGORY_ORDER, ...[...m.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    return order.filter((c) => m.has(c)).map((c) => ({ category: c, items: m.get(c)! }));
  }, [apps]);

  async function handleComplete() {
    setSaving(true);
    try {
      // Always-pinned must be included in the rail.
      const pinned = Array.from(new Set([...ALWAYS_PINNED_KEYS, ...selected]));
      const res = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessType: "smb", industry: "Other", useCase: department, teamSize: "1-10",
          enabledModules: ["people", "tasks", "sops", "meetings"],
          departments: [], customDepartments: [], invites: [],
          departmentRouter: department, selectedProducts: [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Pin the chosen apps to the rail.
      await fetch("/api/preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidebar: { pinned } }),
      }).catch(() => {});
      setStep(3);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const deptLabel = DEPARTMENTS.find((d) => d.id === department)?.label ?? "";
  const selectedDept = DEPARTMENTS.find((d) => d.id === department);

  return (
    <>
      <div className="os-onboard__progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s.id} className={`os-onboard__progress-dot ${i === step ? "is-active" : i < step ? "is-done" : ""}`} style={{ width: i === step ? 36 : 8 }} />
        ))}
      </div>

      {/* ─── Step 0 · Welcome ─── */}
      {step === 0 && (
        <div className="os-onboard__step">
          <div className="os-onboard__hero">
            <span className="os-onboard__eyebrow"><Sparkles /> Welcome to WorkwrK</span>
            <h1 className="os-onboard__title">Your modular <em>Work OS</em>.</h1>
            <p className="os-onboard__sub">
              Pick the apps that match how your team works. Every app comes with boards,
              AI agents, automations, and templates ready to go. Add or remove apps any time.
            </p>
          </div>
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <button type="button" className="os-onboard__btn-cta" onClick={() => setStep(1)}>
              <span>Get started</span><ArrowRight />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 1 · Use-case router ─── */}
      {step === 1 && (
        <div className="os-onboard__step">
          <div className="os-onboard__hero">
            <h1 className="os-onboard__title" style={{ fontSize: 36 }}>What brings you to WorkwrK?</h1>
            <p className="os-onboard__sub">Pick your primary use case. We'll pre-select the right apps — you can adjust on the next step.</p>
          </div>
          <div className="os-onboard__grid">
            {DEPARTMENTS.map((d) => {
              const Icon = d.Icon;
              return (
                <button key={d.id} type="button" className={`os-onb-card ${department === d.id ? "is-selected" : ""}`} onClick={() => setDepartment(d.id)}>
                  <div className="os-onb-card__icon" style={{ background: d.gradient }}><Icon /></div>
                  <div className="os-onb-card__body">
                    <div className="os-onb-card__title">{d.label}</div>
                    <div className="os-onb-card__desc">{d.description}</div>
                  </div>
                  <div className="os-onb-card__check"><Check /></div>
                </button>
              );
            })}
          </div>
          <div className="os-onboard__actions">
            <button type="button" className="os-onboard__btn-back" onClick={() => setStep(0)}><ArrowLeft /> Back</button>
            <button type="button" className="os-onboard__btn-next" onClick={() => setStep(2)} disabled={!department}><span>Continue</span><ArrowRight /></button>
          </div>
        </div>
      )}

      {/* ─── Step 2 · App picker (real apps) ─── */}
      {step === 2 && (
        <div className="os-onboard__step">
          <div className="os-onboard__hero">
            <h1 className="os-onboard__title" style={{ fontSize: 36 }}>Pick your apps</h1>
            <p className="os-onboard__sub">We pre-selected the essentials for your team. Add or remove freely — you can change this any time from the rail.</p>
          </div>

          {department ? (
            <div className="os-onboard__rec">
              <div className="os-onboard__rec-icon">{selectedDept ? <selectedDept.Icon /> : <Sparkles />}</div>
              <div className="os-onboard__rec-text">Pre-selected for <strong>{deptLabel}</strong> — the core apps everyone gets, plus what your team typically needs day-one.</div>
              <span className="os-onboard__rec-count">{selected.size} selected</span>
            </div>
          ) : null}

          {grouped.map((g) => (
            <div key={g.category}>
              <div className="os-onboard__suite-title">
                <span>{g.category === "Core" ? "Core (recommended for everyone)" : g.category}</span>
                <span className="os-onboard__suite-title-line" />
                <span style={{ fontSize: 10.5, color: "var(--os-ink-3)" }}>{g.items.filter((a) => selected.has(a.key)).length} / {g.items.length}</span>
              </div>
              <div className="os-onboard__grid">
                {g.items.map((a) => {
                  const isSelected = selected.has(a.key);
                  const isRec = recommendedSet.has(a.key);
                  const isCore = a.category === "Core";
                  return (
                    <button key={a.key} type="button" className={`os-onb-card ${isSelected ? "is-selected" : ""}`} onClick={() => toggleApp(a.key)}>
                      {isCore ? <span className="os-onb-product__tier os-onb-product__tier--core">Core</span> : null}
                      <div className="os-onb-card__icon" style={{ background: CATEGORY_GRADIENT[a.category ?? "Workspace"] ?? CATEGORY_GRADIENT.Core }}>
                        <a.Icon />
                      </div>
                      <div className="os-onb-card__body">
                        <div className="os-onb-card__title">
                          {a.label}
                          {isRec && !isCore ? (
                            <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--os-c-pink)", marginLeft: 6, padding: "1px 5px", borderRadius: 4, background: "rgba(255, 21, 138, 0.12)" }}>Recommended</span>
                          ) : null}
                        </div>
                        <div className="os-onb-card__desc">{TAGLINES[a.key] ?? a.category}</div>
                      </div>
                      <div className="os-onb-card__check"><Check /></div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="os-onboard__actions">
            <button type="button" className="os-onboard__btn-back" onClick={() => setStep(1)}><ArrowLeft /> Back</button>
            <button type="button" className="os-onboard__btn-next" onClick={() => void handleComplete()} disabled={saving || selected.size === 0}>
              <span>{saving ? "Setting up…" : "Set up my workspace"}</span>{!saving ? <ArrowRight /> : null}
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3 · Ready ─── */}
      {step === 3 && (
        <div className="os-onboard__step">
          <div className="os-onboard__ready">
            <div className="os-onboard__ready-art"><Sparkles /></div>
            <span className="os-onboard__eyebrow"><Check /> All set</span>
            <h1 className="os-onboard__title" style={{ marginTop: 16 }}>Your workspace is ready.</h1>
            <p className="os-onboard__sub">We've pinned {selected.size} apps to your rail and pre-configured them for {deptLabel}. Sidekick is online and ready to draft work for you.</p>
            <div className="os-onboard__ready-summary">
              <strong>What's set up:</strong>
              <ul>
                <li><Check /> {selected.size} apps pinned to your rail</li>
                <li><Check /> Core workspace (Tasks, Notes, SOPs, Goals)</li>
                <li><Check /> Sidekick AI assistant online</li>
                <li><Check /> Pre-built agents for {deptLabel}</li>
              </ul>
            </div>
            <button type="button" className="os-onboard__btn-cta" onClick={() => router.push("/today")}>
              <span>Go to my workspace</span><ArrowRight />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
