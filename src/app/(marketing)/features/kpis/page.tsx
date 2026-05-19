import type { Metadata } from "next";
import { TrendingUp, BarChart3, Gauge, Sparkles, Bell, Layers } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "KPIs — WorkwrK",
  description: "Track, weight, and score KPIs across every role. Auto-rolled up to teams, locations, and the whole company. Tied to the performance review engine.",
  alternates: { canonical: "https://workwrk.com/features/kpis" },
};

export default function KPIsFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="work"
      hue="sky"
      eyebrow="Work hub · KPIs"
      title={<>The KPI engine. <GradientText hue="sky">Auto-scored, auto-rolled-up.</GradientText></>}
      lede="Define KPIs once. Weight them per role. Watch them auto-score across people, teams, and locations — and tie straight into performance reviews."
      capabilities={[
        { icon: Gauge,      title: "Weighted scoring",   body: "Each KPI carries a weight per role. Composite scores recompute on every data change." },
        { icon: Layers,     title: "Multi-level rollup", body: "Person → team → location → company. Drill any direction in one click." },
        { icon: TrendingUp, title: "Trends + alerts",    body: "Spot drift early. Auto-alert when a KPI falls below threshold for two periods." },
        { icon: BarChart3,  title: "Period flexibility", body: "Daily, weekly, monthly, quarterly. Multiple windows per KPI, no spreadsheet acrobatics." },
        { icon: Bell,       title: "Tied to reviews",    body: "KPI achievement counts toward review scores at the weight you decide (default 30%)." },
        { icon: Sparkles,   title: "Sector templates",   body: "Pre-built KPI sets for tech, healthcare, manufacturing, logistics, services, sales." },
      ]}
      workflowSteps={[
        "Pick a sector template — KPIs pre-populated for your industry",
        "Tweak weights by role — sales rep ≠ ops manager",
        "Connect a data source — manual entry, CSV import, API, or live integration",
        "Watch dashboards update in real time as data flows in",
        "Review cycles pull KPI scores automatically",
      ]}
      relatedSlugs={["kras", "okrs", "reviews", "analytics", "tasks"]}
      testimonial={{
        quote: "We scrapped four Looker dashboards and replaced them with the KPI engine. Same insights, no dashboard maintenance.",
        author: "Mei Tanaka",
        role: "Head of Ops",
        company: "Lattice & Co",
      }}
      faq={[
        { q: "Can I have different KPIs per role?",            a: "Yes — every role has its own KPI set with role-specific weights. Same person can sit on multiple roles." },
        { q: "How do KPIs feed into performance reviews?",      a: "KPI achievement contributes a configurable weight (default 30%) to the composite review score. Tweakable per cycle." },
        { q: "Can I import KPIs from another tool?",            a: "Yes. CSV import for historic data; API + webhooks for live feeds; native integrations for Stripe, QuickBooks, HubSpot, more." },
        { q: "How are KPIs different from OKRs?",                a: "KPIs measure ongoing performance (steady-state). OKRs set ambitious goals (change-state). Most teams use both — KPIs for the floor, OKRs for the ceiling." },
      ]}
    />
  );
}
