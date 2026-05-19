import type { Metadata } from "next";
import { BarChart3, PieChart, LineChart, Filter, Download, Eye } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Analytics — WorkwrK",
  description: "Role-aware dashboards. The CEO sees the company. The manager sees their team. The IC sees themselves. One platform, three layers of insight.",
  alternates: { canonical: "https://workwrk.com/features/analytics" },
};

export default function AnalyticsFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="home"
      hue="indigo"
      eyebrow="Home hub · Analytics"
      title={<>Dashboards <GradientText hue="indigo">that know your role.</GradientText></>}
      lede="The same screen renders differently for the CEO, the manager, and the IC. Permissions and relevance baked in — no fifteen-tab dashboard archeology."
      capabilities={[
        { icon: Eye,        title: "Role-aware views",   body: "Auto-scoped to what you should see. No 'permission denied' walls. No info overload either." },
        { icon: LineChart,  title: "Rolling windows",     body: "30/60/90 day windows on every KPI, OKR, and signal. Trend lines that mean something." },
        { icon: PieChart,   title: "Breakdown by anything", body: "Slice by role, team, location, manager, hub. One-click pivot." },
        { icon: Filter,     title: "Saved views",         body: "Pin queries as dashboards. Share with stakeholders. They see the same numbers, the same way." },
        { icon: Download,   title: "Export-friendly",     body: "Every view exports to CSV, PDF, or PNG. For the auditor, the board, the all-hands deck." },
        { icon: BarChart3,  title: "Built on AI Engine",  body: "Cmd-K → 'show me X' → live dashboard pinned. Reuse forever." },
      ]}
      relatedSlugs={["ai-engine", "kpis", "okrs", "people"]}
      faq={[
        { q: "Can I build custom dashboards?",            a: "Yes — drag-and-drop builder; Cmd-K natural language path; or SQL access on Scale." },
        { q: "Real-time or batched?",                      a: "Most metrics are real-time. Heavy aggregations refresh every 15 min. SLA-grade real-time available on Scale." },
        { q: "Does it work with my data warehouse?",       a: "Bi-directional sync with Snowflake, BigQuery, Redshift on Scale. Read-only mirroring on Growth." },
      ]}
    />
  );
}
