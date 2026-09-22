// /features/analytics, rewritten against the product.
//
// The old page sold a drag and drop dashboard builder, SQL access, rolling
// 30/60/90 windows on every entity, one click pivots, PDF and PNG export
// and bi-directional warehouse sync. None of that ships, and the separate
// dashboards surface was removed from the product. What is true is smaller
// and is what this page now says: the numbers live in the block that owns
// them, and you read them there.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Reporting",
  description:
    "Where the numbers are: the goal rollup and its verdict, KPI readings by period, review scores, SOP acknowledgement, saved views and CSV export. And what there is not.",
  alternates: { canonical: "https://workwrk.com/features/analytics" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Reporting", description: "What the numbers are, and where they are not." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "What the numbers are, and where they are not." },
};

export default function AnalyticsFeaturePage() {
  return (
    <FeatureSubPage
      slug="analytics"
      hubSlug="goals"
      eyebrow="Across every block"
      title="The number lives beside the work."
      lede="A number read three screens away from the thing it measures is how a company ends up arguing about the number."
      capabilities={[
        { title: "Goal rollup", body: "Progress computed from the key results and the children beneath them, with the on track verdict derived the same way for every goal." },
        { title: "KPI readings by period", body: "The readings against the target and the direction, in the unit the KPI is actually kept in." },
        { title: "Compliance views", body: "Who has acknowledged the current version of an SOP or a policy, and who has not, per person and per document." },
        { title: "Views do the slicing", body: "Group, filter and sort a list or a table and save the result as a named view. That is the pivot, and it lives on the data." },
        { title: "Tables for the rest", body: "A spreadsheet with formulas, lookups and rollups, for the working that does not belong in a product surface." },
        { title: "CSV out", body: "Exports for activity, compliance, people, reviews and your own data. No PDF renderer and no warehouse sync." },
      ]}
      surfaceKey="table"
      surfaceCrumb="Tables"
      surfaceLabel="The Tables block: a sheet with a formula bar, which is where a number on this page comes from."
      relatedSlugs={["okrs", "kpis", "tasks"]}
      faq={[
        { q: "Is there a dashboard builder?", a: "No. There was a dashboards surface and it was removed rather than half maintained. Saved views on the data are what replaced it." },
        { q: "Can I query the database directly?", a: "No. There is a v1 REST API with an OpenAPI document for the entities it covers." },
        { q: "Does it connect to a data warehouse?", a: "No." },
      ]}
    />
  );
}
