import type { Metadata } from "next";
import { Star, Users, BarChart3, Sparkles, Calendar, Award } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Performance Reviews — WorkwrK",
  description: "360-degree reviews with weighted scoring. Manager, peer, self, KPIs, kudos — all combined into one composite score. The performance system that uses real data.",
  alternates: { canonical: "https://workwrk.com/features/reviews" },
};

export default function ReviewsFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="talent"
      hue="violet"
      eyebrow="Talent hub · Reviews"
      title={<>360° reviews with <GradientText hue="violet">data, not vibes.</GradientText></>}
      lede="Composite scores combine manager rating, peer review, self-assessment, KPI achievement, SOP compliance, and kudos count. Calibrated. Defensible. Done in 10 days."
      capabilities={[
        { icon: Star,      title: "Composite scoring",  body: "Manager 25% · 360 peers 10% · Self 10% · KPIs 30% · Tasks 15% · SOPs 10%. Tweakable per cycle." },
        { icon: Users,     title: "Calibration sessions", body: "Side-by-side calibration views with delta highlighting. Defensible decisions in 30 minutes per team." },
        { icon: BarChart3, title: "Trend across cycles",  body: "See growth, plateau, or decline across quarters. One chart per person, automatically." },
        { icon: Calendar,  title: "Cycle templates",      body: "Quarterly, annual, mid-year, project-end. Templates per company, per department." },
        { icon: Award,     title: "Kudos boost",          body: "Recognition counted as a bonus, not a primary axis. Real recognition; not gameable." },
        { icon: Sparkles,  title: "AI-assisted summaries", body: "Reviewers see auto-drafted summaries from KPI + task + kudos data. Edit, don't write from blank." },
      ]}
      workflowSteps={[
        "Pick a cycle template — quarterly, annual, etc.",
        "Composite weights default per industry; override per company",
        "Self-assessment opens 14 days before cycle close",
        "360° peer reviews go out automatically to selected peers",
        "Manager review pulls KPI scores + tasks + kudos into a copilot draft",
        "Calibration happens in-app; exports to comp planning",
      ]}
      relatedSlugs={["people", "kpis", "kras", "kudos", "ai-engine"]}
      testimonial={{
        quote: "Cycles used to take six weeks across four tools. Now it's ten days inside workwrk. And the data is better.",
        author: "Daniel Park",
        role: "VP People",
        company: "Forge Capital",
      }}
      faq={[
        { q: "Can I run multiple cycles in parallel?",    a: "Yes — quarterly + annual + mid-year can all be live simultaneously. Each has its own template, weights, and stakeholders." },
        { q: "How does the 360 anonymity work?",           a: "Configurable per cycle. Default: peer comments anonymous, ratings aggregated. Some cultures want full transparency; the toggle is yours." },
        { q: "What if we don't run KPIs yet?",             a: "Use just the manager + self-assessment + peer trio. Composite math handles missing axes gracefully. Wire up KPIs whenever you're ready." },
      ]}
    />
  );
}
