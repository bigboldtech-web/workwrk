import type { Metadata } from "next";
import { Crosshair, GitMerge, TrendingUp, Calendar, Users, Bell } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "OKRs — WorkwrK",
  description: "Objectives + Key Results that cascade top-down, roll up automatically, and tie into the rest of the platform. Goal-setting that actually works.",
  alternates: { canonical: "https://workwrk.com/features/okrs" },
};

export default function OKRsFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="work"
      hue="sky"
      eyebrow="Work hub · OKRs"
      title={<>OKRs that <GradientText hue="sky">cascade and roll up.</GradientText></>}
      lede="Set company OKRs. Cascade them. Watch them auto-roll-up as teams hit their KRs. The goal system you wish 15Five had been."
      capabilities={[
        { icon: Crosshair, title: "Top-down cascade",   body: "Company OKRs split into department OKRs, then team, then individual. Inheritance is automatic." },
        { icon: GitMerge,  title: "Bottom-up rollup",   body: "KR progress propagates up the tree. CEO sees company-level completion live, not in a spreadsheet." },
        { icon: TrendingUp,title: "Confidence + status",body: "Each KR tracks numeric progress AND a confidence rating. Catch slipping objectives before they slip." },
        { icon: Calendar,  title: "Quarterly + annual", body: "Run quarterly cycles inside annual ones. Annual review of quarterly progress is one click." },
        { icon: Users,     title: "Cross-functional",   body: "OKRs span departments. One KR can have stakeholders in eng, sales, and ops — visible to all." },
        { icon: Bell,      title: "Slack-style nudges", body: "Weekly check-in nudges to KR owners. Updates flow back to dashboards automatically." },
      ]}
      relatedSlugs={["kpis", "kras", "tasks", "reviews", "analytics"]}
      faq={[
        { q: "How is this different from KPIs?",          a: "KPIs measure steady-state performance (ongoing health). OKRs are ambitious change-state goals. Most teams use both." },
        { q: "Can KRs link to KPIs?",                      a: "Yes. A KR's progress can auto-update from a linked KPI's value. No double-entry." },
        { q: "Quarterly check-in cadence?",                a: "Default weekly KR check-ins; monthly cycle-level reviews; quarterly retrospective. All configurable per company." },
      ]}
    />
  );
}
