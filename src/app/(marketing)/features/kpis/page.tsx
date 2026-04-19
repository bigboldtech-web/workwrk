import type { Metadata } from "next";

import {
  ModuleConnects,
  ModuleCta,
  ModuleDeepDive,
  ModuleFaq,
  ModuleHero,
  ModuleReplaces,
  ModuleStats,
  DataTableVisual,
  DashboardVisual,
} from "@/components/modules";
export const metadata: Metadata = {
  title: "KPIs — WorkwrK | Live per-role metrics that drive scoring",
  description:
    "Per-role KPIs with live targets. Readings pull from connected tools. Scores recalculate nightly and feed composite performance.",
  alternates: { canonical: "https://workwrk.com/features/kpis" },
};

export default function KpisPage() {
  return (
    <>
      <ModuleHero
        eyebrow="KPIs · Live per-role metrics"
        moduleNumber="02"
        iconKey="kpi"
        tone="lime"
        title={<>Numbers that <span className="hi">actually update.</span></>}
        body="Every KPI has a target, an owner, a source, and a cadence. Readings pull from your connected tools — not from a weekly Google Sheet someone forgets to update. When a KPI moves, the composite performance score moves with it, overnight."
        badges={["Live targets", "From connected tools", "Nightly recompute", "σ calibration", "Per-role templates"]}
        visual={
          <DataTableVisual
            title="Sales · weekly KPIs"
            meta="5 reps · 6 KPIs · auto-calc · 2m ago"
            tone="lime"
            rows={[
              { a: "Priya Sharma", b: "head of sales · L5", score: 92, delta: "+4", up: true },
              { a: "Amit Joshi", b: "account exec · L4", score: 87, delta: "+2", up: true },
              { a: "Ravi Kumar", b: "account exec · L4", score: 78, delta: "−5", up: false },
              { a: "Neha Mehta", b: "sdr · L3", score: 71, delta: "+1", up: true },
              { a: "Sanjay Rao", b: "sdr · L2", score: 45, delta: "−8", up: false },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Live readings"
        tone="lime"
        title={<>KPIs that <span className="hi">self-update.</span></>}
        body={
          <>
            <p>
              Pull SDR call volume from Aircall. Pipeline from HubSpot. GMV from
              Razorpay. Ticket SLA from Zendesk. You tell us the KPI and the source
              once — the reading keeps coming every 15 minutes.
            </p>
            <p>
              For KPIs without a source-of-truth tool, we offer a manual-entry
              workflow with nightly reminders. No KPI stays stale.
            </p>
          </>
        }
        bullets={[
          "40+ connectors (HubSpot, Razorpay, Linear...)",
          "Webhook ingest for anything else",
          "SQL-friendly schema · queryable live",
          "Manual entry with nightly reminders",
          "Anomaly alerts · σ thresholds",
          "Historical series · 5 years retention",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Active KPIs", stat: "86", delta: "across 18 roles", tone: "lime" },
              { label: "Connected sources", stat: "14", delta: "9 live · 5 manual", tone: "blue" },
              { label: "Stale readings", stat: "0", delta: "threshold breach rate", tone: "amber" },
            ]}
            footer="Last refresh · 2m 14s ago · next 13m"
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Role templates"
        tone="blue"
        background="carded"
        title={<>A KPI pack <span className="hi">for every role.</span></>}
        body={
          <>
            <p>
              Pre-built packs for 18 common SMB roles — SDR, AE, CSM, Engineer,
              Engineering Manager, Ops, HR, Founder. Start with the template, tune
              the targets to your company.
            </p>
            <p>
              Templates are based on actual KPI packs used by early-access customers. Not
              opinion-ware — benchmarks from the field.
            </p>
          </>
        }
        bullets={[
          "18 role templates · India-SMB tuned",
          "Median benchmarks from our customers",
          "Clone, edit, save as your pack",
          "Versioned · diff between revisions",
          "Auto-weight KPIs into composite",
          "Calibrated quarterly against peer mean",
        ]}
        visual={
          <DataTableVisual
            title="SDR · KPI pack"
            meta="6 KPIs · benchmarked to 214 SDRs"
            tone="blue"
            rows={[
              { a: "Outbound touches/wk", b: "target 480 · source Aircall", score: 96, delta: "+16", up: true },
              { a: "SAL → SQL conversion", b: "target 40% · source HubSpot", score: 84, delta: "+4", up: true },
              { a: "Opportunities sourced", b: "target ₹80L/qtr · source HS", score: 72, delta: "−6", up: false },
              { a: "Meeting show rate", b: "target 72% · source HS", score: 88, delta: "+2", up: true },
              { a: "NPS from accts", b: "target 8.5 · source survey", score: 91, delta: "+3", up: true },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="Measurement in practice"
        title={<>KPIs teams <span className="hi">actually trust.</span></>}
        stats={[
          { stat: "40+", label: "Native data connectors · Indian stack first", tone: "lime" },
          { stat: "15 min", label: "Standard refresh cadence · real-time on webhooks", tone: "blue" },
          { stat: "6×", label: "More KPIs tracked per role · vs spreadsheet teams", tone: "amber" },
          { stat: "0", label: "KPIs that stopped updating · across our customers", tone: "pink" },
        ]}
      />

      <ModuleConnects
        sourceName="KPIs"
        title={<>A KPI reading fans out <span className="hi">everywhere.</span></>}
        subtitle="A number changing isn't a local event — it propagates into scoring, reviews, and the AI engine."
        entries={[
          { name: "KRAs", flow: "KRAs bundle KPIs. Miss a KPI and its parent KRA lights up red.", href: "/features/kras", iconKey: "kra" },
          { name: "Reviews", flow: "Every review pre-fills with the quarter's KPI readings · no manual compilation.", href: "/features/reviews", iconKey: "reviews" },
          { name: "People", flow: "KPI history stays attached to the person across role changes.", href: "/features/people", iconKey: "people" },
          { name: "AI Engine", flow: "'Explain the KPI drop on Sanjay last week' · engine reads readings + events.", href: "/features/ai-engine", iconKey: "ai" },
          { name: "Analytics", flow: "Every reading is a row. SQL-friendly warehouse, BI-ready.", href: "/features/analytics", iconKey: "analytics" },
          { name: "KPIs", flow: "Composite KPIs roll up from child KPIs. Cascaded targets, cleanly.", href: "/features/kpis", iconKey: "kpi" },
        ]}
      />

      <ModuleReplaces
        title={<>What KPIs <span className="hi">replaces.</span></>}
        rows={[
          { old: "A weekly KPI deck someone builds every Monday", nu: "Live dashboards that refreshed 14 minutes ago" },
          { old: "Paying a BI vendor ₹3L/mo for stale dashboards", nu: "Connected KPIs on every role · no BI seat needed" },
          { old: "The founder's spreadsheet with 'actuals vs targets'", nu: "One table per role · live readings, live targets, live calc" },
          { old: "'Hey, can you update the numbers for the standup?'", nu: "Numbers are always current — standups skip the catch-up" },
        ]}
      />

      <ModuleFaq
        title={<>Questions about <span className="hi">measurement.</span></>}
        items={[
          { q: "What if we use a tool you don't have a native connector for?", a: <p>We ship webhooks and a REST API. Point your tool at our ingest endpoint with the KPI ID, and the reading shows up in seconds. For larger customers, we build native connectors in 2–4 weeks.</p> },
          { q: "Can we mix automatic and manual KPIs?", a: <p>Yes. Some KPIs (brand sentiment, team morale) don&apos;t have a source-of-truth tool. Those go on a manual-entry cadence — daily, weekly, or monthly — with nightly reminders to the owner.</p> },
          { q: "How do weighted composites work?", a: <p>Each role has a KPI weight vector (e.g. 40% pipeline, 30% conversion, 20% NPS, 10% SOP compliance). The composite score is the weighted sum, re-calibrated nightly against peer-role mean and σ.</p> },
          { q: "Do you handle seasonality?", a: <p>Yes. KPIs can have quarterly targets, seasonal curves, or rolling windows. We don&apos;t punish teams for a predictable Diwali dip.</p> },
        ]}
      />

      <ModuleCta
        tone="lime"
        title={<>Measure what <em>matters.</em></>}
        subtitle="14-day trial. Connect your first tool in under two minutes."
      />
    </>
  );
}
