import type { Metadata } from "next";

import {
  ModuleConnects,
  ModuleCta,
  ModuleDeepDive,
  ModuleFaq,
  ModuleHero,
  ModuleReplaces,
  ModuleStats,
  IntegrationGridVisual,
  DashboardVisual,
} from "@/components/modules";
export const metadata: Metadata = {
  title: "Integrations — WorkwrK | Native connectors, Indian stack first",
  description:
    "Slack, Gmail, Drive, Linear, Razorpay, Keka, GreytHR, HubSpot, Zendesk. Native connectors for the tools Indian SMBs actually run on.",
  alternates: { canonical: "https://workwrk.com/features/integrations" },
};

export default function IntegrationsPage() {
  return (
    <>
      <ModuleHero
        eyebrow="Integrations · live today + shipping monthly"
        moduleNumber="11"
        iconKey="integrations"
        tone="blue"
        title={<>We talk to the tools <span className="bl">your team already runs.</span></>}
        body='Claude AI Engine, Slack webhooks, Google sign-in and Stripe billing are all live today. HubSpot, Razorpay, Keka and GreytHR are in active build with a new connector each release. Public webhooks + REST API for anything we haven’t got to yet — so you are never blocked waiting.'
        badges={["Claude · live", "Slack · live", "Google SSO · live", "Stripe · live", "Monthly releases"]}
        visual={
          <IntegrationGridVisual
            integrations={[
              { name: "Claude API", group: "AI Engine · live", color: "#d97757", status: "live" },
              { name: "Slack Webhooks", group: "Kudos + signal alerts · live", color: "#611f69", status: "live" },
              { name: "Google OAuth", group: "SSO sign-in · live", color: "#4285f4", status: "live" },
              { name: "Stripe", group: "Billing + subscriptions · live", color: "#635bff", status: "live" },
              { name: "HubSpot", group: "Sales KPIs", color: "#ff7a59", status: "soon" },
              { name: "Razorpay", group: "Revenue + payroll", color: "#2c5fe8", status: "soon" },
              { name: "Keka", group: "HR payroll sync", color: "#00b8a9", status: "soon" },
              { name: "GreytHR", group: "HR payroll sync", color: "#ff9933", status: "soon" },
              { name: "Linear", group: "Engineering tasks", color: "#5e6ad2", status: "soon" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Indian stack first"
        tone="blue"
        title={<>Built for the tools <span className="bl">Indian SMBs actually use.</span></>}
        body={
          <>
            <p>
              Most SaaS integrations treat India as an after-thought. We don&apos;t.
              Razorpay payments, Keka HR, GreytHR payroll, TallyPrime, ZohoOne,
              Exotel call logs, Aircall — these are first-class. Built and
              maintained by our team.
            </p>
            <p>
              Global tools too — Slack, Google, HubSpot, Linear, Zendesk, Claude,
              Notion, Figma, GitHub, Jira. The ones your team spends their day in.
            </p>
          </>
        }
        bullets={[
          "Razorpay · Keka · GreytHR · Tally · Zoho",
          "Slack · Google · HubSpot · Linear",
          "Zendesk · Freshdesk · Intercom",
          "Aircall · Exotel · Salesforce",
          "GitHub · Jira · Notion · Figma",
          "Webhooks + REST for the rest",
        ]}
        visual={
          <IntegrationGridVisual
            integrations={[
              { name: "TallyPrime", group: "Accounting sync", color: "#ff3d8a", status: "soon" },
              { name: "ZohoOne", group: "CRM + desk", color: "#c8202f", status: "soon" },
              { name: "Freshdesk", group: "Support SLAs", color: "#25c16f", status: "soon" },
              { name: "Exotel", group: "Call KPIs", color: "#e74c3c", status: "soon" },
              { name: "Aircall", group: "SDR volume", color: "#00b8d9", status: "soon" },
              { name: "GitHub", group: "Eng velocity", color: "#d4ff2e", status: "soon" },
              { name: "Jira", group: "Cross-team tasks", color: "#0052cc", status: "soon" },
              { name: "Notion", group: "SOP import", color: "#ededed", status: "soon" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Build your own"
        tone="lime"
        background="carded"
        title={<>Public API + webhooks <span className="hi">for anything else.</span></>}
        body={
          <>
            <p>
              If there&apos;s no native connector, webhook events cover 80% of use cases
              — KPI readings, new kudos, SOP publish, review submitted, task
              assigned. And a public REST API covers the rest. OAuth 2.0 for
              third-party apps.
            </p>
          </>
        }
        bullets={[
          "40+ webhook events · signed payloads",
          "REST API · 1M req/day on Growth",
          "OAuth 2.0 · build your own app",
          "Official SDKs · Node, Python, Go",
          "Developer console · org.workwrk.com/dev",
          "Zapier + Make.com (for light workflows)",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Endpoints live", stat: "REST", delta: "signed payloads · HMAC-SHA256", tone: "lime" },
              { label: "SDKs", stat: "3", delta: "Node · Python · Go · published", tone: "blue" },
              { label: "Custom webhook", stat: "< 2d", delta: "median eng-team integration time", tone: "amber" },
            ]}
            footer="Developer docs — docs.workwrk.com/api"
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="Integrations by the numbers"
        title={<>Connected is <span className="hi">the default.</span></>}
        stats={[
          { stat: "Monthly", label: "Cadence · a new native connector every release", tone: "blue" },
          { stat: "7 min", label: "Median time to connect first tool · Slack + Google", tone: "lime" },
          { stat: "Public", label: "REST + webhooks live today · SDK in Node, Python, Go", tone: "amber" },
          { stat: "0", label: "Zapier required for the core flow · just available if wanted", tone: "pink" },
        ]}
      />

      <ModuleConnects
        sourceName="Integrations"
        title={<>Every module <span className="hi">uses the connectors.</span></>}
        subtitle="Connectors aren't a separate product — they're how every module in the spine gets its live data."
        entries={[
          { name: "KPIs", flow: "Readings pulled from HubSpot, Razorpay, Zendesk, Linear — every 15 min.", href: "/features/kpis", iconKey: "kpi" },
          { name: "People", flow: "Org graph bulk-imports from Google Workspace · payroll sync with Keka.", href: "/features/people", iconKey: "people" },
          { name: "SOPs", flow: "Import Notion / Drive SOPs in one click · AI classifies each.", href: "/features/sops", iconKey: "sop" },
          { name: "Reviews", flow: "Slack integration · review reminders + pre-fill notifications.", href: "/features/reviews", iconKey: "reviews" },
          { name: "Access", flow: "SSO / SAML · Okta, Azure AD, Google SSO · on Scale+.", href: "/features/access", iconKey: "access" },
          { name: "Analytics", flow: "Snowflake + BigQuery native exports · 15-minute freshness.", href: "/features/analytics", iconKey: "analytics" },
        ]}
      />

      <ModuleReplaces
        title={<>What Integrations <span className="hi">replaces.</span></>}
        rows={[
          { old: "Zapier plumbing between 8 tools · monthly bills + failed zaps", nu: "Native connectors — built, tested, maintained by us" },
          { old: "'Export this CSV, upload to that tool' Monday chores", nu: "Live sync · 15-minute cadence · automated" },
          { old: "Paying a fractional integrations engineer to maintain it", nu: "Zero maintenance — we ship updates when vendor APIs change" },
          { old: "Integration tools that assume US-first tech stack", nu: "Razorpay / Keka / GreytHR / Tally native — Indian stack first" },
        ]}
      />

      <ModuleFaq
        title={<>Questions about <span className="hi">connectivity.</span></>}
        items={[
          { q: "What if my tool isn't on the list?", a: <p>Webhooks + REST API cover 90% of use cases in a day of work. For deeper, native integrations, we build one every 2–4 weeks — bumped up for Scale+ customers on request.</p> },
          { q: "How do OAuth disconnections work?", a: <p>If a token expires (user rotates password, revokes access), the integration pauses gracefully — no data loss — and the admin gets a Slack ping to re-auth. Failed pulls are not re-attempted blindly.</p> },
          { q: "Are webhook payloads signed?", a: <p>Yes. Every payload carries an HMAC-SHA256 signature using your org secret. Docs cover the verification snippet for Node, Python, Go.</p> },
          { q: "Can integrations write back?", a: <p>Yes, but scoped. Slack posts kudos + digests. Linear creates tasks from KR drift. HubSpot gets KPI reading push-backs. All writes are explicitly opt-in per integration.</p> },
          { q: "Data residency on third-party APIs?", a: <p>We never relay your data through our servers unless necessary. Most integrations run on your VPC (Scale+) so the data never leaves your boundary.</p> },
        ]}
      />

      <ModuleCta
        tone="blue"
        title={<>Plug in your <em>stack.</em></>}
        subtitle="Free trial · Slack + Google take under seven minutes total."
      />
    </>
  );
}
