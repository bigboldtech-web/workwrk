import type { Metadata } from "next";

import { IndustryPage } from "@/components/modules";
import type { IndustryConfig } from "@/components/modules";
export const metadata: Metadata = {
  title: "WorkwrK for Logistics — SOPs, compliance, multi-warehouse clarity",
  description:
    "Versioned SOPs across warehouses. Nightly compliance checks. Multi-location visibility. Built for Indian logistics and warehousing SMBs.",
  alternates: { canonical: "https://workwrk.com/industries/logistics" },
};

const config: IndustryConfig = {
  eyebrow: "Logistics · Warehousing · Fulfilment",
  name: "Logistics",
  tone: "lime",
  headline: <>Twelve warehouses, <span className="hi">one playbook.</span></>,
  body: "Every warehouse, every shift, every worker — on the same SOPs. Compliance tracked nightly. Drift flagged before it becomes a stockout or a misrouted shipment. Multi-location visibility without flying team leads across cities.",
  pains: [
    { title: "Each warehouse runs its own version of the SOP", body: "Mumbai does it one way, Bengaluru another, Hyderabad a third. The HQ thinks there's one way. There are twelve." },
    { title: "Compliance checks are ad-hoc audits", body: "Regional manager drops in, spots 3 deviations, writes a report, forgets it by next month. No continuous feedback." },
    { title: "Shift handovers lose context", body: "Morning shift flags a damaged-goods issue to evening shift by WhatsApp voice note. Night shift never heard. Issue repeats, now with a customer complaint attached." },
    { title: "Contract driver + permanent staff confusion", body: "Different access, different training, different pay cycles. Manual tracking in a spreadsheet leads to either over-paying or under-communicating." },
    { title: "Throughput measured, not quality", body: "We track packages moved per hour. We don't track damage rate, picking accuracy, or returns-caused-by-warehouse. Growth happens with hidden cost." },
    { title: "Safety incidents aggregate slowly", body: "A cut hand here, a forklift near-miss there. By the time HR aggregates, six months have passed and the pattern — same station, same shift — is already a habit." },
  ],
  fit: [
    {
      eyebrow: "One SOP, many warehouses",
      tone: "lime",
      title: <>Same playbook, <span className="hi">every location.</span></>,
      body: <><p>Write the SOP once. Publish to all warehouses. Version history per warehouse if regional variations exist (different customs for North vs South India, port-vs-road procedures). Compliance tracked per warehouse, per shift.</p></>,
      bullets: [
        "Global SOP + per-warehouse overlay",
        "Tablet mode · offline-tolerant",
        "Read-receipts per worker · per version",
        "Picking / packing / dispatch SOPs",
        "Shift handover structured template",
        "Damage / returns workflow",
      ],
    },
    {
      eyebrow: "KPIs beyond throughput",
      tone: "amber",
      title: <>Volume <span className="am">and</span> quality.</>,
      body: <><p>Track picking accuracy, damage rate, returns-caused-by-warehouse, dispatch SLA, inventory shrinkage. Alongside packages-per-hour, not instead of. Get honest warehouse-level scorecards.</p></>,
      bullets: [
        "Picking accuracy + damage rate",
        "Returns-caused-by-warehouse tracked",
        "Dispatch SLA compliance %",
        "Inventory shrinkage trend",
        "Per-station heatmaps",
        "Multi-warehouse leaderboard",
      ],
    },
    {
      eyebrow: "Incidents + safety",
      tone: "pink",
      title: <>Small signals, <span className="pk">caught early.</span></>,
      body: <><p>Near-miss reports take 30 seconds on a shop-floor tablet. Incidents cluster on dashboards — same station, same shift, same SOP step? The system flags before it becomes a pattern you can't ignore.</p></>,
      bullets: [
        "Near-miss + incident (30s log)",
        "Cluster detection across warehouses",
        "5-Why template inline",
        "Root-cause task with SLA",
        "Safety trend leaderboard",
        "Quarterly safety audit export",
      ],
    },
  ],
  stats: [
    { stat: "95%", label: "Cross-warehouse SOP compliance · adopted teams", tone: "lime" },
    { stat: "−28%", label: "Damage rate · in year one of adoption", tone: "pink" },
    { stat: "12", label: "Warehouses aligned under one spine · reference customer", tone: "amber" },
    { stat: "2 days", label: "Regional-ops review cycle · down from 10 days", tone: "blue" },
  ],
  relevantModules: [
    { name: "SOPs", href: "/features/sops", flow: "Multi-warehouse versioned SOPs with per-location overlays.", iconKey: "sop" },
    { name: "People", href: "/features/people", flow: "Permanent + contract + driver roles · multi-warehouse graph.", iconKey: "people" },
    { name: "KPIs", href: "/features/kpis", flow: "Throughput, accuracy, damage, shrinkage · live per warehouse.", iconKey: "kpi" },
    { name: "Tasks", href: "/features/tasks", flow: "Incidents auto-spawn investigation with SLA + owner.", iconKey: "tasks" },
    { name: "Reviews", href: "/features/reviews", flow: "Warehouse-manager review cycles · cross-location calibration.", iconKey: "reviews" },
    { name: "OKRs", href: "/features/okrs", flow: "Regional OKRs cascaded · weekly read-outs by city.", iconKey: "okr" },
    { name: "Access", href: "/features/access", flow: "Per-location RBAC · contractor scopes · audit trail.", iconKey: "access" },
  ],
  faq: [
    { q: "Does it work without reliable internet?", a: <p>Yes. Tablet mode caches SOPs, incidents, and read-receipts locally. Syncs when connectivity returns. Designed for warehouses in industrial zones where WiFi can be shaky.</p> },
    { q: "Can we integrate with our WMS (warehouse management system)?", a: <p>Yes. We integrate with Unicommerce, ClickPost, ShipRocket, and have a REST API for anything else. WMS provides the operational layer; WorkwrK provides the people + process layer on top.</p> },
    { q: "How do we handle regional variation without diverging?", a: <p>Global SOP is the source of truth. Regional overlays capture legitimate variation (customs docs, regional carrier practices). System detects drift between regions and flags unexpected divergence for review.</p> },
    { q: "Contract driver performance — can we track that?", a: <p>Yes. Drivers can have their own role type with KPIs tied to on-time delivery, fuel efficiency, customer feedback, and safety compliance. Payroll integration (Keka, GreytHR) handles variable pay.</p> },
    { q: "Is it audit-ready for customs / GST / DPIIT?", a: <p>Yes. Every read/write is signed and logged. Export of SOP compliance per warehouse per period is one click. For customs broker audits, the SOP trail is particularly clean.</p> },
  ],
};

export default function LogisticsIndustryPage() {
  return <IndustryPage c={config} />;
}
