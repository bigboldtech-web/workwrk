// /industries/technology, rewritten against the product.
//
// The old page named four competitor products in its lede and three more in
// its pains, sold two way ticket sync, a sales pipeline and a customer 360
// that are not in this product at all, promised "SOC 2 by default. Audit
// log, SCIM, SAML SSO included" against three flags that are false, printed
// an invented counter ("perf cycles in 10 days, not 6 weeks") and carried an
// invented customer at an invented company. What survives is the shape of
// the argument, which was always the good part.

import type { Metadata } from "next";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "WorkwrK for technology companies",
  description:
    "Roles, result areas, processes and goals for an engineering and go to market org on one data model, so a promotion case and a quarter review read from the same records.",
  alternates: { canonical: "https://workwrk.com/industries/technology" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "WorkwrK for technology companies",
    description: "One data model under engineering and go to market.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "One data model under engineering and go to market." },
};

export default function TechnologyIndustryPage() {
  return (
    <IndustrySubPage
      slug="technology"
      eyebrow="Technology"
      title="One record for every function."
      lede="The role, the process, the measure and the goal are the same objects in engineering as they are in go to market."
      painsTitle="Where the company question fails."
      pains={[
        "Each function runs on its own tool, and the quarter review is a manual reconciliation of four exports.",
        "Onboarding a hire means creating accounts in several products and writing the same process down twice.",
        "Quarterly goals are a document rather than a system, so slippage is only visible at the retro.",
        "Recognition happens in a chat channel that scrolls past, and nothing of it survives to the review.",
      ]}
      capabilities={[
        { title: "Role ladders that own things", body: "A role definition carries its result areas, the processes it owns and what it escalates, so a level is a job rather than a title." },
        { title: "Measures with owners", body: "Each KPI has a target, a direction and the person who records the reading. No metric without a name against it." },
        { title: "Processes that stay current", body: "Four kinds of process doc with version history and an acknowledgement list, which is what a runbook needs to be trusted." },
        { title: "Goals that read the work", body: "Cascade, rollup and a computed on track verdict, with the linked tasks visible on the goal as the effort behind it." },
        { title: "A v1 API", body: "People, tasks, processes, result areas, KPIs and readings, with an OpenAPI document. Build the connection your stack needs; none ships." },
        { title: "The conversation on the work", body: "Channels, calls and comments attached to the task, so a decision survives the thread it was made in." },
      ]}
      kpisLabel="What teams here measure."
      kpis={["Cycle time", "Review cycle completion", "Process acknowledgement", "Goal progress", "On track verdict"]}
      faq={[
        { q: "Does this replace our issue tracker?", a: "It can, and for a small team it usually does. It does not sync with one: nothing here connects to a third party product." },
        { q: "Do you do compensation banding?", a: "No. Compensation, payroll and benefits are not in this product." },
        { q: "What about a security review?", a: "Read the security page. We hold no third party certification, there is no single sign-on and there is no choice of region. Better to know that on the first call." },
      ]}
    />
  );
}
