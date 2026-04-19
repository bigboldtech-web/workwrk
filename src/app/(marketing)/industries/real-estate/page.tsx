import type { Metadata } from "next";

import { IndustryPage } from "@/components/modules";
import type { IndustryConfig } from "@/components/modules";
export const metadata: Metadata = {
  title: "WorkwrK for Real Estate — Multi-site, agent scoring, fair comp",
  description:
    "Per-project teams. Agent KPIs tied to conversion. Composite scores calibrated per city. Built for Indian real-estate brokerages and developers.",
  alternates: { canonical: "https://workwrk.com/industries/real-estate" },
};

const config: IndustryConfig = {
  eyebrow: "Real Estate · Brokerages, developers, channel partners",
  name: "Real Estate",
  tone: "amber",
  headline: <>Agents, projects, <span className="am">and fair commission.</span></>,
  body: "Run your RE team across multiple cities and projects on one spine. Agent KPIs weight lead quality, site-visit conversion, and closing velocity — not just top-line revenue. Commission runs on composite scoring. Calibration σ across cities prevents the &quot;Mumbai agent got unfair breaks&quot; debate.",
  pains: [
    { title: "Lead data lives with individual agents", body: "Each agent has their own WhatsApp pipeline and personal spreadsheet. When an agent leaves, the lead list walks out the door with them." },
    { title: "Commission math is opinion-driven", body: "Top-line revenue is easy to track. Lead quality, follow-through, and site-visit discipline are not. Commission ends up a negotiation, not a calculation." },
    { title: "City-wise fairness is impossible", body: "Bengaluru inventory moves fast. Mumbai inventory is slow. An agent's raw revenue doesn't capture difficulty. Without city-adjusted composite scoring, top agents feel cheated." },
    { title: "Site-visit SOP varies wildly", body: "Every experienced agent runs site visits their own way. New hires learn by watching — inconsistently. Brand experience at the site is hit-or-miss." },
    { title: "Channel partner performance unclear", body: "CPs bring leads. Do you know which CP sources 40% of your best-fit leads? Or which CP sends junk? Without scoring, it's all gut feel." },
    { title: "Developer / brokerage OKRs disconnected", body: "Developer tracks inventory-move. Brokerage tracks revenue. Neither sees the same number. Monthly reconciliation meetings are painful." },
  ],
  fit: [
    {
      eyebrow: "Agent composite scoring",
      tone: "amber",
      title: <>Lead quality, conversion, closing · <span className="am">one composite.</span></>,
      body: <><p>Every agent scored on: lead quality sourced (via enquiry fit), site-visit conversion rate, proposal-to-token velocity, token-to-close velocity, customer NPS, and compliance with the site-visit SOP. Weighted per role, calibrated per city.</p></>,
      bullets: [
        "Lead quality score · ICP-matched",
        "Site-visit conversion live",
        "Token-to-close velocity tracked",
        "Customer NPS post-token survey",
        "City-wise σ calibration",
        "Composite-driven commission calc",
      ],
    },
    {
      eyebrow: "Site-visit SOP + brand consistency",
      tone: "lime",
      title: <>Every visit feels like <span className="hi">the brand.</span></>,
      body: <><p>Site-visit playbook: pre-brief with enquiry context, arrival flow, walkthrough script, amenity demonstrations, objection handling, token-booking conversation. Scribe-recorded by your top agents, assigned by role. Compliance tracked per visit.</p></>,
      bullets: [
        "Site-visit SOP · Scribe-recorded",
        "Pre-visit enquiry brief",
        "Objection-handling flow",
        "Per-visit compliance check",
        "New-agent ramp · 30-day",
        "Site-visit feedback from customers",
      ],
    },
    {
      eyebrow: "Channel partner scoring",
      tone: "blue",
      title: <>Know your <span className="bl">best CPs.</span></>,
      body: <><p>CPs get scored on lead-to-site-visit conversion, eventual closing rate, and customer fit. Your best CPs rise to the top. Relationship managers see CP scorecards live — conversations with CPs become data-driven.</p></>,
      bullets: [
        "CP lead-quality scoring",
        "Eventual-closing rate tracked",
        "CP commission reconciliation",
        "CP relationship history · signed",
        "Per-project CP leaderboard",
        "Payout integration · Razorpay",
      ],
    },
  ],
  stats: [
    { stat: "+18%", label: "Agent productivity · median across brokerages", tone: "amber" },
    { stat: "Fairer", label: "Commission perception · survey NPS +23 among top agents", tone: "lime" },
    { stat: "−22%", label: "Agent attrition · year over year · post-adoption", tone: "pink" },
    { stat: "5", label: "Cities aligned on one spine · largest reference deployment", tone: "blue" },
  ],
  relevantModules: [
    { name: "KPIs", href: "/features/kpis", flow: "Lead, conversion, velocity, NPS · per agent · city-calibrated.", iconKey: "kpi" },
    { name: "KRAs", href: "/features/kras", flow: "Agent, team lead, RM role packs · AI-drafted from top agents.", iconKey: "kra" },
    { name: "SOPs", href: "/features/sops", flow: "Site-visit, token, registration flows · Scribe-recorded.", iconKey: "sop" },
    { name: "People", href: "/features/people", flow: "Multi-city org graph · agents + RMs + CPs · clean.", iconKey: "people" },
    { name: "Reviews", href: "/features/reviews", flow: "Monthly cycles · city-adjusted calibration σ.", iconKey: "reviews" },
    { name: "Kudos", href: "/features/kudos", flow: "RM recognition of agent site-visit excellence.", iconKey: "kudos" },
    { name: "AI Engine", href: "/features/ai-engine", flow: "'Which agents should we staff on the new launch' · instant answer.", iconKey: "ai" },
  ],
  faq: [
    { q: "Do you integrate with Sell.do / Hubster / proprietary CRMs?", a: <p>Sell.do and Hubster integrations are native. For proprietary CRMs, we offer REST API + webhook ingest. Most brokerages plug in within a week.</p> },
    { q: "How does city-calibrated scoring prevent unfairness?", a: <p>Each city is its own σ-tolerance bucket. Mumbai agents are calibrated against other Mumbai agents; Bengaluru against Bengaluru. Composite z-scores normalise across cities so cross-city promotions are fair.</p> },
    { q: "Can CPs log into their own view?", a: <p>Yes. CP lite accounts exist. They see their own leaderboard, their own commission reconciliation, and their own leads. They don&apos;t see other CPs or internal team data.</p> },
    { q: "What about developer-side (not brokerage)?", a: <p>Same spine, different role packs. Developer KRAs focus on inventory movement, construction milestones, and project-level OKRs. Brokerage + developer can run on the same WorkwrK org if you&apos;re integrated.</p> },
    { q: "RERA compliance — does it help?", a: <p>RERA-relevant docs (customer forms, payment schedules) can be managed as versioned SOPs + flows. Signed audit trail means regulatory audits are clean. We don&apos;t replace your RERA filing tool; we manage the upstream process.</p> },
  ],
};

export default function RealEstateIndustryPage() {
  return <IndustryPage c={config} />;
}
