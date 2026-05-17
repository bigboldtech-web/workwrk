// White-clean features page. Modules grouped by domain (HR, Talent,
// Spend, Procurement, Platform, Enterprise) with feature cards. Sits
// alongside the landing's 100+ grid — landing is the wide overview;
// this page gives each module its own paragraph of detail.

import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  CalendarOff,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Code,
  Command,
  Crosshair,
  Database,
  DollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  Grid3x3,
  Heart,
  History,
  Inbox as InboxIcon,
  Key,
  Layers,
  Lightbulb,
  ListChecks,
  MessageSquare,
  MessageSquareHeart,
  Receipt,
  Send,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Star,
  Tag,
  Target,
  Timer,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Features — WorkWrk",
  description:
    "Every module to run people, performance, spend, procurement, talent, and learning — all in one workspace, with AI agents and dimensional tagging that makes reporting actually work.",
};

type Feature = { name: string; icon: LucideIcon; desc: string };
type Group = {
  id: string;
  label: string;
  tagline: string;
  features: Feature[];
};

const GROUPS: Group[] = [
  {
    id: "hr",
    label: "Core HR",
    tagline: "The people directory every other module joins to.",
    features: [
      { name: "People & profiles", icon: Users, desc: "Org-scoped directory with avatars, contact info, manager hierarchy, skills, and certifications." },
      { name: "Org chart", icon: Grid3x3, desc: "Live tree of departments and reporting lines. Click any node to drill into a sub-org." },
      { name: "Departments", icon: Building2, desc: "Nested departments with heads, members, and goal cascading. Map to your real org structure, however weird." },
      { name: "Roles & access", icon: Shield, desc: "10-tier RBAC (Super Admin → Agent) with per-module permission matrix editable by Company Admin." },
      { name: "Onboarding", icon: GraduationCap, desc: "Templates + per-hire instances. Buddy assignment, day-by-day checklist, course enrollment auto-trigger." },
      { name: "Skills & certs", icon: BadgeCheck, desc: "Track who's qualified for what. Filter People by skill when staffing a project or backfill." },
    ],
  },
  {
    id: "performance",
    label: "Performance & Goals",
    tagline: "What good looks like, measurably.",
    features: [
      { name: "KRAs & KPIs", icon: Target, desc: "Org-wide KRAs, per-user assignments with weightage, KPI records per period (daily → annual)." },
      { name: "OKRs", icon: Crosshair, desc: "Cascading objectives with key results, weekly/biweekly/monthly check-in cadence, parent-child alignment." },
      { name: "Performance reviews", icon: Star, desc: "Cycles with self-assessment, manager review, peer feedback, calibration grid, and outcome stamping." },
      { name: "360 feedback", icon: MessageSquareHeart, desc: "Peer feedback collection with structured rubrics. Anonymous responses if the cycle is configured for it." },
      { name: "Talent grid", icon: Grid3x3, desc: "9-box and custom-axis grids for succession planning. Drag-drop calibration with consensus tracking." },
      { name: "Performance scoring", icon: BarChart3, desc: "Composite score from KPIs + manager rating + peer + self + SOP compliance, weighted per org config." },
    ],
  },
  {
    id: "process",
    label: "Process & Documentation",
    tagline: "Compliance that scales.",
    features: [
      { name: "SOPs with versioning", icon: BookOpen, desc: "Rich-text or step-recorded procedures. Every publish snapshots a version; rollback is one click." },
      { name: "Folder ACL", icon: Folder, desc: "Per-folder access control. Engineering can't read HR's procedures unless granted." },
      { name: "Compliance tracking", icon: ShieldCheck, desc: "Who completed which SOP, when, plus per-version acknowledgement records for audit." },
      { name: "Process runs", icon: ListChecks, desc: "Instances of an SOP run by a specific person against a specific record. Full audit chain." },
      { name: "Policies", icon: Shield, desc: "Acknowledgeable policies (handbook, security, code of conduct) with read-receipt tracking." },
      { name: "Announcements", icon: Bell, desc: "Org-wide or department-targeted announcements with read tracking and email digest." },
    ],
  },
  {
    id: "tasks",
    label: "Tasks & Calendar",
    tagline: "Where work actually happens.",
    features: [
      { name: "Tasks + subtasks", icon: CheckSquare, desc: "Hour-precise scheduling, all-day flag, sub-tasks one level deep, RACI roles, status workflow." },
      { name: "Gantt + Day/Week/Month", icon: BarChart3, desc: "Five views over the same data: Gantt, Day, Week, Month, List. Drag to reschedule." },
      { name: "Calendar sync", icon: Calendar, desc: "Two-way Google Calendar. Outlook / iCal export. Tasks become calendar events automatically." },
      { name: "SLA & escalation", icon: Timer, desc: "Auto-escalate tasks that breach their SLA hours. Routes to manager with notification." },
      { name: "Recurring tasks", icon: Timer, desc: "Daily, weekly, monthly recurrence with skip-on-holiday and pause-while-on-leave logic." },
      { name: "Labels & priorities", icon: Tag, desc: "Multi-label tags, priority levels (low/normal/high/urgent), filterable list views." },
    ],
  },
  {
    id: "spend",
    label: "Spend & Time",
    tagline: "Every dollar and hour, tagged.",
    features: [
      { name: "Expenses", icon: Receipt, desc: "Submit, approve, reimburse. Bulk approve across N rows. Cost-center attribution via Worktags." },
      { name: "Compensation cycles", icon: DollarSign, desc: "Annual / semiannual reviews. Manager proposes, HR finalizes, audit triangle prevents self-approval." },
      { name: "Time off", icon: CalendarOff, desc: "Per-org leave policies with annualHours + carryover. Auto-approve flag for bereavement-style policies." },
      { name: "Timesheets", icon: Clock, desc: "Weekly grid + clock-punch. Live elapsed timer in topbar. Anti-forgotten-stop guards (>16h refused)." },
      { name: "Receipt storage", icon: FileText, desc: "S3-backed receipt uploads. Future v2: OCR extracts amount, vendor, date automatically." },
      { name: "Multi-currency", icon: DollarSign, desc: "Per-row currency. Org reporting currency at cycle level. FX conversion lives in v2." },
    ],
  },
  {
    id: "procurement",
    label: "Procurement & AP",
    tagline: "Vendor → PO → Invoice, end to end.",
    features: [
      { name: "Vendor management", icon: Building2, desc: "Vendor roster with payment terms, tax ID, contact. Archive doesn't lose history." },
      { name: "Purchase orders", icon: ShoppingCart, desc: "Auto-numbered (PO-000001), full state machine: DRAFT → SUBMITTED → APPROVED → SENT → RECEIVED → CLOSED." },
      { name: "Invoices", icon: FileText, desc: "Optional PO linking. Refuses duplicate (vendor, invoice number) — fraud detection at the schema." },
      { name: "Three-way matching (v2)", icon: Layers, desc: "PO + Goods Receipt + Invoice match validation lands when receipt-recording UI ships." },
      { name: "AP automation", icon: Send, desc: "Approval routing by amount threshold, auto-pay for trusted vendors, scheduled batch payments." },
      { name: "Spend analytics", icon: BarChart3, desc: "Slice spend by cost-center / business-unit / region via Worktags. No bespoke joins." },
    ],
  },
  {
    id: "talent",
    label: "Recruiting & Learning",
    tagline: "Bring people in. Skill them up.",
    features: [
      { name: "Job board", icon: Briefcase, desc: "Internal req tracking with hiring manager, salary range, openings count. Public career page lands in v2." },
      { name: "Candidate pipeline", icon: Users, desc: "Kanban: Applied → Screening → Interview → Offer → Hired/Rejected. Stage transitions logged." },
      { name: "Interview scheduling", icon: Calendar, desc: "Schedule against an Application, assign interviewer, mark complete with 1-5 score + notes. Auto-advances stage." },
      { name: "Scorecards", icon: ClipboardCheck, desc: "Per-interviewer rubric. v2 expands to per-competency structured scoring." },
      { name: "Courses + LMS", icon: GraduationCap, desc: "Mandatory or optional courses. Bulk-enroll departments. Mandatory courses surface in employee Inbox until completed." },
      { name: "Talent pool", icon: Heart, desc: "Candidates without active applications. Source-tagged. Re-engage when relevant roles open." },
    ],
  },
  {
    id: "engagement",
    label: "Engagement",
    tagline: "Recognition + voice.",
    features: [
      { name: "Kudos", icon: Heart, desc: "Peer-to-peer recognition with reactions and a public feed. Drives belonging without a separate app." },
      { name: "Ideas board", icon: Lightbulb, desc: "Submit, vote, comment. Manager+ converts to a Task or KRA. Innovation pipeline you can actually point at." },
      { name: "Pulse surveys", icon: ClipboardList, desc: "Anonymous or named pulse checks with deadline + recurrence. Aggregate over time, not just the latest." },
      { name: "Candor sessions", icon: MessageSquareHeart, desc: "Psychological-safety check-ins. Recurring 1:1 prompts that keep the relationship maintained." },
      { name: "Employee of the month", icon: Star, desc: "Voted or curated. Public shoutout, profile badge, optional bonus tie-in." },
    ],
  },
  {
    id: "planning",
    label: "Planning & Analytics",
    tagline: "Where the org is going.",
    features: [
      { name: "Workforce planning", icon: Target, desc: "Headcount + budget plan per department per period. Live variance vs current state." },
      { name: "Founder analytics", icon: BarChart3, desc: "MRR-over-time chart, signup funnel, 6-month cohort retention, recent churn. Built for SaaS founders." },
      { name: "Custom dashboards", icon: TrendingUp, desc: "Drag-drop tiles over any data slice. Save to user or share with org." },
      { name: "Cohort analysis", icon: Users, desc: "Slice by hire month, manager, role, region. Retention curves with overlay comparisons." },
      { name: "Reports + exports", icon: Download, desc: "Every list view exports to CSV, audit-logged. Scheduled reports for finance close." },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    tagline: "The connective tissue.",
    features: [
      { name: "Inbox", icon: InboxIcon, desc: "Aggregates 12 work-streams: SOPs, tasks, reviews, OKRs, expenses, comp, time-off, timesheets, POs, invoices, mandatory courses, interviews." },
      { name: "Cmd-K palette", icon: Command, desc: "Search-driven nav across every page + quick actions (Submit expense / Request PTO / Clock in). Workday's #1 power-user pattern." },
      { name: "Worktags", icon: Tag, desc: "Polymorphic tagging: Cost Center / Business Unit / Region / Project / Function / Custom. Tag any record; report by any dimension." },
      { name: "AI agents", icon: Brain, desc: "Generate KRAs from a job description, draft SOPs from a screen recording, summarize meeting notes, and surface drift signals." },
      { name: "AI content generation", icon: Wand2, desc: "/api/ai endpoints for any text-completion need. Each org brings its own Claude key (BYOK) for full data control." },
      { name: "Notifications", icon: Bell, desc: "Per-user per-type preferences: email, in-app, desktop. Daily digest if you opt out of real-time pings." },
      { name: "Bulk approve", icon: CheckSquare, desc: "Select N rows in any approval queue, hit Approve all. Per-row authorization respected; partial failures reported per-id." },
      { name: "CSV export", icon: Download, desc: "Every list view exports to CSV. Audit-logged. Excel-ready (UTF-8 BOM). 10,000-row cap interactive; bulk batches via cron." },
    ],
  },
  {
    id: "enterprise",
    label: "Enterprise & Security",
    tagline: "What IT will actually approve.",
    features: [
      { name: "SAML SSO", icon: Key, desc: "Per-org SAML 2.0 config (issuer, SSO URL, x509 cert). Just-in-time user provisioning, attribute mapping for role auto-assign." },
      { name: "SCIM 2.0", icon: Database, desc: "Full RFC 7644 compliance: Users + Groups (mapped to Departments) + ServiceProviderConfig. Bearer-token authed; tokens hashed at rest." },
      { name: "Audit trail", icon: History, desc: "Every mutation logged with actor, IP, before/after. Filterable by type / actor / severity / date. CSV export for SOX, SOC 2." },
      { name: "10-tier RBAC", icon: ShieldCheck, desc: "Super Admin / Company Admin / C-Level / VP / Director / HR / Manager / Team Lead / Employee / Agent. Custom permission matrix per tier per module." },
      { name: "Custom domains", icon: Globe, desc: "Run on app.yourcompany.com instead of workwrk.com. Plus white-label branding (logo, primary color)." },
      { name: "Field-level audit", icon: Layers, desc: "Diff capture on every edit: oldValue → newValue stored as JSON. Click-through to inspect what changed." },
      { name: "Data residency", icon: Database, desc: "Choose EU / US / IN region at signup. Data physically remains in that region; no replication across borders." },
      { name: "API + webhooks", icon: Code, desc: "Per-org API keys with rate buckets. Webhook subscriptions with HMAC-signed payloads, automatic retries on failure." },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    tagline: "Plays with what you already use.",
    features: [
      { name: "Google Calendar (2-way)", icon: Calendar, desc: "Full bi-directional sync. Tasks become events; events imported as tasks. Incremental sync via syncToken." },
      { name: "Slack notifications", icon: MessageSquare, desc: "Webhook-based notifications for review-due, OKR-stale, kudos-received. Channel-routable." },
      { name: "Chrome extension", icon: Globe, desc: "Record SOPs by performing them. Click-and-screenshot capture, AI parses into steps." },
      { name: "Stripe billing", icon: Receipt, desc: "Subscription management, customer portal, AppSumo redemption flow. Webhooks tracked end-to-end." },
      { name: "QuickBooks (soon)", icon: FileSpreadsheet, desc: "Sync employees, expenses, payroll runs into QB. Avoids the build-from-scratch GL trap for SMB customers." },
      { name: "Xero (soon)", icon: FileSpreadsheet, desc: "Same shape as QuickBooks. Pick whichever your accountant uses." },
    ],
  },
];

export default function FeaturesPage() {
  const totalFeatures = GROUPS.reduce((acc, g) => acc + g.features.length, 0);
  return (
    <div className="bg-white text-slate-900">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 pt-20 pb-12 text-center">
        <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight">
          Every tool.{" "}
          <span className="text-slate-400">One workspace.</span>
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-base lg:text-lg text-slate-600">
          {totalFeatures}+ features across {GROUPS.length} domains, all built
          in-platform with one permission system, one search index, one audit
          trail.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {GROUPS.map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              className="text-xs px-3 h-8 inline-flex items-center rounded-full border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-colors"
            >
              {g.label}
            </a>
          ))}
        </div>
      </section>

      {/* Feature groups */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10 pb-24 space-y-24">
        {GROUPS.map((g, i) => (
          <section key={g.id} id={g.id} className="scroll-mt-20">
            <div className="grid lg:grid-cols-[280px_1fr] gap-8 lg:gap-12 items-start">
              <div className="lg:sticky lg:top-24">
                <p className="text-[11px] uppercase tracking-[0.18em] font-medium text-slate-400 mb-3">
                  {String(i + 1).padStart(2, "0")} / {String(GROUPS.length).padStart(2, "0")}
                </p>
                <h2 className="text-3xl lg:text-4xl font-semibold tracking-tight">
                  {g.label}
                </h2>
                <p className="mt-3 text-slate-600">{g.tagline}</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {g.features.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div
                      key={f.name}
                      className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all"
                    >
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                        <Icon size={16} />
                      </div>
                      <p className="mt-4 font-semibold text-slate-900">{f.name}</p>
                      <p className="mt-1 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Stats strip */}
      <section className="bg-slate-50/50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16 grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
          <Stat n={String(totalFeatures)} label="Features" sub="Every one built in-platform" />
          <Stat n="12" label="Inbox sources" sub="One queue, every approval" />
          <Stat n="11" label="Schema migrations" sub="Phase 0 → 3 ships" />
          <Stat n="10" label="RBAC tiers" sub="Custom matrix per module" />
        </div>
      </section>

      {/* CTA */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-24 text-center">
          <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
            Try every feature.{" "}
            <span className="text-slate-400">Free for 14 days.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl bg-white text-slate-900 font-medium hover:bg-slate-100 transition-colors"
            >
              Get started — it's free
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl border border-slate-700 text-white font-medium hover:bg-slate-800 transition-colors"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ n, label, sub }: { n: string; label: string; sub: string }) {
  return (
    <div>
      <p className="text-4xl lg:text-5xl font-semibold tracking-tight text-slate-900">{n}</p>
      <p className="mt-2 text-sm font-semibold text-slate-700">{label}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}
