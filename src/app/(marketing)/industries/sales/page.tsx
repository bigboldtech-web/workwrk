// /industries/sales, rewritten against the product. The old page named two
// competitor products in its pains and promised two way sync with them.
// There is no CRM in this product; saying so is the page.

import type { Metadata } from "next";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "WorkwrK for sales teams",
  description:
    "Quotas as measures with owners, a pipeline cadence that is a real cycle, ramp processes for new reps, and goals that roll up. There is no CRM here.",
  alternates: { canonical: "https://workwrk.com/industries/sales" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "WorkwrK for sales teams", description: "Quota, cadence and ramp. Not a CRM." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Quota, cadence and ramp. Not a CRM." },
};

export default function SalesIndustryPage() {
  return (
    <IndustrySubPage
      slug="sales"
      eyebrow="Sales"
      title="Quota, cadence and ramp."
      lede="Keep the pipeline where it is, and put what each seat owns, how a rep ramps and whether the quarter is on track here."
      painsTitle="Where the quarter goes missing."
      pains={[
        "The number is in one system and the person's performance is in another, and neither reconciles at review time.",
        "A new rep ramps from a call recording and a colleague's memory.",
        "Pipeline review is a recurring meeting rather than a cycle with a record.",
        "Quarterly targets are set once and read once.",
      ]}
      capabilities={[
        { title: "Quota as a measure", body: "A target, a direction, a period and a named owner for the reading, which is what makes it reviewable later." },
        { title: "What the seat owns", body: "A role definition with its result areas, so an account executive and a manager are different jobs on paper too." },
        { title: "Ramp as a process", body: "The onboarding a rep actually follows, versioned, with a record of who has acknowledged it." },
        { title: "Cadence with a record", body: "Check-ins and review cycles on a schedule, with what was said kept against the period." },
        { title: "Goals that roll up", body: "Team and company goals with computed progress and an on track verdict, and the linked work on the goal." },
        { title: "Tables for the working", body: "Forecast working in a real spreadsheet with formulas and rollups, beside everything else." },
      ]}
      kpisLabel="What teams here measure."
      kpis={["Quota attainment", "Ramp time", "Cycle completion", "Goal progress"]}
      faq={[
        { q: "Is there a CRM in here?", a: "No. There is no deal pipeline, no contact object and no forecast engine. Keep the CRM you have." },
        { q: "Do you sync with it?", a: "No. Nothing connects to a third party product. There is a v1 REST API if you want to push a number in." },
        { q: "Commissions?", a: "Only as your own working in a table. There is no commission engine and no payout." },
      ]}
    />
  );
}
