// /features/integrations, rewritten against the product.
//
// The old page listed twenty two named connectors in a directory grid, sold
// two way sync with four of them by name, promised five thousand apps
// through two no code automators and a warehouse mirror, and said
// "22+ native integrations and counting". Not one connector ships.
//
// Keeping the page and telling the truth on it beats deleting it: a
// procurement team searches for this page, and the answer they need is the
// real one. Connectors here are demand driven, which is a strategy rather
// than an apology, and it is written down that way.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "What connects today: a v1 REST API with an OpenAPI document, CSV in and CSV out. No third party connectors ship, and this page will not pretend otherwise.",
  alternates: { canonical: "https://workwrk.com/features/integrations" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Integrations",
    description: "A v1 API, CSV in and out, and an honest list of what does not connect.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "A v1 API, CSV in and out, and an honest list of what does not connect." },
};

export default function IntegrationsFeaturePage() {
  return (
    <FeatureSubPage
      slug="integrations"
      hubSlug="tables"
      eyebrow="Across every block"
      title="The short, true list."
      lede="A connector named on a marketing page is a commitment a buyer quotes back at you, so here is the whole list."
      capabilities={[
        { title: "A v1 REST API",
          body: "People, tasks, processes, result areas, KPIs, KPI readings and recognitions, with an OpenAPI document you can generate a client from.",
        },
        { title: "CSV in", body: "Import into a table from a spreadsheet, which is how most teams move the data they actually care about." },
        { title: "CSV out", body: "Exports for activity, compliance, people, reviews and the whole of your own data." },
        { title: "Email that works", body: "Invitations, reminders and cycle notifications reach a mailbox. That is a delivery path, not an integration." },
        { title: "Why the list is short",
          body: "Most connectors exist to keep two products in step. Eight blocks on one data model is the other answer to that problem, and it is the one this product took.",
        },
        { title: "Connectors are demand driven",
          body: "We build one when customers ask for the same one. None ships today, so none is named here, on the comparison table, or in a sales call.",
        },
      ]}
      relatedSlugs={["tasks", "access"]}
      faq={[
        { q: "Do you connect to my chat, my identity provider or my accounting product?", a: "No. Nothing connects to a third party product today." },
        { q: "Can I build the connection myself?", a: "Yes, against the v1 API. It is the same data model the product uses." },
        // This used to refuse to publish a number that /developers publishes
        // outright, so a buyer asking one question got two answers and the
        // refusal read as evasive. The figures are the enforced schema
        // defaults in prisma/schema.prisma, and the window shape is what
        // src/lib/api-auth.ts actually does.
        { q: "Is there a rate limit I should design for?", a: "Yes: 120 requests a minute and 50,000 a day per key, counted in fixed calendar minute and day buckets, and adjustable per key." },
      ]}
    />
  );
}
