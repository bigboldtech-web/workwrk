// Features page — rebuilt to match landing v4 + hub IA.
//
// Each of the seven sidebar hubs gets its own section: hero tagline,
// long-form body, and a grid of feature cards with icon + name + blurb.
// Anchor IDs on each section (#home, #people, ...) so landing v4 can
// deep-link from its hub cards.

import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, Sparkles,
  LayoutDashboard, Users, CalendarDays, DollarSign, Star, Megaphone, Wrench,
  Inbox, Crosshair, Target, BookOpen, Briefcase, Receipt, ShoppingCart,
  GraduationCap, Heart, Shield, MessageSquareHeart, Lightbulb, ClipboardCheck,
  Activity, Link2, Palette, Bot, Grid3x3, Building2,
  type LucideIcon,
} from "lucide-react";
import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";

export const metadata: Metadata = {
  title: "Features — WorkwrK",
  description:
    "Seven hubs, one product. Home, People, Work, Money, Talent, Culture, Platform — built around how teams actually work, not how vendors sell.",
  alternates: { canonical: "https://workwrk.com/features" },
};

interface Hub {
  anchor: string;
  icon: LucideIcon;
  name: string;
  tagline: string;
  body: string;
  features: { icon: LucideIcon; name: string; blurb: string }[];
}

const HUBS: readonly Hub[] = [
  {
    anchor: "home",
    icon: LayoutDashboard,
    name: "Home",
    tagline: "What needs you, right now.",
    body: "The front door of WorkwrK. Confident morning greeting, KPIs that matter today, and an Inbox that triages 12 different work-streams into one prioritized list. AI suggests what's safe to bulk-approve so you stop drowning in routine decisions.",
    features: [
      { icon: Inbox, name: "Inbox", blurb: "Approvals, tasks, mandatory courses, reviews — one list, AI-triaged, bulk-actionable." },
      { icon: Sparkles, name: "Cmd-K AI", blurb: "Search every entity, then ask follow-ups in plain English. Cross-module answers from your live data." },
      { icon: Bot, name: "AI Assistant", blurb: "Anthropic-powered. Knows your data. Refuses to make things up." },
    ],
  },
  {
    anchor: "people",
    icon: Users,
    name: "People",
    tagline: "The org, the lookups, the structure.",
    body: "Profiles deeper than HRIS. Departments, roles, offices, reporting lines. Live org chart you can drag to reorg. People directory with search-first UX and per-field filter rail.",
    features: [
      { icon: Users, name: "People directory", blurb: "Search-first. Filter by department, role, status, office. Click a person; see everything." },
      { icon: Building2, name: "Org chart", blurb: "Live, dynamic, drag-to-reorg. Department + role hierarchies always reflect reality." },
    ],
  },
  {
    anchor: "work",
    icon: CalendarDays,
    name: "Work",
    tagline: "Tasks, OKRs, KPIs, SOPs — every cadence.",
    body: "Plan the week, score the month, document the process. Day / Week / Month / List / Gantt views over the same tasks. KRAs and KPIs cascade into composite scores. OKRs flow Company → Team → Individual. SOPs become Process Runs you hand off.",
    features: [
      { icon: CalendarDays, name: "Tasks", blurb: "Drag between days. Cross-day reorder. Recurring patterns. Subtasks, labels, time spent, SLA escalation." },
      { icon: Crosshair, name: "OKRs", blurb: "Company → Team → Individual cascade. Progress auto-computes from KR check-ins." },
      { icon: Target, name: "KRAs + KPIs", blurb: "Per-role scoring. Composite score blends KPIs + reviews + SOP compliance." },
      { icon: BookOpen, name: "SOPs", blurb: "Versioned playbooks with rollback. Folder ACL. Compliance tracking per version." },
      { icon: BookOpen, name: "Process Runs", blurb: "Instances of an SOP run by a specific person against a specific record." },
    ],
  },
  {
    anchor: "money",
    icon: DollarSign,
    name: "Money",
    tagline: "Expenses to full GL — one ledger.",
    body: "Submit, approve, account. Expenses route through Studio workflows. POs match invoices with duplicate-detection at the schema. Statements (P&L, Balance Sheet, Cash Flow) on demand. Adaptive Planning with variance reports against actuals.",
    features: [
      { icon: Receipt, name: "Expenses", blurb: "Submit in seconds, approve in the Inbox queue. Receipts attach. Reimbursement tracked end-to-end." },
      { icon: ShoppingCart, name: "Procurement", blurb: "Vendors → POs → invoices. Approval chains route via Studio workflows. Auto-numbered + state-machine." },
      { icon: DollarSign, name: "Financials", blurb: "Chart of accounts, journal entries, period close, P&L / BS / Cash Flow on demand." },
      { icon: Target, name: "Adaptive Planning", blurb: "Budget plans + scenarios + driver-based forecasts. Variance vs actuals with drill-through." },
    ],
  },
  {
    anchor: "talent",
    icon: Star,
    name: "Talent",
    tagline: "Reviews, comp, hiring, learning.",
    body: "The ceremonies that compound. 360° performance cycles with self + manager + peer. Compensation decisions with approval chains. Recruiting pipeline. Talent grid (9-box). Mandatory learning with compliance tracking.",
    features: [
      { icon: Star, name: "Reviews", blurb: "Self + manager + peer + upward. Composite scoring. 48-hour cycles supported." },
      { icon: DollarSign, name: "Compensation", blurb: "Cycles, proposals, approval chains. Subject never sees the proposal pre-decision." },
      { icon: GraduationCap, name: "Onboarding", blurb: "Per-role templates. New hire's Inbox lights up on day one with the right checklist." },
      { icon: Briefcase, name: "Recruiting", blurb: "Reqs → candidates → applications → interviews → offers. Full pipeline tracking." },
      { icon: Grid3x3, name: "Talent Grid", blurb: "9-box (performance × potential). Drives promotion + PIP conversations." },
      { icon: GraduationCap, name: "Learning", blurb: "Mandatory courses with compliance tracking. Catalog for self-enrollment." },
    ],
  },
  {
    anchor: "culture",
    icon: Megaphone,
    name: "Culture",
    tagline: "Broadcast, recognize, signal.",
    body: "The bandwidth between the org and its people. Must-acknowledge announcements with tracking. Kudos that build into recognition scores. Pulse surveys + ideas board + manager candor channels.",
    features: [
      { icon: Megaphone, name: "Announcements", blurb: "Scheduled publishing, must-acknowledge tracking, audience targeting, expirations." },
      { icon: Heart, name: "Kudos", blurb: "Tag colleagues with company values. Auto-counts toward recognition score on profiles." },
      { icon: Shield, name: "Policies", blurb: "Versioned. Acknowledgement tracking. Periodic re-acknowledge triggers." },
      { icon: Lightbulb, name: "Ideas", blurb: "Improvement suggestions with voting + manager response pipeline." },
      { icon: ClipboardCheck, name: "Pulse surveys", blurb: "Weekly rotating prompts. Anonymous or attributed. Trends over time." },
      { icon: MessageSquareHeart, name: "Candor", blurb: "Async upward feedback. Routed to managers with response tracking." },
    ],
  },
  {
    anchor: "platform",
    icon: Wrench,
    name: "Platform",
    tagline: "Customize, govern, observe.",
    body: "The leverage layer. Custom workflows + custom fields per entity. SCIM + SAML SSO. Full audit log with severity tagging. Tools catalog with shared credentials. Cron-driven integrations.",
    features: [
      { icon: Wrench, name: "Studio workflows", blurb: "Visual approval-chain builder. Start from templates: 1-up, dual-sign, three-tier, HR-gated." },
      { icon: Link2, name: "Integrations", blurb: "Slack, Google Calendar, Anthropic BYOK, QuickBooks + Xero (in progress)." },
      { icon: Palette, name: "Brand guide", blurb: "Per-org logo, accent, type. Brand-aware emails + exports." },
      { icon: Activity, name: "Audit log", blurb: "Every mutation with actor / target / old / new. SOC-2 ready. Severity-tagged." },
      { icon: Shield, name: "SCIM + SSO", blurb: "SAML + OIDC. SCIM provisioning. Field-level RBAC matrix." },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <MarketingTopbar />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 lg:px-10 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium px-3 h-7 rounded-full border border-border bg-surface mb-6">
          <Sparkles size={11} className="text-[color:var(--accent-strong)]" />
          Features
        </div>
        <h1 className="text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-[1.05]">
          Seven hubs.<br />
          <span className="text-[color:var(--accent-strong)]">One product.</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto leading-relaxed">
          WorkwrK's information architecture maps to how teams actually work —
          not to the org chart of the company that built it. Each hub is a
          coherent surface; together they replace ~15 SaaS subscriptions.
        </p>

        {/* Hub jump-nav */}
        <nav className="mt-10 flex items-center gap-1.5 flex-wrap justify-center">
          {HUBS.map((h) => (
            <a
              key={h.anchor}
              href={`#${h.anchor}`}
              className="text-xs font-medium px-3 h-7 inline-flex items-center rounded-full border border-border text-muted hover:text-foreground hover:border-muted-2 transition-fast"
            >
              {h.name}
            </a>
          ))}
        </nav>
      </section>

      {/* ── Hub sections ─────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto pb-12">
        {HUBS.map((hub, hubIndex) => {
          const HubIcon = hub.icon;
          return (
            <section
              key={hub.name}
              id={hub.anchor}
              className={`px-6 lg:px-10 py-20 ${hubIndex > 0 ? "border-t border-border" : ""}`}
            >
              {/* Hub header */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10 mb-12">
                <div>
                  <div className="flex items-center gap-3 mb-5">
                    <span
                      className="h-11 w-11 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}
                    >
                      <HubIcon size={22} />
                    </span>
                    <h2 className="text-3xl font-bold tracking-tight">{hub.name}</h2>
                  </div>
                  <p className="text-base font-medium text-foreground leading-snug">{hub.tagline}</p>
                </div>
                <div>
                  <p className="text-[15px] text-muted leading-relaxed">{hub.body}</p>
                </div>
              </div>

              {/* Feature cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {hub.features.map((f) => {
                  const FIcon = f.icon;
                  return (
                    <div
                      key={f.name}
                      className="rounded-xl border border-border bg-surface/40 p-5 hover:border-[color:var(--accent)]/40 hover:bg-background transition-fast"
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <FIcon size={14} className="text-[color:var(--accent-strong)]" />
                        <h3 className="text-sm font-semibold">{f.name}</h3>
                      </div>
                      <p className="text-[13px] text-muted leading-relaxed">{f.blurb}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* ── Final CTA ────────────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-24 text-center">
          <h2 className="text-4xl font-bold tracking-tight mb-5">
            Try every hub on a real workspace.
          </h2>
          <p className="text-muted mb-8">
            Free under five people. Set up in an hour.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-7 h-12 rounded-xl bg-[color:var(--accent)] text-white font-semibold hover:opacity-90 transition-fast shadow-[0_8px_24px_-8px_rgba(124,58,237,0.5)]"
          >
            Start free
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
