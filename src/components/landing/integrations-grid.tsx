// Integrations grid — shows the breadth of connectors.
//
// Header on the left, a 4-column grid of integration cards on the
// right. Two infinite-scroll marquee rows above the grid for a fast
// "we connect to everything" hit, and a categorized grid below for
// the searchable look. Each integration card uses the real brand logo
// (served from simpleicons.org) in the brand color.

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

interface Integration {
  name: string;
  category: "Comms" | "Identity" | "Money" | "Growth" | "Engineering" | "Docs" | "Auto" | "Warehouse";
  hue: string;
  // simpleicons.org slug. If null, fall back to letter swatch.
  slug: string | null;
}

const INTEGRATIONS: readonly Integration[] = [
  // Comms
  { name: "Slack",            category: "Comms",       hue: "#4A154B", slug: "slack" },
  { name: "Microsoft Teams",  category: "Comms",       hue: "#5059C9", slug: "microsoftteams" },
  { name: "Zoom",             category: "Comms",       hue: "#2D8CFF", slug: "zoom" },
  { name: "Gmail",            category: "Comms",       hue: "#EA4335", slug: "gmail" },
  // Identity
  { name: "Okta",             category: "Identity",    hue: "#007DC1", slug: "okta" },
  { name: "Google Workspace", category: "Identity",    hue: "#4285F4", slug: "google" },
  { name: "Microsoft 365",    category: "Identity",    hue: "#D83B01", slug: "microsoft" },
  { name: "Azure AD",         category: "Identity",    hue: "#0078D4", slug: "microsoftazure" },
  // Money
  { name: "Stripe",           category: "Money",       hue: "#635BFF", slug: "stripe" },
  { name: "Razorpay",         category: "Money",       hue: "#0C2451", slug: "razorpay" },
  { name: "QuickBooks",       category: "Money",       hue: "#2CA01C", slug: "quickbooks" },
  { name: "Xero",             category: "Money",       hue: "#13B5EA", slug: "xero" },
  // Growth
  { name: "HubSpot",          category: "Growth",      hue: "#FF7A59", slug: "hubspot" },
  { name: "Salesforce",       category: "Growth",      hue: "#00A1E0", slug: "salesforce" },
  { name: "Pipedrive",        category: "Growth",      hue: "#0E1620", slug: "pipedrive" },
  { name: "Intercom",         category: "Growth",      hue: "#1F8DED", slug: "intercom" },
  // Engineering
  { name: "GitHub",           category: "Engineering", hue: "#181717", slug: "github" },
  { name: "Linear",           category: "Engineering", hue: "#5E6AD2", slug: "linear" },
  { name: "Jira",             category: "Engineering", hue: "#0052CC", slug: "jira" },
  { name: "GitLab",           category: "Engineering", hue: "#FC6D26", slug: "gitlab" },
  // Docs
  { name: "Notion",           category: "Docs",        hue: "#000000", slug: "notion" },
  { name: "Confluence",       category: "Docs",        hue: "#172B4D", slug: "confluence" },
  // Auto
  { name: "Zapier",           category: "Auto",        hue: "#FF4A00", slug: "zapier" },
  { name: "Make",             category: "Auto",        hue: "#6D00CC", slug: "make" },
  // Warehouse
  { name: "Snowflake",        category: "Warehouse",   hue: "#29B5E8", slug: "snowflake" },
  { name: "BigQuery",         category: "Warehouse",   hue: "#4285F4", slug: "googlebigquery" },
];

const CATEGORY_LABELS: Record<Integration["category"], string> = {
  Comms:       "Communication",
  Identity:    "Identity + SSO",
  Money:       "Money + Billing",
  Growth:      "Growth + CRM",
  Engineering: "Engineering",
  Docs:        "Docs + Knowledge",
  Auto:        "Automation",
  Warehouse:   "Data Warehouse",
};

export function IntegrationsGrid() {
  return (
    <section className="relative overflow-hidden bg-white py-24 lg:py-32">
      <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
        {/* Header */}
        <motion.div
          className="max-w-3xl"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p
            className="text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "var(--brand-red)" }}
          >
            Integrations
          </p>
          <h2
            className="mt-5 font-extrabold tracking-[-0.03em]"
            style={{
              color: "var(--m-text)",
              fontSize: "clamp(2rem, 4vw, 3.4rem)",
              lineHeight: 1.04,
            }}
          >
            Connects to{" "}
            <span style={{ color: "var(--brand-red)" }}>everything</span>{" "}
            you already pay for.
          </h2>
          <p
            className="mt-5 text-base lg:text-lg leading-relaxed max-w-2xl"
            style={{ color: "var(--m-text-muted)" }}
          >
            26+ native connectors. Webhooks on every entity. A REST +
            GraphQL API. Two-way sync with the tools your team already
            lives in &mdash; no swap-everything migration required.
          </p>
        </motion.div>

        {/* Marquee row */}
        <div className="mt-12 lg:mt-14 relative">
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-28 z-10"
            style={{ background: "linear-gradient(to right, white, transparent)" }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-28 z-10"
            style={{ background: "linear-gradient(to left, white, transparent)" }}
          />
          <div className="overflow-hidden">
            <motion.div
              className="flex gap-3 w-max"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ x: { duration: 50, ease: "linear", repeat: Infinity } }}
            >
              {[...INTEGRATIONS, ...INTEGRATIONS].map((it, i) => (
                <IntegrationChip key={`m-${i}`} integration={it} />
              ))}
            </motion.div>
          </div>
        </div>

        {/* Categorized grid */}
        <motion.div
          className="mt-12 lg:mt-14"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <p
            className="text-[10.5px] font-bold uppercase tracking-[0.22em] mb-5"
            style={{ color: "var(--m-text-soft)" }}
          >
            Browse by category
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {INTEGRATIONS.map((it, i) => (
              <IntegrationCard key={it.name} integration={it} delay={i * 0.02} />
            ))}
          </div>
        </motion.div>

        {/* Trademark disclaimer */}
        <p
          className="mt-10 text-[11px] leading-relaxed max-w-3xl"
          style={{ color: "var(--m-text-soft)" }}
        >
          All third-party product names, logos, and brands are property
          of their respective owners. Use of these names, logos, and
          brands does not imply endorsement.
        </p>
      </div>
    </section>
  );
}

// ── Brand logo (with letter fallback) ───────────────────────────────

function BrandLogo({
  integration,
  size,
}: {
  integration: Integration;
  size: number;
}) {
  const [errored, setErrored] = useState(false);

  if (integration.slug && !errored) {
    const color = integration.hue.replace("#", "");
    return (
      <span
        className="rounded-md flex items-center justify-center flex-shrink-0 bg-white"
        style={{
          width: size,
          height: size,
          border: "1px solid var(--m-border)",
          padding: size * 0.18,
        }}
      >
        <img
          src={`https://cdn.simpleicons.org/${integration.slug}/${color}`}
          alt={`${integration.name} logo`}
          width={size * 0.64}
          height={size * 0.64}
          loading="lazy"
          onError={() => setErrored(true)}
          style={{ display: "block" }}
        />
      </span>
    );
  }

  // Fallback: colored square with first letter
  return (
    <span
      className="rounded-md flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{
        backgroundColor: integration.hue,
        width: size,
        height: size,
        fontSize: size * 0.44,
      }}
    >
      {integration.name[0]}
    </span>
  );
}

// ── Marquee chip ─────────────────────────────────────────────────────

function IntegrationChip({ integration }: { integration: Integration }) {
  return (
    <div
      className="inline-flex items-center gap-2.5 pl-2 pr-4 h-12 rounded-full whitespace-nowrap"
      style={{
        backgroundColor: "white",
        border: "1px solid var(--m-border)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <BrandLogo integration={integration} size={32} />
      <span
        className="text-[12.5px] font-bold"
        style={{ color: "var(--m-text)", fontVariant: "small-caps", letterSpacing: "0.02em" }}
      >
        {integration.name}
      </span>
    </div>
  );
}

// ── Category grid card ──────────────────────────────────────────────

function IntegrationCard({ integration, delay }: { integration: Integration; delay: number }) {
  return (
    <motion.div
      className="group flex items-center gap-3 px-3.5 py-3 rounded-xl bg-white transition-all"
      style={{
        border: "1px solid var(--m-border)",
      }}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2, boxShadow: "0 8px 22px -8px rgba(15,23,42,0.12)" }}
    >
      <BrandLogo integration={integration} size={32} />
      <div className="min-w-0 flex-1">
        <p
          className="text-[12.5px] font-bold truncate"
          style={{ color: "var(--m-text)", fontVariant: "small-caps", letterSpacing: "0.02em" }}
        >
          {integration.name}
        </p>
        <p className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>
          {CATEGORY_LABELS[integration.category]}
        </p>
      </div>
      <ArrowRight
        size={13}
        className="opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
        style={{ color: "var(--m-text-soft)" }}
      />
    </motion.div>
  );
}
