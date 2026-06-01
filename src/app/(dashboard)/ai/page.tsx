"use client";

/* AI — prompt playground with templates + recent runs.
 *
 * This is a stub showcase page; the real AI conversation surface lives
 * in /sidekick. This page surfaces curated prompt templates by category
 * so users can jump-start common queries.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Cpu, MessageCircle, Hash, ChevronRight, Sparkles, FileText, Mail, Code,
  Database, PieChart, Megaphone, Briefcase, Send, Activity, Bot, ArrowRight, Layers,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";

type Category = "writing" | "marketing" | "code" | "data" | "ops" | "hr";

type Prompt = {
  id: string;
  title: string;
  description: string;
  category: Category;
  Icon: typeof Cpu;
  preview: string;
};

const CATEGORIES: { id: Category | "all"; label: string; Icon: typeof Cpu; hue: string }[] = [
  { id: "all", label: "All", Icon: Layers, hue: "var(--os-ink-3)" },
  { id: "writing", label: "Writing", Icon: FileText, hue: C.teal },
  { id: "marketing", label: "Marketing", Icon: Megaphone, hue: C.pink },
  { id: "code", label: "Code", Icon: Code, hue: C.indigo },
  { id: "data", label: "Data", Icon: Database, hue: C.purple },
  { id: "ops", label: "Operations", Icon: Briefcase, hue: C.orange },
  { id: "hr", label: "HR", Icon: PieChart, hue: C.green },
];

const PROMPTS: Prompt[] = [
  { id: "p1", title: "Draft an email", description: "Cold outreach, follow-up, or internal — tailored to your audience.", category: "writing", Icon: Mail, preview: "Write a 3-sentence follow-up email to a prospect after a 30-min discovery call…" },
  { id: "p2", title: "Summarize a doc", description: "Paste a long document; get an executive summary with action items.", category: "writing", Icon: FileText, preview: "Summarize the attached PRD in 5 bullet points, highlighting tradeoffs…" },
  { id: "p3", title: "Campaign brief", description: "Generate a launch brief with positioning, target audience, and KPIs.", category: "marketing", Icon: Megaphone, preview: "Draft a launch brief for a SaaS analytics product targeted at FP&A teams…" },
  { id: "p4", title: "Headline A/B", description: "Generate 10 headline variants and rank them by hook strength.", category: "marketing", Icon: Sparkles, preview: "Generate 10 email subject lines for a webinar on revenue forecasting…" },
  { id: "p5", title: "Code review", description: "Paste a diff; get inline review comments, security flags, and refactors.", category: "code", Icon: Code, preview: "Review this React hook for accidental re-renders and missing dependencies…" },
  { id: "p6", title: "Explain code", description: "Paste a function; get a plain-English explanation with edge cases.", category: "code", Icon: Code, preview: "Explain what this SQL window function does, including edge cases…" },
  { id: "p7", title: "SQL from question", description: "Describe what you want; get a SQL query against your schema.", category: "data", Icon: Database, preview: "Show monthly revenue by region for the last 6 months, ordered by Δ%…" },
  { id: "p8", title: "Chart suggestion", description: "Paste data; get a chart type recommendation with reasoning.", category: "data", Icon: PieChart, preview: "Suggest the best chart for comparing 8 cohorts across 12 months…" },
  { id: "p9", title: "Meeting agenda", description: "Pull from recent activity; draft an agenda with time boxes.", category: "ops", Icon: Briefcase, preview: "Draft a 1:1 agenda for my report based on this week's stand-ups…" },
  { id: "p10", title: "Status update", description: "Synthesize last week's commits, PRs, and decisions into one paragraph.", category: "ops", Icon: Activity, preview: "Write a Friday team update summarizing this week's shipped + planned work…" },
  { id: "p11", title: "Job description", description: "Generate a JD from role + level + must-haves; tuned for inclusivity.", category: "hr", Icon: FileText, preview: "Write a JD for a Staff Engineer (Platform), remote, with focus on infra…" },
  { id: "p12", title: "Interview questions", description: "Generate a 60-min interview loop with scoring rubric for any role.", category: "hr", Icon: MessageCircle, preview: "Suggest a 5-question behavioral loop for a Product Manager role…" },
];

const RECENT = [
  { id: "r1", title: "Q3 board update draft", time: "2h ago", category: "writing", model: "Opus 4.7" },
  { id: "r2", title: "Subject line A/B test", time: "yesterday", category: "marketing", model: "Sonnet 4.6" },
  { id: "r3", title: "SQL for monthly cohorts", time: "yesterday", category: "data", model: "Opus 4.7" },
  { id: "r4", title: "Refactor of useReducer hook", time: "3d ago", category: "code", model: "Opus 4.7" },
];

export default function AiPage() {
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");

  const shown = PROMPTS.filter((p) => activeCategory === "all" ? true : p.category === activeCategory);

  return (
    <>
      <OsTitleBar
        title="AI"
        Icon={Cpu}
        iconGradient={GRAD.bluePurple}
        description="Prompt playground · curated templates · runs in your account"
        actions={
          <div className="aip__head-actions">
            <Link href="/sidekick" className="aip__nav-link"><MessageCircle /> Sidekick</Link>
            <Link href="/agents" className="aip__nav-link"><Bot /> Agents</Link>
          </div>
        }
      />

      <div className="aip">
        <section className="aip__hero">
          <span className="aip__hero-accent" aria-hidden="true" />
          <div className="aip__hero-l">
            <span className="aip__hero-tag"><Sparkles /> Ask anything</span>
            <h2>What do you want to ship today?</h2>
            <p>Describe what you need in plain English — a draft, a query, a summary, a review. Press <kbd>Enter</kbd> to send it to Sidekick.</p>
            <div className="aip__hero-input">
              <Cpu />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Summarize this week's deals in the pipeline…"
              />
              <Link href={query ? `/sidekick?q=${encodeURIComponent(query)}` : "/sidekick"} className="aip__hero-send">
                <Send /> Send
              </Link>
            </div>
          </div>
        </section>

        <div className="aip__cats">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`aip__cat${activeCategory === c.id ? " is-active" : ""}`}
              style={{ ["--cat-c" as unknown as string]: c.hue }}
              onClick={() => setActiveCategory(c.id as Category | "all")}
            >
              <c.Icon /> {c.label}
            </button>
          ))}
        </div>

        <section className="aip__section">
          <header className="aip__section-head">
            <h2><Hash /> Templates</h2>
            <span className="aip__section-line" />
            <span className="aip__section-count">{shown.length}</span>
          </header>
          <div className="aip__grid">
            {shown.map((p) => {
              const cat = CATEGORIES.find((c) => c.id === p.category);
              const Icon = p.Icon;
              return (
                <Link
                  key={p.id}
                  href={`/sidekick?q=${encodeURIComponent(p.preview)}`}
                  className="aip__card"
                  style={{ ["--card-c" as unknown as string]: cat?.hue ?? "var(--os-ink-3)" }}
                >
                  <span className="aip__card-icon"><Icon /></span>
                  <div className="aip__card-body">
                    <h3>{p.title}</h3>
                    <p>{p.description}</p>
                    <span className="aip__card-preview">&ldquo;{p.preview}&rdquo;</span>
                  </div>
                  <span className="aip__card-cta">Run <ArrowRight /></span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="aip__section">
          <header className="aip__section-head">
            <h2><Activity /> Recent</h2>
            <span className="aip__section-line" />
            <Link href="/sidekick" className="aip__section-more">all <ChevronRight /></Link>
          </header>
          <div className="aip__recent">
            {RECENT.map((r) => {
              const cat = CATEGORIES.find((c) => c.id === r.category);
              return (
                <Link key={r.id} href="/sidekick" className="aip__rrow" style={{ ["--r-c" as unknown as string]: cat?.hue ?? "var(--os-ink-3)" }}>
                  <span className="aip__rrow-dot" />
                  <div className="aip__rrow-main">
                    <div className="aip__rrow-title">{r.title}</div>
                    <div className="aip__rrow-meta">{cat?.label} · {r.model}</div>
                  </div>
                  <span className="aip__rrow-time">{r.time}</span>
                  <ChevronRight className="aip__rrow-arrow" />
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
