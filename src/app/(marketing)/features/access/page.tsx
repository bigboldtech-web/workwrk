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
  title: "Access — WorkwrK | Field-level RBAC with signed audit trail",
  description:
    "Role-based access control that follows the org graph. Field-level policies, signed audit events, SSO / SAML, GDPR- and DPDPA-ready.",
  alternates: { canonical: "https://workwrk.com/features/access" },
};

export default function AccessPage() {
  return (
    <>
      <ModuleHero
        eyebrow="Access · RBAC + audit"
        moduleNumber="12"
        iconKey="access"
        tone="pink"
        title={<>Who sees what, <span className="pk">by design.</span></>}
        body="Field-level RBAC that follows the org graph — not per-user checkbox hell. Every read and write is signed, stored, and exportable. GDPR + DPDPA right-to-erasure one-click. SSO on Scale+. Built assuming auditors will come."
        badges={["Field-level RBAC", "Signed audit", "SSO / SAML", "DPDPA / GDPR", "SOC 2 type II"]}
        visual={
          <DataTableVisual
            title="RBAC · live policies"
            meta="24 policies · 6 roles × 4 scopes · audited"
            tone="pink"
            rows={[
              { a: "Salary band", b: "CEO + HR · read only", score: 100, delta: "signed ✓", up: true },
              { a: "Review scores", b: "Reporting chain · + HR", score: 100, delta: "signed ✓", up: true },
              { a: "Kudos feed", b: "Org-wide · read", score: 100, delta: "signed ✓", up: true },
              { a: "KPI raw readings", b: "Role + manager · read", score: 100, delta: "signed ✓", up: true },
              { a: "SOP drafts", b: "Owner + reviewer · write", score: 100, delta: "signed ✓", up: true },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Policies on roles, not users"
        tone="pink"
        title={<>Give access to <span className="pk">a role · not a person.</span></>}
        body={
          <>
            <p>
              The &quot;Head of Sales&quot; role has specific read/write scopes. When Priya is
              that person, she has them. Promote someone else in her place — they
              inherit automatically, and Priya&apos;s scopes drop. No more &quot;did we
              remove X&apos;s access&quot; discussions.
            </p>
            <p>
              Policies are declarative and version-controlled — you can see the
              diff between today&apos;s policies and last quarter&apos;s.
            </p>
          </>
        }
        bullets={[
          "Roles, not users, own policies",
          "Versioned policy set · diff view",
          "Field-level granularity (salary, PII)",
          "Declarative · infra-as-code friendly",
          "Export as YAML for git storage",
          "Kill-switch per role · emergency use",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Active policies", stat: "24", delta: "6 roles × 4 scopes", tone: "pink" },
              { label: "Time-to-revoke on exit", stat: "< 60s", delta: "median · cryptographically signed", tone: "lime" },
              { label: "Policy changes this quarter", stat: "7", delta: "all sign-off + diff reviewed", tone: "blue" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Signed audit"
        tone="blue"
        background="carded"
        title={<>Every read, every write, <span className="hi">cryptographically signed.</span></>}
        body={
          <>
            <p>
              Access logs are signed with your org&apos;s key — not ours. Meaning if an
              auditor or regulator asks for proof that a record wasn&apos;t tampered,
              you can show them and they can verify outside our infrastructure.
              Built with DPDPA + SOC 2 + ISO 27001 in mind.
            </p>
          </>
        }
        bullets={[
          "HMAC-SHA256 per event",
          "Cryptographic hash chain · tamper-evident",
          "Signed with your org key · verify offline",
          "5 year retention (configurable)",
          "One-click DPDPA export / erasure",
          "Exportable to SIEM (Splunk, Datadog)",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Audit events · 30d", stat: "412k", delta: "all signed · chain-verified", tone: "blue" },
              { label: "DPDPA requests handled", stat: "8", delta: "median response 4h", tone: "lime" },
              { label: "SOC 2 control status", stat: "100%", delta: "of 68 controls · green", tone: "amber" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="Security by default"
        title={<>Audit-ready from <span className="hi">day one.</span></>}
        stats={[
          { stat: "SOC 2", label: "Type II · annual · report available under NDA", tone: "pink" },
          { stat: "DPDPA", label: "Compliant from day one · with signed export / erasure", tone: "lime" },
          { stat: "< 60s", label: "Median time-to-revoke on exit · org-wide", tone: "blue" },
          { stat: "100%", label: "Of access events · cryptographically signed", tone: "amber" },
        ]}
      />

      <ModuleConnects
        sourceName="Access"
        title={<>Access is a <span className="hi">cross-cutting concern.</span></>}
        subtitle="Every module reads and writes — every one of those events is subject to policy and produces a signed audit row."
        entries={[
          { name: "People", flow: "Lifecycle events (hire, promote, exit) fire policy updates automatically.", href: "/features/people", iconKey: "people" },
          { name: "SOPs", flow: "SOP readership limited by role · sensitive SOPs to specific roles only.", href: "/features/sops", iconKey: "sop" },
          { name: "Analytics", flow: "Row-level RBAC preserved in every warehouse export.", href: "/features/analytics", iconKey: "analytics" },
          { name: "AI Engine", flow: "AI only reads what the prompter&apos;s role can read · no leakage.", href: "/features/ai-engine", iconKey: "ai" },
          { name: "Integrations", flow: "OAuth scopes mapped to internal RBAC · tokens least-privilege.", href: "/features/integrations", iconKey: "integrations" },
          { name: "Access", flow: "Policies themselves versioned · every change is an audited write.", href: "/features/access", iconKey: "access" },
        ]}
      />

      <ModuleReplaces
        title={<>What Access <span className="hi">replaces.</span></>}
        rows={[
          { old: "Per-user permission checkboxes that drift over time", nu: "Role-based policies that follow the org graph automatically" },
          { old: "Shared admin credentials for sensitive tools", nu: "SSO / SAML + field-level RBAC scoped to role" },
          { old: "SOC 2 preparation fire-drills every year", nu: "Controls always-on · signed audit log exportable any time" },
          { old: "DPDPA export requests handled by SQL and prayer", nu: "One-click per-user export / erasure · signed receipts" },
        ]}
      />

      <ModuleFaq
        title={<>Questions from <span className="hi">security + legal.</span></>}
        items={[
          { q: "Is SSO / SAML included?", a: <p>Google SSO is included on all plans. SAML (Okta, Azure AD, OneLogin) is included on Scale+. SCIM provisioning on Scale+.</p> },
          { q: "Where does data live?", a: <p>Default India (Mumbai · AWS ap-south-1). Singapore (Scale+), your VPC (Enterprise). Configurable per customer. Cross-border replication off unless you explicitly opt in.</p> },
          { q: "DPDPA compliance — what exactly?", a: <p>One-click export and erasure per user with signed receipts for the regulator. Consent management for AI Engine prompts. Data residency controls. Data Protection Officer contact exposed. Full DPIA template on request.</p> },
          { q: "Can you run on-prem?", a: <p>Yes — Enterprise tier. We deploy into your VPC (AWS, GCP, or Azure) with your own Postgres. Upgrade path from cloud-hosted is supported.</p> },
          { q: "SOC 2 report?", a: <p>Type II available under NDA. Annual attestation. Sub-processor list is published. Contact security@workwrk.com.</p> },
        ]}
      />

      <ModuleCta
        tone="pink"
        title={<>Security that <em>ships.</em></>}
        subtitle="14-day free trial · SOC 2 controls active from day one · no config required."
      />
    </>
  );
}
