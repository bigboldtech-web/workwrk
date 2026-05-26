"use client";

/* New-user onboarding wizard — 4 steps:
 *   0. Welcome
 *   1. "What brings you here?" → department router
 *   2. "Pick your tools" → product picker (pre-checked from department)
 *   3. Ready → "Go to my workspace"
 *
 * Saves to POST /api/setup with the same body shape as the legacy
 * wizard (so the backend doesn't have to change). On success the
 * /onboard route redirects to /today.
 *
 * Visuals come from os.css (`.workwrk-os` scope, set in layout.tsx).
 * No inline purples or radial blobs — uses the Monday-bright palette
 * everywhere.
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, ArrowLeft, Check, Sparkles, Users, BarChart3, ShoppingCart,
  Headphones, Megaphone, Calculator, Code2, Scale, MessageSquareHeart, Boxes,
  Wrench, type LucideIcon,
} from "lucide-react";

// ─── Departments ────────────────────────────────────────────
interface DepartmentOption {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  gradient: string;
}
const DEPARTMENTS: DepartmentOption[] = [
  { id: "hr",          label: "People & HR",         description: "Hiring, onboarding, reviews, payroll, benefits", Icon: Users,             gradient: "linear-gradient(135deg, #FF158A, #A25DDC)" },
  { id: "sales",       label: "Sales & Customers",   description: "CRM, deals, pipeline, renewals",                  Icon: BarChart3,         gradient: "linear-gradient(135deg, #00C875, #66CCC2)" },
  { id: "operations",  label: "Operations",          description: "Procurement, inventory, assets, field ops",       Icon: Boxes,             gradient: "linear-gradient(135deg, #7F5347, #FDAB3D)" },
  { id: "finance",     label: "Finance",             description: "GL, FP&A, expenses, tax, books",                   Icon: Calculator,        gradient: "linear-gradient(135deg, #14787E, #00C875)" },
  { id: "it",          label: "IT",                  description: "Tickets, incidents, access, security",            Icon: Wrench,            gradient: "linear-gradient(135deg, #579BFC, #A25DDC)" },
  { id: "marketing",   label: "Marketing",           description: "Campaigns, content, events, web",                 Icon: Megaphone,         gradient: "linear-gradient(135deg, #FDAB3D, #FF158A)" },
  { id: "engineering", label: "Engineering",         description: "Sprints, releases, incidents, roadmap",           Icon: Code2,             gradient: "linear-gradient(135deg, #5559DF, #579BFC)" },
  { id: "legal",       label: "Legal",               description: "Contracts, privacy, IP, compliance",              Icon: Scale,             gradient: "linear-gradient(135deg, #A25DDC, #5559DF)" },
  { id: "support",     label: "Customer Support",    description: "Tickets, queues, SLAs, knowledge base",           Icon: Headphones,        gradient: "linear-gradient(135deg, #FDAB3D, #FF158A)" },
  { id: "all-in-one",  label: "The whole company",   description: "Workday-style all-in-one — give me everything",   Icon: Sparkles,          gradient: "linear-gradient(135deg, #FF158A, #A25DDC, #579BFC)" },
];

// ─── Products (from /api/products) ──────────────────────────
interface CatalogProduct {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  iconKey: string | null;
  hue: string | null;
  suite: string;
  tier: string;
  status: string;
  pathPrefix: string | null;
}

// Hue (named) → gradient. Catalog supplies short color names; we map to
// the Monday palette gradients so the cards feel like the rest of the OS.
const HUE_GRADIENTS: Record<string, string> = {
  violet:    "linear-gradient(135deg, #A25DDC, #579BFC)",
  purple:    "linear-gradient(135deg, #A25DDC, #FF158A)",
  pink:      "linear-gradient(135deg, #FF158A, #A25DDC)",
  rose:      "linear-gradient(135deg, #FF158A, #FDAB3D)",
  red:       "linear-gradient(135deg, #E2445C, #FF158A)",
  orange:    "linear-gradient(135deg, #FDAB3D, #FF158A)",
  amber:     "linear-gradient(135deg, #FDAB3D, #FFCB00)",
  yellow:    "linear-gradient(135deg, #FFCB00, #FDAB3D)",
  lime:      "linear-gradient(135deg, #9CD326, #00C875)",
  green:     "linear-gradient(135deg, #00C875, #66CCC2)",
  emerald:   "linear-gradient(135deg, #00C875, #14787E)",
  teal:      "linear-gradient(135deg, #14787E, #66CCC2)",
  cyan:      "linear-gradient(135deg, #66CCC2, #579BFC)",
  sky:       "linear-gradient(135deg, #579BFC, #5559DF)",
  blue:      "linear-gradient(135deg, #0073EA, #5559DF)",
  indigo:    "linear-gradient(135deg, #5559DF, #A25DDC)",
  charcoal:  "linear-gradient(135deg, #323338, #676879)",
};

const TIER_LABEL: Record<string, string> = {
  CORE: "Core", PLUS: "Plus", SUITE: "Suite", FREE: "Free",
};
const TIER_CLASS: Record<string, string> = {
  CORE: "core", PLUS: "plus", SUITE: "suite", FREE: "core",
};

// ─── Steps ──────────────────────────────────────────────────
const STEPS = [
  { id: "welcome",    label: "Welcome" },
  { id: "department", label: "What brings you here?" },
  { id: "products",   label: "Pick your tools" },
  { id: "ready",      label: "Ready" },
];

export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [department, setDepartment] = useState<string>("");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Redirect if already onboarded
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((d) => { if (d.setupCompleted) router.push("/today"); })
      .catch(() => {});
  }, [router]);

  // Pull the product catalog
  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => setProducts(d.products ?? []))
      .catch(() => {});
  }, []);

  // Recommended product slugs per department
  const recommendedSlugs = useMemo(() => {
    const RECS: Record<string, string[]> = {
      hr:          ["workwrk-people", "workwrk-recruit", "workwrk-perform", "workwrk-learn", "workwrk-pay", "workwrk-benefits"],
      sales:       ["workwrk-crm", "workwrk-success"],
      operations:  ["workwrk-procurement", "workwrk-assets", "workwrk-inventory", "workwrk-field-ops"],
      finance:     ["workwrk-books", "workwrk-fpa", "workwrk-expense", "workwrk-tax"],
      it:          ["workwrk-itsm", "workwrk-access", "workwrk-assets"],
      marketing:   ["workwrk-campaigns", "workwrk-content", "workwrk-events"],
      engineering: ["workwrk-dev", "workwrk-incidents", "workwrk-roadmap"],
      legal:       ["workwrk-contracts", "workwrk-privacy"],
      support:     ["workwrk-help"],
      "all-in-one": products.filter((p) => p.status !== "DEPRECATED").map((p) => p.slug),
    };
    return RECS[department] ?? [];
  }, [department, products]);

  // Pre-select core + recommended whenever the department changes
  useEffect(() => {
    if (!department) return;
    const coreSlugs = products.filter((p) => p.suite === "CROSS").map((p) => p.slug);
    setSelected(new Set([...coreSlugs, ...recommendedSlugs]));
  }, [department, recommendedSlugs, products]);

  function toggleProduct(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleComplete() {
    setSaving(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessType: "smb",
          industry: "Other",
          useCase: department,
          teamSize: "1-10",
          enabledModules: ["people", "tasks", "sops", "meetings"],
          departments: [],
          customDepartments: [],
          invites: [],
          departmentRouter: department,
          selectedProducts: Array.from(selected),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStep(3);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // Group products by suite for the picker
  const productsBySuite = useMemo(() => {
    const m = new Map<string, CatalogProduct[]>();
    for (const p of products) {
      if (p.status === "DEPRECATED") continue;
      if (!m.has(p.suite)) m.set(p.suite, []);
      m.get(p.suite)!.push(p);
    }
    return m;
  }, [products]);

  const suiteOrder = ["CROSS", "PEOPLE", "SALES", "OPERATIONS", "IT", "MARKETING", "ENGINEERING", "FINANCE", "LEGAL", "SUPPORT"];
  const recommendedSet = useMemo(() => new Set(recommendedSlugs), [recommendedSlugs]);

  const deptLabel = DEPARTMENTS.find((d) => d.id === department)?.label ?? "";
  const selectedDeptLogo = DEPARTMENTS.find((d) => d.id === department);

  // ────────────────────────────────────────────────────────
  return (
    <>
      {/* Progress dots */}
      <div className="os-onboard__progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span
            key={s.id}
            className={`os-onboard__progress-dot ${i === step ? "is-active" : i < step ? "is-done" : ""}`}
            style={{ width: i === step ? 36 : 8 }}
          />
        ))}
      </div>

      {/* ─── Step 0 · Welcome ───────────────────────── */}
      {step === 0 && (
        <div className="os-onboard__step">
          <div className="os-onboard__hero">
            <span className="os-onboard__eyebrow">
              <Sparkles />
              Welcome to WorkwrK
            </span>
            <h1 className="os-onboard__title">
              Your modular <em>Work OS</em>.
            </h1>
            <p className="os-onboard__sub">
              Pick the apps that match how your team works. Every app comes with boards,
              AI agents, automations, and templates ready to go. Add or remove apps any time.
            </p>
          </div>
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <button
              type="button"
              className="os-onboard__btn-cta"
              onClick={() => setStep(1)}
            >
              <span>Get started</span>
              <ArrowRight />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 1 · Department router ─────────────── */}
      {step === 1 && (
        <div className="os-onboard__step">
          <div className="os-onboard__hero">
            <h1 className="os-onboard__title" style={{ fontSize: 36 }}>
              What brings you to WorkwrK?
            </h1>
            <p className="os-onboard__sub">
              Pick your primary use case. We'll pre-select the right apps — you can adjust on the next step.
            </p>
          </div>

          <div className="os-onboard__grid">
            {DEPARTMENTS.map((d) => {
              const Icon = d.Icon;
              const isSelected = department === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`os-onb-card ${isSelected ? "is-selected" : ""}`}
                  onClick={() => setDepartment(d.id)}
                >
                  <div className="os-onb-card__icon" style={{ background: d.gradient }}>
                    <Icon />
                  </div>
                  <div className="os-onb-card__body">
                    <div className="os-onb-card__title">{d.label}</div>
                    <div className="os-onb-card__desc">{d.description}</div>
                  </div>
                  <div className="os-onb-card__check">
                    <Check />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="os-onboard__actions">
            <button type="button" className="os-onboard__btn-back" onClick={() => setStep(0)}>
              <ArrowLeft />
              Back
            </button>
            <button
              type="button"
              className="os-onboard__btn-next"
              onClick={() => setStep(2)}
              disabled={!department}
            >
              <span>Continue</span>
              <ArrowRight />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 2 · Product picker ───────────────── */}
      {step === 2 && (
        <div className="os-onboard__step">
          <div className="os-onboard__hero">
            <h1 className="os-onboard__title" style={{ fontSize: 36 }}>
              Pick your tools
            </h1>
            <p className="os-onboard__sub">
              We pre-selected the essentials for your team. Add or remove freely — you can change this any time in Settings.
            </p>
          </div>

          {department ? (
            <div className="os-onboard__rec">
              <div className="os-onboard__rec-icon">
                {selectedDeptLogo ? <selectedDeptLogo.Icon /> : <Sparkles />}
              </div>
              <div className="os-onboard__rec-text">
                Pre-selected for <strong>{deptLabel}</strong> — everything cross-functional, plus the apps your team typically needs day-one.
              </div>
              <span className="os-onboard__rec-count">{selected.size} selected</span>
            </div>
          ) : null}

          {products.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--os-ink-3)", fontSize: 13 }}>
              Loading products…
            </div>
          ) : (
            suiteOrder.map((suite) => {
              const items = productsBySuite.get(suite);
              if (!items || items.length === 0) return null;
              const suiteLabel = suite === "CROSS" ? "Core (recommended for everyone)" : suite.charAt(0) + suite.slice(1).toLowerCase();
              return (
                <div key={suite}>
                  <div className="os-onboard__suite-title">
                    <span>{suiteLabel}</span>
                    <span className="os-onboard__suite-title-line" />
                    <span style={{ fontSize: 10.5, color: "var(--os-ink-3)" }}>
                      {items.filter((p) => selected.has(p.slug)).length} / {items.length}
                    </span>
                  </div>
                  <div className="os-onboard__grid">
                    {items.map((p) => {
                      const isSelected = selected.has(p.slug);
                      const gradient = HUE_GRADIENTS[p.hue ?? ""] ?? HUE_GRADIENTS.indigo;
                      const isRec = recommendedSet.has(p.slug);
                      const tierKey = TIER_CLASS[p.tier] ?? "core";
                      return (
                        <button
                          key={p.slug}
                          type="button"
                          className={`os-onb-card ${isSelected ? "is-selected" : ""}`}
                          onClick={() => toggleProduct(p.slug)}
                        >
                          <span className={`os-onb-product__tier os-onb-product__tier--${tierKey}`}>
                            {TIER_LABEL[p.tier] ?? p.tier}
                          </span>
                          <div className="os-onb-card__icon" style={{ background: gradient }}>
                            {/* Initial fallback if we don't have a Lucide for the iconKey */}
                            <span style={{ fontWeight: 800, fontSize: 14, color: "white" }}>
                              {(p.name.replace(/^WorkwrK\s*/i, "")[0] ?? "?").toUpperCase()}
                            </span>
                          </div>
                          <div className="os-onb-card__body">
                            <div className="os-onb-card__title">
                              {p.name.replace(/^WorkwrK\s*/i, "")}
                              {isRec ? (
                                <span style={{
                                  fontSize: 9.5, fontWeight: 800, color: "var(--os-c-pink)",
                                  marginLeft: 6, padding: "1px 5px", borderRadius: 4,
                                  background: "rgba(255, 21, 138, 0.12)",
                                }}>
                                  Recommended
                                </span>
                              ) : null}
                            </div>
                            <div className="os-onb-card__desc">{p.tagline}</div>
                          </div>
                          <div className="os-onb-card__check">
                            <Check />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          <div className="os-onboard__actions">
            <button type="button" className="os-onboard__btn-back" onClick={() => setStep(1)}>
              <ArrowLeft />
              Back
            </button>
            <button
              type="button"
              className="os-onboard__btn-next"
              onClick={() => void handleComplete()}
              disabled={saving || selected.size === 0}
            >
              <span>{saving ? "Setting up…" : "Set up my workspace"}</span>
              {!saving ? <ArrowRight /> : null}
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3 · Ready ────────────────────────── */}
      {step === 3 && (
        <div className="os-onboard__step">
          <div className="os-onboard__ready">
            <div className="os-onboard__ready-art">
              <Sparkles />
            </div>
            <span className="os-onboard__eyebrow">
              <Check />
              All set
            </span>
            <h1 className="os-onboard__title" style={{ marginTop: 16 }}>
              Your workspace is ready.
            </h1>
            <p className="os-onboard__sub">
              We've installed {selected.size} apps and pre-configured them for {deptLabel}.
              Sidekick is online and ready to draft work for you.
            </p>

            <div className="os-onboard__ready-summary">
              <strong>What's installed:</strong>
              <ul>
                <li><Check /> {selected.size} apps configured</li>
                <li><Check /> Cross-functional core (Tasks, Meetings, SOPs, OKRs)</li>
                <li><Check /> Sidekick AI assistant online</li>
                <li><Check /> Pre-built agents for {deptLabel}</li>
              </ul>
            </div>

            <button
              type="button"
              className="os-onboard__btn-cta"
              onClick={() => router.push("/today")}
            >
              <span>Go to my workspace</span>
              <ArrowRight />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
