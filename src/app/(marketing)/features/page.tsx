// Features page — Phase H revamp.
//
// Replaces the v2 grouped-by-domain feature wall with a hub-aligned
// page. Each of the seven sidebar hubs gets a section: what it does,
// the marquee capabilities, and a link to the dedicated module page
// when it lands.
//
// One promise per hub, then the proof. No carousels, no infinite
// scrolling feature lists.

import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  LayoutDashboard, Users, CalendarDays, DollarSign, Star, Megaphone, Wrench,
  Sparkles, Inbox, Crosshair, Target, BookOpen, Briefcase, Receipt, ShoppingCart,
  GraduationCap, Heart, Shield, MessageSquareHeart, Lightbulb, ClipboardCheck,
  Activity, Link2, Palette, Bot, Grid3x3, Building2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";

export const metadata: Metadata = {
  title: "Features — WorkwrK",
  description:
    "Seven hubs, one product. Home, People, Work, Money, Talent, Culture, Platform — built around how teams actually work.",
  alternates: { canonical: "https://workwrk.com/features" },
};

interface Hub {
  icon: LucideIcon;
  name: string;
  tagline: string;
  body: string;
  features: { icon: LucideIcon; name: string; blurb: string }[];
}

const HUBS: readonly Hub[] = [
  {
    icon: LayoutDashboard,
    name: "Home",
    tagline: "What needs you, right now.",
    body: "The front door of WorkwrK. A confident greeting, the KPIs that matter today, and an Inbox that triages 12 different work-streams into one prioritized list.",
    features: [
      { icon: Inbox, name: "Inbox", blurb: "Approvals, tasks, mandatory courses, reviews, and decisions across every module — one list, AI-triaged." },
      { icon: Sparkles, name: "Cmd-K AI", blurb: "Search across every entity, then ask follow-ups in plain English. Cross-module answers in real time." },
      { icon: Bot, name: "AI Assistant", blurb: "Anthropic-powered. Knows your data. Refuses to make things up." },
    ],
  },
  {
    icon: Users,
    name: "People",
    tagline: "The org, the lookups, the structure.",
    body: "Profiles deeper than HRIS. Departments, roles, offices, reporting lines, and the fast universal lookup that's the entry-point into anyone's day.",
    features: [
      { icon: Users, name: "People directory", blurb: "Search-first. Filter by department, role, status, office. Click a person; see everything." },
      { icon: Building2, name: "Org chart", blurb: "Live, dynamic. Drag to reorg. Department + role hierarchies always reflect reality." },
    ],
  },
  {
    icon: CalendarDays,
    name: "Work",
    tagline: "Tasks, OKRs, KPIs, SOPs — every cadence.",
    body: "Plan the week, score the month, document the process. Calendar / week / month / list / Gantt views on the same underlying tasks. KRAs and KPIs cascade into composite scores.",
    features: [
      { icon: CalendarDays, name: "Tasks", blurb: "Drag between days. Cross-day reorder. Recurring patterns. Subtasks, labels, time spent." },
      { icon: Crosshair, name: "OKRs", blurb: "Company → Team → Individual cascade. Progress auto-computes from KR check-ins." },
      { icon: Target, name: "KRAs + KPIs", blurb: "Per-role scoring. Composite score combines KPIs + reviews + SOP compliance." },
      { icon: BookOpen, name: "SOPs + Process Runs", blurb: "Versioned playbooks. Hand off a checklist; track who finished what." },
    ],
  },
  {
    icon: DollarSign,
    name: "Money",
    tagline: "Expenses to full GL — one ledger.",
    body: "Submit, approve, account. Expenses route through workflows. POs match invoices. Statements (P&L, Balance Sheet, Cash Flow) and Adaptive Planning with variance reports.",
    features: [
      { icon: Receipt, name: "Expenses", blurb: "Submit in seconds, approve in the Inbox queue. Receipts attach. Reimbursement tracked." },
      { icon: ShoppingCart, name: "Procurement", blurb: "Vendors → POs → invoices. Approval chains route via Studio workflows." },
      { icon: DollarSign, name: "Financials", blurb: "Chart of accounts, journal entries, period close, P&L / BS / Cash Flow on demand." },
      { icon: Target, name: "Adaptive Planning", blurb: "Budget plans + scenarios + driver-based forecasts. Variance vs actuals." },
    ],
  },
  {
    icon: Star,
    name: "Talent",
    tagline: "Reviews, comp, hiring, learning.",
    body: "The ceremonies that compound. 360° performance cycles. Compensation decisions with approval chains. Recruiting pipeline. Talent grid (9-box). Mandatory learning with compliance tracking.",
    features: [
      { icon: Star, name: "Reviews", blurb: "Self + manager + peer + upward + skip-level. Composite scoring. 48-hour cycles supported." },
      { icon: DollarSign, name: "Compensation", blurb: "Cycles, proposals, approval chains. Subject never sees the proposal pre-decision." },
      { icon: GraduationCap, name: "Onboarding", blurb: "Per-role templates. New hire's inbox lights up on day one." },
      { icon: Briefcase, name: "Recruiting", blurb: "Reqs → candidates → applications → interviews → offers." },
      { icon: Grid3x3, name: "Talent Grid", blurb: "9-box (performance × potential). Drives promotion + PIP conversations." },
      { icon: GraduationCap, name: "Learning", blurb: "Mandatory courses with compliance tracking. Catalog for self-enroll." },
    ],
  },
  {
    icon: Megaphone,
    name: "Culture",
    tagline: "Broadcast, recognize, signal.",
    body: "The bandwidth between the org and its people. Must-acknowledge announcements. Kudos that build recognition scores. Pulse surveys + ideas + candor channels.",
    features: [
      { icon: Megaphone, name: "Announcements", blurb: "Scheduled publishing, must-acknowledge tracking, audience targeting, expirations." },
      { icon: Heart, name: "Kudos", blurb: "Tag colleagues with company values. Auto-counts toward recognition score." },
      { icon: Shield, name: "Policies", blurb: "Versioned. Acknowledgement tracking. Periodic re-acknowledge triggers." },
      { icon: Lightbulb, name: "Ideas", blurb: "Improvement suggestions with voting. Status pipeline ends in 'rewarded'." },
      { icon: ClipboardCheck, name: "Pulse surveys", blurb: "Weekly rotating prompts. Anonymous or attributed. Trends over time." },
      { icon: MessageSquareHeart, name: "Candor", blurb: "Async upward feedback. Routed to managers with response tracking." },
    ],
  },
  {
    icon: Wrench,
    name: "Platform",
    tagline: "Customize, govern, observe.",
    body: "The leverage layer. Custom workflows + custom fields. SCIM + SSO. Full audit log. Brand guide. Tools catalog with shared credentials. Cron + integrations.",
    features: [
      { icon: Wrench, name: "Studio workflows", blurb: "Visual approval-chain builder. Start from templates: 1-up, dual-sign, three-tier, HR-gated." },
      { icon: Link2, name: "Integrations", blurb: "Slack, Google Calendar, Anthropic BYOK, QuickBooks + Xero (in progress)." },
      { icon: Palette, name: "Brand guide", blurb: "Per-org logo, accent, type. Brand-aware emails + exports." },
      { icon: Activity, name: "Audit log", blurb: "Every mutation with actor / target / old / new. SOC-2 ready. Severity-tagged." },
      { icon: Shield, name: "SCIM + SSO", blurb: "SAML + OIDC. SCIM provisioning. Field-level RBAC." },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingTopbar />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="px-6 pt-20 pb-12 max-w-4xl mx-auto text-center">
        <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3">
          Features
        </p>
        <h1 className="text-5xl font-bold tracking-tight mb-6 leading-[1.1]">
          Seven hubs.<br />
          <span className="text-[color:var(--accent-strong)]">One product.</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto leading-relaxed">
          WorkwrK's information architecture maps to how teams actually work —
          not to the org chart of the company that built it. Each hub is a
          coherent surface; together they replace ~15 SaaS subscriptions.
        </p>
      </section>

      {/* ── Hub sections ─────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto pb-12">
        {HUBS.map((hub, hubIndex) => {
          const HubIcon = hub.icon;
          return (
            <section
              key={hub.name}
              className={`px-6 py-16 ${hubIndex > 0 ? "border-t border-border" : ""}`}
              id={hub.name.toLowerCase()}
            >
              {/* Hub header */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8 mb-10">
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <span
                      className="h-10 w-10 rounded-xl flex items-center justify-center"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent-strong)",
                      }}
                    >
                      <HubIcon size={20} />
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
      <section className="px-6 py-24 border-t border-border text-center max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          Try every hub on a real workspace.
        </h2>
        <p className="text-muted mb-8">
          Free under five people. Set up in an hour.
        </p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg bg-[color:var(--accent)] text-white font-semibold hover:opacity-90 transition-fast"
        >
          Start free
          <ArrowRight size={16} />
        </Link>
      </section>

      <MarketingFooter />
    </div>
  );
}
