"use client";

// Onboarding v2 — Phase B3 of the Modular Work OS revamp.
//
// Showcases the new architecture's two key innovations:
//   1. Department Router — "What brings you here?" (HR / Sales / Ops /
//      Finance / IT / Marketing / Eng / Legal / Support / All-in-one)
//   2. Product Picker — recommended products from the catalog,
//      pre-checked based on the department choice, freely toggleable
//
// Saves to ProductInstallation via /api/setup (same endpoint, new
// fields `departmentRouter` + `selectedProducts`). Existing /setup
// page remains the canonical path until this is fully built out
// (welcome + theme + team-id + integrations steps come later).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Sparkles,
  Users,
  TrendingUp,
  ShoppingCart,
  Headphones,
  Megaphone,
  BookText,
  Code,
  FileText,
  Activity,
  Boxes,
} from "lucide-react";

// ── Static catalog mirrors of src/lib/products/catalog.ts. We don't
// import the server catalog directly because it references the
// generated Prisma client which is server-only. Instead the page
// fetches /api/products on mount; this static map gives us the
// icon + hue + tier + recommended set for the picker UI.

interface DepartmentOption {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
}

const DEPARTMENTS: DepartmentOption[] = [
  { id: "hr", label: "Manage People & HR", description: "Hiring, onboarding, reviews, payroll, benefits", icon: Users, accent: "violet" },
  { id: "sales", label: "Manage Sales & Customers", description: "CRM, deals, pipeline, renewals", icon: TrendingUp, accent: "emerald" },
  { id: "operations", label: "Run Operations", description: "Procurement, inventory, field ops, assets", icon: Boxes, accent: "sky" },
  { id: "finance", label: "Manage Finance", description: "GL, FP&A, expenses, tax, books", icon: BookText, accent: "blue" },
  { id: "it", label: "Manage IT", description: "Tickets, incidents, access, security", icon: Headphones, accent: "indigo" },
  { id: "marketing", label: "Run Marketing", description: "Campaigns, content, events, web", icon: Megaphone, accent: "amber" },
  { id: "engineering", label: "Build Software", description: "Sprints, releases, incidents, roadmap", icon: Code, accent: "purple" },
  { id: "legal", label: "Manage Legal", description: "Contracts, privacy, IP, compliance", icon: FileText, accent: "rose" },
  { id: "support", label: "Run Customer Support", description: "Tickets, queues, SLAs, knowledge base", icon: Activity, accent: "teal" },
  { id: "all-in-one", label: "Run the Whole Company", description: "I want everything — Workday-style all-in-one", icon: Sparkles, accent: "pink" },
];

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

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "department", label: "What brings you here?" },
  { id: "products", label: "Pick your tools" },
  { id: "ready", label: "Ready" },
];

export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [department, setDepartment] = useState<string>("");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Redirect away if setup already completed.
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((d) => {
        if (d.setupCompleted) router.push("/dashboard");
      })
      .catch(() => {});
  }, [router]);

  // Pull the full product catalog on mount.
  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => setProducts(d.products || []))
      .catch(() => {});
  }, []);

  // Default selection: when the user picks a department, auto-check
  // the recommended products. The user can freely add/remove.
  const recommendedSlugs = useMemo(() => {
    const RECS: Record<string, string[]> = {
      hr: ["workwrk-people", "workwrk-recruit", "workwrk-perform", "workwrk-learn", "workwrk-pay", "workwrk-benefits"],
      sales: ["workwrk-crm", "workwrk-success"],
      operations: ["workwrk-procurement", "workwrk-assets", "workwrk-inventory", "workwrk-field-ops"],
      finance: ["workwrk-books", "workwrk-fpa", "workwrk-expense", "workwrk-tax"],
      it: ["workwrk-itsm", "workwrk-access", "workwrk-assets"],
      marketing: ["workwrk-campaigns", "workwrk-content", "workwrk-events"],
      engineering: ["workwrk-dev", "workwrk-incidents", "workwrk-roadmap"],
      legal: ["workwrk-contracts", "workwrk-privacy"],
      support: ["workwrk-help"],
      "all-in-one": products.filter((p) => p.status !== "DEPRECATED").map((p) => p.slug),
    };
    return RECS[department] ?? [];
  }, [department, products]);

  // When department changes, reset the selected set to the recommended +
  // core (CROSS suite) products.
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
          // Minimum required by /api/setup. We fake the legacy fields
          // since the new flow doesn't ask for them; the user can
          // refine in Settings later.
          businessType: "smb",
          industry: "Other",
          useCase: department,
          teamSize: "1-10",
          enabledModules: ["people", "tasks", "sops", "meetings"],
          departments: [],
          customDepartments: [],
          invites: [],
          // New Phase B fields
          departmentRouter: department,
          selectedProducts: Array.from(selected),
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setStep(3);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // ────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────

  const productsBySuite = useMemo(() => {
    const m = new Map<string, CatalogProduct[]>();
    for (const p of products) {
      if (!m.has(p.suite)) m.set(p.suite, []);
      m.get(p.suite)!.push(p);
    }
    return m;
  }, [products]);

  const suiteOrder = ["CROSS", department === "hr" ? "PEOPLE" : null, "PEOPLE", "SALES", "OPERATIONS", "IT", "MARKETING", "ENGINEERING", "FINANCE", "LEGAL", "SUPPORT"]
    .filter((s, i, a): s is string => !!s && a.indexOf(s) === i);

  return (
    <div style={{ color: "#1a1a1a" }}>
      {/* Progress dots */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 48 }}>
        {STEPS.map((s, i) => (
          <span
            key={s.id}
            style={{
              width: i === step ? 32 : 8,
              height: 8,
              borderRadius: 999,
              background: i <= step ? "#7c3aed" : "rgba(0,0,0,0.1)",
              transition: "all 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* Step 0: Welcome */}
      {step === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              borderRadius: 999,
              background: "rgba(124,58,237,0.1)",
              color: "#7c3aed",
              fontSize: 12,
              fontWeight: 500,
              marginBottom: 24,
            }}
          >
            <Sparkles size={14} />
            Welcome to WorkwrK
          </div>
          <h1 style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", marginBottom: 16, lineHeight: 1.1 }}>
            Your modular Work OS.
          </h1>
          <p style={{ fontSize: 18, color: "#666", maxWidth: 540, margin: "0 auto 40px", lineHeight: 1.5 }}>
            Pick the products that match how your team works. Every product comes with
            boards, AI agents, automations, and templates ready to go. You can add or
            remove products anytime.
          </p>
          <button
            type="button"
            onClick={() => setStep(1)}
            style={{
              padding: "14px 32px",
              borderRadius: 999,
              background: "#1a1a1a",
              color: "#fff",
              fontSize: 15,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Get started
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Step 1: Department Router */}
      {step === 1 && (
        <div>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 12 }}>
              What brings you to WorkwrK?
            </h1>
            <p style={{ fontSize: 16, color: "#666" }}>
              Pick your primary use case. We&apos;ll recommend the right products.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, maxWidth: 880, margin: "0 auto" }}>
            {DEPARTMENTS.map((d) => {
              const Icon = d.icon;
              const isSelected = department === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDepartment(d.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: 16,
                    borderRadius: 12,
                    border: isSelected ? "2px solid #7c3aed" : "2px solid rgba(0,0,0,0.08)",
                    background: isSelected ? "rgba(124,58,237,0.05)" : "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: isSelected ? "#7c3aed" : "rgba(0,0,0,0.04)",
                      color: isSelected ? "#fff" : "#666",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#1a1a1a" }}>
                      {d.label}
                    </div>
                    <div style={{ fontSize: 12, color: "#666", lineHeight: 1.4 }}>{d.description}</div>
                  </div>
                  {isSelected && (
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "#7c3aed",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Check size={12} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 880, margin: "32px auto 0" }}>
            <button
              type="button"
              onClick={() => setStep(0)}
              style={{ padding: "10px 16px", border: "none", background: "transparent", color: "#666", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!department}
              style={{
                padding: "10px 24px",
                borderRadius: 999,
                background: department ? "#1a1a1a" : "rgba(0,0,0,0.1)",
                color: department ? "#fff" : "#999",
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                cursor: department ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Continue
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Product Picker */}
      {step === 2 && (
        <div>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 12 }}>
              Pick your tools
            </h1>
            <p style={{ fontSize: 16, color: "#666" }}>
              We&apos;ve pre-selected what fits — toggle anything to add or remove. You can change this later.
            </p>
            <div style={{ marginTop: 12, fontSize: 13, color: "#7c3aed", fontWeight: 500 }}>
              {selected.size} product{selected.size === 1 ? "" : "s"} selected
            </div>
          </div>

          {suiteOrder.map((suite) => {
            const list = productsBySuite.get(suite);
            if (!list || list.length === 0) return null;
            return (
              <section key={suite} style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 12 }}>
                  {suite === "CROSS" ? "Core (always on)" : suite.charAt(0) + suite.slice(1).toLowerCase()}
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                  {list.map((p) => {
                    const isSelected = selected.has(p.slug);
                    const isCore = p.suite === "CROSS";
                    const isComingSoon = p.status === "COMING_SOON";
                    return (
                      <button
                        key={p.slug}
                        type="button"
                        onClick={() => !isCore && !isComingSoon && toggleProduct(p.slug)}
                        disabled={isCore || isComingSoon}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: 14,
                          borderRadius: 10,
                          border: isSelected ? "2px solid #7c3aed" : "2px solid rgba(0,0,0,0.08)",
                          background: isSelected ? "rgba(124,58,237,0.04)" : "#fff",
                          cursor: isCore || isComingSoon ? "default" : "pointer",
                          textAlign: "left",
                          opacity: isComingSoon ? 0.5 : 1,
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 6,
                            border: isSelected ? "2px solid #7c3aed" : "2px solid rgba(0,0,0,0.15)",
                            background: isSelected ? "#7c3aed" : "transparent",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginTop: 2,
                          }}
                        >
                          {isSelected && <Check size={12} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{p.name.replace(/^WorkwrK /, "")}</span>
                            {isCore && (
                              <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "rgba(124,58,237,0.1)", color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.05em" }}>Core</span>
                            )}
                            {isComingSoon && (
                              <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.1)", color: "#d97706", textTransform: "uppercase", letterSpacing: "0.05em" }}>Soon</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: "#666" }}>{p.tagline}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 880, margin: "32px auto 0" }}>
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{ padding: "10px 16px", border: "none", background: "transparent", color: "#666", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              onClick={handleComplete}
              disabled={saving || selected.size === 0}
              style={{
                padding: "10px 24px",
                borderRadius: 999,
                background: saving || selected.size === 0 ? "rgba(0,0,0,0.1)" : "#1a1a1a",
                color: saving || selected.size === 0 ? "#999" : "#fff",
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                cursor: saving || selected.size === 0 ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {saving ? "Setting up your workspace…" : `Set up workspace (${selected.size})`}
              {!saving && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Ready */}
      {step === 3 && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #ec4899)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 32,
            }}
          >
            <Check size={36} />
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 12 }}>
            Your workspace is ready
          </h1>
          <p style={{ fontSize: 16, color: "#666", maxWidth: 480, margin: "0 auto 40px" }}>
            We&apos;ve installed {selected.size} product{selected.size === 1 ? "" : "s"} tuned for {DEPARTMENTS.find((d) => d.id === department)?.label.toLowerCase()}.
            Everything you need is in the left sidebar — Workspace, Sidekick, Agents, Build, Meetings, Favorites, More.
          </p>
          <Link
            href="/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 32px",
              borderRadius: 999,
              background: "#1a1a1a",
              color: "#fff",
              fontSize: 15,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Open my workspace
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
    </div>
  );
}
