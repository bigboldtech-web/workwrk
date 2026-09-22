// /industries/real-estate, rewritten against the product. The old page
// promised connections to three named property portals and a commission
// calculation the product does not do.

import type { Metadata } from "next";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "WorkwrK for brokerages and developers",
  description:
    "Inventory and pipelines as tables and lists, agent result areas, the processes a transaction repeats, and measures with a named owner.",
  alternates: { canonical: "https://workwrk.com/industries/real-estate" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "WorkwrK for brokerages and developers", description: "Inventory, pipeline and process." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Inventory, pipeline and process." },
};

export default function RealEstateIndustryPage() {
  return (
    <IndustrySubPage
      slug="real-estate"
      eyebrow="Real estate"
      title="Listings, deals and the process between."
      lede="Listings, leads and transactions become tables and lists on one model, with the process that moves a deal written beside them."
      painsTitle="Where the deal loses its trail."
      pains={[
        "Inventory is a spreadsheet, the pipeline is a tool, and the handover between them is a message.",
        "Every agent runs the transaction slightly differently, and the difference surfaces at closing.",
        "Agent performance is reconstructed at the end of the quarter from exports.",
        "The checklist for a closing exists in somebody's head.",
      ]}
      capabilities={[
        { title: "Inventory as a table", body: "A real spreadsheet with formulas, lookups and rollups, and rows that link to the work moving them." },
        { title: "Pipeline as a list", body: "Lists and boards with per list statuses and every view, so a stage means what your firm decided it means." },
        { title: "The transaction process", body: "A checklist procedure with owners per step, versioned, with a record of who has acknowledged it." },
        { title: "What an agent owns", body: "Result areas on the role, so a performance conversation starts from the seat rather than the mood." },
        { title: "Measures with owners", body: "Listings taken, time to close and pipeline coverage as targets with a direction and a person recording the reading." },
        { title: "Goals per office", body: "Cascade and rollup by office or department, with the linked work visible on the goal." },
      ]}
      kpisLabel="What teams here measure."
      kpis={["Time to close", "Listings taken", "Pipeline coverage", "Acknowledgement rate"]}
      faq={[
        { q: "Do you connect to listing portals?", a: "No. Nothing connects to a third party product. There is a v1 REST API and CSV import and export." },
        { q: "Do you calculate commission?", a: "Only as your own formula in a table. There is no commission engine and no payout." },
        { q: "Can a client see their transaction?", a: "You can share a list or a document with a named person. There is no branded client portal." },
      ]}
    />
  );
}
