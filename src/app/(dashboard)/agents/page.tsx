"use client";

import { useState } from "react";
import { Bot, Plus, Check, MessageCircle } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";

type Agent = {
  id: string;
  name: string;
  role: string;
  desc: string;
  initial: string;
  gradient: string;
  skills: string[];
  metrics: { drafts: number; tasks: number; saved: string };
  tier: "core" | "plus" | "suite" | "free";
  installed: boolean;
  badge?: string;
  category: "sales" | "hr" | "ops" | "support" | "finance" | "marketing" | "exec";
};

const AGENTS: Agent[] = [
  {
    id: "ria", name: "Ria", role: "Sales Development Rep",
    desc: "Drafts cold emails, qualifies inbound leads, books meetings, and follows up on stalled deals — all with your tone of voice.",
    initial: "R", gradient: GRAD.orangePink, category: "sales",
    skills: ["Email drafting", "Lead enrichment", "Pipeline", "Salesforce", "Gmail"],
    metrics: { drafts: 12, tasks: 28, saved: "6h/wk" },
    tier: "plus", installed: true,
  },
  {
    id: "priya", name: "Priya", role: "HR Ops",
    desc: "Runs onboarding checklists, schedules 1:1s, drafts policy reminders, and routes time-off + expense approvals.",
    initial: "P", gradient: GRAD.pinkPurple, category: "hr",
    skills: ["Onboarding", "Approvals", "Slack", "Policies", "Calendar"],
    metrics: { drafts: 4, tasks: 17, saved: "8h/wk" },
    tier: "plus", installed: true,
  },
  {
    id: "maya", name: "Maya", role: "Recruiter",
    desc: "Sources candidates, schedules interviews, drafts offer letters, and keeps the ATS up-to-date as candidates move through the pipeline.",
    initial: "M", gradient: GRAD.greenTeal, category: "hr",
    skills: ["Sourcing", "ATS sync", "Calendly", "LinkedIn", "Offer letters"],
    metrics: { drafts: 0, tasks: 8, saved: "12h/wk" },
    tier: "suite", installed: false, badge: "New",
  },
  {
    id: "aman", name: "Aman", role: "IT Help Desk",
    desc: "Triages incoming tickets, auto-resolves common requests (password, SSO, VPN), and routes SEV-1 incidents to on-call engineers.",
    initial: "A", gradient: GRAD.bluePurple, category: "ops",
    skills: ["Triage", "Auto-resolve", "Jira", "PagerDuty", "Slack"],
    metrics: { drafts: 0, tasks: 41, saved: "15h/wk" },
    tier: "plus", installed: true,
  },
  {
    id: "rio", name: "Rio", role: "Customer Support",
    desc: "Answers tier-1 support tickets using your KB, escalates complex cases with full context, and tags conversations for product feedback.",
    initial: "R", gradient: GRAD.yellowOrange, category: "support",
    skills: ["KB search", "Macros", "Zendesk", "Intercom", "CSAT"],
    metrics: { drafts: 0, tasks: 53, saved: "20h/wk" },
    tier: "suite", installed: false,
  },
  {
    id: "vinay", name: "Vinay", role: "Finance Analyst",
    desc: "Categorizes expenses, flags anomalies, reconciles bank statements, and assembles weekly cashflow reports for review.",
    initial: "V", gradient: GRAD.tealGreen, category: "finance",
    skills: ["OCR receipts", "Reconciliation", "Reports", "QuickBooks", "Xero"],
    metrics: { drafts: 2, tasks: 14, saved: "10h/wk" },
    tier: "suite", installed: false,
  },
  {
    id: "diya", name: "Diya", role: "Marketing Operations",
    desc: "Drafts campaign briefs, schedules social posts, runs A/B tests on subject lines, and reports on open + click rates each Monday.",
    initial: "D", gradient: GRAD.indigoBlue, category: "marketing",
    skills: ["Campaigns", "A/B tests", "HubSpot", "Mailchimp", "Buffer"],
    metrics: { drafts: 6, tasks: 22, saved: "9h/wk" },
    tier: "plus", installed: false,
  },
  {
    id: "sage", name: "Sage", role: "Legal & Compliance",
    desc: "Reviews contracts for risky clauses, drafts NDAs from templates, tracks renewal dates, and routes privacy requests (GDPR / DPDP) to the right team.",
    initial: "S", gradient: GRAD.brownOrange, category: "ops",
    skills: ["Contract review", "NDA gen", "Renewal alerts", "GDPR", "DPDP"],
    metrics: { drafts: 3, tasks: 7, saved: "6h/wk" },
    tier: "suite", installed: false, badge: "Beta",
  },
  {
    id: "ash", name: "Ash", role: "Chief of Staff",
    desc: "Your second brain. Drafts board updates, summarizes weekly metrics, prepares 1:1 agendas, and surfaces what needs your attention each morning.",
    initial: "A", gradient: GRAD.purpleIndigo, category: "exec",
    skills: ["Summaries", "1:1 prep", "Board updates", "Slack", "All apps"],
    metrics: { drafts: 8, tasks: 19, saved: "10h/wk" },
    tier: "suite", installed: true, badge: "★ Hero",
  },
];

const FILTERS = [
  { id: "all", label: "All agents" },
  { id: "installed", label: "Installed" },
  { id: "sales", label: "Sales" },
  { id: "hr", label: "HR & People" },
  { id: "ops", label: "Operations" },
  { id: "support", label: "Support" },
  { id: "finance", label: "Finance" },
  { id: "marketing", label: "Marketing" },
  { id: "exec", label: "Executive" },
];

export default function AgentsPage() {
  const [filter, setFilter] = useState("all");

  const shown = AGENTS.filter((a) => {
    if (filter === "all") return true;
    if (filter === "installed") return a.installed;
    return a.category === filter;
  });

  const installedCount = AGENTS.filter((a) => a.installed).length;
  const totalSaved = AGENTS.filter((a) => a.installed).reduce(
    (acc, a) => acc + parseInt(a.metrics.saved, 10),
    0,
  );

  return (
    <>
      <OsTitleBar
        title="Agents"
        Icon={Bot}
        iconGradient={GRAD.bluePurple}
        description="Hire AI teammates. They show up in Sidekick, your Inbox, and on the boards they own."
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.pr]}
        morePeople={9}
      />

      <div className="os-mkt">
        <div className="os-mkt__hero">
          <div>
            <div className="os-mkt__hero-eyebrow">Agent marketplace</div>
            <h2>
              Build a team that{" "}
              <em style={{ fontStyle: "normal", color: "var(--os-c-orange)" }}>runs itself</em>.
            </h2>
            <p>
              Each agent is a domain expert — they read your boards, draft work for your approval,
              and run autonomously when you let them. Together they take 50+ hours of busywork off
              your plate every week.
            </p>
          </div>
          <div className="os-mkt__hero-side">
            <div className="os-mkt__hero-stat">
              <strong>{installedCount}</strong>
              agents hired
            </div>
            <div className="os-mkt__hero-stat">
              <strong>~{totalSaved}h</strong>
              saved per week
            </div>
            <div className="os-mkt__hero-stat">
              <strong>156</strong>
              tasks delegated this month
            </div>
          </div>
        </div>

        <div className="os-mkt__filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`os-mkt__filter ${filter === f.id ? "is-on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id === "installed" ? <span className="os-mkt__filter-count">{installedCount}</span> : null}
              {f.id === "all" ? <span className="os-mkt__filter-count">{AGENTS.length}</span> : null}
            </button>
          ))}
        </div>

        <h3 className="os-mkt__section-title">
          {filter === "all" ? "All agents" : FILTERS.find((f) => f.id === filter)?.label}
          <span>{shown.length} available</span>
        </h3>

        <div className="os-mkt__grid">
          {shown.map((a) => (
            <article key={a.id} className="os-mkt-card">
              {a.badge ? <span className="os-mkt-card__badge">{a.badge}</span> : null}
              <div className="os-mkt-card__head">
                <div className="os-mkt-card__icon" style={{ background: a.gradient }}>
                  {a.initial}
                </div>
                <div className="os-mkt-card__head-text">
                  <div className="os-mkt-card__name">{a.name}</div>
                  <div className="os-mkt-card__role">{a.role}</div>
                </div>
              </div>
              <p className="os-mkt-card__desc">{a.desc}</p>
              <div className="os-mkt-card__metrics">
                <div className="os-mkt-card__metric">
                  <strong>{a.metrics.drafts}</strong>
                  drafts today
                </div>
                <div className="os-mkt-card__metric">
                  <strong>{a.metrics.tasks}</strong>
                  tasks/wk
                </div>
                <div className="os-mkt-card__metric">
                  <strong>{a.metrics.saved}</strong>
                  saved
                </div>
              </div>
              <div className="os-mkt-card__skills">
                {a.skills.map((s) => (
                  <span key={s} className="os-mkt-card__skill">{s}</span>
                ))}
              </div>
              <div className="os-mkt-card__foot">
                <span className={`os-mkt-card__tier os-mkt-card__tier--${a.tier}`}>{a.tier}</span>
                {a.installed ? (
                  <>
                    <button type="button" className="os-mkt-card__btn os-mkt-card__btn--installed">
                      <Check />
                      Hired
                    </button>
                    <button
                      type="button"
                      className="os-mkt-card__btn os-mkt-card__btn--chat"
                      style={{ marginLeft: 0 }}
                    >
                      <MessageCircle />
                      Chat
                    </button>
                  </>
                ) : (
                  <button type="button" className="os-mkt-card__btn os-mkt-card__btn--install">
                    <Plus />
                    Hire
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
