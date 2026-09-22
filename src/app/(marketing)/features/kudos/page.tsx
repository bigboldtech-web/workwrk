// /features/kudos, rewritten against the product. The old page named a
// competitor recognition product in a quote, described the feed by
// reference to a third party chat product, and claimed kudos count toward
// a review score, which is the unbuilt half of stop 6.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Kudos",
  description:
    "Recognition tagged with the company's own values, visible on a profile and in a feed, and readable when a review cycle comes round.",
  alternates: { canonical: "https://workwrk.com/features/kudos" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Kudos", description: "Recognition against the values you actually wrote down." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Recognition against the values you actually wrote down." },
};

export default function KudosFeaturePage() {
  return (
    <FeatureSubPage
      slug="kudos"
      hubSlug="teams"
      eyebrow="Teams"
      title="Recognition tied to your own values."
      lede="A kudos names a person, a value and what they did, and the values are the ones you wrote in settings."
      capabilities={[
        { title: "Your values", body: "The tags are the company values from your own identity settings. Add one, retire one, and the recognition follows." },
        { title: "Anyone to anyone", body: "Not a manager privilege. The people who see the work are usually not the people who run the review." },
        { title: "A feed", body: "A public feed of recognition, so it is visible to the team rather than trapped in a direct message." },
        { title: "On the profile", body: "Recognitions collect on the person's page with their value and their note." },
        { title: "Values, counted", body: "Which values the company actually recognises, as a count, which is usually a more honest culture report than a survey." },
        { title: "Readable at review time", body: "A reviewer can read them. They do not score the review by themselves; that link is not built yet." },
      ]}
      surfaceKey="review-timeline"
      surfaceCrumb="Recognition"
      surfaceLabel="The Teams block: a review timeline showing the records a review cycle reads from."
      relatedSlugs={["people", "reviews"]}
      faq={[
        { q: "Does kudos cost extra?", a: "No. It is in every tier, including the free one." },
        { q: "Do kudos change a review score?", a: "No. A reviewer can read them as context. Kudos landing on a review as scored evidence is not built." },
        { q: "Can a kudos be private?", a: "The feed is the point, so recognition is visible to the workspace." },
      ]}
    />
  );
}
