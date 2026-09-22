// /industries/logistics, rewritten against the product. The old page named
// three third party transport systems as shipping integrations and carried
// an invented customer.

import type { Metadata } from "next";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "WorkwrK for logistics teams",
  description:
    "Hubs, routes and daily service levels kept as measures with owners, procedures with acknowledgement, and tables for the working underneath.",
  alternates: { canonical: "https://workwrk.com/industries/logistics" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "WorkwrK for logistics teams", description: "Service levels, procedure and roles." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Service levels, procedure and roles." },
};

export default function LogisticsIndustryPage() {
  return (
    <IndustrySubPage
      slug="logistics"
      eyebrow="Logistics"
      title="A service level with an owner."
      lede="The daily number, the procedure for the exception and the person who owns both usually live in three places."
      painsTitle="Where the service level slips."
      pains={[
        "Daily performance is a message in a group, not a record anyone can read back.",
        "Exception handling depends on who is on shift rather than on a written step.",
        "Hub managers own results that were never written down, so a transfer resets them.",
        "Quarterly targets are disconnected from the daily numbers that would move them.",
      ]}
      capabilities={[
        { title: "Daily measures", body: "On time rate, exception rate and dwell time as KPIs with a target, a direction and an owner for the reading." },
        { title: "Per hub and per route", body: "Keep the same measure per department or office and read it where the work is managed." },
        { title: "Exception procedures", body: "Written steps with owners, version history, and a record of who has acknowledged the current version." },
        { title: "Roles that survive a transfer", body: "Result areas sit on the role, so a hub handover carries what the seat owns." },
        { title: "Tables for the working", body: "Formulas, lookups and rollups in a real spreadsheet, beside the rest rather than in another product." },
        { title: "Targets that read the day", body: "Goals with rollup and a computed verdict, and the linked work visible on them." },
      ]}
      kpisLabel="What teams here measure."
      kpis={["On time rate", "Exception rate", "Dwell time", "Acknowledgement rate"]}
      faq={[
        { q: "Do you connect to our transport management system?", a: "No. Nothing connects to a third party product. There is a v1 REST API and CSV import and export." },
        { q: "Can drivers use it?", a: "In a phone browser, yes. There is no app in a store." },
        { q: "Can we keep the daily sheet?", a: "Keep it as a table here, with formulas, and link the rows to the work. That is usually the fastest honest migration." },
      ]}
    />
  );
}
