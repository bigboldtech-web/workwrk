// /industries/services, rewritten against the product. The old page sold
// project profit and loss calculated daily, client portals and multi
// currency margin reporting. None of those is a product surface here.

import type { Metadata } from "next";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "WorkwrK for services firms",
  description:
    "Projects as lists and boards, capacity by role, utilisation kept as a measure with an owner, and the processes a delivery team actually repeats.",
  alternates: { canonical: "https://workwrk.com/industries/services" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "WorkwrK for services firms", description: "Projects, capacity and the process underneath." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Projects, capacity and the process underneath." },
};

export default function ServicesIndustryPage() {
  return (
    <IndustrySubPage
      slug="services"
      eyebrow="Services"
      title="Delivery, capacity and the process underneath."
      lede="An agency sells the same delivery repeatedly, so the list, the process and the role are the blocks that matter."
      painsTitle="Where the delivery gets re-invented."
      pains={[
        "Every project starts from a blank board and a memory of the last one.",
        "Utilisation is a monthly spreadsheet that arrives too late to act on.",
        "The same delivery process is written down in three proposals and nowhere in the system.",
        "Who is free next week is a conversation rather than a view.",
      ]}
      capabilities={[
        { title: "A project is a list", body: "Spaces, folders and lists with every view, custom fields, per list statuses and saved views, so a delivery template is a real thing." },
        { title: "Capacity by role", body: "Workload and planner views read assignment and logged time, per person and per team." },
        { title: "Utilisation as a measure", body: "A target, a direction and an owner for the reading, kept per period rather than reconstructed monthly." },
        { title: "The delivery process", body: "The repeatable part written once, versioned, with a record of who has read the current version." },
        { title: "Rates and working in tables", body: "Formulas, lookups and rollups where the commercial working belongs, linked to the delivery it describes." },
        { title: "Goals per practice", body: "Cascade and rollup by department, with the linked work visible as the effort behind the number." },
      ]}
      kpisLabel="What teams here measure."
      kpis={["Utilisation", "On time delivery", "Cycle time", "Goal progress"]}
      faq={[
        { q: "Do you do invoicing or project profit and loss?", a: "No. There is no billing, no invoicing and no finance module. Tables will hold the working; they will not raise an invoice." },
        { q: "Can a client see their project?", a: "You can share a space, a folder or a list with a named person. There is no separate branded client portal." },
        { q: "Multi currency?", a: "Only in a table, as your own formula. The product does not do currency conversion for you." },
      ]}
    />
  );
}
