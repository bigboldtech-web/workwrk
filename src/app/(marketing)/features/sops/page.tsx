import type { Metadata } from "next";
import { BookOpen, ClipboardCheck, History, ShieldCheck, GitBranch, Users } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "SOPs — WorkwrK",
  description: "Standard Operating Procedures with compliance runs, version control, and audit-grade trail. The process layer your auditor will love.",
  alternates: { canonical: "https://workwrk.com/features/sops" },
};

export default function SOPsFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="work"
      hue="sky"
      eyebrow="Work hub · SOPs"
      title={<>SOPs your auditor <GradientText hue="sky">actually likes.</GradientText></>}
      lede="Process docs with compliance runs, version history, and an audit trail that holds up in a SOC 2 review. Far more than a Notion page."
      capabilities={[
        { icon: BookOpen,        title: "Rich documents",      body: "Headings, embedded videos, decision trees, checklists. Rendered crisply, edited collaboratively." },
        { icon: ClipboardCheck,  title: "Compliance runs",     body: "Trigger a SOP run from a button. Every step gets a signed-off timestamp." },
        { icon: History,         title: "Version control",     body: "Every edit is tracked. Diff any two versions. Roll back when needed." },
        { icon: ShieldCheck,     title: "Audit-grade trail",   body: "Who saw what, when. Who signed what, when. Exportable for any audit (SOC 2, ISO 27001, GDPR, HIPAA)." },
        { icon: GitBranch,       title: "Forkable templates",  body: "Library of 200+ sector-specific SOPs. Fork once, customize, never start from zero." },
        { icon: Users,           title: "Roles-aware",         body: "Different SOPs for different roles. Inherited automatically; reviewed annually." },
      ]}
      workflowSteps={[
        "Fork an SOP from the template library (or write your own)",
        "Define roles who must read, acknowledge, and run it",
        "Trigger compliance runs on the cadence that fits — monthly, quarterly, annually",
        "Each step in the run gets timestamped, signed off, exported as audit evidence",
      ]}
      relatedSlugs={["tasks", "kpis", "access", "people"]}
      testimonial={{
        quote: "Our SOC 2 audit went from a quarterly nightmare to a screenshot. The audit trail was already there.",
        author: "Anita Sharma",
        role: "Head of Compliance",
        company: "Quill Health",
      }}
      faq={[
        { q: "How is this different from Trainual?",      a: "Trainual is a knowledge base. workwrk SOPs are wired into the operating data model — completing a SOP step can increment a KPI, kick off a task, or trigger a review." },
        { q: "Can I require sign-off?",                    a: "Yes. Per-step, per-role, per-run. Sign-offs are timestamped and exportable." },
        { q: "What about regulated industries?",           a: "We have specific templates for HIPAA, PCI-DSS, ISO 27001, and SOC 2. Audit trails meet the bar for each." },
      ]}
    />
  );
}
