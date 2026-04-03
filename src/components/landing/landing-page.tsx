"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/footer";
import { FadeIn, StaggerContainer, StaggerItem, ScaleIn, SlideIn } from "@/components/marketing/motion";
import "../../app/(marketing)/marketing.css";
import {
  ArrowUpRight,
  ArrowRight,
  Users,
  Target,
  ClipboardCheck,
  Star,
  BookOpen,
  Heart,
  Zap,
  Brain,
  BarChart3,
  Quote,
  ChevronDown,
  CheckCircle2,
  Play,
  Shield,
  Globe,
  Clock,
} from "lucide-react";

/* ── Testimonials Data ── */
const testimonials = [
  {
    name: "Arjun Mehta",
    role: "CEO, ScaleOps India",
    avatar: "AM",
    text: "We went from managing 80 people across 4 spreadsheets and 3 WhatsApp groups to one single dashboard. Performance reviews that took 2 weeks now take 2 days. WorkwrK is not just a tool — it's how we run the company now.",
    metric: "80% faster reviews",
  },
  {
    name: "Priya Sharma",
    role: "Head of People, FinEdge",
    avatar: "PS",
    text: "The composite scoring engine changed everything. We used to argue about promotions in meetings. Now we pull up the data — KPIs, peer feedback, SOP compliance — and the decision makes itself. Our team trusts the process.",
    metric: "100% data-driven promotions",
  },
  {
    name: "Ravi Krishnan",
    role: "COO, LogiFleet",
    avatar: "RK",
    text: "With 12 warehouse locations, we couldn't replicate what worked in one branch. WorkwrK's SOP playbook fixed that. Now every location follows the same process, compliance is tracked, and AI flags problems before they escalate.",
    metric: "12 locations standardized",
  },
];

/* ── Feature Tab Data ── */
const featureTabs = [
  {
    id: "performance",
    label: "Performance",
    icon: <Zap size={16} />,
    title: "Composite Performance Scores",
    desc: "One score from 6 real data sources. Auto-calculated, auto-updated. No more guessing who deserves a promotion.",
    visual: (
      <div className="flex flex-col gap-2">
        <div className="mb-1 flex items-center justify-between border-b border-[#2A2A3A] pb-2">
          <span className="font-[family-name:var(--font-mono)] text-[0.6rem] uppercase tracking-wider text-[#8888A0]">Performance Scores — March 2026</span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#00D68F]" />
        </div>
        {[
          { name: "Priya S.", score: 92, color: "#00D68F", change: "+4" },
          { name: "Amit J.", score: 87, color: "#00D68F", change: "+2" },
          { name: "Ravi K.", score: 78, color: "#A29BFE", change: "-5" },
          { name: "Neha M.", score: 71, color: "#FF9F43", change: "+1" },
          { name: "Sanjay R.", score: 45, color: "#FF6B6B", change: "-8" },
        ].map((p) => (
          <div key={p.name} className="flex items-center gap-3">
            <span className="w-16 truncate text-xs text-[#8888A0]">{p.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#2A2A3A]">
              <div className="h-full rounded-full transition-all" style={{ width: `${p.score}%`, background: p.color }} />
            </div>
            <span className="w-7 text-right font-[family-name:var(--font-mono)] text-xs" style={{ color: p.color }}>{p.score}</span>
            <span className={`text-[0.6rem] font-[family-name:var(--font-mono)] ${p.change.startsWith("+") ? "text-[#00D68F]" : "text-[#FF6B6B]"}`}>{p.change}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between text-[0.6rem] text-[#8888A0]">
          <span>Auto-recalculated 2 min ago</span>
          <span className="text-[#A29BFE]">View Breakdown →</span>
        </div>
      </div>
    ),
  },
  {
    id: "reviews",
    label: "Reviews",
    icon: <Star size={16} />,
    title: "360° Performance Reviews",
    desc: "Self, manager, and peer reviews — pre-populated with real data. Calibration sessions for fairness.",
    visual: (
      <div className="flex flex-col gap-3">
        <div className="mb-1 flex items-center justify-between border-b border-[#2A2A3A] pb-2">
          <span className="font-[family-name:var(--font-mono)] text-[0.6rem] uppercase tracking-wider text-[#8888A0]">Review — Priya Sharma</span>
          <span className="rounded-full bg-[#00D68F]/20 px-2 py-0.5 text-[0.55rem] font-medium text-[#00D68F]">Completed</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20">
            <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="40" cy="40" r="34" fill="none" stroke="#2A2A3A" strokeWidth="6" />
              <circle cx="40" cy="40" r="34" fill="none" stroke="#00D68F" strokeWidth="6" strokeDasharray="213.6" strokeDashoffset="17" strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-[family-name:var(--font-syne)] text-xl font-bold text-[#00D68F]">92</span>
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-[#8888A0]">
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#00D68F]" /> KPI: 94%</div>
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#6C5CE7]" /> Manager: 4.8/5</div>
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#A29BFE]" /> Peer: 4.5/5</div>
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#FF9F43]" /> SOP: 98%</div>
          </div>
        </div>
        <div className="rounded-lg bg-[#00D68F]/10 px-3 py-2 text-xs text-[#00D68F]">
          Promotion Eligible — Top 5% performer
        </div>
      </div>
    ),
  },
  {
    id: "ai",
    label: "AI",
    icon: <Brain size={16} />,
    title: "AI Intelligence Layer",
    desc: "Ask anything in plain English. Get answers from real data across all modules.",
    visual: (
      <div className="flex flex-col gap-2.5">
        <div className="mb-1 flex items-center justify-between border-b border-[#2A2A3A] pb-2">
          <span className="font-[family-name:var(--font-mono)] text-[0.6rem] uppercase tracking-wider text-[#8888A0]">AI Assistant</span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#00D68F]" />
        </div>
        <div className="ml-auto max-w-[75%] rounded-xl rounded-br-sm bg-[#6C5CE7] px-3 py-2 text-xs text-white">
          Who should I promote this quarter?
        </div>
        <div className="mr-auto max-w-[85%] rounded-xl rounded-bl-sm bg-[#2A2A3A] px-3 py-2 text-xs text-[#E8E8F0]">
          <div className="mb-1 font-[family-name:var(--font-mono)] text-[0.55rem] text-[#A29BFE]">workwrk AI</div>
          Based on composite scores, tenure, and peer feedback:<br />
          <strong>Priya S.</strong> (92) — 14mo tenure, 8 kudos<br />
          <strong>Amit J.</strong> (87) — 22mo, consistent uptrend<br /><br />
          Both exceed promotion threshold of 85+.
        </div>
        <div className="ml-auto max-w-[75%] rounded-xl rounded-br-sm bg-[#6C5CE7] px-3 py-2 text-xs text-white">
          Compare them side by side
        </div>
      </div>
    ),
  },
  {
    id: "kudos",
    label: "Kudos",
    icon: <Heart size={16} />,
    title: "Recognition & Kudos",
    desc: "Build a culture of appreciation. Company value tags. Social feed. Performance bonus.",
    visual: (
      <div className="flex flex-col gap-2.5">
        <div className="mb-1 flex items-center justify-between border-b border-[#2A2A3A] pb-2">
          <span className="font-[family-name:var(--font-mono)] text-[0.6rem] uppercase tracking-wider text-[#8888A0]">Kudos Feed</span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#FF6B6B]" />
        </div>
        {[
          { from: "Ravi K.", to: "Priya S.", msg: "Amazing client presentation!", value: "Customer First", time: "2h" },
          { from: "Neha M.", to: "Amit J.", msg: "Fixed the prod bug at midnight", value: "Ownership", time: "5h" },
          { from: "CEO", to: "Sales Team", msg: "Record quarter — crushed it!", value: "Excellence", time: "1d" },
        ].map((k, i) => (
          <div key={i} className="rounded-lg border border-[#2A2A3A] bg-[rgba(255,255,255,0.02)] p-2.5">
            <div className="flex justify-between text-[0.6rem]">
              <span className="text-[#E8E8F0]"><strong>{k.from}</strong> → {k.to}</span>
              <span className="text-[#8888A0]">{k.time}</span>
            </div>
            <p className="my-1 text-xs text-[#8888A0]">{k.msg}</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FF6B6B]/10 px-2 py-0.5 text-[0.55rem] text-[#FF6B6B]">♥ {k.value}</span>
          </div>
        ))}
      </div>
    ),
  },
];

/* ── FAQ Data ── */
const homeFaqs = [
  { q: "What is WorkwrK?", a: "WorkwrK is an all-in-one business operating system that replaces 15+ disconnected tools. It unifies people management, KPI tracking, performance reviews, SOPs, task management, employee recognition, and AI intelligence into one platform." },
  { q: "Do you offer a free trial?", a: "Yes — every plan includes a 14-day free trial with full access to all features. No credit card required." },
  { q: "How long does setup take?", a: "Most teams are fully set up in under 30 minutes. Create your organization, add your team (or bulk import), set up KRAs/KPIs, and assign SOPs. No implementation consultants required." },
];

/* ── FAQ Accordion ── */
function HomeFaq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#2A2A3A] last:border-b-0">
      <button className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-semibold text-[#E8E8F0] transition-colors hover:text-[#A29BFE]" onClick={() => setOpen(!open)} aria-expanded={open}>
        {q}
        <ChevronDown size={18} className="flex-shrink-0 text-[#8888A0] transition-transform duration-300" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      <div className="overflow-hidden transition-all duration-300" style={{ maxHeight: open ? "300px" : "0px", paddingBottom: open ? "20px" : "0px" }}>
        <p className="text-sm leading-relaxed text-[#8888A0]">{a}</p>
      </div>
    </div>
  );
}

/* ── Feature Tabs ── */
function FeatureTabs() {
  const [active, setActive] = useState(0);
  const tab = featureTabs[active];

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <div>
        <div className="mb-6 flex flex-wrap gap-2">
          {featureTabs.map((t, i) => (
            <button key={t.id} onClick={() => setActive(i)} className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${i === active ? "border-[#6C5CE7] bg-[#6C5CE7]/10 text-[#E8E8F0]" : "border-[#2A2A3A] bg-transparent text-[#8888A0] hover:border-[#3A3A4A]"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <h3 className="mb-3 font-[family-name:var(--font-syne)] text-2xl font-bold text-[#E8E8F0]">{tab.title}</h3>
        <p className="mb-6 text-sm leading-relaxed text-[#8888A0]">{tab.desc}</p>
        <Link href={`/features#${tab.id === "performance" ? "scores" : tab.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#A29BFE] transition-colors hover:text-[#E8E8F0]">
          Learn more <ArrowRight size={14} />
        </Link>
      </div>
      <div className="rounded-2xl border border-[#2A2A3A] bg-[#1A1A26] p-5">{tab.visual}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN LANDING PAGE
   ═══════════════════════════════════════════ */
export function LandingPage() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="marketing-page relative min-h-screen bg-[#0A0A0F] font-[family-name:var(--font-outfit)]">
      <MarketingNav />

      {/* ═══ HERO ═══ */}
      <header className="relative overflow-hidden pb-24 pt-40">
        <div className="hero-grid" />
        <div className="hero-glow" />
        <div className="relative z-[1] mx-auto max-w-[1200px] px-6 text-center">
          <FadeIn delay={0}>
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#2A2A3A] bg-[#12121A] px-4 py-1.5 text-xs text-[#8888A0]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D68F]" />
              Trusted by 500+ growing businesses
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <h1 className="mx-auto mb-6 max-w-[800px] font-[family-name:var(--font-syne)] text-[clamp(2.8rem,6vw,5rem)] font-extrabold leading-[1.05] tracking-[-3px] text-[#E8E8F0]">
              One Platform to Run<br /><span className="text-gradient">Your Entire Business</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.3}>
            <p className="mx-auto mb-10 max-w-[560px] text-lg leading-relaxed text-[#8888A0]">
              Replace 15 disconnected tools with one intelligent system. People, KPIs, SOPs, reviews, tasks, recognition, and AI — unified.
            </p>
          </FadeIn>
          <FadeIn delay={0.45}>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/register" className="btn-primary px-8 py-3.5 text-base">Start Free Trial <ArrowUpRight size={16} /></Link>
              <Link href="/features" className="btn-outline px-8 py-3.5 text-base"><Play size={14} /> Watch Demo</Link>
            </div>
            <p className="mt-5 text-xs text-[#8888A0]">Free 14-day trial. No credit card required. Setup in 10 minutes.</p>
          </FadeIn>
        </div>
      </header>

      {/* ═══ TRUSTED BY ═══ */}
      <section className="border-y border-[#2A2A3A] py-10">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <p className="mb-6 text-center text-xs uppercase tracking-[3px] text-[#8888A0]">Trusted by teams at</p>
          </FadeIn>
          <StaggerContainer className="flex flex-wrap items-center justify-center gap-10 opacity-40">
            {["ScaleOps", "FinEdge", "LogiFleet", "BrightPath", "Apex Realty", "MedCare", "NovaTech", "UrbanGrid"].map((co) => (
              <StaggerItem key={co}>
                <span className="font-[family-name:var(--font-syne)] text-lg font-bold tracking-tight text-[#8888A0]">{co}</span>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ═══ STATS ═══ */}
      <section className="py-16">
        <StaggerContainer className="mx-auto grid max-w-[1200px] grid-cols-2 gap-5 px-6 md:grid-cols-4">
          {[
            { number: "12+", label: "Integrated Modules", icon: <BarChart3 size={18} /> },
            { number: "6", label: "Performance Data Sources", icon: <Target size={18} /> },
            { number: "10x", label: "Faster Reviews", icon: <Clock size={18} /> },
            { number: "100%", label: "Process Visibility", icon: <Shield size={18} /> },
          ].map((m) => (
            <StaggerItem key={m.label}>
              <div className="flex items-center gap-4 rounded-xl border border-[#2A2A3A] bg-[#12121A] p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#6C5CE7]/10 text-[#A29BFE]">{m.icon}</div>
                <div>
                  <div className="text-gradient-purple font-[family-name:var(--font-syne)] text-2xl font-extrabold">{m.number}</div>
                  <div className="text-xs text-[#8888A0]">{m.label}</div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </section>

      {/* ═══ PROBLEM ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn className="mb-12 max-w-[600px]">
            <p className="mkt-label">The Problem</p>
            <h2 className="mkt-title text-[clamp(2rem,4vw,3rem)]">Your business is held together<br />by WhatsApp and hope.</h2>
          </FadeIn>
          <StaggerContainer className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Invisible Performance", desc: "No idea who's performing until it's too late. Gut-based decisions. Top performers leave unnoticed." },
              { title: "Process in People's Heads", desc: "When someone leaves, their process goes with them. Nothing documented. Nothing repeatable." },
              { title: "15 Tools, Zero Clarity", desc: "Data in spreadsheets, WhatsApp, and 12 other tools. Monthly reviews are storytelling sessions." },
              { title: "No Accountability Chain", desc: "Tasks assigned verbally and forgotten. No follow-up. No escalation. Deadlines are suggestions." },
              { title: "Founder is the Bottleneck", desc: "Every decision flows through you. You can't scale because the business can't function without you." },
              { title: "Recognition Doesn't Exist", desc: "Great work goes unnoticed. No culture of appreciation. Top performers feel invisible and leave." },
            ].map((card) => (
              <StaggerItem key={card.title}>
                <div className="mkt-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <h3 className="mb-2 font-[family-name:var(--font-syne)] text-lg font-bold text-[#E8E8F0]">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-[#8888A0]">{card.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ═══ INTERACTIVE FEATURE TABS ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn className="mb-12 max-w-[600px]">
            <p className="mkt-label">See It In Action</p>
            <h2 className="mkt-title mb-4 text-[clamp(2rem,4vw,3rem)]">Not another dashboard.<br />A <span className="text-gradient">business operating system.</span></h2>
          </FadeIn>
          <ScaleIn><FeatureTabs /></ScaleIn>
        </div>
      </section>

      {/* ═══ ALL 12 MODULES ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn className="mb-12 text-center">
            <p className="mkt-label">12 Modules</p>
            <h2 className="mkt-title text-[clamp(2rem,4vw,3rem)]">Everything works together.</h2>
          </FadeIn>
          <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: <Users size={20} />, title: "People", color: "#6C5CE7" },
              { icon: <Target size={20} />, title: "KRA & KPIs", color: "#00D68F" },
              { icon: <ClipboardCheck size={20} />, title: "Tasks", color: "#FF9F43" },
              { icon: <Star size={20} />, title: "Reviews", color: "#A29BFE" },
              { icon: <BookOpen size={20} />, title: "SOPs", color: "#00D68F" },
              { icon: <Zap size={20} />, title: "Scores", color: "#6C5CE7" },
              { icon: <Heart size={20} />, title: "Kudos", color: "#FF6B6B" },
              { icon: <Brain size={20} />, title: "AI", color: "#A29BFE" },
              { icon: <BarChart3 size={20} />, title: "Analytics", color: "#00D68F" },
              { icon: <Globe size={20} />, title: "Meetings", color: "#FF9F43" },
              { icon: <Shield size={20} />, title: "Notifications", color: "#6C5CE7" },
              { icon: <CheckCircle2 size={20} />, title: "Integrations", color: "#8888A0" },
            ].map((m) => (
              <StaggerItem key={m.title}>
                <div className="flex items-center gap-3 rounded-xl border border-[#2A2A3A] bg-[#12121A] p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-[rgba(108,92,231,0.4)]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${m.color}15`, color: m.color }}>{m.icon}</div>
                  <span className="text-sm font-medium text-[#E8E8F0]">{m.title}</span>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
          <FadeIn className="mt-8 text-center" delay={0.3}>
            <Link href="/features" className="inline-flex items-center gap-2 text-sm font-semibold text-[#A29BFE] transition-colors hover:text-[#E8E8F0]">Explore all features <ArrowRight size={16} /></Link>
          </FadeIn>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn className="mb-12 text-center">
            <p className="mkt-label">Customer Stories</p>
            <h2 className="mkt-title text-[clamp(2rem,4vw,3rem)]">Loved by teams who<br />refuse to stay small.</h2>
          </FadeIn>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <SlideIn key={t.name} from={i % 2 === 0 ? "left" : "right"} delay={i * 0.1}>
                <div className="flex flex-col rounded-2xl border border-[#2A2A3A] bg-[#12121A] p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <Quote size={24} className="mb-4 text-[#6C5CE7]/30" />
                  <p className="mb-6 flex-1 text-sm leading-relaxed text-[#8888A0]">&ldquo;{t.text}&rdquo;</p>
                  <div className="flex items-center justify-between border-t border-[#2A2A3A] pt-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#6C5CE7]/20 text-xs font-bold text-[#A29BFE]">{t.avatar}</div>
                      <div>
                        <div className="text-sm font-medium text-[#E8E8F0]">{t.name}</div>
                        <div className="text-xs text-[#8888A0]">{t.role}</div>
                      </div>
                    </div>
                    <span className="rounded-full bg-[#00D68F]/10 px-2.5 py-1 text-[0.6rem] font-semibold text-[#00D68F]">{t.metric}</span>
                  </div>
                </div>
              </SlideIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ RESULTS ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <div className="mkt-highlight">
              <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
                <div>
                  <FadeIn>
                    <p className="mkt-label">Results</p>
                    <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.4rem)]">Real impact.<br />Measurable outcomes.</h2>
                    <p className="mb-8 text-sm leading-relaxed text-[#8888A0]">Companies using WorkwrK report dramatic improvements in visibility, efficiency, and team culture within the first 90 days.</p>
                  </FadeIn>
                  <StaggerContainer className="flex flex-col gap-4">
                    {[
                      { metric: "80%", label: "faster performance review cycles" },
                      { metric: "3x", label: "increase in employee recognition" },
                      { metric: "70%", label: "reduction in founder dependency" },
                      { metric: "95%", label: "SOP compliance across locations" },
                    ].map((r) => (
                      <StaggerItem key={r.label}>
                        <div className="flex items-center gap-4">
                          <span className="text-gradient-purple w-14 flex-shrink-0 font-[family-name:var(--font-syne)] text-2xl font-extrabold">{r.metric}</span>
                          <span className="text-sm text-[#8888A0]">{r.label}</span>
                        </div>
                      </StaggerItem>
                    ))}
                  </StaggerContainer>
                </div>
                <FadeIn delay={0.2}>
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-[#2A2A3A] bg-[#1A1A26] p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                      <Quote size={20} className="mb-3 text-[#6C5CE7]/30" />
                      <p className="mb-4 text-sm leading-relaxed text-[#8888A0]">&ldquo;We went from managing 80 people across 4 spreadsheets to one dashboard. Performance reviews that took 2 weeks now take 2 days.&rdquo;</p>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6C5CE7]/20 text-xs font-bold text-[#A29BFE]">AM</div>
                        <div>
                          <div className="text-sm font-medium text-[#E8E8F0]">Arjun Mehta</div>
                          <div className="text-xs text-[#8888A0]">CEO, ScaleOps India</div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-xl border border-[#2A2A3A] bg-[#1A1A26] p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                        <div className="text-gradient-purple font-[family-name:var(--font-syne)] text-3xl font-extrabold">500+</div>
                        <div className="text-xs text-[#8888A0]">Businesses</div>
                      </div>
                      <div className="rounded-xl border border-[#2A2A3A] bg-[#1A1A26] p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                        <div className="text-gradient-purple font-[family-name:var(--font-syne)] text-3xl font-extrabold">15k+</div>
                        <div className="text-xs text-[#8888A0]">Employees managed</div>
                      </div>
                    </div>
                  </div>
                </FadeIn>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid gap-12 lg:grid-cols-[1fr_2fr] lg:items-start">
            <FadeIn>
              <div>
                <p className="mkt-label">FAQ</p>
                <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">Common questions.</h2>
                <p className="text-sm text-[#8888A0]">Can&apos;t find what you&apos;re looking for?</p>
                <Link href="/faq" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#A29BFE] transition-colors hover:text-[#E8E8F0]">See all FAQs <ArrowRight size={14} /></Link>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="rounded-2xl border border-[#2A2A3A] bg-[#12121A] px-6">
                {homeFaqs.map((faq) => <HomeFaq key={faq.q} q={faq.q} a={faq.a} />)}
              </div>
              <div className="mt-4 text-right">
                <Link href="/faq" className="inline-flex items-center gap-2 text-sm font-semibold text-[#A29BFE] transition-colors hover:text-[#E8E8F0]">See all FAQs <ArrowRight size={14} /></Link>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <ScaleIn>
            <div className="mkt-highlight text-center">
              <FadeIn delay={0.15}>
                <h2 className="mkt-title mb-4 text-[clamp(2rem,4vw,3rem)]">Stop managing chaos.<br />Start <span className="text-gradient">operating</span> your business.</h2>
              </FadeIn>
              <FadeIn delay={0.3}>
                <p className="mx-auto mb-8 max-w-[460px] text-base text-[#8888A0]">Join 500+ businesses that replaced spreadsheets, WhatsApp groups, and guesswork with one intelligent platform.</p>
              </FadeIn>
              <FadeIn delay={0.45}>
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                  <Link href="/register" className="btn-primary px-8 py-3.5 text-base">Start Free Trial <ArrowUpRight size={16} /></Link>
                  <Link href="/pricing" className="btn-outline px-8 py-3.5 text-base">View Pricing</Link>
                </div>
                <p className="relative mt-4 text-xs text-[#8888A0]">Free 14-day trial. No credit card. Setup in 10 minutes.</p>
              </FadeIn>
            </div>
          </ScaleIn>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
