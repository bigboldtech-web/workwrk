// ClickUp-style landing page v2. Clean white aesthetic, two-column
// hero, feature pill chips, logo wall, 100+ features grid with four
// hero callouts. Built from scratch so the existing immersive
// 14-scene landing stays available to roll back to if needed —
// /(marketing)/page.tsx picks which one renders.

import Link from "next/link";
import {
  Activity,
  Archive,
  ArrowRight,
  AtSign,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  CalendarOff,
  Check,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Cloud,
  Code,
  Command,
  Compass,
  Crosshair,
  Database,
  DollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Folder,
  Gauge,
  Globe,
  GraduationCap,
  Grid3x3,
  Heart,
  History,
  Inbox,
  Key,
  Layers,
  Lightbulb,
  ListChecks,
  Mail,
  MessageSquare,
  MessageSquareHeart,
  Package,
  PieChart,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  Target,
  Timer,
  TrendingUp,
  UserPlus,
  Users,
  Wand2,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Hero pill chips — surface our most-used modules ─────────────

const HERO_CHIPS = [
  "Inbox", "Cmd-K search", "OKRs", "Reviews", "SOPs", "Tasks",
  "Expenses", "Compensation", "Time off", "Timesheets", "Recruiting",
  "Procurement", "Learning", "Workforce planning", "Audit trail",
  "SSO + SCIM", "Worktags", "AI agents",
];

// ─── 100+ features grid ──────────────────────────────────────────

type Feature = { name: string; icon: LucideIcon; hero?: boolean };

const FEATURES: Feature[] = [
  // ─── HR core ──
  { name: "People directory", icon: Users },
  { name: "Org chart", icon: Building2 },
  { name: "Departments", icon: Briefcase },
  { name: "Roles & access levels", icon: Shield },
  { name: "Profiles", icon: AtSign },
  { name: "Onboarding", icon: GraduationCap },
  { name: "Manager hierarchy", icon: Share2 },
  { name: "Skills & certifications", icon: BadgeCheck },

  // ─── Performance ──
  { name: "KRAs & KPIs", icon: Target, hero: true },
  { name: "OKRs", icon: Crosshair },
  { name: "OKR check-ins", icon: TrendingUp },
  { name: "Performance reviews", icon: Star },
  { name: "360° feedback", icon: RefreshCw },
  { name: "Calibration", icon: Gauge },
  { name: "Talent grid", icon: Grid3x3 },
  { name: "Performance scoring", icon: BarChart3 },

  // ─── Process & docs ──
  { name: "SOPs", icon: BookOpen, hero: true },
  { name: "SOP versioning", icon: History },
  { name: "Folder ACL", icon: Folder },
  { name: "Compliance tracking", icon: ShieldCheck },
  { name: "Process runs", icon: ListChecks },
  { name: "Policies", icon: Shield },
  { name: "Announcements", icon: Bell },
  { name: "Wiki & docs", icon: FileText },

  // ─── Tasks & calendar ──
  { name: "Tasks", icon: CheckSquare, hero: true },
  { name: "Subtasks", icon: ListChecks },
  { name: "Gantt view", icon: BarChart3 },
  { name: "Calendar sync", icon: Calendar },
  { name: "SLA & escalation", icon: Timer },
  { name: "Recurring tasks", icon: RefreshCw },
  { name: "Labels & tags", icon: Tag },
  { name: "Priorities", icon: Target },

  // ─── Spend ──
  { name: "Expenses", icon: Receipt, hero: true },
  { name: "Expense approval", icon: Check },
  { name: "Receipts", icon: FileText },
  { name: "Compensation cycles", icon: DollarSign },
  { name: "Salary bands", icon: BarChart3 },
  { name: "Bonus distribution", icon: Sparkles },
  { name: "Time off", icon: CalendarOff },
  { name: "Leave policies", icon: Settings },
  { name: "Timesheets", icon: Clock },
  { name: "Clock in / out", icon: Timer },

  // ─── Procurement ──
  { name: "Vendors", icon: Building2 },
  { name: "Purchase orders", icon: ShoppingCart },
  { name: "Invoices", icon: FileText },
  { name: "AP automation", icon: Zap },
  { name: "Three-way matching", icon: Layers },

  // ─── Recruiting ──
  { name: "Job board", icon: Briefcase },
  { name: "Candidate pipeline", icon: Users },
  { name: "Interview scheduling", icon: Calendar },
  { name: "Scorecards", icon: ClipboardCheck },
  { name: "Offer letters", icon: Send },
  { name: "Talent pool", icon: UserPlus },

  // ─── Learning ──
  { name: "Courses", icon: GraduationCap },
  { name: "Mandatory training", icon: ShieldCheck },
  { name: "Progress tracking", icon: TrendingUp },
  { name: "Certifications", icon: BadgeCheck },

  // ─── Engagement ──
  { name: "Kudos", icon: Heart },
  { name: "Ideas", icon: Lightbulb },
  { name: "Pulse surveys", icon: ClipboardList },
  { name: "Candor sessions", icon: MessageSquareHeart },
  { name: "Employee of the month", icon: Star },

  // ─── Planning & analytics ──
  { name: "Workforce planning", icon: Target },
  { name: "Headcount budget", icon: PieChart },
  { name: "Founder analytics", icon: BarChart3 },
  { name: "Cohort retention", icon: Users },
  { name: "MRR trends", icon: TrendingUp },
  { name: "Custom dashboards", icon: Gauge },

  // ─── Cross-cutting platform ──
  { name: "Inbox", icon: Inbox, hero: true },
  { name: "Cmd-K palette", icon: Command },
  { name: "Worktags", icon: Tag },
  { name: "Cost-center tagging", icon: Tag },
  { name: "Tag filtering", icon: Filter },
  { name: "AI agents", icon: Brain },
  { name: "AI content generation", icon: Wand2 },
  { name: "AI signals", icon: Sparkles },

  // ─── Communication ──
  { name: "Meetings", icon: MessageSquare },
  { name: "Action items", icon: CheckSquare },
  { name: "Email digests", icon: Mail },
  { name: "Notifications", icon: Bell },

  // ─── Assets ──
  { name: "Assets", icon: Package },
  { name: "Tools registry", icon: Wrench },

  // ─── Enterprise ──
  { name: "SAML SSO", icon: Key },
  { name: "SCIM 2.0", icon: Cloud },
  { name: "Audit trail", icon: Activity },
  { name: "Field-level diffs", icon: History },
  { name: "Multi-tenant", icon: Layers },
  { name: "Custom domains", icon: Globe },
  { name: "10-tier RBAC", icon: ShieldCheck },
  { name: "API + webhooks", icon: Code },
  { name: "Bulk approve", icon: Check },
  { name: "CSV export", icon: Download },
  { name: "Backup & restore", icon: Database },

  // ─── Localization ──
  { name: "18+ languages", icon: Globe },
  { name: "Multi-currency", icon: DollarSign },

  // ─── Operations ──
  { name: "Webhooks", icon: Send },
  { name: "API keys", icon: Key },
  { name: "Rate limits", icon: Gauge },
  { name: "Activity log", icon: Activity },
  { name: "Health monitoring", icon: Activity },
  { name: "Search across everything", icon: Search },
  { name: "Help center", icon: Compass },
  { name: "Archive & restore", icon: Archive },

  // ─── Integrations ──
  { name: "Google Calendar sync", icon: Calendar },
  { name: "Slack notifications", icon: MessageSquare },
  { name: "Chrome extension", icon: Globe },
  { name: "Stripe billing", icon: Receipt },
  { name: "QuickBooks (soon)", icon: FileSpreadsheet },
  { name: "Xero (soon)", icon: FileSpreadsheet },
];

const HERO_CALLOUTS: Array<{
  name: string;
  tagline: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    name: "Inbox",
    tagline: "12 work-streams in one queue",
    icon: Inbox,
    accent: "from-blue-100 to-blue-50 text-blue-600",
  },
  {
    name: "SOPs",
    tagline: "Compliance that scales",
    icon: BookOpen,
    accent: "from-amber-100 to-amber-50 text-amber-600",
  },
  {
    name: "Worktags",
    tagline: "Cost-center attribution everywhere",
    icon: Tag,
    accent: "from-emerald-100 to-emerald-50 text-emerald-600",
  },
  {
    name: "AI agents",
    tagline: "Generate KRAs, SOPs, signals",
    icon: Brain,
    accent: "from-violet-100 to-violet-50 text-violet-600",
  },
];

// ─── Logo wall placeholder ───────────────────────────────────────

const LOGO_WALL = ["Cashkr", "Mango Inc.", "Northwind", "Atlas Co.", "Helix", "Vista Group"];

// ─── Component ───────────────────────────────────────────────────

export function LandingV2() {
  // Topbar + Footer come from the marketing layout — kept out of
  // here so they don't double-render and so they're consistent with
  // /pricing, /features, etc.
  return (
    <>
      <Hero />
      <LogoWall />
      <BigQuote />
      <FeaturesGrid />
      <Numbers />
      <FinalCTA />
    </>
  );
}

// ─── Topbar ──────────────────────────────────────────────────────

function Topbar() {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-slate-900 flex items-center justify-center">
            <span className="text-white text-xs font-bold">W</span>
          </div>
          <span className="font-semibold text-base">workwrk</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-slate-600">
          <Link href="/features" className="hover:text-slate-900">Product</Link>
          <Link href="/industries" className="hover:text-slate-900">Solutions</Link>
          <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
          <Link href="/customers" className="hover:text-slate-900">Customers</Link>
          <Link href="/help-center" className="hover:text-slate-900">Resources</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/demo" className="hidden sm:inline-flex text-sm text-slate-600 hover:text-slate-900">
            Get a demo
          </Link>
          <Link href="/login" className="hidden sm:inline-flex text-sm text-slate-600 hover:text-slate-900">
            Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center px-4 h-9 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}

// ─── Hero ────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-16 pb-24 lg:pt-24 lg:pb-32 grid lg:grid-cols-2 gap-12 items-start">
        <div>
          <Link
            href="/changelog"
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 px-3 h-7 rounded-full border border-slate-200 hover:border-slate-300 hover:text-slate-900 transition-colors"
          >
            Introducing WorkWrk 4.0 <ArrowRight size={11} />
          </Link>

          <h1 className="text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight leading-[1.05] mt-6">
            One platform.
            <br />
            <span className="text-slate-500">Every system.</span>
          </h1>

          <ul className="mt-8 space-y-3 text-slate-700">
            <li className="flex items-start gap-3">
              <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span>
                <strong className="font-semibold">Save money.</strong>{" "}
                One bill replaces HRIS, ATS, payroll spend tools, and 15 more SaaS lines.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span>
                <strong className="font-semibold">Save time.</strong>{" "}
                One Inbox aggregates 12 work-streams. One Cmd-K reaches everything.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span>
                <strong className="font-semibold">Run the whole company.</strong>{" "}
                People, performance, spend, procurement, learning — one source of truth.
              </span>
            </li>
          </ul>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-5 h-12 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors"
            >
              Get started — it's free
              <ArrowRight size={16} />
            </Link>
            <span className="text-xs text-slate-500">
              Free forever. No credit card.
            </span>
          </div>

          <div className="mt-12">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-medium">
              GET 400% MORE DONE • CUSTOMIZE YOUR WORKSPACE
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {HERO_CHIPS.map((c, i) => (
                <span
                  key={c}
                  className={`text-xs px-3 h-8 inline-flex items-center rounded-full border transition-colors ${
                    i === 0
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right: faux product preview */}
        <ProductPreview />
      </div>
    </section>
  );
}

function ProductPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 bg-gradient-to-br from-slate-100 via-white to-slate-50 rounded-3xl blur-2xl opacity-70 -z-10" />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/30 overflow-hidden">
        {/* Window chrome */}
        <div className="h-9 px-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
            <Search size={10} />
            <span className="font-mono">⌘K</span>
          </div>
        </div>

        <div className="grid grid-cols-[180px_1fr] min-h-[480px]">
          {/* Sidebar */}
          <aside className="border-r border-slate-100 p-3 space-y-0.5 bg-slate-50/40">
            <SidebarItem icon={Inbox} label="Inbox" badge="12" active />
            <SidebarItem icon={CheckSquare} label="Tasks" />
            <SidebarItem icon={Crosshair} label="OKRs" />
            <SidebarItem icon={BookOpen} label="SOPs" />
            <SidebarItem icon={Receipt} label="Expenses" />
            <SidebarItem icon={DollarSign} label="Compensation" />
            <SidebarItem icon={CalendarOff} label="Time off" />
            <SidebarItem icon={Clock} label="Timesheets" />
            <SidebarItem icon={Briefcase} label="Recruiting" />
            <SidebarItem icon={ShoppingCart} label="Procurement" />
            <SidebarItem icon={GraduationCap} label="Learning" />
          </aside>

          {/* Content */}
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Inbox size={16} className="text-slate-700" />
              <span className="font-semibold text-sm">Inbox</span>
              <span className="text-[10px] text-slate-500">12 items waiting on you</span>
            </div>

            <FauxRow
              icon={Receipt}
              title="Conference travel — Mohsin S."
              right="$1,240.00"
              meta="submitted today"
              accent="text-blue-600 bg-blue-50"
            />
            <FauxRow
              icon={CalendarOff}
              title="Aarav K. — PTO Mar 14–18"
              right="40h"
              meta="Pending"
              accent="text-amber-600 bg-amber-50"
            />
            <FauxRow
              icon={Briefcase}
              title="Interview: Priya M. — Sr. Designer"
              right="2:00pm"
              meta="in 30 min"
              accent="text-violet-600 bg-violet-50"
            />
            <FauxRow
              icon={DollarSign}
              title="Comp proposal — 12 reports"
              right="+5.2% avg"
              meta="2026 Annual cycle"
              accent="text-emerald-600 bg-emerald-50"
            />
            <FauxRow
              icon={GraduationCap}
              title="Security training (mandatory)"
              right="50%"
              meta="due Friday"
              accent="text-orange-600 bg-orange-50"
            />
            <FauxRow
              icon={BookOpen}
              title="SOP: Lead reallocation rules"
              right="v3"
              meta="Acknowledge"
              accent="text-slate-600 bg-slate-100"
            />
          </div>
        </div>
      </div>

      {/* Floating bulk approve bar */}
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-full shadow-lg shadow-slate-300/40 px-4 h-10 flex items-center gap-3 text-xs">
        <span className="font-medium">3 selected</span>
        <span className="text-slate-300">·</span>
        <button className="text-red-600 hover:text-red-700">Reject all</button>
        <button className="text-emerald-600 hover:text-emerald-700 font-medium">Approve all</button>
      </div>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  badge,
  active,
}: {
  icon: LucideIcon;
  label: string;
  badge?: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 h-7 rounded-md text-xs ${
        active ? "bg-white border border-slate-200 text-slate-900 font-medium" : "text-slate-600"
      }`}
    >
      <Icon size={12} />
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span className="text-[10px] bg-rose-500 text-white px-1.5 rounded-full font-medium">
          {badge}
        </span>
      )}
    </div>
  );
}

function FauxRow({
  icon: Icon,
  title,
  right,
  meta,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  right: string;
  meta: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${accent}`}>
        <Icon size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-900 truncate">{title}</div>
        <div className="text-[10px] text-slate-500">{meta}</div>
      </div>
      <span className="text-xs font-mono text-slate-700">{right}</span>
    </div>
  );
}

// ─── Logo wall ───────────────────────────────────────────────────

function LogoWall() {
  return (
    <section className="border-y border-slate-100 bg-slate-50/40">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-medium">
          Trusted by teams at
        </span>
        {LOGO_WALL.map((name) => (
          <span
            key={name}
            className="text-lg font-semibold text-slate-300 hover:text-slate-500 transition-colors"
          >
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

// ─── Big quote / value prop ──────────────────────────────────────

function BigQuote() {
  return (
    <section className="max-w-5xl mx-auto px-6 lg:px-10 py-24 lg:py-32 text-center">
      <h2 className="text-4xl lg:text-6xl font-semibold tracking-tight leading-[1.1]">
        60% of work is lost in context —
        <br />
        <span className="text-slate-400">and AI is lost without it.</span>
      </h2>
      <p className="mt-8 max-w-2xl mx-auto text-base lg:text-lg text-slate-600">
        WorkWrk gives every person, AI agent, and system one place to read
        and write the truth. Tasks know which OKRs they roll up to. Expenses
        know which cost center they bill. Reviews know what the SOPs said
        the role should do. Context, finally, is shared.
      </p>
    </section>
  );
}

// ─── Features grid ───────────────────────────────────────────────

function FeaturesGrid() {
  // Compute hero-callout positions to build the layout grid: 4 hero
  // cards interleaved through the wall of small feature tiles.
  return (
    <section className="bg-slate-50/50 border-y border-slate-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
            100+ features to replace fragmented software.
          </h2>
          <p className="mt-5 text-base lg:text-lg text-slate-600">
            Every tool you've stitched together with Zapier, replaced. One
            workspace, one bill, one place to look when something breaks.
          </p>
        </div>

        {/* Hero callouts row */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-16">
          {HERO_CALLOUTS.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.name}
                className={`rounded-2xl bg-gradient-to-br ${c.accent} p-6 border border-white shadow-sm`}
              >
                <Icon size={26} />
                <p className="mt-6 text-xl font-semibold">{c.name}</p>
                <p className="text-sm opacity-80 mt-1">{c.tagline}</p>
              </div>
            );
          })}
        </div>

        {/* Wall of features */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px bg-slate-200 mt-12 rounded-2xl overflow-hidden border border-slate-200">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.name}
                className="bg-white aspect-square p-4 flex flex-col items-center justify-center gap-2 text-center hover:bg-slate-50 transition-colors group"
              >
                <Icon size={18} className="text-slate-400 group-hover:text-slate-700 transition-colors" />
                <span className="text-[11px] text-slate-600 font-medium leading-tight">
                  {f.name}
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs text-slate-500">
          {FEATURES.length}+ features and counting. Every one built in-platform — no integration glue, no auth juggling.
        </p>
      </div>
    </section>
  );
}

// ─── Numbers / stats ─────────────────────────────────────────────

function Numbers() {
  return (
    <section className="max-w-7xl mx-auto px-6 lg:px-10 py-24 lg:py-32">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
          Built to scale from 25 to 500,000.
        </h2>
        <p className="mt-5 text-base lg:text-lg text-slate-600">
          Same platform a 25-person startup spins up in an afternoon also
          runs a Fortune-500 conglomerate's HR + spend + procurement.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <Stat n="12" label="Inbox sources" sub="One queue, every approval" />
        <Stat n="80+" label="Data models" sub="Indexed for sub-second filters" />
        <Stat n="11" label="Schema migrations" sub="All shipping on day one" />
        <Stat n="100%" label="Type-clean" sub="No 'any' on hot paths" />
      </div>
    </section>
  );
}

function Stat({ n, label, sub }: { n: string; label: string; sub: string }) {
  return (
    <div className="space-y-2">
      <p className="text-5xl lg:text-6xl font-semibold tracking-tight text-slate-900">{n}</p>
      <p className="text-base font-semibold text-slate-700">{label}</p>
      <p className="text-sm text-slate-500">{sub}</p>
    </div>
  );
}

// ─── Final CTA ───────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="bg-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-24 lg:py-32 text-center">
        <h2 className="text-4xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
          Replace 15 tools.
          <br />
          <span className="text-slate-400">Get one platform.</span>
        </h2>
        <p className="mt-6 max-w-2xl mx-auto text-base lg:text-lg text-slate-300">
          Free to start. Free forever for teams under 25. Self-serve in
          7 days, not 7 months.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-6 h-12 rounded-xl bg-white text-slate-900 font-medium hover:bg-slate-100 transition-colors"
          >
            Get started — it's free
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-6 h-12 rounded-xl border border-slate-700 text-white font-medium hover:bg-slate-800 transition-colors"
          >
            Get a demo
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-white border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-slate-900 flex items-center justify-center">
              <span className="text-white text-xs font-bold">W</span>
            </div>
            <span className="font-semibold">workwrk</span>
          </div>
          <p className="mt-4 text-slate-500 max-w-sm">
            One platform to run people, process, performance, spend, and
            growth. Built for teams who outgrew spreadsheets but can't
            afford Workday.
          </p>
        </div>
        <FooterCol title="Product" links={[
          ["Features", "/features"],
          ["Pricing", "/pricing"],
          ["Changelog", "/changelog"],
          ["Roadmap", "/roadmap"],
          ["Security", "/security"],
        ]} />
        <FooterCol title="Solutions" links={[
          ["Industries", "/industries"],
          ["Customers", "/customers"],
          ["Partners", "/partners"],
          ["Compare", "/compare"],
        ]} />
        <FooterCol title="Company" links={[
          ["About", "/about"],
          ["Blog", "/blog"],
          ["Help center", "/help-center"],
          ["Contact", "/contact"],
          ["Privacy", "/privacy"],
          ["Terms", "/terms"],
        ]} />
      </div>
      <div className="border-t border-slate-100 px-6 lg:px-10 py-6 text-xs text-slate-400 max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <span>© {new Date().getFullYear()} WorkWrk. All rights reserved.</span>
        <span className="font-mono">v4.0</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <p className="font-semibold text-slate-900 mb-4">{title}</p>
      <ul className="space-y-2.5">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-slate-500 hover:text-slate-900 transition-colors">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
