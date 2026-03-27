import type { Metadata } from "next";
import Link from "next/link";
import {
  Users, Target, ClipboardCheck, Star, BookOpen, Heart,
  Zap, Brain, BarChart3, Calendar, Bell, Settings,
  ArrowUpRight, CheckCircle2, Quote,
} from "lucide-react";
import {
  FadeIn, StaggerContainer, StaggerItem, ScaleIn, SlideIn,
  FloatingElement, GlowPulse,
} from "@/components/marketing/motion";

export const metadata: Metadata = {
  title: "Features — TheywrK | 12 Integrated Business Modules",
  description:
    "Explore all 12 modules: People Management, KRA/KPI Engine, Performance Reviews, SOPs, Tasks, Recognition, Composite Scoring, AI Intelligence, Analytics, Meetings, Notifications, and Integrations.",
  openGraph: {
    title: "TheywrK Features — 12 Modules, One Platform",
    description:
      "People, KPIs, SOPs, reviews, tasks, kudos, AI, analytics — see every feature of the business operating system.",
  },
};

/* ── testimonial inserted after the 6th module ── */
const testimonials = [
  {
    quote: "We replaced 6 different tools with TheywrK. Our managers finally have a single place to see the full picture of every team member.",
    name: "Sarah Chen",
    role: "VP of People",
    company: "Nexora Technologies",
  },
];

const modules = [
  {
    id: "people",
    icon: <Users size={28} />,
    color: "#6C5CE7",
    title: "People Management",
    subtitle: "Your single source of truth for every team member.",
    desc: "Complete organizational structure with department hierarchy, employee profiles, role management, and team views. Bulk import, soft-delete with recovery, activity feeds, and guided onboarding workflows for new hires.",
    features: [
      "Org chart with department hierarchy",
      "Rich employee profiles with performance history",
      "Bulk operations (import, role change, department transfer)",
      "Soft delete with 30-day recovery window",
      "Activity feed per employee",
      "Customizable onboarding step workflows",
    ],
  },
  {
    id: "kpi",
    icon: <Target size={28} />,
    color: "#00D68F",
    title: "KRA & KPI Engine",
    subtitle: "Define success. Track it automatically. Score it fairly.",
    desc: "Company goals cascade down to individual KRAs and KPIs. Auto-scoring with configurable targets, traffic-light indicators (green/amber/red), trend analysis over time, and department-level aggregation.",
    features: [
      "Goal cascading from company to individual",
      "Auto-scoring against configurable targets",
      "Traffic-light status indicators",
      "Trend analysis with period-over-period comparison",
      "Department and team-level aggregation",
      "90-day rolling score calculations",
    ],
  },
  {
    id: "tasks",
    icon: <ClipboardCheck size={28} />,
    color: "#FF9F43",
    title: "Task Management",
    subtitle: "Every person knows exactly what to do, by when.",
    desc: "Assign tasks with priority levels (P0-P3), track status from created to completed, manage deadlines, and add comments. Task completion rates flow directly into composite performance scores.",
    features: [
      "Priority levels (P0 critical to P3 low)",
      "Status workflow (Created → In Progress → Completed)",
      "Deadline tracking with overdue alerts",
      "Task comments and collaboration",
      "Completion rates feed into performance scores",
      "Assignee workload visibility",
    ],
  },
  {
    id: "reviews",
    icon: <Star size={28} />,
    color: "#A29BFE",
    title: "Performance Reviews",
    subtitle: "Data-driven decisions, not gut feelings.",
    desc: "Full review cycles with self-assessment, manager review, peer feedback, and calibration. Reviews are auto-populated with KPI data, task completion rates, and SOP compliance — no more storytelling sessions.",
    features: [
      "360° feedback (self, manager, peer)",
      "KRA-based structured self-assessment",
      "Calibration sessions for fair scoring",
      "Auto-populated with real performance data",
      "Promotion and PIP eligibility tracking",
      "Review history and score progression",
    ],
  },
  {
    id: "sops",
    icon: <BookOpen size={28} />,
    color: "#00D68F",
    title: "SOP Playbook",
    subtitle: "When someone leaves, the process stays.",
    desc: "Create step-by-step standard operating procedures with a visual builder. Assign SOPs to employees, track compliance per step, score completion, and maintain version history. Institutional knowledge that scales.",
    features: [
      "Step-by-step SOP builder",
      "Assignment workflows per role or individual",
      "Per-step compliance tracking",
      "Completion scoring and progress tracking",
      "Department-level compliance dashboards",
      "Version history and audit trail",
    ],
  },
  {
    id: "scores",
    icon: <Zap size={28} />,
    color: "#6C5CE7",
    title: "Composite Performance Scores",
    subtitle: "One score. Six data sources. Zero guesswork.",
    desc: "Auto-calculated composite score (0–100) combining KPI achievement, manager ratings, peer feedback, self-assessment, SOP compliance, and task completion. Configurable weights per organization. Recalculates in real-time whenever any input changes.",
    features: [
      "Weighted scoring from 6 data sources",
      "Configurable weight distribution per org",
      "Auto-recalculation on any data change",
      "6-month trend history with bar charts",
      "Top performers leaderboard",
      "Kudos bonus: +1 per 2 kudos (max +5)",
    ],
  },
  {
    id: "kudos",
    icon: <Heart size={28} />,
    color: "#FF6B6B",
    title: "Recognition & Kudos",
    subtitle: "Build a culture where great work gets noticed.",
    desc: "Anyone can give kudos with personalized messages and company value tags. Kudos appear in a social feed, show on profiles, factor into composite performance scores, and drive a monthly Most Recognized leaderboard.",
    features: [
      "One-click kudos with custom messages",
      "Company value tags (Ownership, Teamwork, etc.)",
      "Organization-wide social kudos feed",
      "Kudos count and history on profiles",
      "Performance score bonus (+1 per 2 kudos)",
      "Monthly Most Recognized leaderboard",
    ],
  },
  {
    id: "ai",
    icon: <Brain size={28} />,
    color: "#A29BFE",
    title: "AI Intelligence Layer",
    subtitle: "Ask your business anything in plain English.",
    desc: "Natural language queries across all modules. Ask about performance, tasks, SOPs, reviews, and trends. The AI pulls real data from every module to give you instant, data-backed answers — not generic suggestions.",
    features: [
      "Natural language queries",
      "Cross-module data analysis",
      "Performance insights and recommendations",
      "Trend detection and anomaly alerts",
      "Promotion and risk-of-leaving predictions",
      "Department and branch comparisons",
    ],
  },
  {
    id: "analytics",
    icon: <BarChart3 size={28} />,
    color: "#00D68F",
    title: "Analytics & Reporting",
    subtitle: "Organization-wide visibility in one dashboard.",
    desc: "Comprehensive dashboards with department comparisons, score trend charts, top performers, task analytics, review completion rates, and recognition leaderboards. Export any report as CSV.",
    features: [
      "Organization-wide performance dashboards",
      "Department comparison charts",
      "Composite score trend over 6 months",
      "Task and review completion analytics",
      "Recognition leaderboard analytics",
      "CSV and data export for all reports",
    ],
  },
  {
    id: "meetings",
    icon: <Calendar size={28} />,
    color: "#FF9F43",
    title: "Meetings & Action Items",
    subtitle: "Capture decisions. Track follow-ups.",
    desc: "Create meeting notes with structured decisions and action items. Action items flow directly into the task management system with assignees and deadlines. Never lose a decision or forget a follow-up.",
    features: [
      "Structured meeting notes",
      "Decisions log with accountability",
      "Action items with assignees and deadlines",
      "Direct integration with task system",
      "Meeting history and searchability",
      "Participant tracking",
    ],
  },
  {
    id: "notifications",
    icon: <Bell size={28} />,
    color: "#6C5CE7",
    title: "Notifications & Email",
    subtitle: "Never miss what matters.",
    desc: "In-app notifications for reviews, tasks, kudos, and milestones. Email system for invitations, review requests, and digest summaries. Activity feed per user and organization-wide.",
    features: [
      "Real-time in-app notifications",
      "Email notifications for key events",
      "Review and task assignment alerts",
      "Kudos received notifications",
      "Organization-wide activity feed",
      "Per-user activity timeline",
    ],
  },
  {
    id: "integrations",
    icon: <Settings size={28} />,
    color: "#8888A0",
    title: "Settings & Integrations",
    subtitle: "Your platform, your rules.",
    desc: "Organization branding and logo upload, score weight configuration, webhook integrations for external systems, API access, data exports, and role-based access control with manager/admin/employee roles.",
    features: [
      "Organization branding and logo",
      "Configurable score weights",
      "Webhook integrations for external systems",
      "Event-driven notifications to any endpoint",
      "Role-based access control (Admin/Manager/Employee)",
      "Bulk data export (CSV)",
    ],
  },
];

/* ── Mini demo panels for each module ── */
function DemoPeople() {
  const people = [
    { name: "Sarah K.", role: "Engineering Lead", color: "#6C5CE7" },
    { name: "James L.", role: "Senior Dev", color: "#A29BFE" },
    { name: "Mia T.", role: "Designer", color: "#A29BFE" },
    { name: "Raj P.", role: "Backend Dev", color: "#A29BFE" },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Org Chart</div>
      {/* top node */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ background: "#6C5CE715", border: "1px solid #6C5CE730", borderRadius: 8, padding: "8px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#E8E8F0", fontWeight: 600 }}>{people[0].name}</div>
          <div style={{ fontSize: 10, color: "#8888A0" }}>{people[0].role}</div>
        </div>
        <div style={{ width: 1, height: 16, background: "#2A2A3A" }} />
        <div style={{ display: "flex", gap: 8 }}>
          {people.slice(1).map((p) => (
            <div key={p.name} style={{ background: "#1A1A26", border: "1px solid #2A2A3A", borderRadius: 8, padding: "6px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#E8E8F0", fontWeight: 500 }}>{p.name}</div>
              <div style={{ fontSize: 9, color: "#8888A0" }}>{p.role}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoKPI() {
  const kpis = [
    { label: "Revenue Target", value: 87, color: "#00D68F" },
    { label: "Customer NPS", value: 72, color: "#FF9F43" },
    { label: "Sprint Velocity", value: 94, color: "#00D68F" },
    { label: "Bug Resolution", value: 61, color: "#FF6B6B" },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>KPI Dashboard</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {kpis.map((k) => (
          <div key={k.label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "#E8E8F0" }}>{k.label}</span>
              <span style={{ fontSize: 11, color: k.color, fontWeight: 600 }}>{k.value}%</span>
            </div>
            <div style={{ height: 6, background: "#1A1A26", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${k.value}%`, height: "100%", background: k.color, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoTasks() {
  const columns = [
    { title: "To Do", color: "#FF9F43", items: ["API docs", "Wireframes"] },
    { title: "In Progress", color: "#6C5CE7", items: ["Auth flow"] },
    { title: "Done", color: "#00D68F", items: ["DB schema", "CI setup"] },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Kanban Board</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {columns.map((col) => (
          <div key={col.title}>
            <div style={{ fontSize: 10, color: col.color, fontWeight: 600, marginBottom: 6 }}>{col.title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {col.items.map((item) => (
                <div key={item} style={{ background: "#1A1A26", border: "1px solid #2A2A3A", borderRadius: 6, padding: "5px 8px", fontSize: 10, color: "#E8E8F0" }}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoReviews() {
  const segments = [
    { label: "KPI", pct: 30, color: "#00D68F" },
    { label: "Manager", pct: 25, color: "#6C5CE7" },
    { label: "Peer", pct: 20, color: "#A29BFE" },
    { label: "Self", pct: 15, color: "#FF9F43" },
    { label: "SOP", pct: 10, color: "#FF6B6B" },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Review Breakdown</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* donut mock */}
        <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
          <svg viewBox="0 0 36 36" style={{ width: 80, height: 80, transform: "rotate(-90deg)" }}>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1A1A26" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#00D68F" strokeWidth="3" strokeDasharray="30 70" strokeDashoffset="0" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#6C5CE7" strokeWidth="3" strokeDasharray="25 75" strokeDashoffset="-30" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#A29BFE" strokeWidth="3" strokeDasharray="20 80" strokeDashoffset="-55" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#FF9F43" strokeWidth="3" strokeDasharray="15 85" strokeDashoffset="-75" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#FF6B6B" strokeWidth="3" strokeDasharray="10 90" strokeDashoffset="-90" />
          </svg>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 14, fontWeight: 700, color: "#E8E8F0" }}>82</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {segments.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
              <span style={{ fontSize: 10, color: "#8888A0" }}>{s.label} {s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoSOP() {
  const steps = [
    { text: "Create ticket in Jira", done: true },
    { text: "Assign to dev team", done: true },
    { text: "Code review approved", done: true },
    { text: "QA sign-off", done: false },
    { text: "Deploy to production", done: false },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>SOP: Release Process</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {steps.map((s) => (
          <div key={s.text} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 16, height: 16, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10,
              background: s.done ? "#00D68F20" : "#1A1A26",
              border: s.done ? "1px solid #00D68F50" : "1px solid #2A2A3A",
              color: s.done ? "#00D68F" : "#2A2A3A",
            }}>
              {s.done ? "✓" : ""}
            </div>
            <span style={{ fontSize: 11, color: s.done ? "#E8E8F0" : "#8888A0", textDecoration: s.done ? "none" : "none" }}>{s.text}</span>
          </div>
        ))}
        <div style={{ marginTop: 4, fontSize: 10, color: "#00D68F", fontWeight: 600 }}>60% complete</div>
      </div>
    </div>
  );
}

function DemoScores() {
  const score = 78;
  const angle = (score / 100) * 180;
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Composite Score</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* gauge */}
        <div style={{ position: "relative", width: 120, height: 65, overflow: "hidden" }}>
          <svg viewBox="0 0 120 65" style={{ width: 120, height: 65 }}>
            <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#1A1A26" strokeWidth="8" strokeLinecap="round" />
            <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="url(#gaugeGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * 157} 157`} />
            <defs>
              <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FF6B6B" />
                <stop offset="50%" stopColor="#FF9F43" />
                <stop offset="100%" stopColor="#00D68F" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#E8E8F0", marginTop: -4, fontFamily: "var(--font-syne)" }}>{score}</div>
        <div style={{ fontSize: 10, color: "#00D68F", fontWeight: 600 }}>Above average</div>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {([["KPI", 82], ["Mgr", 76], ["Peer", 80], ["Self", 74], ["SOP", 85], ["Task", 71]] as const).map(([s, v]) => (
            <div key={s} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#8888A0" }}>{s}</div>
              <div style={{ fontSize: 10, color: "#E8E8F0", fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoKudos() {
  const kudos = [
    { from: "Alex M.", to: "Sarah K.", msg: "Amazing work shipping the new dashboard!", tag: "Ownership", color: "#6C5CE7" },
    { from: "Priya S.", to: "James L.", msg: "Thanks for jumping in on the production issue.", tag: "Teamwork", color: "#00D68F" },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Kudos Feed</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {kudos.map((k) => (
          <div key={k.msg} style={{ background: "#1A1A26", border: "1px solid #2A2A3A", borderRadius: 8, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Heart size={12} style={{ color: "#FF6B6B" }} />
              <span style={{ fontSize: 11, color: "#E8E8F0", fontWeight: 600 }}>{k.from}</span>
              <span style={{ fontSize: 10, color: "#8888A0" }}>to {k.to}</span>
            </div>
            <div style={{ fontSize: 10, color: "#8888A0", marginBottom: 4 }}>{k.msg}</div>
            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 99, background: `${k.color}15`, border: `1px solid ${k.color}30`, color: k.color }}>{k.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoAI() {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>AI Assistant</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* user bubble */}
        <div style={{ alignSelf: "flex-end", background: "#6C5CE720", border: "1px solid #6C5CE730", borderRadius: "12px 12px 4px 12px", padding: "8px 12px", maxWidth: "85%" }}>
          <div style={{ fontSize: 11, color: "#E8E8F0" }}>Who are the top 3 performers in Engineering this quarter?</div>
        </div>
        {/* AI bubble */}
        <div style={{ alignSelf: "flex-start", background: "#1A1A26", border: "1px solid #2A2A3A", borderRadius: "12px 12px 12px 4px", padding: "8px 12px", maxWidth: "85%" }}>
          <div style={{ fontSize: 11, color: "#E8E8F0", marginBottom: 4 }}>Based on composite scores:</div>
          <div style={{ fontSize: 10, color: "#8888A0" }}>1. Sarah K. — 91<br />2. James L. — 87<br />3. Mia T. — 84</div>
        </div>
      </div>
    </div>
  );
}

function DemoAnalytics() {
  const bars = [65, 78, 82, 74, 88, 91];
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const maxH = 50;
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Score Trend</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: maxH + 16 }}>
        {bars.map((v, idx) => (
          <div key={months[idx]} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            <div style={{ fontSize: 9, color: "#E8E8F0", marginBottom: 4, fontWeight: 600 }}>{v}</div>
            <div style={{ width: "100%", height: (v / 100) * maxH, background: `linear-gradient(to top, #6C5CE7, #A29BFE)`, borderRadius: "4px 4px 0 0" }} />
            <div style={{ fontSize: 9, color: "#8888A0", marginTop: 4 }}>{months[idx]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoMeetings() {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Meeting Notes</div>
      <div style={{ background: "#1A1A26", border: "1px solid #2A2A3A", borderRadius: 8, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: "#E8E8F0", fontWeight: 600 }}>Sprint Planning</span>
          <span style={{ fontSize: 9, color: "#FF9F43" }}>Today</span>
        </div>
        <div style={{ fontSize: 10, color: "#8888A0", marginBottom: 8 }}>Q1 roadmap alignment and resource allocation</div>
        <div style={{ fontSize: 9, color: "#6C5CE7", fontWeight: 600, marginBottom: 4 }}>DECISIONS</div>
        <div style={{ fontSize: 10, color: "#E8E8F0", marginBottom: 6 }}>Prioritize auth module for March release</div>
        <div style={{ fontSize: 9, color: "#FF9F43", fontWeight: 600, marginBottom: 4 }}>ACTION ITEMS</div>
        <div style={{ fontSize: 10, color: "#8888A0" }}>Sarah K. — Create tech spec by Mar 15</div>
        <div style={{ fontSize: 10, color: "#8888A0" }}>James L. — Estimate API work by Mar 12</div>
      </div>
    </div>
  );
}

function DemoNotifications() {
  const notifs = [
    { text: "Review cycle Q1 is now open", time: "2m ago", color: "#A29BFE", icon: "star" },
    { text: "You received kudos from Alex M.", time: "1h ago", color: "#FF6B6B", icon: "heart" },
    { text: "Task 'API docs' is overdue", time: "3h ago", color: "#FF9F43", icon: "alert" },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Notifications</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {notifs.map((n) => (
          <div key={n.text} style={{ display: "flex", alignItems: "center", gap: 8, background: "#1A1A26", border: "1px solid #2A2A3A", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#E8E8F0" }}>{n.text}</div>
              <div style={{ fontSize: 9, color: "#8888A0" }}>{n.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoIntegrations() {
  const hooks = [
    { name: "Slack Webhook", url: "hooks.slack.com/...", status: "active", color: "#00D68F" },
    { name: "Jira Sync", url: "api.atlassian.com/...", status: "active", color: "#00D68F" },
    { name: "Custom API", url: "api.internal.co/...", status: "pending", color: "#FF9F43" },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: "#8888A0", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Webhooks</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {hooks.map((h) => (
          <div key={h.name} style={{ display: "flex", alignItems: "center", gap: 8, background: "#1A1A26", border: "1px solid #2A2A3A", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: h.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#E8E8F0", fontWeight: 600 }}>{h.name}</div>
              <div style={{ fontSize: 9, color: "#8888A0", fontFamily: "var(--font-mono)" }}>{h.url}</div>
            </div>
            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 99, background: `${h.color}15`, color: h.color, textTransform: "capitalize" }}>{h.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const demoMap: Record<string, () => React.JSX.Element> = {
  people: DemoPeople,
  kpi: DemoKPI,
  tasks: DemoTasks,
  reviews: DemoReviews,
  sops: DemoSOP,
  scores: DemoScores,
  kudos: DemoKudos,
  ai: DemoAI,
  analytics: DemoAnalytics,
  meetings: DemoMeetings,
  notifications: DemoNotifications,
  integrations: DemoIntegrations,
};


export default function FeaturesPage() {
  return (
    <>
      {/* ═══ Hero ═══ */}
      <section className="pb-20 pt-36">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn delay={0.1}>
            <p className="mkt-label">Platform</p>
          </FadeIn>
          <FadeIn delay={0.2}>
            <h1 className="mkt-title mb-4 text-[clamp(2.2rem,5vw,3.5rem)]">
              12 integrated modules.<br />
              <span className="text-gradient">One operating system.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.35}>
            <p className="mb-8 max-w-[560px] text-lg text-[#8888A0]">
              Every module works together. Data flows between them.
              Your entire business — visible, measurable, and manageable.
            </p>
          </FadeIn>
          <FadeIn delay={0.45}>
            <Link href="/register" className="btn-primary">
              Start Free Trial <ArrowUpRight size={16} />
            </Link>
          </FadeIn>

        </div>
      </section>

      {/* ═══ Module list ═══ */}
      <section className="pb-32">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex flex-col gap-28 lg:gap-36">
            {modules.map((mod, i) => {
              const DemoComponent = demoMap[mod.id];
              const isEven = i % 2 === 1;
              const showTestimonial = i === 5 && testimonials[0];

              return (
                <article
                  key={mod.id}
                  id={mod.id}
                  className="scroll-mt-24"
                >
                  {/* Top row: title + demo side by side */}
                  <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-16">
                    {/* Title & description */}
                    <FadeIn direction="left" delay={0.1}>
                      <div>
                        <p className="mb-3 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em]"
                          style={{ color: mod.color }}>
                          Module {String(i + 1).padStart(2, "0")}
                        </p>
                        <h2 className="mb-3 text-3xl font-bold tracking-tight text-[#E8E8F0]"
                          style={{ fontFamily: "var(--font-syne)" }}>
                          {mod.title}
                        </h2>
                        <p className="mb-4 text-base font-medium text-[#A29BFE]">
                          {mod.subtitle}
                        </p>
                        <p className="text-[15px] leading-relaxed text-[#8888A0]">
                          {mod.desc}
                        </p>
                      </div>
                    </FadeIn>

                    {/* Demo panel */}
                    <FadeIn direction="right" delay={0.25}>
                      <div className="overflow-hidden rounded-2xl bg-[#12121A] shadow-2xl shadow-black/40 transition-transform duration-500 hover:scale-[1.02]">
                        <div className="flex items-center gap-2 bg-[#0A0A12] px-4 py-3">
                          <div className="flex gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                            <div className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                            <div className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                          </div>
                          <span className="ml-2 font-[family-name:var(--font-mono)] text-[10px] text-[#555566]">
                            theywrk.com/{mod.id}
                          </span>
                        </div>
                        {DemoComponent && <DemoComponent />}
                      </div>
                    </FadeIn>
                  </div>

                  {/* Bottom row: 3 features left, 3 features right */}
                  <StaggerContainer className="mt-10 grid gap-x-16 gap-y-4 sm:grid-cols-2" delay={0.3} stagger={0.08}>
                    {mod.features.map((f) => (
                      <StaggerItem key={f}>
                        <div className="flex items-center gap-3 text-[14px] text-[#C0C0D0]">
                          <CheckCircle2
                            size={16}
                            className="flex-shrink-0"
                            style={{ color: mod.color }}
                          />
                          {f}
                        </div>
                      </StaggerItem>
                    ))}
                  </StaggerContainer>

                  {/* Testimonial after the 6th module */}
                  {showTestimonial && (
                    <FadeIn delay={0.2}>
                    <div className="mx-auto mt-20 max-w-2xl text-center">
                      <Quote size={28} className="mx-auto mb-4" style={{ color: "#6C5CE740" }} />
                      <p className="mb-5 text-lg italic leading-relaxed text-[#E8E8F0]">
                        &ldquo;{(showTestimonial as typeof testimonials[0]).quote}&rdquo;
                      </p>
                      <div className="flex items-center justify-center gap-3">
                        <div
                          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{ background: "linear-gradient(135deg, #6C5CE7, #A29BFE)" }}
                        >
                          {(showTestimonial as typeof testimonials[0]).name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-semibold text-[#E8E8F0]">
                            {(showTestimonial as typeof testimonials[0]).name}
                          </div>
                          <div className="text-xs text-[#8888A0]">
                            {(showTestimonial as typeof testimonials[0]).role}, {(showTestimonial as typeof testimonials[0]).company}
                          </div>
                        </div>
                      </div>
                    </div>
                    </FadeIn>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ The Platform Effect ═══ */}
      <section className="pb-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn className="text-center">
            <p className="mkt-label">Impact</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.6rem,3vw,2.4rem)]">
              The Platform <span className="text-gradient">Effect</span>
            </h2>
            <p className="mx-auto mb-12 max-w-[480px] text-sm text-[#8888A0]">
              When every module works together, the results compound. Here is what our customers report.
            </p>
          </FadeIn>
          <StaggerContainer className="grid gap-6 sm:grid-cols-3" stagger={0.15}>
            {[
              {
                value: "40%",
                label: "Faster Reviews",
                desc: "Auto-populated data eliminates manual prep. Managers spend time on conversations, not spreadsheets.",
                color: "#6C5CE7",
              },
              {
                value: "3x",
                label: "Better SOP Compliance",
                desc: "Step-by-step tracking and compliance dashboards make standard processes the default, not the exception.",
                color: "#00D68F",
              },
              {
                value: "60%",
                label: "Less Manual Reporting",
                desc: "Real-time dashboards and AI queries replace weekly report building. Data is always live.",
                color: "#FF9F43",
              },
            ].map((stat) => (
              <StaggerItem key={stat.label}>
                <div
                  className="mkt-card"
                  style={{ borderTop: `3px solid ${stat.color}` }}
                >
                  <div
                    className="mb-2 text-4xl font-bold"
                    style={{ fontFamily: "var(--font-syne)", color: stat.color }}
                  >
                    {stat.value}
                  </div>
                  <div
                    className="mb-2 text-sm font-semibold text-[#E8E8F0]"
                    style={{ fontFamily: "var(--font-outfit)" }}
                  >
                    {stat.label}
                  </div>
                  <p className="text-xs leading-relaxed text-[#8888A0]">
                    {stat.desc}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <ScaleIn>
            <div className="mkt-highlight text-center">
              <FadeIn delay={0.2}>
                <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
                  Ready to see it in action?
                </h2>
                <p className="mx-auto mb-8 max-w-[440px] text-base text-[#8888A0]">
                  Start your free trial and experience all 12 modules working together.
                </p>
                <div className="flex items-center justify-center gap-4">
                  <Link href="/register" className="btn-primary px-8 py-3.5">
                    Start Free Trial
                  </Link>
                  <Link href="/pricing" className="btn-outline px-8 py-3.5">
                    View Pricing
                  </Link>
                </div>
              </FadeIn>
            </div>
          </ScaleIn>
        </div>
      </section>
    </>
  );
}
