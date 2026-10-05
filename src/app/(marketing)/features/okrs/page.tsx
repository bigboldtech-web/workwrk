// /features/okrs, rewritten against the product. The old lede named a
// competitor product; the nudges card named a third party chat product.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Goals and OKRs",
  description:
    "Company, team and personal goals that cascade and roll up, with an on track verdict that is computed rather than voted on, and an effort panel built from the linked work.",
  alternates: { canonical: "https://workwrk.com/features/okrs" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Goals and OKRs", description: "Cascade, rollup, and a verdict you can check." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Cascade, rollup, and a verdict you can check." },
};

export default function OkrsFeaturePage() {
  return (
    <FeatureSubPage
      slug="okrs"
      hubSlug="goals"
      eyebrow="Goals"
      title="The goal reads its own work."
      lede="Progress rolls up from key results, KPI readings and child goals, and the goal's Effort card counts the work linked to it: hours logged, tasks done and in progress, and who is driving it."
      capabilities={[
        { title: "Three levels", body: "Company, team and personal, with the same shape at each level so a cascade is a link rather than a retyping." },
        { title: "Rollup", body: "A parent goal's progress is computed from its key results and its children. Nobody maintains a second number." },
        { title: "A verdict, not a vote", body: "On track, at risk or off track is derived from progress against time elapsed, the same way for every goal." },
        { title: "Effort panel", body: "The tasks linked through the KRA are counted on the goal, hours logged, tasks done and in progress, with the people driving them, without anyone attaching them by hand." },
        { title: "Owned by a person", body: "A goal has an owner and a department. What a role owns is the KRA, and the two are linked rather than confused." },
        { title: "Check-ins", body: "Update a key result with a note and the history stays on it, so the story of the quarter is readable after it." },
      ]}
      surfaceKey="goal-detail"
      surfaceCrumb="Goals"
      surfaceLabel="The Goals block: a goal detail page with its progress, its KPI readings and the work linked to it."
      relatedSlugs={["kras", "kpis", "tasks"]}
      faq={[
        { q: "Who can set a goal for someone else?", a: "A manager assigns goals down their own reporting line. Everyone can see the company goals." },
        { q: "Does progress update itself?", a: "Rollup and the verdict are computed. A key result's own value is updated by its owner, or moves with the KPI reading it is tied to." },
        { q: "Can I see the work behind a goal?", a: "Yes. The Effort card counts the linked tasks and names who is driving them, and Linked work opens each List, Space or KRA the goal is linked to." },
      ]}
    />
  );
}
