"use client";

/* New-user onboarding wizard (self-contained light theme, explicit Tailwind,
 * no os.css token dependency).
 *   0. Welcome  ·  1. Use case  ·  2. Pick apps (real apps-catalog)  ·  3. Ready
 * On finish: POST /api/setup (marks complete) + PATCH /api/preferences pins the
 * chosen apps to the rail.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowRight, ArrowLeft, Check, Sparkles, Loader2, Users, BarChart3,
  Headphones, Megaphone, Calculator, Code2, Scale, Boxes, Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  CATALOG_APPS, CATEGORY_ORDER, ALWAYS_PINNED_KEYS, DEFAULT_PINNED_KEYS,
  canAccessApp, type AppEntry,
} from "@/components/layout/os/apps-catalog";

interface DepartmentOption { id: string; label: string; description: string; Icon: LucideIcon; gradient: string }
const DEPARTMENTS: DepartmentOption[] = [
  { id: "hr",          label: "People & HR",       description: "Hiring, onboarding, reviews, time-off",        Icon: Users,      gradient: "#FF158A" },
  { id: "sales",       label: "Sales & Customers", description: "Pipelines, deals, renewals, contracts",        Icon: BarChart3,  gradient: "#00C875" },
  { id: "operations",  label: "Operations",        description: "Tools, assets, SOPs, forms",                   Icon: Boxes,      gradient: "#E8920C" },
  { id: "finance",     label: "Finance",           description: "Dashboards, contracts, expense tracking",      Icon: Calculator, gradient: "#14787E" },
  { id: "it",          label: "IT",                description: "Tools, assets, access policies, SOPs",         Icon: Wrench,     gradient: "#0073EA" },
  { id: "marketing",   label: "Marketing",         description: "Content, forms, clips, dashboards",            Icon: Megaphone,  gradient: "#FF7A59" },
  { id: "engineering", label: "Engineering",       description: "Goals, docs, SOPs, dashboards",                Icon: Code2,      gradient: "#5B7FFF" },
  { id: "legal",       label: "Legal",             description: "Contracts, policies, SOPs, docs",              Icon: Scale,      gradient: "#475569" },
  { id: "support",     label: "Customer Support",  description: "SOPs, forms, docs, recognition",               Icon: Headphones, gradient: "#00B2A9" },
  { id: "all-in-one",  label: "The whole company", description: "Workday-style all-in-one. Give me everything",Icon: Sparkles,   gradient: "#0073EA" },
];

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

const CATEGORY_GRADIENT: Record<string, string> = {
  Core: "#0073EA",
  People: "#FF158A",
  "Time & Pay": "#14787E",
  Knowledge: "#E8920C",
  "Build & Extend": "#5B7FFF",
  Sales: "#00C875",
  Marketing: "#FF7A59",
  Service: "#E2445C",
  Finance: "#14787E",
  Dev: "#5B7FFF",
  Workspace: "#5A6472",
};

const ONBOARD_EXCLUDE = new Set(["settings", "trash", "store"]);
const STEPS = ["welcome", "department", "apps", "ready"];
// Official brand accent: Monday blue (the os-brand token).
const CTA = "#0073EA";

export default function OnboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [department, setDepartment] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/setup").then((r) => r.json()).then((d) => { if (d.setupCompleted) router.push("/today"); }).catch(() => {});
  }, [router]);

  const apps = useMemo<AppEntry[]>(
    () => CATALOG_APPS.filter((a) => !ONBOARD_EXCLUDE.has(a.key) && canAccessApp(a, accessLevel)),
    [accessLevel],
  );
  const recommended = useMemo(() => (department === "all-in-one" ? apps.map((a) => a.key) : DEPT_RECS[department] ?? []), [department, apps]);
  const recommendedSet = useMemo(() => new Set(recommended), [recommended]);

  useEffect(() => {
    if (!department) return;
    const core = apps.filter((a) => a.category === "Core").map((a) => a.key);
    setSelected(new Set([...ALWAYS_PINNED_KEYS, ...DEFAULT_PINNED_KEYS, ...core, ...recommended]));
  }, [department, recommended, apps]);

  function toggleApp(key: string) {
    if (ALWAYS_PINNED_KEYS.includes(key)) return;
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  const grouped = useMemo(() => {
    const m = new Map<string, AppEntry[]>();
    for (const a of apps) { const c = a.category ?? "Workspace"; (m.get(c) ?? m.set(c, []).get(c)!).push(a); }
    const order = [...CATEGORY_ORDER, ...[...m.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    return order.filter((c) => m.has(c)).map((c) => ({ category: c, items: m.get(c)! }));
  }, [apps]);

  async function handleComplete() {
    setSaving(true);
    try {
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
      await fetch("/api/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sidebar: { pinned } }) }).catch(() => {});
      setStep(3);
    } catch (err) { console.error(err); } finally { setSaving(false); }
  }

  const deptLabel = DEPARTMENTS.find((d) => d.id === department)?.label ?? "";
  const selectedDept = DEPARTMENTS.find((d) => d.id === department);

  return (
    <>
      {/* Progress */}
      <div className="mb-9 flex shrink-0 justify-center gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s} className={`h-2 rounded-full transition-all duration-300 ${i === step ? "w-9 bg-[#0073EA]" : i < step ? "w-2 bg-emerald-500" : "w-2 bg-zinc-200"}`} />
        ))}
      </div>

      {/* Step 0. Welcome */}
      {step === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-[#E6F1FB] px-3 py-1 text-[12px] font-bold uppercase tracking-wide text-[#0073EA]">
            <Sparkles className="h-3.5 w-3.5" /> Welcome to WorkwrK
          </span>
          <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-tight text-zinc-900 sm:text-[52px]">
            Your modular <span className="text-[#0073EA]">Work OS</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-zinc-500">
            Pick the apps that match how your team works. Every app comes with boards, AI agents, automations, and templates ready to go. Add or remove any time.
          </p>
          <button type="button" onClick={() => setStep(1)} className="mt-9 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold text-white shadow-lg transition hover:opacity-95 hover:shadow-xl" style={{ background: CTA }}>
            Get started <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Step 1. Use case */}
      {step === 1 && (
        <div className="flex flex-1 flex-col">
          <div className="mb-8 text-center">
            <h1 className="text-[32px] font-extrabold tracking-tight text-zinc-900">What brings you to WorkwrK?</h1>
            <p className="mx-auto mt-2 max-w-lg text-[15px] text-zinc-500">Pick your primary use case. We&apos;ll pre-select the right apps. You can adjust on the next step.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEPARTMENTS.map((d) => (
              <Card key={d.id} selected={department === d.id} onClick={() => setDepartment(d.id)} icon={<d.Icon className="h-5 w-5" />} gradient={d.gradient} title={d.label} desc={d.description} />
            ))}
          </div>
          <div className="mt-9 flex items-center justify-between border-t border-zinc-100 pt-5">
            <BackBtn onClick={() => setStep(0)} />
            <NextBtn disabled={!department} onClick={() => setStep(2)}>Continue</NextBtn>
          </div>
        </div>
      )}

      {/* Step 2. Pick apps */}
      {step === 2 && (
        <div className="flex flex-1 flex-col">
          <div className="mb-6 text-center">
            <h1 className="text-[32px] font-extrabold tracking-tight text-zinc-900">Pick your apps</h1>
            <p className="mx-auto mt-2 max-w-lg text-[15px] text-zinc-500">We pre-selected the essentials for your team. Add or remove freely. Change it any time from the rail.</p>
          </div>

          {department ? (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#0073EA]/15 bg-[#0073EA]/5 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: selectedDept?.gradient ?? CTA }}>
                {selectedDept ? <selectedDept.Icon className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              </span>
              <p className="flex-1 text-[13px] text-zinc-600">Pre-selected for <strong className="font-semibold text-zinc-900">{deptLabel}</strong>. The core apps everyone gets, plus what your team typically needs day-one.</p>
              <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[12px] font-semibold text-[#0073EA] shadow-sm">{selected.size} selected</span>
            </div>
          ) : null}

          <div className="space-y-6">
            {grouped.map((g) => (
              <section key={g.category}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h2 className="text-[12px] font-bold uppercase tracking-wide text-zinc-500">{g.category === "Core" ? "Core · recommended for everyone" : g.category}</h2>
                  <span className="h-px flex-1 bg-zinc-100" />
                  <span className="text-[11px] tabular-nums text-zinc-400">{g.items.filter((a) => selected.has(a.key)).length}/{g.items.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((a) => (
                    <Card
                      key={a.key}
                      selected={selected.has(a.key)}
                      onClick={() => toggleApp(a.key)}
                      icon={<a.Icon className="h-[18px] w-[18px]" />}
                      gradient={CATEGORY_GRADIENT[a.category ?? "Workspace"] ?? CATEGORY_GRADIENT.Core}
                      title={a.label}
                      desc={TAGLINES[a.key] ?? a.category ?? ""}
                      badge={a.category === "Core" ? "Core" : recommendedSet.has(a.key) ? "Recommended" : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-9 flex items-center justify-between border-t border-zinc-100 pt-5">
            <BackBtn onClick={() => setStep(1)} />
            <NextBtn disabled={saving || selected.size === 0} onClick={() => void handleComplete()}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Setting up…</> : <>Set up my workspace <ArrowRight className="h-4 w-4" /></>}
            </NextBtn>
          </div>
        </div>
      )}

      {/* Step 3. Ready */}
      {step === 3 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-[20px] text-white shadow-xl" style={{ background: "#0073EA" }}>
            <Sparkles className="h-8 w-8" />
          </span>
          <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-bold uppercase tracking-wide text-emerald-600">
            <Check className="h-3.5 w-3.5" /> All set
          </span>
          <h1 className="mt-4 text-[40px] font-extrabold tracking-tight text-zinc-900">Your workspace is ready.</h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-zinc-500">
            We&apos;ve pinned {selected.size} apps to your rail and pre-configured them for {deptLabel}. Sidekick is online and ready to draft work for you.
          </p>
          <div className="mt-6 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm">
            <div className="mb-2 text-[13px] font-semibold text-zinc-900">What&apos;s set up</div>
            <ul className="space-y-1.5 text-[13px] text-zinc-600">
              {[`${selected.size} apps pinned to your rail`, "Core workspace (Tasks, Notes, SOPs, Goals)", "Sidekick AI assistant online", `Pre-built agents for ${deptLabel}`].map((t) => (
                <li key={t} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-500" /> {t}</li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => router.push("/today")} className="mt-7 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold text-white shadow-lg transition hover:opacity-95 hover:shadow-xl" style={{ background: CTA }}>
            Go to my workspace <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

function Card({ selected, onClick, icon, gradient, title, desc, badge }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; gradient: string; title: string; desc: string; badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex items-start gap-3 rounded-2xl border p-4 pr-10 text-left transition-all hover:-translate-y-px hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)]"
      style={{
        borderColor: selected ? "#0073EA" : "#e6e6ec",
        background: selected ? "rgba(0,115,234,0.05)" : "#fff",
        boxShadow: selected ? "0 0 0 3px rgba(0,115,234,0.15)" : undefined,
      }}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm" style={{ background: gradient }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14.5px] font-semibold leading-tight tracking-tight text-zinc-900">{title}</span>
          {badge ? (
            <span
              className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
              style={badge === "Core" ? { background: "#f4f4f5", color: "#71717a" } : { background: "rgba(0,115,234,0.1)", color: "#0073EA" }}
            >
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-zinc-500">{desc}</span>
      </span>
      <span
        className="absolute right-3.5 top-1/2 grid h-[22px] w-[22px] -translate-y-1/2 place-items-center rounded-full transition-all"
        style={{ background: selected ? "#0073EA" : "#fff", border: `2px solid ${selected ? "#0073EA" : "#d4d4d8"}` }}
      >
        <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} style={{ opacity: selected ? 1 : 0 }} />
      </span>
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800">
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );
}
function NextBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}
