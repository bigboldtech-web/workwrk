import type { Metadata } from "next";
import { TrendingUp, Target, Trophy, Users, BarChart3, Calendar } from "lucide-react";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "WorkwrK for Sales Teams",
  description: "Pipeline + people in one. Quotas as KPIs, pipeline reviews as cadence, rep onboarding tied to performance. The CRM your perf system actually talks to.",
  alternates: { canonical: "https://workwrk.com/industries/sales" },
};

export default function SalesIndustryPage() {
  return (
    <IndustrySubPage
      hue="fuchsia"
      eyebrow="Sales"
      title={<>Pipeline + people. <GradientText hue="fuchsia">Same system.</GradientText></>}
      lede="Forecasting, quotas as KPIs, pipeline reviews as cadence, rep onboarding tied to ramp performance — and a CRM that finally talks to the perf system."
      pains={[
        "Pipeline is in HubSpot, quotas are in a spreadsheet, perf is in Lattice. None reconcile.",
        "New reps ramp in 6 months because nobody owns onboarding end-to-end.",
        "Forecast accuracy is a manual exercise every Friday afternoon.",
        "Commission disputes happen because the data lives in three places.",
      ]}
      capabilities={[
        { icon: Target,    title: "Quota → KPI",            body: "Quota attainment is a first-class KPI. Auto-pulled into review composite score." },
        { icon: TrendingUp,title: "Pipeline + forecast",    body: "Weighted pipeline, commit/upside categorization, AI-assisted forecast accuracy." },
        { icon: Users,     title: "Rep onboarding",          body: "Forkable ramp journey: discovery, demo, objection-handling certs. Tied to ramp KPIs." },
        { icon: Trophy,    title: "Leaderboards + kudos",    body: "Real-time leaderboards. Kudos for big wins. Recognition factors into perf score." },
        { icon: Calendar,  title: "Pipeline cadence",        body: "Weekly 1:1s, deal reviews, forecast calls — templated, agendas auto-drafted." },
        { icon: BarChart3, title: "Cohort + segment perf",   body: "Win rate by industry, by deal size, by source. Per-rep, per-team, per-region rollups." },
      ]}
      kpis={["Quota attainment %", "Win rate", "Avg deal size", "Sales cycle days", "Pipeline coverage", "Forecast accuracy", "Time-to-ramp", "Activity quotas"]}
      faq={[
        { q: "Do I keep HubSpot / Salesforce?",          a: "Yes — we two-way sync. Reps live in their CRM. Quotas, perf, comp, rollups live in workwrk." },
        { q: "How does commission planning work?",        a: "Plan modeling on Growth; full commission calc + approval on Scale. Pays out to your payroll." },
        { q: "Spiff and contest support?",                 a: "Yes — set up a spiff in 5 minutes, leaderboard auto-publishes, payout flows into commission." },
      ]}
    />
  );
}
