import type { Metadata } from "next";

import {
  ModuleConnects,
  ModuleCta,
  ModuleDeepDive,
  ModuleFaq,
  ModuleHero,
  ModuleReplaces,
  ModuleStats,
  DashboardVisual,
  DataTableVisual,
} from "@/components/modules";
export const metadata: Metadata = {
  title: "Analytics — WorkwrK | SQL-friendly exports, not a static dashboard",
  description:
    "Every reading, every review, every kudos — queryable as rows. REST API, SQL schema, BI-ready. Your data, in your warehouse.",
  alternates: { canonical: "https://workwrk.com/features/analytics" },
};

export default function AnalyticsPage() {
  return (
    <>
      <ModuleHero
        eyebrow="Analytics · The warehouse layer"
        moduleNumber="10"
        iconKey="analytics"
        tone="amber"
        title={<>Your data, <span className="am">in SQL shape.</span></>}
        body="Every row of every module is exportable — via REST, a scheduled warehouse dump, or a live Postgres read replica. Your BI team doesn&apos;t have to screenshot dashboards. We hand them the schema."
        badges={["REST API", "SQL schema", "BI-ready", "Parquet exports", "Row-level RBAC"]}
        visual={
          <DataTableVisual
            title="Exports · last 7 days"
            meta="4 destinations · 214k rows · 0 failed jobs"
            tone="amber"
            rows={[
              { a: "kpi_readings", b: "→ Snowflake · 15m cadence", score: 100, delta: "14k rows", up: true },
              { a: "review_scores", b: "→ BigQuery · quarterly", score: 100, delta: "142 rows", up: true },
              { a: "sop_compliance", b: "→ S3 parquet · daily", score: 100, delta: "4.2k rows", up: true },
              { a: "kudos_feed", b: "→ Postgres replica · live", score: 100, delta: "streaming", up: true },
              { a: "audit_log", b: "→ signed S3 archive · hourly", score: 100, delta: "signed ✓", up: true },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Your warehouse"
        tone="amber"
        title={<>No &quot;export as CSV&quot; <span className="am">button farming.</span></>}
        body={
          <>
            <p>
              Every table in WorkwrK has a documented schema. Your data team gets
              read access to a Postgres replica, a scheduled Parquet dump to your
              S3, or a live webhook stream into Snowflake/BigQuery. Whatever your
              stack expects.
            </p>
            <p>
              Row-level RBAC carries across. Your BI user sees exactly what their
              app-side role says they should.
            </p>
          </>
        }
        bullets={[
          "Postgres read replica (Scale+)",
          "Parquet to S3 · daily or hourly",
          "Snowflake / BigQuery connectors",
          "REST API · rate-limited + signed",
          "GraphQL endpoint (experimental)",
          "Row-level RBAC preserved",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Tables exposed", stat: "62", delta: "across all modules · documented", tone: "amber" },
              { label: "API call budget", stat: "1M/day", delta: "Scale+ · 10M", tone: "lime" },
              { label: "Warehouse freshness", stat: "< 15m", delta: "lag from production · median", tone: "blue" },
            ]}
            footer="Docs — docs.workwrk.com/analytics"
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Pre-built dashboards"
        tone="blue"
        background="carded"
        title={<>Dashboards that <span className="hi">ship with the product.</span></>}
        body={
          <>
            <p>
              Ten ready-made dashboards — executive summary, sales health,
              engineering velocity, HR pulse, SOP compliance, calibration fairness,
              attrition risk, kudos distribution, cost-per-person, budget-vs-actual.
              Clone them, fork them, or export as Looker LookML.
            </p>
          </>
        }
        bullets={[
          "10 prebuilt dashboards",
          "Clone + fork per team",
          "Looker LookML export",
          "Metabase / Superset dashboards",
          "Scheduled PDF delivery · to board",
          "Embed in Notion / Confluence / Slab",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Exec summary", stat: "Live", delta: "revenue · attrition · velocity · NPS", tone: "blue" },
              { label: "Sales health", stat: "Live", delta: "pipeline · conversion · quota", tone: "lime" },
              { label: "Calibration fairness", stat: "Live", delta: "σ by manager · flagged anomalies", tone: "pink" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="Data, owned"
        title={<>Your numbers, <span className="hi">in your warehouse.</span></>}
        stats={[
          { stat: "62", label: "Tables exposed with documented schema · across modules", tone: "amber" },
          { stat: "< 15m", label: "Warehouse sync lag · median across customers", tone: "blue" },
          { stat: "10", label: "Dashboards ship with the product · clone / fork / export", tone: "lime" },
          { stat: "100%", label: "Row-level RBAC enforced across every export path", tone: "pink" },
        ]}
      />

      <ModuleConnects
        sourceName="Analytics"
        title={<>Reads from <span className="hi">every module.</span></>}
        subtitle="Analytics is a read-only shadow of the full spine — every table, every history, exportable."
        entries={[
          { name: "KPIs", flow: "Every reading, every target, every source · as rows.", href: "/features/kpis", iconKey: "kpi" },
          { name: "KRAs", flow: "KRA packages versioned · exportable for board audits.", href: "/features/kras", iconKey: "kra" },
          { name: "Reviews", flow: "Composite scores + calibration σ · queryable by cohort.", href: "/features/reviews", iconKey: "reviews" },
          { name: "People", flow: "Org graph snapshotted daily · longitudinal analysis.", href: "/features/people", iconKey: "people" },
          { name: "Analytics", flow: "Signed audit log of every read · for regulated environments.", href: "/features/analytics", iconKey: "analytics" },
          { name: "AI Engine", flow: "AI can write SQL against the schema · natural-language-to-query.", href: "/features/ai-engine", iconKey: "ai" },
        ]}
      />

      <ModuleReplaces
        title={<>What Analytics <span className="hi">replaces.</span></>}
        rows={[
          { old: "A ₹3L/mo BI tool sitting between your systems", nu: "Native SQL access to every WorkwrK table · included in Scale+" },
          { old: "Weekly CSV exports someone runs manually", nu: "Scheduled warehouse dumps · 15-minute freshness" },
          { old: "Looker dashboards disconnected from live data", nu: "Looker LookML exports synced with the schema" },
          { old: "'Can you pull these numbers for the board' tickets", nu: "Board dashboards auto-generated · scheduled PDF delivery" },
        ]}
      />

      <ModuleFaq
        title={<>Questions from <span className="hi">data teams.</span></>}
        items={[
          { q: "Can I run SQL directly?", a: <p>On Scale+, yes — via a read replica. Plans below get the REST API and scheduled warehouse dumps. A CLI (workwrk query) can hit the replica from terminal too.</p> },
          { q: "What's the REST API rate limit?", a: <p>Starter: 100 req/min. Growth: 1,000 req/min. Scale+: 10,000 req/min and bulk endpoints. All requests signed with your org key.</p> },
          { q: "Is there a semantic layer?", a: <p>We ship a Cube.js semantic layer config for the top 20 metrics (composite score, calibration σ, SOP compliance, etc.). Extendable or replaceable.</p> },
          { q: "Can I export to dbt?", a: <p>Yes. A dbt adapter for WorkwrK Postgres is published. Source freshness checks, tests, and incremental models all work.</p> },
        ]}
      />

      <ModuleCta
        tone="amber"
        title={<>Own your <em>numbers.</em></>}
        subtitle="Free trial includes REST access. Warehouse connectors on Growth and Scale+."
      />
    </>
  );
}
