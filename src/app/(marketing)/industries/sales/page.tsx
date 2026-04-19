import type { Metadata } from "next";

import { IndustryPage } from "@/components/modules";
import type { IndustryConfig } from "@/components/modules";
export const metadata: Metadata = {
  title: "WorkwrK for Sales — Pipeline, quota, review cycles that close",
  description:
    "Per-rep KPIs, commission tied to composite scoring, 48-hour review cycles, SOPs for discovery through close. Built for Indian revenue teams.",
  alternates: { canonical: "https://workwrk.com/industries/sales" },
};

const config: IndustryConfig = {
  eyebrow: "Sales · Revenue teams",
  name: "Sales",
  tone: "lime",
  headline: <>Pipeline, quota, and <span className="hi">fairer commission.</span></>,
  body: "Run your SDR, AE, and CSM teams off one spine. Per-role KPIs connected to HubSpot, Razorpay, and Aircall. Quarterly reviews that take 48 hours, not 2 weeks. Commission tied to composite scores that look at pipeline quality — not just number closed.",
  pains: [
    { title: "Pipeline lives in 6 places", body: "HubSpot, Razorpay, a deal tracker someone built in Notion, the CEO's spreadsheet, WhatsApp brags, and a demo-calendar tab. No single picture." },
    { title: "Commission debates every quarter", body: "Who brought what? Whose deal was it really? Without composite scoring, commission maths becomes opinion — and top reps resent it." },
    { title: "Discovery SOPs ignored", body: "A great discovery SOP drafted by your best rep sits in Drive. New hires find it 4 months too late. Meanwhile, average deal-cycle stays 65% longer than it should." },
    { title: "Review cycles stretch 3 weeks", body: "Sales managers compile KPIs manually, chase peer feedback, negotiate calibration. By the time reviews close, the quarter is over and nothing actionable lands." },
    { title: "Recognition only at QBR", body: "Top reps close a ₹40L deal on Wednesday. Nobody mentions it until the quarterly kickoff three months later. By then, they're already interviewing elsewhere." },
    { title: "Onboarding takes 90 days", body: "New SDRs spend the first month finding the call scripts, discovering the email templates, learning the ICP. All of this should be assigned on day one." },
  ],
  fit: [
    {
      eyebrow: "Live pipeline + quota",
      tone: "lime",
      title: <>One rep, one <span className="hi">honest number.</span></>,
      body: <><p>Pipeline sourced, SQLs converted, meetings held, demos booked, deals closed — all pull live from HubSpot, Razorpay, Aircall. Per-rep, per-role, per-quarter. Weighted by ICP match and deal stage.</p><p>Commission calc runs on the composite, not raw revenue. Top reps feel fairly paid — even on quarters where luck breaks uneven.</p></>,
      bullets: [
        "Live HubSpot / Razorpay / Aircall sync",
        "Per-role KPI pack (SDR / AE / AM / CS)",
        "Composite scoring with ICP + stage weights",
        "Quarterly commission calc — automated",
        "Real-time quota attainment dashboard",
        "Pipeline health flags (stuck deals, drift)",
      ],
    },
    {
      eyebrow: "SOPs for the selling motion",
      tone: "pink",
      title: <>Playbooks your best reps <span className="pk">would actually share.</span></>,
      body: <><p>Discovery SOP, demo SOP, objection-handling flow, refund flow. Written, Scribe-recorded, or branching flows — whichever fits the motion. Auto-assigned to new reps on day one.</p><p>Compliance tracked. When a deal stalls, the system surfaces whether the discovery SOP was followed or skipped.</p></>,
      bullets: [
        "Auto-assign SOPs on role start",
        "Scribe-recorded demo walkthroughs",
        "Refund + renewal flows with SLAs",
        "Compliance % attached to rep scoring",
        "New-hire ramp plan · 30/60/90",
        "Call-review sessions inline with SOPs",
      ],
    },
    {
      eyebrow: "48-hour review cycles",
      tone: "blue",
      title: <>Quarter closes. <span className="bl">Review closes two days later.</span></>,
      body: <><p>Every rep's quarter — KPIs, SOP compliance, kudos received, calibrated against peer σ — pre-fills their review form. Manager adds narrative, approves. Two-day median.</p><p>Promotion calls have a data trail. PIPs have a data trail. No one walks into Q1 hiring wondering who should have been let go last year.</p></>,
      bullets: [
        "Quarterly cycle · 48-hour median",
        "Pre-filled KPIs + SOP + kudos",
        "Calibration σ tracked per manager",
        "Promotion history — signed + audited",
        "PIP workflow with SLA milestones",
        "Exit review template · role-specific",
      ],
    },
  ],
  stats: [
    { stat: "+22%", label: "Quota attainment · across 38 sales teams post-adoption", tone: "lime" },
    { stat: "48h", label: "Median review cycle time · down from 3 weeks", tone: "blue" },
    { stat: "−41%", label: "Regretted attrition · tracked year over year", tone: "pink" },
    { stat: "3.2×", label: "Kudos volume · more in-the-moment recognition", tone: "amber" },
  ],
  relevantModules: [
    { name: "KPIs", href: "/features/kpis", flow: "Live per-rep KPIs from HubSpot, Razorpay, Aircall · 15-min refresh.", iconKey: "kpi" },
    { name: "KRAs", href: "/features/kras", flow: "AI-drafted from your top 3 reps · weights tuned for the role.", iconKey: "kra" },
    { name: "Reviews", href: "/features/reviews", flow: "48-hour cycle · pre-filled with quarter's real data.", iconKey: "reviews" },
    { name: "SOPs", href: "/features/sops", flow: "Discovery, demo, refund flows · auto-assigned by role.", iconKey: "sop" },
    { name: "Kudos", href: "/features/kudos", flow: "Tagged to values, feeds scoring · recognition in-the-moment.", iconKey: "kudos" },
    { name: "AI Engine", href: "/features/ai-engine", flow: "'Who's likely to hit ceiling next quarter' · engine reads + answers.", iconKey: "ai" },
  ],
  faq: [
    { q: "Do you integrate with HubSpot natively?", a: <p>Yes, both ways. Pipeline, deals, meetings, and contact-level activity sync every 15 minutes. Rep KPI readings push back to HubSpot so your existing dashboards get richer.</p> },
    { q: "How do you handle variable commission structures?", a: <p>We support tiered commission, accelerators, spiff bonuses, and draws. Commission calc runs on the composite score — not just revenue — so top reps don't get punished for a slow-close quarter where discovery was still world-class.</p> },
    { q: "What about partner-assisted deals and channel sales?", a: <p>Composite scoring can weight channel-sourced vs direct deals differently. Partner attribution lives as a field on the deal, and kudos to the partner rep can carry over into composite contributions.</p> },
    { q: "Can CS / AM run on the same spine?", a: <p>Yes. We ship template KPI packs for AE, AM, SDR, CSM, BDR — you can fork or blank-slate any of them. All composite scoring works the same way.</p> },
    { q: "How does this compare to Salesforce + Gong + 15Five + Bonusly?", a: <p>We don't replace Salesforce or Gong — we sit alongside them, reading their data into the spine. We do replace 15Five (review cycles), Bonusly (kudos), and the HRMS performance module.</p> },
  ],
};

export default function SalesIndustryPage() {
  return <IndustryPage c={config} />;
}
