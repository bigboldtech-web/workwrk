// /features/sops, rewritten against the product.
//
// Gone: "an audit trail that holds up in a SOC 2 review", "Exportable for
// SOC 2, ISO 27001, HIPAA", an invented customer quote about an audit, an
// FAQ answer naming a competitor product, and a step naming a third party
// chat product. Four claim flags cover those and all four are false.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "SOPs",
  description:
    "Four kinds of process doc, each with its own editor, an acknowledgement loop that closes, version history, and a link to the role and the KRA that own it.",
  alternates: { canonical: "https://workwrk.com/features/sops" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "SOPs",
    description: "Process docs with acknowledgement, versions, and the role that owns them.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Process docs with acknowledgement, versions, and the role that owns them." },
};

export default function SopsFeaturePage() {
  return (
    <FeatureSubPage
      slug="sops"
      hubSlug="docs"
      eyebrow="Docs"
      title="The process, where the work is."
      lede="A written process is worth having only if the people who run it can find it and you can tell who has read it."
      capabilities={[
        { title: "Four kinds, four editors",
          body: "A written procedure, a checklist, a decision flow and a recorded walkthrough. The editor matches the kind rather than making every process a wall of text.",
        },
        { title: "Acknowledgement that closes",
          body: "Assign an SOP, see who has acknowledged the current version and who has not, and export the list. It is a record, not a certification.",
        },
        { title: "Version history",
          body: "Publish a new version and the acknowledgements reset to it. The old version stays readable, attached to the period it governed.",
        },
        { title: "Owned by a role",
          body: "An SOP points at the KRA it serves, so the process and the result area are the same conversation. Today the owner shown on the doc is the person who created it.",
        },
        { title: "Steps, with owners",
          body: "A checklist SOP carries its steps with an owner on each one, and a task can link back to the step it came from.",
        },
        { title: "Policies and contracts beside them",
          body: "The same block holds policies with their own acknowledgement ledger, and contracts with their clauses, so the paperwork is not a separate product.",
        },
      ]}
      surfaceKey="sop-doc"
      surfaceCrumb="SOPs"
      surfaceLabel="The Docs block: the Client onboarding SOP open in the editor, with its numbered steps and its acknowledgement state."
      relatedSlugs={["kras", "tasks", "access"]}
      faq={[
        {
          q: "Does an SOP step create the task by itself?",
          a: "Not yet. Today you create the task and link it to the step, and the link is what the rest of the system reads. The step spawning the task with the owner resolved from the role is in build, and the site says so wherever the story reaches that moment.",
        },
        {
          q: "Can I see who has not read the current version?",
          a: "Yes. The compliance view lists acknowledged and outstanding per SOP and per person, and exports to CSV.",
        },
        {
          q: "Is this an audit trail I can hand to an auditor?",
          a: "It is a record of who acknowledged what and when. Whether that satisfies a given auditor is between you and them: we hold no certification and we are not going to imply one.",
        },
      ]}
    />
  );
}
