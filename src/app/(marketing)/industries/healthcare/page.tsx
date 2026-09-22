// /industries/healthcare, rewritten against the product.
//
// The old page answered "Are you HIPAA-compliant?" with "Yes. BAA
// available.", sold "compliance-grade" audit trails, and carried an
// invented customer. flags.hipaaBaa is false and there is no BAA. A
// clinician reading a false compliance answer on a marketing page is the
// worst version of this whole category of defect, so the answer is now the
// real one and it is the first thing on the FAQ.

import type { Metadata } from "next";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "WorkwrK for healthcare teams",
  description:
    "Processes with version history and acknowledgement, roles that own them, and scoped sharing. We hold no certification and offer no BAA, and this page says so.",
  alternates: { canonical: "https://workwrk.com/industries/healthcare" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "WorkwrK for healthcare teams",
    description: "Process, acknowledgement and roles. What we do not hold is on the page.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Process, acknowledgement and roles. What we do not hold is on the page." },
};

export default function HealthcareIndustryPage() {
  return (
    <IndustrySubPage
      slug="healthcare"
      eyebrow="Healthcare"
      title="Every procedure, read and signed."
      lede="Clinics and multi site teams run on written procedure and on knowing who has read the current version."
      painsTitle="Where the paperwork goes quiet."
      pains={[
        "The procedure exists, but nobody can say which version the evening shift is following.",
        "Training records live in a spreadsheet that is updated after the fact, if at all.",
        "Access is all or nothing, so temporary staff can see more than they should.",
        "Every site does it slightly differently, and the difference is only found when something goes wrong.",
      ]}
      capabilities={[
        { title: "Procedures with versions", body: "Publish a version and the acknowledgements reset to it. The previous version stays readable for the period it governed." },
        { title: "Who has read it", body: "Assign a procedure and see acknowledged and outstanding, per person and per document, exportable to CSV." },
        { title: "A role owns it", body: "Procedures hang off a result area, and the result area sits on a role, so the owner is a seat rather than a person who left." },
        { title: "Scoped sharing", body: "Share a space, a folder or a single document with named people. A grant adds reach and never widens the rest." },
        { title: "A cadence", body: "Review cycles and check-ins on a schedule, so the annual re-read is a cycle rather than an email." },
        { title: "Measures per site", body: "Targets with a direction and a named owner for the reading, kept per department or office." },
      ]}
      kpisLabel="What teams here measure."
      kpis={["Acknowledgement rate", "Time to acknowledge", "Cycle completion", "Outstanding by site"]}
      faq={[
        {
          q: "Are you HIPAA compliant, and is a BAA available?",
          a: "No, and no. We hold no third party certification of any kind and we do not sign a business associate agreement. Do not put protected health information in this product.",
        },
        { q: "Can I choose where the data is stored?", a: "No. There is one deployment and you do not choose its region." },
        { q: "So what is this useful for here?", a: "Operational process, training acknowledgement, roles, goals and the work itself. That is a real job and it is the one we can do honestly." },
      ]}
    />
  );
}
