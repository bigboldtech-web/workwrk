"use client";

import { useEffect, useState } from "react";
import { Bot, Plus, Lock } from "lucide-react";

// Agents — AI specialists with persistent personas.
//
// Stub for now. Phase D will deliver:
//   - Carousel of prebuilt agents per product (Priya, Sam, Aman, Ria, …)
//   - Custom agent builder
//   - Multi-agent orchestration (handoff + shared memory)
//   - Per-agent run history + cost tracking
//
// This stub shows the 12 launch agents as preview cards so the rail has
// something credible to render until the backend is wired.

interface PrebuiltAgent {
  slug: string;
  name: string;
  persona: string;
  product: string;
  hue: string;
}

const LAUNCH_AGENTS: PrebuiltAgent[] = [
  { slug: "priya-hr", name: "Priya", persona: "HR Generalist", product: "WorkwrK People", hue: "blue" },
  { slug: "sam-recruiter", name: "Sam", persona: "Recruiter Copilot", product: "WorkwrK Recruit", hue: "violet" },
  { slug: "maya-onboarding", name: "Maya", persona: "Onboarding Concierge", product: "WorkwrK People", hue: "teal" },
  { slug: "devi-payroll", name: "Devi", persona: "Payroll Specialist", product: "WorkwrK Pay", hue: "green" },
  { slug: "ria-sdr", name: "Ria", persona: "SDR Copilot", product: "WorkwrK CRM", hue: "green" },
  { slug: "aman-it-tech", name: "Aman", persona: "IT Tech", product: "WorkwrK ITSM", hue: "blue" },
  { slug: "nathan-sourcer", name: "Nathan", persona: "Vendor Sourcer", product: "WorkwrK Procurement", hue: "sky" },
  { slug: "ex-expense-auditor", name: "Ex", persona: "Expense Auditor", product: "WorkwrK Expense", hue: "amber" },
  { slug: "booker-bookkeeper", name: "Booker", persona: "Bookkeeper", product: "WorkwrK Books", hue: "blue" },
  { slug: "dev-sprint-coach", name: "Dev", persona: "Sprint Coach", product: "WorkwrK Dev", hue: "violet" },
  { slug: "leila-contract-reviewer", name: "Leila", persona: "Contract Reviewer", product: "WorkwrK Contracts", hue: "blue" },
  { slug: "mira-campaign-manager", name: "Mira", persona: "Campaign Manager", product: "WorkwrK Campaigns", hue: "amber" },
];

export default function AgentsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium mb-3">
            <Bot size={12} />
            Agents
          </div>
          <h1 className="text-3xl font-semibold mb-1">Build your own workforce in minutes</h1>
          <p className="text-muted max-w-xl">
            Expand what you can achieve. Get faster, better results from one place
            with full control and visibility.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
        >
          <Plus size={14} />
          Create agent
          <Lock size={11} className="ml-1" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {LAUNCH_AGENTS.map((a) => (
          <article
            key={a.slug}
            className="group rounded-2xl border border-border bg-surface hover:border-violet-300 transition-all hover:shadow-md p-5"
          >
            <div
              className={`w-16 h-16 rounded-2xl bg-${a.hue}-100 text-${a.hue}-600 flex items-center justify-center text-2xl font-bold mb-4`}
              aria-hidden
            >
              {a.name[0]}
            </div>
            <h3 className="font-semibold text-lg mb-1">{a.name}</h3>
            <p className="text-xs text-muted mb-1">{a.persona}</p>
            <p className="text-[11px] text-muted-2 mb-3">{a.product}</p>
            <button
              type="button"
              disabled
              className="text-xs px-3 py-1 rounded-md border border-border text-muted disabled:opacity-50"
            >
              Coming soon
            </button>
          </article>
        ))}
      </div>

      {mounted && (
        <div className="mt-12 p-6 rounded-2xl border-2 border-dashed border-border bg-surface-2 text-center">
          <p className="text-sm text-muted">
            Phase D ships the runtime: install prebuilt agents, customize their persona +
            tools, build your own from a prompt, and let them work in the background while
            you focus on the bigger picture.
          </p>
        </div>
      )}
    </div>
  );
}
