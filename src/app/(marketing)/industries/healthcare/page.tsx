import type { Metadata } from "next";

import { IndustryPage } from "@/components/modules";
import type { IndustryConfig } from "@/components/modules";
export const metadata: Metadata = {
  title: "WorkwrK for Healthcare — Protocol compliance, training, audit-ready",
  description:
    "Protocol SOPs per role. Compliance tracked per shift. Training playbooks attached to roles at onboarding. Built for Indian healthcare SMBs.",
  alternates: { canonical: "https://workwrk.com/industries/healthcare" },
};

const config: IndustryConfig = {
  eyebrow: "Healthcare · Clinics, diagnostics, home-care",
  name: "Healthcare",
  tone: "blue",
  headline: <>Protocols that stay <span className="bl">alive.</span></>,
  body: "Every procedure, every shift, every role — run against versioned clinical protocols. Training records per provider per SOP. Quarterly protocol review cycles instead of annual. NABH / NABL audit binders in one click.",
  pains: [
    { title: "Protocols last updated two years ago", body: "Your clinical protocols live in a Drive folder. Someone updated them in 2023. Half your current providers joined since then. They've never read the updates." },
    { title: "Training records in three places", body: "HRMS tracks who attended training. QMS tracks what training exists. Nobody ties 'person X is compliant on protocol Y at version Z' in one view." },
    { title: "Shift handovers rely on memory", body: "Day shift nurse hands off to night shift. Critical patient info, pending tests, family concerns — all verbal. Context loss causes real harm." },
    { title: "NABH audit prep is a fire drill", body: "Once a year, a week of frantic evidence-collection. Training attendance, protocol versions, incident logs, consent forms. By the time it ships, everyone is exhausted." },
    { title: "Provider performance — how?", body: "How do you measure a clinician fairly? Outcomes? Compliance? Patient NPS? All of the above, weighted by acuity. Without a composite, review cycles become political." },
    { title: "Protocol deviation reports get buried", body: "Nurse notes a deviation on a paper form. Form enters a filing cabinet. Regional QA sees it next quarter. Pattern takes 18 months to surface." },
  ],
  fit: [
    {
      eyebrow: "Clinical protocols",
      tone: "blue",
      title: <>Versioned. Read-receipted. <span className="bl">Audit-ready.</span></>,
      body: <><p>Every clinical protocol — infection control, medication admin, triage, home-care handoff — lives as a versioned SOP. Tablets at nurse stations and in provider kits. Every provider acknowledges every version.</p></>,
      bullets: [
        "Versioned clinical protocols",
        "Tablet mode · bedside / kit",
        "Read-receipts per provider · per version",
        "Role-based SOP assignment",
        "Deviation workflow · structured",
        "5-Why for adverse events",
      ],
    },
    {
      eyebrow: "Training + credentialling",
      tone: "lime",
      title: <>Who's trained on <span className="hi">what, at which version?</span></>,
      body: <><p>Every provider has a credential record per protocol per version. Training completions ingest from LMS, manual sign-off, or recorded observation. Reports surface lapses before they become compliance gaps.</p></>,
      bullets: [
        "Credential record per provider",
        "LMS integration (TalentLMS, Docebo)",
        "Observed training sign-off",
        "Recertification schedules · automated",
        "NABH CE-hours tracking",
        "One-click audit export",
      ],
    },
    {
      eyebrow: "Provider performance",
      tone: "pink",
      title: <>Outcomes + compliance + NPS · <span className="pk">one fair view.</span></>,
      body: <><p>Provider composite weights clinical outcomes (adjusted for acuity), protocol compliance %, patient NPS, peer-reviewer feedback, and continuing-education progress. Review cycles honour all signals — not just volume.</p></>,
      bullets: [
        "Acuity-adjusted outcome KPI",
        "Protocol compliance · per provider",
        "Patient NPS · ingested from surveys",
        "Peer observation feedback",
        "CE-progress · feeds composite",
        "Quarterly provider review · 48h",
      ],
    },
  ],
  stats: [
    { stat: "−50%", label: "Training time to full compliance · for new providers", tone: "lime" },
    { stat: "0", label: "Protocol drift between clinics · NABH-audited deployments", tone: "blue" },
    { stat: "1 day", label: "NABH audit prep time · down from a week", tone: "amber" },
    { stat: "+14", label: "Patient NPS · year-over-year · median clinic", tone: "pink" },
  ],
  relevantModules: [
    { name: "SOPs", href: "/features/sops", flow: "Clinical protocols with read-receipts per provider per version.", iconKey: "sop" },
    { name: "People", href: "/features/people", flow: "Provider roles, contractor types, shift schedules · clean graph.", iconKey: "people" },
    { name: "KPIs", href: "/features/kpis", flow: "Outcomes, compliance, NPS · per provider composite.", iconKey: "kpi" },
    { name: "Tasks", href: "/features/tasks", flow: "Deviation reports spawn structured investigation tasks.", iconKey: "tasks" },
    { name: "Reviews", href: "/features/reviews", flow: "Quarterly provider reviews · calibrated across clinics.", iconKey: "reviews" },
    { name: "Access", href: "/features/access", flow: "PHI field-level RBAC · signed audit log · DPDPA compliant.", iconKey: "access" },
  ],
  faq: [
    { q: "Are you PHI-compliant for Indian healthcare?", a: <p>Yes. DPDPA Section 8 (sensitive personal data) controls apply to PHI fields. Data residency in Mumbai (ap-south-1) by default. Field-level RBAC for PHI. Signed audit log. HIPAA alignment available for US-facing customers.</p> },
    { q: "Can it run on-prem for larger hospital groups?", a: <p>Yes. Enterprise tier deploys into your VPC (AWS, GCP, or Azure) or your data centre. For larger hospital groups that need on-prem, we have a reference architecture.</p> },
    { q: "Does it integrate with an HIS / LIS?", a: <p>We integrate with common Indian HIS / LIS platforms (Halemind, Plus91, Medflow). For outcomes KPIs, we pull from HIS; for LIS quality metrics, we pull from LIS. Custom integrations available on Growth+.</p> },
    { q: "How do you handle protocol deviation investigations?", a: <p>Each deviation logged on the shop floor creates a task with an SLA and an owner. 5-Why template prompts investigation. Results feed back into SOP revision workflow. Everything signed and exportable for NABH.</p> },
    { q: "What about continuing-education hours (CE)?", a: <p>CE progress is a first-class KPI. Integration with TalentLMS, Docebo, and similar. Manual CE-hour entry with attestation supported. Auto-ping providers when due for recertification.</p> },
  ],
};

export default function HealthcareIndustryPage() {
  return <IndustryPage c={config} />;
}
