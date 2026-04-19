import type { Metadata } from "next";

import { IndustryPage } from "@/components/modules";
import type { IndustryConfig } from "@/components/modules";
export const metadata: Metadata = {
  title: "WorkwrK for Tech & SaaS — Eng velocity, product, AI-native",
  description:
    "Engineering KRAs tied to PR throughput, review depth, incident response. Product KPIs on activation, retention, expansion. Built for Indian tech startups.",
  alternates: { canonical: "https://workwrk.com/industries/technology" },
};

const config: IndustryConfig = {
  eyebrow: "Technology · SaaS, platforms, AI-native",
  name: "Technology",
  tone: "pink",
  headline: <>Ship velocity + <span className="pk">honest review depth.</span></>,
  body: "For product-led teams where PR throughput, review depth, incident response, and feature activation are all first-class signals. Linear / GitHub / PagerDuty integrated natively — and calibrated so engineers who ship AND review AND mentor get the credit.",
  pains: [
    { title: "Velocity measured only by PR count", body: "The reviewer who catches a critical bug on a PR gets no score. The junior who ships 40 tiny tickets outshines the senior on one hard architecture migration. The numbers lie." },
    { title: "Incident response is invisible work", body: "On-call engineer fields a 2am page, fixes a customer-impacting bug, goes back to sleep. It doesn't show up in their sprint board. Performance reviews miss it entirely." },
    { title: "Product KPIs disconnected from engineering", body: "Engineering ships the feature. Product watches activation. Neither team knows whose code moved the needle — so retros become storytelling contests." },
    { title: "Review calibration chaos between EMs", body: "One EM rates generously; another is hard. Senior engineers on the generous team get promoted faster. Everyone knows it's unfair; nobody has time to fix it." },
    { title: "Staff-engineer track feels opaque", body: "ICs above senior want to know what gets them promoted. &quot;You need more impact&quot; isn't a KRA. Without measurable accountabilities, the staff track becomes politicking." },
    { title: "Growth + eng out of sync on OKRs", body: "Growth OKRs set in a Notion page. Engineering OKRs in a different Notion page. Quarterly planning is three days of reconciling two parallel universes." },
  ],
  fit: [
    {
      eyebrow: "Engineering signals, unified",
      tone: "pink",
      title: <>Ship velocity, review depth, on-call, <span className="pk">one composite.</span></>,
      body: <><p>Merged PRs per week · reviewer depth (lines reviewed, catches, comments) · incident response time · deploy success rate · code complexity shipped · mentorship signals. All weighted per role in a composite score.</p></>,
      bullets: [
        "GitHub / Linear / PagerDuty native",
        "Reviewer depth metric (beyond count)",
        "On-call response + resolution tracked",
        "Deploy success + rollback rate",
        "PR complexity-weighted volume",
        "Staff-ladder tracked KRAs",
      ],
    },
    {
      eyebrow: "Product × Engineering KPIs",
      tone: "lime",
      title: <>Feature shipped → <span className="hi">activation measured.</span></>,
      body: <><p>Each shipped feature links to the activation / retention / engagement KPI it was meant to move. Product manager sees outcome, engineer sees outcome. Quarterly retros run on real attribution — not storytelling.</p></>,
      bullets: [
        "Feature-to-KPI mapping at PR merge",
        "A/B test results tied to engineer + PM",
        "Activation / retention as role KPIs",
        "AARRR funnel per pod/team",
        "Launch readiness SOP",
        "Post-launch retro · automated",
      ],
    },
    {
      eyebrow: "OKR cascade that holds",
      tone: "blue",
      title: <>Growth + engineering OKRs <span className="bl">share one tree.</span></>,
      body: <><p>Company OKR → pod KRs → individual commitments. Engineers see exactly how their sprint aligns with company objective. Growth and engineering don&apos;t have two different OKR trees — they share one.</p></>,
      bullets: [
        "Single OKR tree · company to IC",
        "Monday read-outs via Slack",
        "Mid-quarter re-forecast supported",
        "Linear epics linked to KRs",
        "Product + eng aligned weights",
        "Scorecard export for board",
      ],
    },
  ],
  stats: [
    { stat: "−20%", label: "On-call burden per engineer · via better escalation flows", tone: "pink" },
    { stat: "+34%", label: "Reviewer recognition · signal-giver scores up", tone: "lime" },
    { stat: "2 days", label: "Median review cycle · engineering teams love this", tone: "blue" },
    { stat: "0.4σ", label: "Cross-EM calibration variance · down from 1.2σ pre-WorkwrK", tone: "amber" },
  ],
  relevantModules: [
    { name: "KRAs", href: "/features/kras", flow: "Role packs for SWE1 → Staff+ · AI-drafted from your top ICs.", iconKey: "kra" },
    { name: "KPIs", href: "/features/kpis", flow: "GitHub + Linear + PagerDuty native · reviewer depth metric.", iconKey: "kpi" },
    { name: "Reviews", href: "/features/reviews", flow: "48-hour cycles pre-filled with velocity + review + on-call data.", iconKey: "reviews" },
    { name: "OKRs", href: "/features/okrs", flow: "Single tree · company → pod → IC · Monday read-outs.", iconKey: "okr" },
    { name: "Kudos", href: "/features/kudos", flow: "Reviewer recognition, mentorship shout-outs · feeds composite.", iconKey: "kudos" },
    { name: "Integrations", href: "/features/integrations", flow: "GitHub / Linear / PagerDuty / Slack / Jira · native connectors.", iconKey: "integrations" },
    { name: "Analytics", href: "/features/analytics", flow: "SQL-friendly warehouse · dbt adapter · BI-ready.", iconKey: "analytics" },
    { name: "AI Engine", href: "/features/ai-engine", flow: "'Explain why sprint velocity dropped last week' · with citations.", iconKey: "ai" },
  ],
  faq: [
    { q: "Does it replace Lattice / Leapsome / 15Five?", a: <p>Yes, for most teams. Those tools handle reviews + OKRs + goals as a standalone plane. WorkwrK pulls those concerns into the same spine as KPIs, SOPs, and engineering signals — so promotions are grounded in merged PRs, not just self-assessed narratives.</p> },
    { q: "What's the PR &quot;reviewer depth&quot; metric?", a: <p>Instead of counting PR reviews (which rewards rubber-stamping), we look at lines reviewed, inline comments per PR, catches (comments that led to changes before merge), and reviewer churn rate. Weighted per role. Detects real review quality.</p> },
    { q: "How do you handle infra / platform teams with no customer-facing KPIs?", a: <p>Platform KPIs measure what the platform actually does — uptime, latency p99, dev velocity enabled, build-time reduction. Templates exist for DevOps, SRE, platform eng, data eng. Blank-slate if you need custom.</p> },
    { q: "Can we treat our AI / ML team differently?", a: <p>Yes. Model-quality metrics, eval-benchmark trajectories, and research-output KPIs are all supported. We ship a role template for ML engineers and research engineers that has very different weightings from a product SWE.</p> },
    { q: "Do you integrate with our incident tooling?", a: <p>PagerDuty and Opsgenie natively. On-call time, response time, and resolution quality feed into composite scoring. Incident retros can live in WorkwrK as structured SOPs with 5-Why flows.</p> },
  ],
};

export default function TechnologyIndustryPage() {
  return <IndustryPage c={config} />;
}
