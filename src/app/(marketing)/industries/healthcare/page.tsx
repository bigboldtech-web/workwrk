import type { Metadata } from "next";
import { Stethoscope, ShieldCheck, FileText, Calendar, Users, Award } from "lucide-react";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "WorkwrK for Healthcare",
  description: "Compliance-grade workflows for clinics, hospitals, and digital-health teams. SOPs with audit trails, training compliance, scoped access — HIPAA-ready.",
  alternates: { canonical: "https://workwrk.com/industries/healthcare" },
};

export default function HealthcareIndustryPage() {
  return (
    <IndustrySubPage
      hue="sky"
      eyebrow="Healthcare"
      title={<>Compliance-grade workflows. <GradientText hue="sky">Audit-ready by default.</GradientText></>}
      lede="Clinics, multi-site hospitals, and digital health teams use workwrk to run SOPs, training compliance, scoped access, and performance — all to HIPAA + GDPR + ISO 27001 standards."
      pains={[
        "Training compliance is a spreadsheet your CHRO swears the auditor accepts (until they don't).",
        "Every site runs its own version of every SOP, and nobody knows which is current.",
        "Performance reviews for clinicians need data you can't get out of your EHR.",
        "Access controls aren't role-aware enough — temp staff see things they shouldn't.",
      ]}
      capabilities={[
        { icon: Stethoscope, title: "Clinical SOP library",   body: "Forkable, version-controlled SOPs for clinical, admin, and operational processes. Sign-off audit trail." },
        { icon: ShieldCheck, title: "HIPAA + GDPR + DPDP",   body: "Compliance-ready data handling. Per-region residency. Encryption at rest + in transit." },
        { icon: FileText,    title: "Training compliance",   body: "Auto-assign training; auto-track completion; auto-export the report your auditor wants." },
        { icon: Calendar,    title: "Shift-aware KPIs",       body: "Per-shift and per-site KPIs that match how clinical ops actually run." },
        { icon: Users,       title: "Scoped access",          body: "Per-site, per-role, per-record. Temp staff scoped to their shift. Audit log on every access." },
        { icon: Award,       title: "Clinician perf",         body: "Composite scores combining quality metrics, CME, patient feedback, peer review. Not just survey scores." },
      ]}
      kpis={["Training compliance %", "SOP adherence", "Patient NPS", "Visit-to-action time", "Clinician utilization", "Audit findings closed", "Onboarding completion"]}
      testimonial={{
        quote: "Audit findings went from quarterly fires to a screenshot we email. The audit trail was already there.",
        author: "Anita Sharma",
        role: "Head of Compliance",
        company: "Quill Health",
      }}
      faq={[
        { q: "Are you HIPAA-compliant?",                  a: "Yes. BAA available. Scale customers can choose US healthcare-isolated infrastructure with HIPAA-specific controls." },
        { q: "Do you integrate with EHRs?",                a: "We integrate via HL7/FHIR with Epic and Cerner on Scale. Healthie, Athena, and DrChrono on Growth." },
        { q: "What about multi-site organizations?",       a: "First-class. Per-site dashboards, per-site SOPs, per-site KPIs. Roll-up to system level for the C-suite." },
      ]}
    />
  );
}
