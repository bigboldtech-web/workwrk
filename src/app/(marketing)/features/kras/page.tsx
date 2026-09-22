// /features/kras, rewritten against the product. The claims here are small
// on purpose: what shipped is the role definition page, the KRA with its
// weight, and the link from the KRA to the KPI that measures it.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "KRAs",
  description:
    "Key result areas defined on the role rather than the person, weighted, linked to the KPI that measures them, and read by every review.",
  alternates: { canonical: "https://workwrk.com/features/kras" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "KRAs", description: "What a role owns, not what a person remembers." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "What a role owns, not what a person remembers." },
};

export default function KrasFeaturePage() {
  return (
    <FeatureSubPage
      slug="kras"
      hubSlug="goals"
      eyebrow="Goals"
      title="What the role owns, written once."
      lede="A key result area belongs to the role, so the next person to hold it inherits the job instead of negotiating it from a blank page."
      capabilities={[
        { title: "On the role", body: "KRAs sit on the role definition. Move a person into the role and the result areas come with the seat." },
        { title: "Weighted", body: "Each KRA carries a weight, so a composite score reflects what the role is actually for." },
        { title: "Linked to a KPI", body: "A KRA names the KPI that measures it, which is how a reading becomes evidence rather than an opinion." },
        { title: "Owns its SOPs", body: "The processes that serve a result area hang off it, so the question of who runs this has one answer." },
        { title: "Read by reviews", body: "A review cycle opens on the subject's KRAs, with the self rating and the manager rating against each one." },
        { title: "Boundaries", body: "A role definition also records what it escalates and to whom, which is the half of a job description everyone skips." },
      ]}
      surfaceKey="role-page"
      surfaceCrumb="Roles"
      surfaceLabel="The Teams block: a role definition page showing the KRA it owns and the KPIs weighted under it."
      relatedSlugs={["kpis", "reviews", "people"]}
      faq={[
        { q: "Why on the role and not on the person?", a: "Because roles change less often than people do. A new hire steps into a seat that already knows what it owns." },
        { q: "Can a KRA be edited during a cycle?", a: "Yes. The cycle in flight keeps the set it opened with, and the next one picks up the new set." },
        { q: "Do KRAs move by themselves when work is done?", a: "A KRA moves with the KPI reading behind it, and a reading is recorded by whoever owns it. Completing a task does not write a reading today." },
      ]}
    />
  );
}
