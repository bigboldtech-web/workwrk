import type { Metadata } from "next";
import { Cpu, Code2, GitMerge, Bot, BarChart3, Zap } from "lucide-react";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "WorkwrK for Technology Companies",
  description: "Engineering and GTM under one operating system. Tickets, sprints, OKRs, perf reviews, kudos, and pipeline — connected by a single data model.",
  alternates: { canonical: "https://workwrk.com/industries/technology" },
};

export default function TechnologyIndustryPage() {
  return (
    <IndustrySubPage
      hue="violet"
      eyebrow="Technology"
      title={<>Engineering + GTM <GradientText hue="violet">under one OS.</GradientText></>}
      lede="Stop running engineering on Linear, sales on HubSpot, perf on Lattice, and gluing it with Notion. One data model. One platform. One bill."
      pains={[
        "Engineering KPIs live in Linear; revenue lives in HubSpot; perf reviews live in Lattice. None talk to each other.",
        "Onboarding a new hire means setting up 8 accounts and writing the same SOP three times.",
        "Quarterly OKRs are a Notion doc, not a system. Slippage is invisible until the retro.",
        "Recognition is a #shoutouts channel that everyone scrolls past.",
      ]}
      capabilities={[
        { icon: Code2,    title: "Eng-aware roles + KPIs",  body: "Pre-built role ladders (SWE I → Staff → Principal), velocity + quality KPIs, comp bands per band." },
        { icon: GitMerge, title: "Linear + Jira sync",      body: "Tickets, sprints, releases — two-way sync. Ticket velocity feeds engineering KPIs automatically." },
        { icon: BarChart3,title: "GTM under the same roof", body: "Sales pipeline, AE quotas, customer 360 — same data model as engineering. Promotion-relevant data on every profile." },
        { icon: Bot,      title: "AI for tech orgs",        body: "Cmd-K across people, code repos, tickets, deals. Who built what. Who closed what. Who should be promoted." },
        { icon: Zap,      title: "Fast deploys, faster perf",body: "Quarterly perf cycles in 10 days, not 6 weeks. Calibration baked in. Comp planning exports to Carta or your payroll." },
        { icon: Cpu,      title: "SOC 2 by default",         body: "Audit log, SCIM, SAML SSO included. Security review takes a weekend, not a quarter." },
      ]}
      kpis={["Sprint velocity", "PR cycle time", "Deploy frequency", "Pipeline coverage", "Win rate", "Quota attainment", "Time-to-promote", "eNPS", "Customer NPS"]}
      testimonial={{
        quote: "Eng and GTM finally read off the same scoreboard. Promotions aren't a black box anymore.",
        author: "Sarah Chen",
        role: "Founder + CEO",
        company: "Crest AI",
      }}
      faq={[
        { q: "Does this replace Linear?",                 a: "No — we two-way sync. Engineers stay in Linear. KPIs, perf, and cross-functional roll-up live in workwrk." },
        { q: "What about salary banding?",                a: "Per-role comp bands tied to level, location, and tenure. Auto-flagged when offers go out of band." },
        { q: "How fast can we deploy this?",              a: "Tech-company template ships with role ladders, KPIs, OKR examples, and SOC 2 SOPs. Most teams are live in a week." },
      ]}
    />
  );
}
