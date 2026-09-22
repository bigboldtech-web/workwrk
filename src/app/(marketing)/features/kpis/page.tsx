// /features/kpis, rewritten against the product.
//
// Gone: an invented customer at an invented company whose quote also named
// a third party analytics product, an FAQ answer promising native feeds
// from three named third party products, and the sector template library.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "KPIs",
  description:
    "Targets with a direction, readings recorded by the person who owns them, a weight per role, and the review cycle that reads them.",
  alternates: { canonical: "https://workwrk.com/features/kpis" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "KPIs", description: "Targets, readings, and the weight each one carries." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Targets, readings, and the weight each one carries." },
};

export default function KpisFeaturePage() {
  return (
    <FeatureSubPage
      slug="kpis"
      hubSlug="goals"
      eyebrow="Goals"
      title="Every number has an owner."
      lede="A KPI here is a target, a unit, a direction of travel and the person who owns the reading."
      capabilities={[
        { title: "Target and direction", body: "Higher is better or lower is better, against a target in the unit you actually use. Cycle time in days is not a percentage." },
        { title: "Readings with a source", body: "Every reading is recorded against a period by a person or through the API, so a number on a review has a provenance." },
        { title: "A weight per role", body: "The same KPI can matter more to one role than another, and the composite score follows the weight." },
        { title: "Trend over periods", body: "Readings sit on a period, so the movement is the record rather than a screenshot of last quarter." },
        { title: "A review loop", body: "A KPI review cycle asks the owner for the period's reading and closes when it has one." },
        { title: "Tied to the KRA", body: "A KPI is named by the KRA it measures, which is how it reaches the role, the SOP and the goal." },
      ]}
      surfaceKey="goal-detail"
      surfaceCrumb="Goals"
      surfaceLabel="The Goals block: a goal detail page with its KPI readings and the on track verdict they produce."
      relatedSlugs={["kras", "okrs", "reviews"]}
      faq={[
        { q: "Does finishing a task move a KPI?", a: "No. Every reading in the product comes from a person or from the API. When completing a task writes a reading by itself, this page will say so." },
        { q: "Can I load readings from somewhere else?", a: "Yes, through the v1 API, and by CSV into a table. There is no connector to a third party product." },
        { q: "How do KPIs differ from goals?", a: "A KPI is the steady measure of something you already do. A goal is a change you are trying to make. Most teams keep both, and here they are linked rather than duplicated." },
      ]}
    />
  );
}
