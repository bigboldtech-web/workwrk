// AI Agents — the showpiece for workwrk's agent layer.
//
// Three moments inside one dark section:
//
//   1. "Meet your team of agents" — 8 character cards, each a bright
//      gradient with an icon-mark and the agent's role. Cards reveal
//      with stagger + 3D-tilt feel as you scroll in.
//   2. "Agents at work" — pick a team tab, see 3 agent-driven
//      workflows playing out for that team's day.
//   3. "Train your own" — visual mock of the agent builder + 3 simple
//      promises, and a clear CTA.
//
// Section is full-bleed dark (slate-950) so the agent characters pop
// like monday.com's character mosaic on black.

"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Inbox, Activity, FileText, TrendingUp, Truck, UserPlus,
  ClipboardCheck, Compass, Plus, ArrowRight, Sparkles, Bot,
} from "lucide-react";

// ════════════════════════════════════════════════════════════════════
// Agent catalog
// ════════════════════════════════════════════════════════════════════

interface Agent {
  handle: string;
  name: string;
  role: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  gradient: string;
  skills: readonly string[];
}

const AGENTS: readonly Agent[] = [
  {
    handle: "@inbox",
    name: "Inbox Triage",
    role: "Sorts every signal, routes to the right human.",
    icon: Inbox,
    gradient: "linear-gradient(135deg, #FF3D57 0%, #FF7C95 100%)",
    skills: ["Auto-categorize", "Priority scoring", "Route to owner"],
  },
  {
    handle: "@kpi",
    name: "KPI Sentinel",
    role: "Alerts on metric drift before it shows up in the review.",
    icon: Activity,
    gradient: "linear-gradient(135deg, #0073EA 0%, #5BA8FF 100%)",
    skills: ["Anomaly detection", "Threshold alerts", "Trend prediction"],
  },
  {
    handle: "@reviewer",
    name: "Review Drafter",
    role: "Drafts performance reviews from real KPI + task data.",
    icon: FileText,
    gradient: "linear-gradient(135deg, #A25DDC 0%, #D389F6 100%)",
    skills: ["Pull metrics", "Draft strengths", "Suggest growth areas"],
  },
  {
    handle: "@pipeline",
    name: "Pipeline Forecaster",
    role: "Predicts which deals will actually close this quarter.",
    icon: TrendingUp,
    gradient: "linear-gradient(135deg, #FDAB3D 0%, #FFD180 100%)",
    skills: ["Win-rate analysis", "Activity scoring", "Forecast confidence"],
  },
  {
    handle: "@vendor",
    name: "Vendor Watch",
    role: "Tracks vendor compliance, spend, and SOC 2 evidence.",
    icon: Truck,
    gradient: "linear-gradient(135deg, #00C875 0%, #7CE8B0 100%)",
    skills: ["PO matching", "Spend alerts", "Compliance audit"],
  },
  {
    handle: "@recruiter",
    name: "Recruiting Sourcer",
    role: "Finds best candidate matches and queues them in your pipeline.",
    icon: UserPlus,
    gradient: "linear-gradient(135deg, #d946ef 0%, #f0abfc 100%)",
    skills: ["Match scoring", "Outreach drafts", "Schedule screens"],
  },
  {
    handle: "@sop",
    name: "SOP Auditor",
    role: "Checks process compliance in real time across every team.",
    icon: ClipboardCheck,
    gradient: "linear-gradient(135deg, #14b8a6 0%, #5eead4 100%)",
    skills: ["Run validation", "Drift detection", "Audit log"],
  },
  {
    handle: "@coach",
    name: "Onboarding Coach",
    role: "Walks new hires through their first 30 days, automatically.",
    icon: Compass,
    gradient: "linear-gradient(135deg, #6366f1 0%, #a5b4fc 100%)",
    skills: ["Day plan", "Mentor pairing", "Progress check-ins"],
  },
];

// ════════════════════════════════════════════════════════════════════
// Section
// ════════════════════════════════════════════════════════════════════

export function AIAgents() {
  return (
    <section className="relative overflow-hidden bg-slate-950 text-white py-24 lg:py-32">
      {/* Drifting brand-red glow */}
      <motion.div
        className="absolute -top-40 -left-32 w-[680px] h-[680px] rounded-full blur-3xl pointer-events-none"
        style={{ backgroundColor: "var(--brand-red)", opacity: 0.16 }}
        animate={{ x: [0, 60, -20, 0], y: [0, 30, -15, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      />
      <motion.div
        className="absolute -bottom-40 -right-32 w-[640px] h-[640px] rounded-full blur-3xl pointer-events-none"
        style={{ backgroundColor: "#A25DDC", opacity: 0.14 }}
        animate={{ x: [0, -40, 30, 0], y: [0, -20, 30, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        aria-hidden
      />

      {/* Faint grid */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
        aria-hidden
      />

      <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
        {/* ───── Moment 1: Meet your team of agents ───── */}
        <motion.div
          className="max-w-3xl"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--brand-red)" }}>
            <motion.span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "var(--brand-red)" }}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
            AI Agents
          </span>
          <h2
            className="mt-5 font-extrabold tracking-[-0.035em] text-white"
            style={{ fontSize: "clamp(2.2rem, 4.6vw, 3.8rem)", lineHeight: 1.04 }}
          >
            Meet your team <br className="hidden sm:block" />
            of <span style={{ color: "var(--brand-yellow)" }}>AI agents.</span>
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-white/70 max-w-2xl">
            Agents that learn your business and do real work &mdash; not
            chatbots. They run alongside your team across all 7 hubs,
            trigger real actions, and let you train your own from a
            simple builder.
          </p>
        </motion.div>

        {/* Agent character grid */}
        <div className="mt-14 lg:mt-16 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5">
          {AGENTS.map((agent, i) => (
            <AgentCard key={agent.handle} agent={agent} delay={i * 0.05} />
          ))}
          <BuildOwnCard delay={AGENTS.length * 0.05} />
        </div>

        {/* ───── Moment 2: Agents at work ───── */}
        <AgentsAtWork />

        {/* ───── Moment 3: Train your own ───── */}
        <TrainYourOwn />
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Agent card — bright gradient + icon mark + name + skills
// ════════════════════════════════════════════════════════════════════

function AgentCard({ agent, delay }: { agent: Agent; delay: number }) {
  const Icon = agent.icon;
  return (
    <motion.div
      className="group relative rounded-2xl overflow-hidden bg-white/[0.04] hover:bg-white/[0.07] transition-colors"
      style={{ border: "1px solid rgba(255,255,255,0.10)" }}
      initial={{ opacity: 0, y: 22, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
    >
      {/* Gradient hero with icon + bobbing motion */}
      <div
        className="relative h-[170px] flex items-center justify-center overflow-hidden"
        style={{ background: agent.gradient }}
      >
        {/* Decorative glow rings */}
        <div className="absolute inset-0 opacity-25" aria-hidden>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 rounded-full" style={{ background: "radial-gradient(circle, white 0%, transparent 60%)" }} />
        </div>

        <motion.div
          className="relative"
          animate={{ y: [0, -8, 0, 8, 0] }}
          transition={{ duration: 6 + (delay * 10), repeat: Infinity, ease: "easeInOut", delay }}
        >
          <div
            className="w-[88px] h-[88px] rounded-full backdrop-blur flex items-center justify-center"
            style={{
              backgroundColor: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.32)",
              boxShadow: "0 14px 30px -8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.4)",
            }}
          >
            <Icon size={36} strokeWidth={2.2} className="text-white" />
          </div>
        </motion.div>

        {/* Handle pill */}
        <span
          className="absolute top-3 left-3 inline-flex items-center text-[9.5px] font-mono font-bold px-2 h-5 rounded-full text-white"
          style={{ backgroundColor: "rgba(0,0,0,0.25)", backdropFilter: "blur(6px)" }}
        >
          {agent.handle}
        </span>

        {/* Sparkle marker bottom-right */}
        <span className="absolute bottom-3 right-3 text-white/80">
          <Sparkles size={14} />
        </span>
      </div>

      {/* Bottom: name + role + skills */}
      <div className="p-4">
        <p className="font-bold text-[14px] tracking-tight" style={{ color: "white" }}>
          {agent.name}
        </p>
        <p className="mt-1 text-[11.5px] leading-snug" style={{ color: "rgba(255,255,255,0.65)" }}>
          {agent.role}
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          {agent.skills.map((skill) => (
            <span
              key={skill}
              className="text-[9.5px] font-semibold px-1.5 h-[18px] inline-flex items-center rounded-md"
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.78)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// "Build your own" tile
function BuildOwnCard({ delay }: { delay: number }) {
  return (
    <motion.a
      href="#train-your-own"
      className="group relative rounded-2xl overflow-hidden flex flex-col items-center justify-center text-center p-6 transition-colors"
      style={{
        border: "2px dashed rgba(255,255,255,0.14)",
        backgroundColor: "rgba(255,255,255,0.02)",
        minHeight: 340,
      }}
      initial={{ opacity: 0, y: 22, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
    >
      <div
        className="w-[64px] h-[64px] rounded-full flex items-center justify-center mb-4"
        style={{
          background: "linear-gradient(135deg, var(--brand-red) 0%, var(--brand-yellow) 100%)",
          boxShadow: "0 16px 32px -10px rgba(255, 61, 87, 0.4)",
        }}
      >
        <Plus size={28} strokeWidth={2.5} className="text-white" />
      </div>
      <p className="font-bold text-[15px] tracking-tight text-white">Build your own agent</p>
      <p className="mt-2 text-[11.5px] leading-snug text-white/55 max-w-[180px]">
        Drag triggers, pick the actions, point at the data. Trained in
        under an hour.
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-white/90 group-hover:gap-2 transition-all">
        Start building <ArrowRight size={11} />
      </span>
    </motion.a>
  );
}

// ════════════════════════════════════════════════════════════════════
// Moment 2: Agents at Work — tabbed workflow showcase
// ════════════════════════════════════════════════════════════════════

interface WorkflowTab {
  id: string;
  label: string;
  steps: { agent: string; agentHue: string; action: string; outcome: string }[];
}

const WORKFLOWS: readonly WorkflowTab[] = [
  {
    id: "ops",
    label: "Operations",
    steps: [
      { agent: "@inbox",  agentHue: "#FF3D57", action: "Catches incident report at 03:12 ET",          outcome: "Routes to on-call ops lead" },
      { agent: "@sop",    agentHue: "#14b8a6", action: "Runs SOP-141 incident playbook automatically", outcome: "All 6 steps timestamped" },
      { agent: "@vendor", agentHue: "#00C875", action: "Cross-checks vendor SLA + compliance log",    outcome: "Files audit-ready evidence" },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    steps: [
      { agent: "@pipeline", agentHue: "#FDAB3D", action: "Scores 12 new deals from activity signals", outcome: "Flags 3 at-risk for forecast" },
      { agent: "@reviewer", agentHue: "#A25DDC", action: "Drafts mid-cycle rep performance review",   outcome: "Manager edits, doesn't write" },
      { agent: "@inbox",    agentHue: "#FF3D57", action: "Triages 47 customer pings to right rep",    outcome: "SLA dropped from 4h to 12m" },
    ],
  },
  {
    id: "hr",
    label: "HR",
    steps: [
      { agent: "@recruiter", agentHue: "#d946ef", action: "Sources 28 candidates for VP Eng role",      outcome: "Top 6 pinged + scheduled" },
      { agent: "@coach",     agentHue: "#6366f1", action: "Launches Day-1 plan for Maya joining",       outcome: "Mentor paired, docs queued" },
      { agent: "@kpi",       agentHue: "#0073EA", action: "Catches retention drift in Sales team",     outcome: "Flags 2 risk profiles to VP" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    steps: [
      { agent: "@vendor", agentHue: "#00C875", action: "Reconciles 142 vendor invoices to POs",       outcome: "8 over-budget flagged for CFO" },
      { agent: "@kpi",    agentHue: "#0073EA", action: "Spots Operations burn 8% over plan",          outcome: "Alerts CFO + dept head" },
      { agent: "@sop",    agentHue: "#14b8a6", action: "Validates Q2 close SOP across 5 ledgers",     outcome: "Books locked, audit-ready" },
    ],
  },
];

function AgentsAtWork() {
  const [activeId, setActiveId] = useState<string>("ops");
  const active = WORKFLOWS.find((w) => w.id === activeId) ?? WORKFLOWS[0];

  return (
    <div className="mt-32 lg:mt-40">
      <motion.div
        className="max-w-3xl"
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--brand-yellow)" }}>
          Agents at work
        </p>
        <h3
          className="mt-5 font-extrabold tracking-[-0.035em] text-white"
          style={{ fontSize: "clamp(1.8rem, 3.6vw, 2.8rem)", lineHeight: 1.06 }}
        >
          One Tuesday morning. <br className="hidden sm:block" />
          <span style={{ color: "var(--brand-yellow)" }}>Three agents.</span> Real work shipped.
        </h3>
      </motion.div>

      {/* Tabs */}
      <div className="mt-10 flex flex-wrap items-center gap-1.5">
        {WORKFLOWS.map((w) => {
          const isActive = w.id === activeId;
          return (
            <button
              key={w.id}
              onClick={() => setActiveId(w.id)}
              className="relative inline-flex items-center px-4 py-2 rounded-full text-[12.5px] font-semibold transition-colors"
              style={{
                color: isActive ? "var(--brand-yellow)" : "rgba(255,255,255,0.65)",
              }}
            >
              {isActive && (
                <motion.span
                  layoutId="aaw-tab-active"
                  className="absolute inset-0 rounded-full -z-10"
                  style={{
                    backgroundColor: "rgba(255, 203, 0, 0.14)",
                    border: "1px solid rgba(255, 203, 0, 0.4)",
                  }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                />
              )}
              {w.label}
            </button>
          );
        })}
      </div>

      {/* Workflow viz */}
      <div className="mt-8 rounded-2xl p-6 lg:p-8 relative overflow-hidden"
        style={{
          backgroundColor: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="grid lg:grid-cols-3 gap-4">
              {active.steps.map((s, i) => (
                <motion.div
                  key={s.agent}
                  className="relative p-5 rounded-xl bg-white/[0.04]"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                >
                  {/* Step number + agent */}
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className="text-[9.5px] font-bold uppercase tracking-[0.18em]"
                      style={{ color: s.agentHue }}
                    >
                      Step {i + 1}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 text-[10.5px] font-mono font-bold px-2 h-6 rounded-full"
                      style={{
                        backgroundColor: `${s.agentHue}22`,
                        color: s.agentHue,
                        border: `1px solid ${s.agentHue}44`,
                      }}
                    >
                      <Bot size={10} /> {s.agent}
                    </span>
                  </div>

                  <p className="text-[13px] font-semibold leading-snug text-white">
                    {s.action}
                  </p>
                  <div className="mt-3 flex items-start gap-2 text-[11.5px]" style={{ color: "rgba(255,255,255,0.65)" }}>
                    <ArrowRight size={11} className="mt-0.5 flex-shrink-0" style={{ color: s.agentHue }} />
                    <span>{s.outcome}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Moment 3: Train your own
// ════════════════════════════════════════════════════════════════════

function TrainYourOwn() {
  return (
    <div id="train-your-own" className="mt-32 lg:mt-40">
      <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--brand-red)" }}>
            Train your own
          </p>
          <h3
            className="mt-5 font-extrabold tracking-[-0.035em] text-white"
            style={{ fontSize: "clamp(1.8rem, 3.6vw, 2.8rem)", lineHeight: 1.06 }}
          >
            Don&apos;t just hire ours. <br className="hidden sm:block" />
            <span style={{ color: "var(--brand-red)" }}>Train your own.</span>
          </h3>
          <p className="mt-6 text-base lg:text-lg leading-relaxed text-white/70 max-w-xl">
            Drag triggers from any workflow. Pick the actions it can take.
            Scope what data it sees. Validate before it ships. No code, no
            ML team, no waiting.
          </p>

          <ul className="mt-7 space-y-3">
            {[
              { title: "Trigger from any hub",       body: "OKR slipped, KPI dropped, vendor late, kudos sent — anything." },
              { title: "Take real actions",          body: "Create tasks, draft reviews, send Slacks, post to your CRM, run an SOP." },
              { title: "Validate before execute",    body: "Human-in-the-loop by default. Or trust it once it earns the trust." },
              { title: "Scoped to what it needs",    body: "Permissions inherited from your role model. No surprises." },
            ].map((b) => (
              <li key={b.title} className="flex items-start gap-3">
                <span
                  className="mt-1 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "linear-gradient(135deg, var(--brand-red) 0%, var(--brand-yellow) 100%)",
                  }}
                >
                  <Sparkles size={11} className="text-white" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-white">{b.title}</p>
                  <p className="text-[12.5px] text-white/60">{b.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href="/signup"
              className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-white text-slate-950 font-bold text-[14px] hover:-translate-y-0.5 transition-transform"
            >
              Train your first agent <ArrowRight size={14} />
            </a>
            <a
              href="/features/ai-engine"
              className="inline-flex items-center gap-2 h-12 px-6 rounded-full text-white border border-white/20 hover:border-white/50 font-semibold text-[14px] transition-colors"
            >
              See the agent docs
            </a>
          </div>
        </motion.div>

        {/* Agent builder mock */}
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <AgentBuilderMock />
        </motion.div>
      </div>
    </div>
  );
}

function AgentBuilderMock() {
  return (
    <div
      className="rounded-2xl overflow-hidden relative"
      style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 30px 80px -30px rgba(0,0,0,0.6)",
      }}
    >
      {/* Header */}
      <div className="h-10 flex items-center gap-2 px-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
        <span className="ml-2 text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
          workwrk.com / agents / build
        </span>
      </div>

      {/* Builder canvas */}
      <div className="p-5 space-y-3">
        <BuilderBlock
          label="When"
          accent="#00C875"
          children={
            <>
              <BuilderField k="Trigger" v="KPI drift" />
              <BuilderField k="Where"   v="Sales hub · Quota attainment" />
              <BuilderField k="Threshold" v="-5% over 7 days" />
            </>
          }
        />
        <BuilderConnector />
        <BuilderBlock
          label="Then"
          accent="#FF3D57"
          children={
            <>
              <BuilderField k="Action" v="Create task" />
              <BuilderField k="Assign" v="Maya Chen · VP Sales" />
              <BuilderField k="Notify" v="#sales-leads in Slack" />
            </>
          }
        />
        <BuilderConnector />
        <BuilderBlock
          label="With permission"
          accent="#A25DDC"
          children={
            <>
              <BuilderField k="Sees" v="Sales pipeline + KPI dashboards" />
              <BuilderField k="Cannot" v="Comp data · HR records" />
              <BuilderField k="Approval" v="Human in the loop" />
            </>
          }
        />
      </div>

      {/* Footer action */}
      <div className="p-4 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          Auto-saved 12s ago
        </span>
        <div className="flex items-center gap-2">
          <button className="text-[11px] font-semibold px-3 h-7 rounded-md" style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}>
            Test run
          </button>
          <button
            className="text-[11px] font-bold text-white px-3 h-7 rounded-md inline-flex items-center gap-1"
            style={{ background: "linear-gradient(135deg, var(--brand-red) 0%, var(--brand-yellow) 100%)" }}
          >
            Deploy <ArrowRight size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

function BuilderBlock({
  label, accent, children,
}: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: `1px solid ${accent}44`, borderLeft: `3px solid ${accent}` }}>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: accent }}>{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function BuilderField({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="font-mono w-[68px] flex-shrink-0" style={{ color: "rgba(255,255,255,0.5)" }}>{k}</span>
      <span
        className="flex-1 px-2 py-0.5 rounded-md truncate"
        style={{
          backgroundColor: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.9)",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function BuilderConnector() {
  return (
    <div className="h-3 ml-3 w-px" style={{ backgroundColor: "rgba(255,255,255,0.15)" }} />
  );
}
