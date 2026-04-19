import type { Metadata } from "next";

import { IndustryPage } from "@/components/modules";
import type { IndustryConfig } from "@/components/modules";
export const metadata: Metadata = {
  title: "WorkwrK for Professional Services — Utilisation, client NPS, review",
  description:
    "Consultant KPIs across utilisation and client NPS. Review cycles spanning delivery, peer, and client feedback. Built for Indian services firms.",
  alternates: { canonical: "https://workwrk.com/industries/services" },
};

const config: IndustryConfig = {
  eyebrow: "Professional Services · Consulting, agencies, law, design",
  name: "Services",
  tone: "blue",
  headline: <>Utilisation meets <span className="bl">client outcome.</span></>,
  body: "Consultants, agencies, design studios, and boutique firms live and die by utilisation and client NPS. Both matter; neither is enough alone. WorkwrK gives you both in one composite, with review cycles that honour client feedback as first-class evidence.",
  pains: [
    { title: "Utilisation on a spreadsheet, NPS in Typeform", body: "Your numbers are never in the same place. Monthly utilisation review is always 'let me pull the NPS' — and by then, the conversation has cooled." },
    { title: "Senior partners over-burden juniors", body: "Four partners, fourteen IC consultants. Each partner staffs projects from their own mental map. Somebody's always on 150%; somebody else is at 40%. No system sees the full picture." },
    { title: "Client feedback sits in one person's inbox", body: "The client sends a warm thank-you to the engagement lead. Nobody else sees it. The consultant who did the heavy lifting never hears a thing." },
    { title: "Performance reviews are opinion-driven", body: "Consultant A worked on a doomed project; Consultant B on a smooth one. Without controlling for difficulty and client fit, reviews are lottery — good people lose faith." },
    { title: "Methodology lives in veterans' heads", body: "Your firm's delivery methodology, quality bar, and proposal patterns are tribal knowledge. Onboarding a new senior associate takes six months, mostly in osmosis." },
    { title: "Post-engagement retros never happen", body: "Engagement ends, team disbands, project goes into the client-logo page. The lessons — what worked, what didn't — evaporate." },
  ],
  fit: [
    {
      eyebrow: "Utilisation + client NPS",
      tone: "blue",
      title: <>One composite. <span className="bl">Both sides of the ledger.</span></>,
      body: <><p>Consultant KPIs weight utilisation (billable hours, realised rates) alongside client NPS, engagement margin, and project deliverable quality. No more debates about whether &quot;they&apos;re busy&quot; = &quot;they&apos;re good.&quot;</p></>,
      bullets: [
        "Utilisation live from Harvest / Toggl",
        "Client NPS survey automation",
        "Engagement margin per consultant",
        "Deliverable quality via peer review",
        "Composite score weights configurable",
        "Staffing-suggestion AI on workload",
      ],
    },
    {
      eyebrow: "Delivery playbooks",
      tone: "lime",
      title: <>Methodology <span className="hi">written down.</span></>,
      body: <><p>Discovery SOP, kickoff deck template, standard deliverable shapes, QA checklist, post-engagement retro. Versioned, Scribe-recorded for the tricky bits, assigned by role so new seniors inherit it on day one.</p></>,
      bullets: [
        "Discovery + kickoff SOPs",
        "Deliverable templates (decks, memos)",
        "QA checklist per engagement stage",
        "Scribe recordings of client-facing moves",
        "Post-engagement retro · automated",
        "Sample library from past wins",
      ],
    },
    {
      eyebrow: "Reviews with client voice",
      tone: "amber",
      title: <>Client feedback in the <span className="am">review itself.</span></>,
      body: <><p>Review cycles pull in structured client NPS notes plus unstructured post-engagement testimonials. Peer feedback from engagement teammates. Delivery partner sign-off. Four signals, one picture.</p></>,
      bullets: [
        "Client feedback auto-ingested",
        "Peer feedback from engagement team",
        "Partner sign-off workflow",
        "Project-difficulty adjustment",
        "Composite vs cohort σ calibrated",
        "Promotion ladder transparent · L2 to L9",
      ],
    },
  ],
  stats: [
    { stat: "+12%", label: "Utilisation · median gain across 19 services firms", tone: "blue" },
    { stat: "+21", label: "Client NPS · avg increase in year one", tone: "lime" },
    { stat: "−38%", label: "IC consultant attrition · down year over year", tone: "pink" },
    { stat: "4×", label: "More retros completed · vs pre-WorkwrK", tone: "amber" },
  ],
  relevantModules: [
    { name: "KPIs", href: "/features/kpis", flow: "Utilisation + NPS + margin · one composite.", iconKey: "kpi" },
    { name: "Reviews", href: "/features/reviews", flow: "Client + peer + partner · 48-hour cycles.", iconKey: "reviews" },
    { name: "SOPs", href: "/features/sops", flow: "Delivery methodology written + Scribe-recorded.", iconKey: "sop" },
    { name: "Kudos", href: "/features/kudos", flow: "Client thank-yous auto-surface · counted in scoring.", iconKey: "kudos" },
    { name: "KRAs", href: "/features/kras", flow: "Role packs for IC, AM, partner · tuned for services.", iconKey: "kra" },
    { name: "OKRs", href: "/features/okrs", flow: "Firm-level growth OKRs · cascaded to practice leads.", iconKey: "okr" },
    { name: "AI Engine", href: "/features/ai-engine", flow: "'Who should I staff this engagement with' · instant answer.", iconKey: "ai" },
  ],
  faq: [
    { q: "We use Harvest / Toggl / HoursTracker — does it integrate?", a: <p>Harvest and Toggl are native integrations; readings sync every 15 minutes. HoursTracker and similar tools work via webhook / CSV nightly. For bespoke time-trackers, the REST API covers it.</p> },
    { q: "How does project-difficulty adjustment work in reviews?", a: <p>Each engagement is tagged with a difficulty index (client complexity, timeline tightness, scope volatility). Composite scoring adjusts weights so a consultant on a brutal project isn't punished for median output — and someone on an easy one doesn't get over-credited.</p> },
    { q: "Can partner-level people use it?", a: <p>Yes. Partner role templates exist — they run the practice, set quarterly KRAs, approve calibration, and sign off on consultant reviews. Their own KPIs weight practice growth + profitability + partner NPS.</p> },
    { q: "Is there a way to track proposal win-rate?", a: <p>Yes. BD pipeline can live in WorkwrK (or sync from a CRM). Win-rate, avg proposal-to-close time, and proposal quality feed into practice lead KPIs.</p> },
    { q: "What about confidentiality — we work with client names we can't share?", a: <p>Engagements can be marked confidential. The deliverable library auto-redacts client names when sampled for training purposes. Only named roles can see confidential engagement lists.</p> },
  ],
};

export default function ServicesIndustryPage() {
  return <IndustryPage c={config} />;
}
