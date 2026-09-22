// /features/ai-engine, rewritten against the product.
//
// Gone: a named model version and a promise of per customer model pinning,
// "answers with citations to source records" (the endpoint returns a
// response and no sources at all, which is stop 6's unbuilt mechanism),
// "pin useful queries as live dashboards", and "per-user permissions
// enforced at retrieval", which is the one claim here that was wrong in the
// dangerous direction: the retrieval is scoped to the ORGANISATION. That is
// said plainly below rather than quietly dropped.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "AI",
  description:
    "One Ask on every page, reading the workspace it is in: people, roles, result areas, KPI readings, processes and reviews. What it does not do yet is listed too.",
  alternates: { canonical: "https://workwrk.com/features/ai-engine" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "AI", description: "One Ask, reading the workspace it is in." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "One Ask, reading the workspace it is in." },
};

export default function AiFeaturePage() {
  return (
    <FeatureSubPage
      slug="ai-engine"
      hubSlug="ai"
      eyebrow="AI"
      title="One Ask, reading the whole workspace."
      lede="The roles, the result areas, the readings, the processes and the reviews are in one system, so the question has something to read."
      capabilities={[
        { title: "Ask, anywhere", body: "One Ask on every page rather than a chat button on every control." },
        { title: "It reads the workspace", body: "People, departments, roles, result areas, KPI readings, processes, review cycles and recent activity." },
        { title: "Plain questions", body: "Ask whether the quarter is on track, or who owns a process, and get an answer built from those records." },
        { title: "Beside the work", body: "The answer sits next to the block it is about, so the next click is the record rather than a search box." },
        { title: "Scoped to the workspace, not the person",
          body: "Retrieval is filtered by organisation. It is not yet filtered by what the asking person can see, so treat the Ask as an admin surface until that lands.",
        },
        { title: "No source chips yet", body: "The answer does not cite the records it read. When it does, the site will show the chips rather than describe them." },
      ]}
      surfaceKey="ask-ai"
      surfaceCrumb="Ask"
      surfaceLabel="The AI block: one Ask answering a question about the workspace it is in."
      relatedSlugs={["kpis", "sops", "access"]}
      faq={[
        { q: "Does it cite its sources?", a: "Not yet. That is a real gap and it is on the build list; the story on this site marks the same moment as unbuilt." },
        { q: "Does it respect per person permissions?", a: "Not yet. Retrieval is scoped to the organisation. Until per person scoping ships, do not open the Ask to people who should not read the whole workspace." },
        { q: "Is our data used to train a model?", a: "No. The workspace's records are read to answer a question and are not used to train a foundation model." },
      ]}
    />
  );
}
