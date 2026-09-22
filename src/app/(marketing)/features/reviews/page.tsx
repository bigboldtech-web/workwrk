// /features/reviews, rewritten against the product.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Performance reviews",
  description:
    "Review cycles with self, manager and peer input, weighted scoring, and the KPI and SOP records already attached to the person being reviewed.",
  alternates: { canonical: "https://workwrk.com/features/reviews" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Performance reviews", description: "Cycles with the evidence already on them." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Cycles with the evidence already on them." },
};

export default function ReviewsFeaturePage() {
  return (
    <FeatureSubPage
      slug="reviews"
      hubSlug="teams"
      eyebrow="Teams"
      title="The review opens with the evidence."
      lede="A cycle reads the KRAs the role owns, the KPI readings recorded during the period and the SOP acknowledgements."
      capabilities={[
        { title: "Cycles", body: "Launch a cycle for a period, pick who is in it, and track who has submitted without chasing a spreadsheet." },
        { title: "Self, manager, peer", body: "A self assessment, a manager assessment and peer input, each stored separately rather than merged into one anonymous blob." },
        { title: "Against the KRAs", body: "Each result area gets a rating and a comment on both sides, so the disagreement is visible and specific." },
        { title: "Weighted composite", body: "The KPI score, the SOP compliance score and the manager rating combine at weights you set for the cycle." },
        { title: "A timeline", body: "The person's page carries the cycle's timeline, with the readings and the result area outcome on it." },
        { title: "An outcome", body: "A cycle closes with a recorded outcome and a recommendation, and the history stays attached to the period." },
      ]}
      surfaceKey="review-timeline"
      surfaceCrumb="Reviews"
      surfaceLabel="The Teams block: a review timeline with the KPI records and the KRA result already on it."
      relatedSlugs={["kras", "kpis", "people"]}
      faq={[
        { q: "Can several cycles run at once?", a: "Yes. A quarterly and an annual cycle can be live at the same time without sharing a form." },
        { q: "Is peer feedback anonymous?", a: "Peer input is stored as its own record with its author. Decide your own policy on who sees it; do not assume anonymity we do not implement." },
        { q: "Does a kudos count as review evidence?", a: "Not automatically. Kudos are recorded against the company's values and are readable on a profile; landing one on a review as evidence is not built yet." },
      ]}
    />
  );
}
