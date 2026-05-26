"use client";

import { useState } from "react";
import { Store, Plus, Check } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE, getAllModules } from "@/components/layout/os/catalog";

type Tier = "core" | "plus" | "suite" | "free";
type StoreCategory = "core" | "people" | "sales" | "ops" | "it" | "marketing" | "engineering" | "finance" | "legal" | "support" | "ai" | "integrations";

type StoreItem = {
  id: string;
  name: string;
  desc: string;
  category: StoreCategory;
  tier: Tier;
  installed: boolean;
  initial?: string;
  IconKey?: string;
  badge?: string;
};

// Curated category mapping for the catalog modules (keeps the store
// taxonomy clean instead of dumping all 60 under "All").
const CATEGORY_MAP: Record<string, StoreCategory> = {
  tasks: "core", meetings: "core", okrs: "core", sops: "core", docs: "core",
  whiteboards: "core", kudos: "core", announcements: "core", ideas: "core",
  policies: "core", activity: "core", inbox: "core",
  people: "people", organization: "people", recruiting: "people", reviews: "people",
  talent: "people", learning: "people", compensation: "people", benefits: "people",
  "time-off": "people", timesheets: "people", clock: "people", payroll: "people",
  onboarding: "people", "kra-kpi": "people", "workforce-planning": "people",
  "my-benefits": "people",
  crm: "sales",
  procurement: "ops", assets: "ops", autopilot: "ops", "process-runs": "ops",
  itsm: "it",
  marketing: "marketing",
  dev: "engineering",
  financials: "finance", planning: "finance", expenses: "finance",
  legal: "legal",
  helpdesk: "support",
  sidekick: "ai", agents: "ai", ai: "ai", notetaker: "ai", analytics: "ai",
  studio: "ai", build: "ai", tools: "ai",
};

const TIER_MAP: Record<string, Tier> = {
  tasks: "core", meetings: "core", okrs: "core", sops: "core", docs: "core",
  whiteboards: "core", kudos: "core", announcements: "core", ideas: "core",
  policies: "core", activity: "core", inbox: "core", favorites: "core",
  // Suite-level (premium)
  payroll: "suite", benefits: "suite", legal: "suite",
  financials: "suite", planning: "suite",
  agents: "suite", autopilot: "suite", notetaker: "suite",
  // Most others are plus
};

const INSTALLED = new Set([
  "tasks", "meetings", "okrs", "sops", "docs", "inbox", "announcements",
  "people", "organization", "recruiting", "reviews", "compensation",
  "time-off", "timesheets", "payroll", "onboarding",
  "crm", "marketing", "dev", "itsm", "helpdesk",
  "expenses", "procurement", "assets",
  "sidekick", "agents", "ai", "settings", "account",
]);

const CATEGORIES = [
  { id: "all",          label: "All",          gradient: GRAD.bluePurple },
  { id: "installed",    label: "Installed",    gradient: GRAD.tealGreen },
  { id: "ai",           label: "AI",           gradient: GRAD.pinkPurple },
  { id: "people",       label: "People & HR",  gradient: GRAD.pinkPurple },
  { id: "sales",        label: "Sales",        gradient: GRAD.greenTeal },
  { id: "ops",          label: "Operations",   gradient: GRAD.brownOrange },
  { id: "engineering",  label: "Engineering",  gradient: GRAD.indigoBlue },
  { id: "finance",      label: "Finance",      gradient: GRAD.tealGreen },
  { id: "marketing",    label: "Marketing",    gradient: GRAD.orangePink },
  { id: "support",      label: "Support",      gradient: GRAD.orangePink },
  { id: "it",           label: "IT",           gradient: GRAD.bluePurple },
  { id: "legal",        label: "Legal",        gradient: GRAD.purpleIndigo },
  { id: "core",         label: "Core",         gradient: GRAD.indigoBlue },
];

const FEATURED_INTEGRATIONS = [
  { id: "gmail",        name: "Gmail",        desc: "Sync threads into CRM and surface them in your Inbox.", gradient: "#EA4335", initial: "G", category: "integrations" as const, tier: "free" as const },
  { id: "slack",        name: "Slack",        desc: "Cross-post updates, get notifications, run commands.",  gradient: "#4A154B", initial: "S", category: "integrations" as const, tier: "free" as const },
  { id: "googlecal",    name: "Google Cal",   desc: "Two-way meeting sync. Sidekick books with attendees.", gradient: "#4285F4", initial: "C", category: "integrations" as const, tier: "free" as const },
  { id: "github",       name: "GitHub",       desc: "Link PRs to tasks, surface CI status on items.",       gradient: "#181717", initial: "G", category: "integrations" as const, tier: "free" as const },
  { id: "stripe",       name: "Stripe",       desc: "Mirror customers, invoices, subscriptions into CRM.",  gradient: "#635BFF", initial: "S", category: "integrations" as const, tier: "free" as const },
  { id: "salesforce",   name: "Salesforce",   desc: "Two-way sync of accounts, contacts, and opportunities.", gradient: "#00A1E0", initial: "S", category: "integrations" as const, tier: "plus" as const },
  { id: "hubspot",      name: "HubSpot",      desc: "Sync contacts, campaigns, deal pipeline.",             gradient: "#FF7A59", initial: "H", category: "integrations" as const, tier: "plus" as const },
  { id: "zoom",         name: "Zoom",         desc: "Auto-record meetings, attach transcripts to items.",   gradient: "#2D8CFF", initial: "Z", category: "integrations" as const, tier: "free" as const },
  { id: "linear",       name: "Linear",       desc: "Pull issues into Dev tasks. Status syncs both ways.",  gradient: "#5E6AD2", initial: "L", category: "integrations" as const, tier: "free" as const },
];

export default function StorePage() {
  const [filter, setFilter] = useState<string>("all");

  const moduleItems: StoreItem[] = getAllModules().map((m) => ({
    id: m.id,
    name: m.name,
    desc: m.description,
    category: CATEGORY_MAP[m.id] ?? "core",
    tier: TIER_MAP[m.id] ?? "plus",
    installed: INSTALLED.has(m.id),
  }));

  const integrationItems: StoreItem[] = FEATURED_INTEGRATIONS.map((i) => ({
    id: `int-${i.id}`,
    name: i.name,
    desc: i.desc,
    category: "integrations",
    tier: i.tier,
    installed: false,
    initial: i.initial,
  }));

  const all: (StoreItem & { gradient?: string })[] = [
    ...moduleItems.map((m) => {
      const mod = getAllModules().find((x) => x.id === m.id);
      return { ...m, gradient: mod?.gradient ?? GRAD.bluePurple, IconKey: m.id };
    }),
    ...integrationItems.map((i) => {
      const meta = FEATURED_INTEGRATIONS.find((f) => `int-${f.id}` === i.id);
      return { ...i, gradient: meta?.gradient ?? GRAD.bluePurple };
    }),
  ];

  const shown = all.filter((it) => {
    if (filter === "all") return it.category !== "integrations";
    if (filter === "installed") return it.installed;
    return it.category === filter;
  });

  const installedCount = all.filter((m) => m.installed).length;

  return (
    <>
      <OsTitleBar
        title="Marketplace"
        Icon={Store}
        iconGradient={GRAD.orangePink}
        description="Apps, agents, and integrations. Install on-demand. Workspace-scoped."
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />

      <div className="os-mkt">
        <div className="os-mkt__hero">
          <div>
            <div className="os-mkt__hero-eyebrow">App marketplace</div>
            <h2>
              One install away from a{" "}
              <em style={{ fontStyle: "normal", color: "var(--os-c-orange)" }}>complete</em> operating system.
            </h2>
            <p>
              Every app shares the same boards, the same Sidekick, the same agents.
              Install only what your team uses. Uninstall any time without losing data.
            </p>
          </div>
          <div className="os-mkt__hero-side">
            <div className="os-mkt__hero-stat">
              <strong>{installedCount}</strong>
              apps installed
            </div>
            <div className="os-mkt__hero-stat">
              <strong>{all.length}</strong>
              apps + integrations available
            </div>
            <div className="os-mkt__hero-stat">
              <strong>50+</strong>
              integrations supported
            </div>
          </div>
        </div>

        <div className="os-mkt__filters">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`os-mkt__filter ${filter === c.id ? "is-on" : ""}`}
              onClick={() => setFilter(c.id)}
            >
              {c.label}
              {c.id === "all" ? <span className="os-mkt__filter-count">{all.filter((x) => x.category !== "integrations").length}</span> : null}
              {c.id === "installed" ? <span className="os-mkt__filter-count">{installedCount}</span> : null}
            </button>
          ))}
          <button
            type="button"
            className={`os-mkt__filter ${filter === "integrations" ? "is-on" : ""}`}
            onClick={() => setFilter("integrations")}
            style={{ marginLeft: "auto" }}
          >
            Integrations
            <span className="os-mkt__filter-count">{integrationItems.length}</span>
          </button>
        </div>

        <h3 className="os-mkt__section-title">
          {CATEGORIES.find((c) => c.id === filter)?.label ?? "Integrations"}
          <span>{shown.length} items</span>
        </h3>

        <div className="os-mkt__grid">
          {shown.map((it) => {
            const mod = getAllModules().find((x) => x.id === it.id);
            return (
              <article key={it.id} className="os-mkt-card">
                <div className="os-mkt-card__head">
                  <div
                    className="os-mkt-card__icon"
                    style={{ background: it.gradient ?? GRAD.bluePurple }}
                  >
                    {mod ? <mod.Icon /> : it.initial ?? it.name[0]}
                  </div>
                  <div className="os-mkt-card__head-text">
                    <div className="os-mkt-card__name">{it.name}</div>
                    <div className="os-mkt-card__role">
                      {it.category === "integrations" ? "Integration" : CATEGORIES.find((c) => c.id === it.category)?.label}
                    </div>
                  </div>
                </div>
                <p className="os-mkt-card__desc">{it.desc}</p>
                <div className="os-mkt-card__foot">
                  <span className={`os-mkt-card__tier os-mkt-card__tier--${it.tier}`}>{it.tier}</span>
                  {it.installed ? (
                    <button type="button" className="os-mkt-card__btn os-mkt-card__btn--installed">
                      <Check />
                      Installed
                    </button>
                  ) : (
                    <button type="button" className="os-mkt-card__btn os-mkt-card__btn--install">
                      <Plus />
                      Install
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
