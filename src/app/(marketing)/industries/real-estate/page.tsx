import type { Metadata } from "next";
import { Home, Users, FileText, TrendingUp, DollarSign, Calendar } from "lucide-react";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "WorkwrK for Real Estate",
  description: "Listings, leads, deals, commissions. The operating system for brokerages and developers — per-agent pipelines, deal stages, comp bands.",
  alternates: { canonical: "https://workwrk.com/industries/real-estate" },
};

export default function RealEstateIndustryPage() {
  return (
    <IndustrySubPage
      hue="rose"
      eyebrow="Real Estate"
      title={<>Listings + leads + deals. <GradientText hue="rose">One platform.</GradientText></>}
      lede="Brokerages and developers run their entire operating layer in workwrk — listing inventory, lead pipelines per agent, deal stages, commission calcs, and the agent perf system tied to it all."
      pains={[
        "Listings, leads, and deals live in three different tools — none of them talk to commission calc.",
        "Agent perf is a feel, not a system. Top agents get poached because comp lags.",
        "Compliance docs scatter across email; broker audits become weekend events.",
        "Commission disputes regularly because data is fragmented.",
      ]}
      capabilities={[
        { icon: Home,      title: "Listing inventory",    body: "Property records with photos, docs, status, history. Tied to leads, viewings, and deals." },
        { icon: TrendingUp,title: "Pipeline per agent",   body: "Per-agent and per-team pipelines. Forecast by stage, by region, by property type." },
        { icon: FileText,  title: "Deal stages + docs",   body: "Customizable stages, doc requirements per stage, signed checklist for compliance audits." },
        { icon: DollarSign,title: "Commission calc",      body: "Tiered comp plans, split calculations, payout workflows. Tied to the deal record automatically." },
        { icon: Users,     title: "Agent perf",            body: "Closed deals + pipeline + client NPS + kudos → composite agent perf score. Comp recommendations follow." },
        { icon: Calendar,  title: "Calendar + viewings",  body: "Two-way Google + Microsoft cal sync. Viewings on the listing record; auto-followups." },
      ]}
      kpis={["Closed deals/qtr", "GCI/agent", "Pipeline value", "Conversion %", "Days on market", "Listings/agent", "Repeat client %", "Agent NPS"]}
      faq={[
        { q: "Do you integrate with MLS / portals?",      a: "Yes — Zillow, Bayut, PropertyGuru on Growth. Custom MLS integrations available on Scale." },
        { q: "Multi-broker office support?",               a: "First-class. Per-office dashboards, per-office comp plans, network-level rollup for the principal." },
        { q: "Mobile for showings + open houses?",          a: "Native iOS/Android with offline. Update listings, capture leads at open houses, complete buyer agreements on the spot." },
      ]}
    />
  );
}
