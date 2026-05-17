// Landing v4 — built from scratch, not based on v2 or my failed v3.
//
// Premium aesthetic targeting the Linear / Workday / Vercel quality bar:
//   - Confident large typography
//   - Locked palette (violet accent + neutral surfaces + signal tokens)
//   - Generous spacing
//   - CSS-only product mock (no screenshots)
//   - 7-hub showcase that maps 1:1 to the live app's sidebar IA
//   - One promise, one CTA verb
//
// Sections (top to bottom):
//   1. Topbar
//   2. Hero — pitch + product mock
//   3. Three pillars — Consolidate / AI-native / SMB→Enterprise scale
//   4. Seven hubs grid — what each hub does + feature bullets
//   5. Workflow demonstration — how a request flows end-to-end
//   6. Trust strip — placeholder customer logos
//   7. Big stat strip
//   8. Pricing preview — three tiers
//   9. FAQ
//   10. Final CTA
//   11. Footer
//
// All section components live inline so the file reads top-to-bottom
// like a real document, not a maze of imports. Long but explicit.

import Link from "next/link";
import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";
import {
  ArrowRight, Check, ChevronRight, Sparkles, Layers, Bot, TrendingUp,
  LayoutDashboard, Users, CalendarDays, DollarSign, Star, Megaphone, Wrench,
  Inbox, Crosshair, BookOpen, Receipt, ShoppingCart, Briefcase,
  GraduationCap, Heart, Shield, Lightbulb, Building2,
  type LucideIcon,
} from "lucide-react";

export function LandingV4() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <MarketingTopbar />
      <Hero />
      <Pillars />
      <HubsGrid />
      <WorkflowDemo />
      <TrustStrip />
      <StatStrip />
      <PricingPreview />
      <FAQ />
      <FinalCTA />
      <MarketingFooter />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. HERO
// ════════════════════════════════════════════════════════════════════

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Subtle radial accent backdrop — soft violet glow behind the
          right-side product mock so the page has visual depth without
          being a gradient explosion. */}
      <div
        className="absolute right-0 top-0 w-[600px] h-[600px] -z-10 rounded-full opacity-30 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-16 pb-24 lg:pt-24 lg:pb-32 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center">
        {/* ── Left: pitch ─────────────────────────────────────────── */}
        <div>
          <Link
            href="/changelog"
            className="inline-flex items-center gap-2 text-xs font-medium px-3 h-7 rounded-full border border-border bg-surface hover:border-muted-2 transition-fast"
          >
            <Sparkles size={11} className="text-[color:var(--accent-strong)]" />
            <span className="text-foreground">WorkwrK 4.0 — seven hubs, one product</span>
            <ArrowRight size={11} className="text-muted-2" />
          </Link>

          <h1 className="text-5xl lg:text-6xl xl:text-[80px] font-bold tracking-tight leading-[1.02] mt-6">
            Run your<br />
            company on<br />
            <span className="text-[color:var(--accent-strong)]">one product.</span>
          </h1>

          <p className="text-lg lg:text-xl text-muted mt-7 leading-relaxed max-w-xl">
            WorkwrK unifies people, performance, finance, talent, and platform
            tooling into a single operating system. Replace 15 disconnected
            SaaS tools with one product that actually knows your company.
          </p>

          <ul className="mt-9 space-y-3.5">
            <PromiseRow strong="Save money." rest="One bill replaces HRIS, ATS, expense tools, and 15 more SaaS lines." />
            <PromiseRow strong="Save time." rest="One Inbox aggregates 12 work-streams. One Cmd-K reaches everything." />
            <PromiseRow strong="Run the whole company." rest="People, performance, spend, talent, learning — one source of truth." />
          </ul>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl bg-[color:var(--accent)] text-white font-semibold hover:opacity-90 transition-fast shadow-[0_8px_24px_-8px_rgba(124,58,237,0.5)]"
            >
              Start free
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl border border-border font-semibold hover:bg-surface transition-fast"
            >
              See a demo
            </Link>
            <span className="text-xs text-muted-2 ml-1">Free under 5 people · no card</span>
          </div>
        </div>

        {/* ── Right: CSS-only product mock ────────────────────────── */}
        <ProductMock />
      </div>
    </section>
  );
}

function PromiseRow({ strong, rest }: { strong: string; rest: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="w-5 h-5 rounded-md flex-shrink-0 mt-0.5 inline-flex items-center justify-center"
        style={{
          background: "var(--signal-success-bg)",
          color: "var(--signal-success-fg)",
        }}
      >
        <Check className="w-3 h-3" />
      </span>
      <span className="text-[15px] leading-relaxed">
        <strong className="font-semibold text-foreground">{strong}</strong>{" "}
        <span className="text-muted">{rest}</span>
      </span>
    </li>
  );
}

// CSS-only product mock — renders a faux dashboard sidebar + main area
// so the hero has a "this is what the product looks like" element
// without needing an actual screenshot.
function ProductMock() {
  return (
    <div className="relative">
      {/* Stack-shadow effect: two cards behind to suggest depth */}
      <div className="absolute -inset-3 rounded-2xl bg-gradient-to-br from-[color:var(--accent-soft)] to-transparent blur-2xl opacity-60 -z-10" aria-hidden />

      <div className="relative rounded-2xl border border-border bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.20)] overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-4 h-9 border-b border-border bg-[color:var(--surface-elevated)]">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/40" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400/40" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400/40" />
          <div className="flex-1 text-center text-[11px] text-muted-2 font-mono">workwrk.com/dashboard</div>
        </div>

        <div className="grid grid-cols-[140px_1fr] min-h-[420px]">
          {/* Faux sidebar */}
          <div className="border-r border-border bg-[color:var(--surface-elevated)] p-3 text-xs">
            <div className="px-2 py-1.5 mb-3 inline-flex items-center gap-2">
              <span
                className="w-5 h-5 rounded-md inline-flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: "var(--accent)" }}
              >
                W
              </span>
              <span className="font-bold text-foreground">workwrk</span>
            </div>
            <SidebarBlock label="Home" items={["Dashboard", "Inbox"]} active="Dashboard" />
            <SidebarBlock label="Work" items={["Tasks", "OKRs", "SOPs"]} />
            <SidebarBlock label="Money" items={["Expenses", "Procurement"]} />
            <SidebarBlock label="Talent" items={["Reviews", "Recruiting"]} />
          </div>

          {/* Faux main panel — Inbox preview */}
          <div className="p-4">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-2 font-semibold">Good morning, Ibrahim</p>
              <p className="text-base font-bold mt-1">7 items need your attention.</p>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MockStat label="Tasks this week" value="12" />
              <MockStat label="Approvals" value="5" highlight />
              <MockStat label="Reviews" value="3" />
            </div>

            {/* Inbox preview rows */}
            <p className="text-[10px] uppercase tracking-widest text-muted-2 font-semibold mb-2">Inbox</p>
            <div className="space-y-1">
              <MockRow icon={DollarSign} title="Expense · $480" sub="From Asha · 1d ago" tone="success" />
              <MockRow icon={ShoppingCart} title="PO-000412" sub="$12,400 to Acme" tone="warning" />
              <MockRow icon={CalendarDays} title="Time off · 3d" sub="From Mohsin" tone="info" />
              <MockRow icon={Star} title="Q2 Review · Ayaz" sub="Due tomorrow" tone="warning" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarBlock({ label, items, active }: { label: string; items: string[]; active?: string }) {
  return (
    <div className="mb-3">
      <p className="text-[9px] uppercase tracking-widest text-muted-2 font-semibold px-2 mb-1">{label}</p>
      <div className="space-y-0.5">
        {items.map((it) => (
          <div
            key={it}
            className={`px-2 py-1 rounded text-[11px] ${
              it === active
                ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] font-medium"
                : "text-muted"
            }`}
          >
            {it}
          </div>
        ))}
      </div>
    </div>
  );
}

function MockStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-md border p-2 ${
        highlight ? "border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)]" : "border-border bg-background"
      }`}
    >
      <p className="text-[14px] font-bold tabular-nums">{value}</p>
      <p className="text-[9px] text-muted leading-tight">{label}</p>
    </div>
  );
}

function MockRow({
  icon: Icon,
  title,
  sub,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  tone: "success" | "warning" | "info";
}) {
  const toneClass =
    tone === "success" ? "text-[color:var(--signal-success-fg)] bg-[color:var(--signal-success-bg)]" :
    tone === "warning" ? "text-[color:var(--signal-warning-fg)] bg-[color:var(--signal-warning-bg)]" :
    "text-[color:var(--signal-info-fg)] bg-[color:var(--signal-info-bg)]";
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <span className={`w-6 h-6 rounded-md inline-flex items-center justify-center ${toneClass}`}>
        <Icon size={11} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium truncate">{title}</p>
        <p className="text-[9px] text-muted-2 truncate">{sub}</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 2. PILLARS — three reasons people switch
// ════════════════════════════════════════════════════════════════════

function Pillars() {
  return (
    <section className="border-t border-border bg-[color:var(--surface)]/40">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
            Why teams switch
          </p>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight max-w-2xl mx-auto leading-[1.1]">
            One product, fifteen<br />subscriptions canceled.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <PillarCard
            icon={Layers}
            title="Consolidate."
            body="Asana + Notion + Lattice + Bill.com + Bamboo + Carta + Slack + Linear becomes one bill, one sign-in, one source of truth."
          />
          <PillarCard
            icon={Bot}
            title="AI-native."
            body="Cmd-K opens an assistant that reads across every module. Inbox AI triages your approvals. Plain-English questions, data-backed answers."
          />
          <PillarCard
            icon={TrendingUp}
            title="SMB → mid-market scale."
            body="From 5 people to 500. Same product. The schema scales — financials, multi-entity, SCIM, audit — without enterprise pricing on day one."
          />
        </div>
      </div>
    </section>
  );
}

function PillarCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-7 hover:border-[color:var(--accent)]/40 transition-fast">
      <span
        className="inline-flex items-center justify-center w-11 h-11 rounded-xl mb-5"
        style={{
          background: "var(--accent-soft)",
          color: "var(--accent-strong)",
        }}
      >
        <Icon size={22} />
      </span>
      <h3 className="text-xl font-bold tracking-tight mb-2">{title}</h3>
      <p className="text-[15px] text-muted leading-relaxed">{body}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 3. HUBS GRID — seven cards matching the sidebar IA
// ════════════════════════════════════════════════════════════════════

const HUBS: Array<{
  icon: LucideIcon;
  name: string;
  tagline: string;
  features: { icon: LucideIcon; label: string }[];
}> = [
  {
    icon: LayoutDashboard,
    name: "Home",
    tagline: "What needs you, right now.",
    features: [
      { icon: Inbox, label: "Inbox aggregating 12 streams" },
      { icon: Sparkles, label: "Cmd-K AI search" },
      { icon: Bot, label: "AI Assistant" },
    ],
  },
  {
    icon: Users,
    name: "People",
    tagline: "The org, the lookups, the structure.",
    features: [
      { icon: Users, label: "People directory" },
      { icon: Building2, label: "Live org chart" },
    ],
  },
  {
    icon: CalendarDays,
    name: "Work",
    tagline: "Tasks, OKRs, KPIs, SOPs — every cadence.",
    features: [
      { icon: CalendarDays, label: "Tasks (day/week/month/Gantt)" },
      { icon: Crosshair, label: "OKRs cascading" },
      { icon: BookOpen, label: "SOPs + Process runs" },
    ],
  },
  {
    icon: DollarSign,
    name: "Money",
    tagline: "Expenses to full GL — one ledger.",
    features: [
      { icon: Receipt, label: "Expenses + reimbursements" },
      { icon: ShoppingCart, label: "Procurement + vendors" },
      { icon: DollarSign, label: "Financial statements" },
    ],
  },
  {
    icon: Star,
    name: "Talent",
    tagline: "Reviews, comp, hiring, learning.",
    features: [
      { icon: Star, label: "360° review cycles" },
      { icon: DollarSign, label: "Compensation cycles" },
      { icon: Briefcase, label: "Recruiting pipeline" },
      { icon: GraduationCap, label: "Mandatory learning" },
    ],
  },
  {
    icon: Megaphone,
    name: "Culture",
    tagline: "Broadcast, recognize, signal.",
    features: [
      { icon: Megaphone, label: "Announcements with acks" },
      { icon: Heart, label: "Kudos + recognition" },
      { icon: Shield, label: "Versioned policies" },
      { icon: Lightbulb, label: "Ideas board" },
    ],
  },
  {
    icon: Wrench,
    name: "Platform",
    tagline: "Customize, govern, observe.",
    features: [
      { icon: Wrench, label: "Studio workflows" },
      { icon: Shield, label: "SCIM + SSO + audit log" },
      { icon: Bot, label: "BYOK AI" },
    ],
  },
];

function HubsGrid() {
  return (
    <section className="border-t border-border">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
            Seven hubs · one product
          </p>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight max-w-3xl mx-auto leading-[1.1]">
            Built around how teams<br />actually work — not how<br />vendors sell.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {HUBS.map((hub, i) => {
            const HubIcon = hub.icon;
            // First card spans 2 columns on lg+ to break the grid rhythm
            // and create the "hero hub" that sets the visual tone.
            const isHero = i === 0;
            return (
              <div
                key={hub.name}
                className={`rounded-2xl border border-border bg-surface p-6 hover:border-[color:var(--accent)]/40 transition-fast ${
                  isHero ? "md:col-span-2 lg:col-span-2" : ""
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center rounded-xl mb-4 ${
                    isHero ? "w-12 h-12" : "w-10 h-10"
                  }`}
                  style={{
                    background: "var(--accent-soft)",
                    color: "var(--accent-strong)",
                  }}
                >
                  <HubIcon size={isHero ? 24 : 18} />
                </span>
                <h3 className={`font-bold tracking-tight mb-1.5 ${isHero ? "text-2xl" : "text-lg"}`}>
                  {hub.name}
                </h3>
                <p className={`text-foreground/80 mb-4 ${isHero ? "text-base" : "text-[13.5px]"}`}>
                  {hub.tagline}
                </p>
                <ul className="space-y-1.5">
                  {hub.features.map((f) => {
                    const FIcon = f.icon;
                    return (
                      <li key={f.label} className="flex items-center gap-2 text-[12.5px] text-muted">
                        <FIcon size={11} className="text-[color:var(--accent-strong)] flex-shrink-0" />
                        <span>{f.label}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/features"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--accent-strong)] hover:underline"
          >
            Every feature, every hub
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 4. WORKFLOW DEMO — animated-feel timeline of a request flow
// ════════════════════════════════════════════════════════════════════

function WorkflowDemo() {
  const steps: { label: string; actor: string; detail: string }[] = [
    { label: "1. Submit", actor: "Asha (employee)", detail: "Submits a $480 expense in 12 seconds from her phone." },
    { label: "2. Triage", actor: "AI Inbox", detail: "Flags it as routine — matches Asha's policy + her clean history. Suggests approve." },
    { label: "3. Approve", actor: "Mohsin (manager)", detail: "One click in the Inbox queue. No email, no spreadsheet, no chasing." },
    { label: "4. Pay", actor: "Finance", detail: "Auto-journaled into the GL. Reimbursement queued. Audit row logged." },
  ];

  return (
    <section className="border-t border-border bg-[color:var(--surface)]/40">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
            How it works
          </p>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight max-w-2xl mx-auto leading-[1.1]">
            A request flows end-to-<br />end in four clicks.
          </h2>
          <p className="text-[15px] text-muted mt-5 max-w-2xl mx-auto leading-relaxed">
            Same pattern for expenses, POs, time-off, comp decisions, hiring.
            One workflow surface; the same approval chain logic everywhere.
          </p>
        </div>

        <div className="relative">
          {/* Connecting line behind the step dots */}
          <div className="hidden md:block absolute top-5 left-0 right-0 h-px bg-border" aria-hidden />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
            {steps.map((step, i) => (
              <div key={step.label} className="text-center md:text-left">
                <div className="flex md:block items-center gap-3 mb-3">
                  <span
                    className="w-10 h-10 rounded-full inline-flex items-center justify-center font-bold text-sm flex-shrink-0"
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-contrast)",
                    }}
                  >
                    {i + 1}
                  </span>
                </div>
                <h3 className="font-bold text-[15px] mb-1">{step.label.replace(/^\d+\.\s*/, "")}</h3>
                <p className="text-[12.5px] text-[color:var(--accent-strong)] font-medium mb-2">{step.actor}</p>
                <p className="text-[13px] text-muted leading-relaxed">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 5. TRUST STRIP — placeholder customer logos
// ════════════════════════════════════════════════════════════════════

function TrustStrip() {
  const logos = ["Cashkr", "BigBoldTech", "Mango Inc.", "Northwind", "Atlas Co.", "Helix"];
  return (
    <section className="border-t border-border">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16">
        <p className="text-center text-[11px] uppercase tracking-[0.2em] text-muted-2 font-semibold mb-8">
          Trusted by teams that mean business
        </p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-8 items-center opacity-70 hover:opacity-90 transition-fast">
          {logos.map((name) => (
            <div
              key={name}
              className="text-center text-sm font-semibold tracking-tight text-muted"
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 6. STAT STRIP
// ════════════════════════════════════════════════════════════════════

function StatStrip() {
  const stats: { n: string; label: string; sub: string }[] = [
    { n: "15+",  label: "SaaS tools replaced",  sub: "by one product" },
    { n: "< 1h", label: "Median setup time",    sub: "for a new tenant" },
    { n: "12",   label: "Streams aggregated",   sub: "in the unified Inbox" },
    { n: "150ms", label: "Universal UI motion", sub: "feels instant everywhere" },
  ];
  return (
    <section className="border-t border-border bg-[color:var(--surface)]/40">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-5xl lg:text-6xl font-bold tracking-tight tabular-nums text-[color:var(--accent-strong)]">
                {s.n}
              </p>
              <p className="text-[14px] font-semibold mt-3">{s.label}</p>
              <p className="text-[12px] text-muted mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 7. PRICING PREVIEW
// ════════════════════════════════════════════════════════════════════

function PricingPreview() {
  const tiers: { name: string; price: string; sub: string; bullets: string[]; cta: string; href: string; highlighted?: boolean }[] = [
    {
      name: "Starter",
      price: "Free",
      sub: "Up to 5 people",
      bullets: ["Home + People + Work + Culture", "AI Cmd-K search", "Email support"],
      cta: "Start free",
      href: "/register",
    },
    {
      name: "Growth",
      price: "$8",
      sub: "per user / month",
      bullets: ["Everything in Starter", "Money + Talent hubs", "AI Inbox triage", "Priority support"],
      cta: "Start 14-day trial",
      href: "/register?plan=growth",
      highlighted: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      sub: "100+ people",
      bullets: ["Everything in Growth", "SCIM + SSO + audit", "Studio workflows", "Dedicated CSM"],
      cta: "Talk to sales",
      href: "/contact",
    },
  ];

  return (
    <section className="border-t border-border">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
            Pricing
          </p>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight max-w-2xl mx-auto leading-[1.1]">
            Free under five.<br />Honest above that.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border p-6 transition-fast ${
                tier.highlighted
                  ? "border-[color:var(--accent)] bg-background shadow-[0_30px_60px_-20px_rgba(124,58,237,0.4)] ring-1 ring-[color:var(--accent)]/20"
                  : "border-border bg-background hover:border-muted-2/60"
              }`}
            >
              {tier.highlighted && (
                <span
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full"
                  style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
                >
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold mb-1">{tier.name}</h3>
              <div className="mb-5">
                <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
                {tier.price !== "Free" && tier.price !== "Custom" && (
                  <span className="text-sm text-muted ml-1.5">{tier.sub}</span>
                )}
                {(tier.price === "Free" || tier.price === "Custom") && (
                  <p className="text-sm text-muted mt-1">{tier.sub}</p>
                )}
              </div>
              <Link
                href={tier.href}
                className={`block text-center px-4 py-2.5 rounded-lg font-semibold text-sm mb-6 transition-fast ${
                  tier.highlighted
                    ? "bg-[color:var(--accent)] text-white hover:opacity-90"
                    : "border border-border hover:bg-surface"
                }`}
              >
                {tier.cta}
              </Link>
              <ul className="space-y-2">
                {tier.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-[13px]">
                    <Check size={13} className="text-[color:var(--accent-strong)] flex-shrink-0 mt-0.5" />
                    <span className="leading-snug">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--accent-strong)] hover:underline">
            Full feature matrix
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 8. FAQ
// ════════════════════════════════════════════════════════════════════

function FAQ() {
  const items: { q: string; a: string }[] = [
    {
      q: "What does WorkwrK actually replace?",
      a: "Most customers retire 12–20 SaaS subscriptions including Asana/Notion (tasks + SOPs), Lattice (reviews + OKRs), BambooHR (HRIS), Bill.com (expenses + AP), Greenhouse (recruiting), Bonusly (kudos), and Carta (comp). One sign-in, one bill.",
    },
    {
      q: "How is the AI different from a chatbot?",
      a: "Cmd-K queries read across every module in your tenant — people, tasks, KPIs, financials, comp, SOPs. It synthesizes answers from your live data. 'Who's overdue on reviews?' returns names + due dates with deep-links. Not a chatbot. A reading-comprehension layer over your company.",
    },
    {
      q: "Can I start free?",
      a: "Yes. Free under 5 people, forever. No credit card. The full Home + People + Work + Culture hubs are unlocked. Money + Talent hubs unlock at $8/user/month (Growth tier).",
    },
    {
      q: "How long does setup take?",
      a: "Median is under an hour. Day 0 checklist: create org, departments, roles, offices, fiscal year. Then invite the team. There's a six-week implementation playbook for full company rollout in docs/implementation-guide.md.",
    },
    {
      q: "Does WorkwrK support multi-currency / multi-region?",
      a: "Yes. INR, AED, USD, EUR, SGD priced in-currency with compliant local invoicing. GST, VAT, and reverse-charge supported. 18 locales including Hindi, Arabic, Japanese, and Chinese.",
    },
    {
      q: "What about security and compliance?",
      a: "SOC-2 Type II in progress. SAML SSO + SCIM provisioning on Enterprise. Field-level RBAC with a configurable permission matrix. Full audit log with severity tagging. GDPR org-delete with 30-day grace period. Region-locked storage available on Enterprise.",
    },
  ];

  return (
    <section className="border-t border-border bg-[color:var(--surface)]/40">
      <div className="max-w-3xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
            FAQ
          </p>
          <h2 className="text-4xl font-bold tracking-tight">
            Questions teams actually ask.
          </h2>
        </div>

        <div className="space-y-3">
          {items.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-border bg-background overflow-hidden"
            >
              <summary className="cursor-pointer px-5 py-4 flex items-center justify-between hover:bg-[color:var(--surface-elevated)] transition-fast list-none">
                <span className="text-[15px] font-semibold pr-4">{item.q}</span>
                <ChevronRight size={16} className="text-muted-2 flex-shrink-0 group-open:rotate-90 transition-fast" />
              </summary>
              <div className="px-5 pb-4 text-[14px] text-muted leading-relaxed">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 9. FINAL CTA
// ════════════════════════════════════════════════════════════════════

function FinalCTA() {
  return (
    <section className="border-t border-border">
      <div className="max-w-4xl mx-auto px-6 lg:px-10 py-28 text-center">
        <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-5 leading-[1.05]">
          Replace fifteen tools<br />
          <span className="text-[color:var(--accent-strong)]">with one.</span>
        </h2>
        <p className="text-lg text-muted mb-10 max-w-xl mx-auto">
          Free under five people. Cancel any time. Set up in under an hour.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-7 h-12 rounded-xl bg-[color:var(--accent)] text-white font-semibold hover:opacity-90 transition-fast shadow-[0_8px_24px_-8px_rgba(124,58,237,0.5)]"
          >
            Start free
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-7 h-12 rounded-xl border border-border font-semibold hover:bg-surface transition-fast"
          >
            See a demo
          </Link>
        </div>
      </div>
    </section>
  );
}
