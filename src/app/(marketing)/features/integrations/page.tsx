import type { Metadata } from "next";
import { Plug, Zap, Code, Webhook, RefreshCw, Database } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText, Section, Container, Eyebrow, H3 } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Integrations — WorkwrK",
  description: "Slack, Google Workspace, Microsoft 365, Stripe, Razorpay, QuickBooks, Salesforce, HubSpot, GitHub, Linear — and an API for everything else.",
  alternates: { canonical: "https://workwrk.com/features/integrations" },
};

const INTEGRATIONS = [
  { name: "Slack",            cat: "Comms" },
  { name: "Microsoft Teams",  cat: "Comms" },
  { name: "Google Workspace", cat: "Identity" },
  { name: "Microsoft 365",    cat: "Identity" },
  { name: "Okta",             cat: "SSO" },
  { name: "Azure AD",         cat: "SSO" },
  { name: "Stripe",           cat: "Money" },
  { name: "Razorpay",         cat: "Money" },
  { name: "QuickBooks",       cat: "Money" },
  { name: "Xero",             cat: "Money" },
  { name: "HubSpot",          cat: "Growth" },
  { name: "Salesforce",       cat: "Growth" },
  { name: "Pipedrive",        cat: "Growth" },
  { name: "GitHub",           cat: "Engineering" },
  { name: "Linear",           cat: "Engineering" },
  { name: "Jira",             cat: "Engineering" },
  { name: "Notion",           cat: "Docs" },
  { name: "Confluence",       cat: "Docs" },
  { name: "Zapier",           cat: "Automation" },
  { name: "Make",             cat: "Automation" },
  { name: "Snowflake",        cat: "Warehouse" },
  { name: "BigQuery",         cat: "Warehouse" },
];

export default function IntegrationsFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="money"
      hue="emerald"
      eyebrow="Money hub · Integrations"
      title={<>Connects to <GradientText hue="emerald">everything you run.</GradientText></>}
      lede="22+ native integrations. Webhook events for every entity. A full REST + GraphQL API. Plus Zapier and Make for the long tail."
      capabilities={[
        { icon: Plug,      title: "Native integrations",   body: "Two-way sync with the tools you already pay for. Slack, Google, Microsoft, HubSpot, Stripe, more." },
        { icon: Webhook,   title: "Webhooks on everything",body: "Every entity emits events on create / update / delete. Subscribe; route; transform; act." },
        { icon: Code,      title: "REST + GraphQL API",    body: "Same data model the product uses. Type-safe SDKs in TypeScript, Python, Go." },
        { icon: Zap,       title: "Zapier + Make",         body: "5,000+ apps reachable via the no-code automators. Triggers + actions for every hub." },
        { icon: RefreshCw, title: "Two-way sync",          body: "Changes flow both ways. People in BambooHR → roles in workwrk. Deals in HubSpot → revenue KPIs." },
        { icon: Database,  title: "Data warehouse",        body: "Snowflake, BigQuery, Redshift mirroring. Read-only on Growth; bi-directional on Scale." },
      ]}
      relatedSlugs={["ai-engine", "analytics", "access"]}
      faq={[
        { q: "Can I request a new integration?",        a: "Yes — most-requested ship within the quarter. Customer-funded custom integrations available as a Scale add-on." },
        { q: "Do I need engineers to set this up?",       a: "No. Most native integrations are click-to-connect. Webhooks and API are for engineers; everything else is no-code." },
        { q: "How does conflict resolution work?",        a: "Field-level last-write-wins by default; configurable to source-of-truth-wins or merge-on-conflict per integration." },
      ]}
      bottomSlot={
        <Section variant="tint" py="lg">
          <Container>
            <div className="max-w-2xl mb-10">
              <Eyebrow hue="emerald" className="mb-4">The directory</Eyebrow>
              <H3>22+ native integrations and counting.</H3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {INTEGRATIONS.map((i) => (
                <div key={i.name} className="p-4 bg-white border border-slate-200 rounded-xl text-center">
                  <p className="font-bold text-slate-900 text-sm">{i.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 mt-1">{i.cat}</p>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      }
    />
  );
}
