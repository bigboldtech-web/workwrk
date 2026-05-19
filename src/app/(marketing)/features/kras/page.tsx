import type { Metadata } from "next";
import { Target, ListChecks, Link2, FileText, Users, Star } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "KRAs — WorkwrK",
  description: "Key Result Areas defined at the role level. Linked to KPIs, surfaced in reviews, and the single source of truth for what each person owns.",
  alternates: { canonical: "https://workwrk.com/features/kras" },
};

export default function KRAsFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="work"
      hue="sky"
      eyebrow="Work hub · KRAs"
      title={<>KRAs that everyone <GradientText hue="sky">actually agrees on.</GradientText></>}
      lede="Key Result Areas live on the role, not the person. Hire someone into the role and their KRAs are inherited automatically — and surface in every review."
      capabilities={[
        { icon: Target,     title: "Role-defined",       body: "KRAs live on the role. Move a person between roles and the KRAs move with them." },
        { icon: Link2,      title: "Linked to KPIs",     body: "Every KRA points to the KPIs that measure it. Drift becomes visible at a glance." },
        { icon: ListChecks, title: "Versioned",          body: "Quarterly cycles fork the KRA set. History stays attached to historical reviews." },
        { icon: FileText,   title: "Reviewer copilot",   body: "Reviewers see the KRAs alongside KPI scores, kudos, and prior cycles. No tab switching." },
        { icon: Users,      title: "Manager + employee", body: "Both edit. Both sign off. Version history shows the negotiation, not just the result." },
        { icon: Star,       title: "Weight per KRA",     body: "Not all KRAs are equal. Weight them so the composite score reflects what actually matters." },
      ]}
      relatedSlugs={["kpis", "reviews", "people", "okrs"]}
      faq={[
        { q: "Why role-defined and not person-defined?",  a: "Because roles change less than people. New hire steps into a role — KRAs are inherited. No fresh-onboarding KRA drafting." },
        { q: "How are KRAs used in reviews?",             a: "Every review opens with the KRA list. Each KRA gets a manager rating, a self-assessment, and rollup from the linked KPIs." },
        { q: "Can KRAs be edited mid-cycle?",             a: "Yes — but they're version-locked. The next cycle picks up the new set; the in-flight one continues on the old set." },
      ]}
    />
  );
}
