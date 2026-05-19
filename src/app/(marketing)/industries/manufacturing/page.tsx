import type { Metadata } from "next";
import { Factory, Wrench, Truck, Gauge, ShieldCheck, Clipboard } from "lucide-react";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "WorkwrK for Manufacturing",
  description: "Shop floor + SOPs + KPIs in one platform. Per-shift performance, vendor management, ISO 9001 audit trails, multi-site rollup — built for plants and OEMs.",
  alternates: { canonical: "https://workwrk.com/industries/manufacturing" },
};

export default function ManufacturingIndustryPage() {
  return (
    <IndustrySubPage
      hue="emerald"
      eyebrow="Manufacturing"
      title={<>Shop floor + SOPs + KPIs. <GradientText hue="emerald">One operating layer.</GradientText></>}
      lede="Run plants the way modern software companies run engineering — per-shift KPIs, version-controlled SOPs, vendor + procurement, all tied to the people doing the work."
      pains={[
        "Each plant has its own KPI definitions, so cross-site comparisons are guesswork.",
        "Quality audits surface SOP drift you couldn't have detected.",
        "Procurement is a spreadsheet, an email, and a hope.",
        "Frontline supervisors don't have dashboards because the IT stack was built for the CFO.",
      ]}
      capabilities={[
        { icon: Factory,    title: "Per-shift dashboards",  body: "Per-shift, per-line, per-site KPI views. Supervisors see their floor; the C-suite sees the system." },
        { icon: Clipboard,  title: "ISO 9001 / 14001 SOPs",  body: "Forkable, audit-trailed SOP library. Sign-off, version history, compliance runs — built for audits." },
        { icon: Wrench,     title: "Maintenance + uptime",   body: "PM schedules tied to SOPs, downtime tracked as a KPI, root cause analysis with audit trail." },
        { icon: Truck,      title: "Vendor + procurement",   body: "Approval workflows, vendor scorecards, PO + GRN tracking. Tied to budget vs actual in real time." },
        { icon: Gauge,      title: "Multi-site rollup",      body: "Plant → region → enterprise. Drill any direction; compare any unit; calibrate KPIs at the apex." },
        { icon: ShieldCheck,title: "Safety + incidents",     body: "Incident reporting with SOP linkage. Near-misses tracked. Closure tied to specific actions and owners." },
      ]}
      kpis={["OEE", "Scrap %", "Downtime hours", "PM compliance", "Cycle time", "Vendor on-time rate", "Audit findings", "Safety incidents/M hrs"]}
      faq={[
        { q: "Mobile-ready for the shop floor?",          a: "Yes — PWA and native iOS/Android. Supervisors and line leads can update KPIs and complete SOP runs from a tablet on the floor." },
        { q: "Does it integrate with MES or ERP?",         a: "Yes — SAP, Oracle, NetSuite, Tally on Scale. Webhooks for any custom MES on Growth." },
        { q: "Offline support?",                            a: "Mobile app supports offline SOP runs and KPI entry; syncs when reconnected." },
      ]}
    />
  );
}
