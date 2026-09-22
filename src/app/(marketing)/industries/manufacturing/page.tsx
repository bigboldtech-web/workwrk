// /industries/manufacturing, rewritten against the product. The old page
// promised native connections to four named enterprise systems, a native
// mobile app, and audit trails for two named standards.

import type { Metadata } from "next";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "WorkwrK for manufacturing teams",
  description:
    "Per shift measures, version controlled procedures with acknowledgement, roles that own them, and tables for the working that does not fit a product surface.",
  alternates: { canonical: "https://workwrk.com/industries/manufacturing" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "WorkwrK for manufacturing teams", description: "Procedure, shift measures and roles." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Procedure, shift measures and roles." },
};

export default function ManufacturingIndustryPage() {
  return (
    <IndustrySubPage
      slug="manufacturing"
      eyebrow="Manufacturing"
      title="One record for line and office."
      lede="A plant already runs on written process and on numbers per shift, and those belong on the same records as the goals above them."
      painsTitle="Where the shift record stops."
      pains={[
        "Standard operating procedure lives in a binder and a shared drive, at two different versions.",
        "Shift numbers are written down, then retyped, then argued about at the weekly meeting.",
        "Supervisors own results nobody wrote down, so handover loses half of it.",
        "Improvement goals are a slide, and no one can point at the work that moved them.",
      ]}
      capabilities={[
        { title: "Versioned procedure", body: "Four kinds of process doc, published with a version, with the old one readable for the period it governed." },
        { title: "Sign off that is recorded", body: "Who acknowledged the current version, per person and per line, exportable." },
        { title: "Measures per shift", body: "A target, a direction and an owner for the reading, kept per period so the trend is the record." },
        { title: "Roles, not names", body: "A role definition carries its result areas and what it escalates, which is what a handover actually needs." },
        { title: "Tables for the rest", body: "A real spreadsheet with formulas, lookups and rollups, for the working a product surface should not try to own." },
        { title: "Improvement goals", body: "Goals that roll up with a computed verdict, and an effort panel listing the linked work." },
      ]}
      kpisLabel="What teams here measure."
      kpis={["Output per shift", "Rework rate", "Downtime", "Acknowledgement rate", "Goal progress"]}
      faq={[
        { q: "Does it connect to our plant or finance systems?", a: "No. There is a v1 REST API and CSV import and export. No connector to a third party product ships." },
        { q: "Is there a native mobile app?", a: "No. The site is responsive and works on a phone browser. There is no app in a store." },
        { q: "Can we keep our standard's documentation here?", a: "You can keep the documents, the versions and the acknowledgement record. We hold no certification ourselves and make no claim about yours." },
      ]}
    />
  );
}
