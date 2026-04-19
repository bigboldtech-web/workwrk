import type { Metadata } from "next";

import { IndustryPage } from "@/components/modules";
import type { IndustryConfig } from "@/components/modules";
export const metadata: Metadata = {
  title: "WorkwrK for Manufacturing — Shift SOPs, safety, throughput",
  description:
    "Shift-level SOPs, floor-supervisor kudos, KPIs across safety and throughput, audit-ready compliance. Built for Indian manufacturing SMBs.",
  alternates: { canonical: "https://workwrk.com/industries/manufacturing" },
};

const config: IndustryConfig = {
  eyebrow: "Manufacturing · Shop floor + supply",
  name: "Manufacturing",
  tone: "amber",
  headline: <>Safety, throughput, <span className="am">and audit-ready.</span></>,
  body: "Shift-level SOPs that actually get followed. KPIs on safety incidents, OEE, and quality. Supervisors recognise floor staff in-the-moment. Monthly audit binders ship in one click — signed, versioned, regulator-ready.",
  pains: [
    { title: "SOPs on dusty paper binders", body: "The SOP on Line 3 is a laminated printout from 2021. Shop floor reality diverged two years ago. Nobody updates the paper." },
    { title: "Safety incidents find out after the fact", body: "Near-miss data sits in a notebook the supervisor carries. By the time HR sees it, it's six weeks old — the lesson already dissolved." },
    { title: "Audit prep is a week of chaos", body: "ISO 9001, ISO 14001, factory inspection — every audit means three days of someone pulling SOP versions, training records, and compliance proof from six places." },
    { title: "Shift handovers lose context", body: "Morning shift sees a quality issue, notes it loosely in WhatsApp. Evening shift doesn't see the note. Next shift, issue repeats." },
    { title: "Good work goes unnoticed", body: "A floor supervisor spots a shop-floor operator solving a calibration issue creatively. No way to recognise it except a verbal shout. Morale slips." },
    { title: "Contractor / permanent workforce mix", body: "40% permanent, 60% contractor. Different access, different policies, different training records. Managing that in Excel is a nightmare." },
  ],
  fit: [
    {
      eyebrow: "Shift-level SOPs + audits",
      tone: "amber",
      title: <>SOPs on the floor <span className="am">are live, not laminated.</span></>,
      body: <><p>Every line, every station, every safety procedure — written as versioned SOPs, displayed on shop-floor tablets, with read-receipts per shift. Updates ship to all stations simultaneously.</p><p>ISO audits export a signed PDF binder. Training records, SOP versions, sign-offs — all in one click.</p></>,
      bullets: [
        "Versioned SOPs per line / station",
        "Shop-floor tablet mode · offline-tolerant",
        "Read-receipts per worker per version",
        "ISO 9001 / ISO 14001 audit export",
        "Training record · signed + timestamped",
        "Factory inspection binder · 1-click",
      ],
    },
    {
      eyebrow: "Safety + quality KPIs",
      tone: "lime",
      title: <>Incidents logged where <span className="hi">they happen.</span></>,
      body: <><p>Supervisors log near-misses from the floor — on the same tablet as the SOPs. Incidents show up org-wide within minutes, not weeks. Trend analysis runs on the spine without waiting for a quarterly HR report.</p></>,
      bullets: [
        "Near-miss + incident tracking (floor UI)",
        "OEE — availability × performance × quality",
        "Per-line throughput vs target",
        "Quality defect rate · live",
        "5-Why template built into incident flow",
        "Safety training compliance per worker",
      ],
    },
    {
      eyebrow: "Shift + permanent hybrid",
      tone: "pink",
      title: <>Managing a mixed workforce <span className="pk">cleanly.</span></>,
      body: <><p>Contractor and permanent workers live in the same org graph with different role types. Different access scopes, different training requirements, different payroll integration — one spine.</p></>,
      bullets: [
        "Role type flag · contractor / permanent",
        "Different RBAC scopes per type",
        "Training records by worker type",
        "Multi-plant consolidated view",
        "Keka / GreytHR payroll sync",
        "Worker onboarding checklist by type",
      ],
    },
  ],
  stats: [
    { stat: "−30%", label: "Safety incidents · year-over-year on adopting plants", tone: "lime" },
    { stat: "+8%", label: "Throughput · median improvement on Line-1 benchmarks", tone: "amber" },
    { stat: "1 day", label: "ISO audit prep time · down from 5–7 days", tone: "blue" },
    { stat: "95%", label: "SOP compliance across 12 multi-plant deployments", tone: "pink" },
  ],
  relevantModules: [
    { name: "SOPs", href: "/features/sops", flow: "Versioned shop-floor SOPs with tablet mode and read-receipts.", iconKey: "sop" },
    { name: "People", href: "/features/people", flow: "Mixed contractor + permanent graph. Multi-plant · multi-city.", iconKey: "people" },
    { name: "KPIs", href: "/features/kpis", flow: "OEE, safety, quality, throughput · per line, per shift.", iconKey: "kpi" },
    { name: "Tasks", href: "/features/tasks", flow: "Incidents auto-spawn investigation tasks with 5-Why SLAs.", iconKey: "tasks" },
    { name: "Kudos", href: "/features/kudos", flow: "Supervisor recognition feeds into floor-staff scoring.", iconKey: "kudos" },
    { name: "Access", href: "/features/access", flow: "Audit-ready RBAC · contractor scopes · signed trail.", iconKey: "access" },
    { name: "Reviews", href: "/features/reviews", flow: "Quarterly reviews for salaried staff · monthly for supervisors.", iconKey: "reviews" },
  ],
  faq: [
    { q: "Do the shop-floor tablets work offline?", a: <p>Yes. The tablet mode caches SOPs locally and syncs incidents + read-receipts when connectivity returns. Designed for plants where WiFi is patchy.</p> },
    { q: "Can we run multi-plant with different SOPs per plant?", a: <p>Yes. SOPs can be global (same across all plants), region-specific, or plant-specific. Version history is maintained per layer.</p> },
    { q: "ISO 9001 / ISO 14001 — how audit-ready?", a: <p>One-click export of the signed binder: SOPs by version, training records per worker per SOP, incident trail with 5-Why resolutions, access audit log. Our first factory customers went from 5 days of prep to a half-day.</p> },
    { q: "Does it work for process manufacturing (food, pharma)?", a: <p>Yes. Pharmaceutical and food-processing customers use it for GMP compliance. Temperature-log integration, batch-record SOPs, and deviation-tracking flows are all supported.</p> },
    { q: "Payroll integration for contractor payments?", a: <p>Keka, GreytHR, Razorpay Payroll, and Tally all integrate. Contractor payroll can be tied to attendance + KPI attainment via our API.</p> },
  ],
};

export default function ManufacturingIndustryPage() {
  return <IndustryPage c={config} />;
}
