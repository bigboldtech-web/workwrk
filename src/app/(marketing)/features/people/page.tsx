import type { Metadata } from "next";

import {
  ModuleAnchorNav,
  ModuleConnects,
  ModuleCta,
  ModuleDeepDive,
  ModuleFaq,
  ModuleHero,
  ModuleReplaces,
  ModuleStats,
  OrgTreeVisual,
  DashboardVisual,
  TimelineVisual,
} from "@/components/modules";
export const metadata: Metadata = {
  title: "People — WorkwrK | The org graph, not a spreadsheet",
  description:
    "Canonical people data — roles, reporting lines, ramp plans, access, and history. One graph every other module reads from.",
  alternates: { canonical: "https://workwrk.com/features/people" },
  openGraph: {
    title: "People — WorkwrK",
    description: "A live org graph that every module reads from.",
    url: "https://workwrk.com/features/people",
  },
};

export default function PeoplePage() {
  return (
    <>
      <ModuleHero
        eyebrow="People · The org graph"
        moduleNumber="01"
        iconKey="people"
        tone="lime"
        title={
          <>
            One graph. <span className="hi">Every person, every role.</span>
          </>
        }
        body="The canonical source of who works where, reports to whom, carries what KRA, and can access what data. Every other module reads from it — and when it updates, the whole system reacts."
        badges={["CSV / Google Workspace import", "Role templates", "RBAC at field-level", "Ramp schedules", "Offboarding audit"]}
        visual={<OrgTreeVisual />}
      />

      <ModuleAnchorNav
        items={[
          { id: "roles", label: "Roles + ramps", tone: "lime" },
          { id: "lifecycle", label: "Lifecycle", tone: "blue" },
          { id: "access", label: "Access control", tone: "pink" },
          { id: "connects", label: "Connects to", tone: "amber" },
          { id: "faq", label: "FAQ" },
        ]}
      />

      <ModuleDeepDive
        id="roles"
        eyebrow="Roles + ramps"
        tone="lime"
        title={<>A role <span className="hi">is more than a title.</span></>}
        body={
          <>
            <p>
              Each role has its own KRAs, KPIs, SOPs to read, reviewer, and 90-day
              ramp. Hire a new senior SDR and they auto-inherit the role&apos;s package —
              targets set, SOPs assigned, reviewer wired. No 40-point onboarding
              checklist maintained by a human.
            </p>
            <p>
              Change the role and everyone in it updates live. No stale definitions.
            </p>
          </>
        }
        bullets={[
          "Role templates clone KRAs / KPIs",
          "90-day ramp with weekly milestones",
          "Auto-assign SOPs by role on day one",
          "Version history on role changes",
          "Two roles per person · split KRAs",
          "Career ladders · L1 through L9",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Roles defined", stat: "18", delta: "+2 this quarter", tone: "lime" },
              { label: "Median ramp", stat: "76 days", delta: "−12 vs last cohort", tone: "blue" },
              { label: "Role-SOP compliance", stat: "91%", delta: "+4 vs Q4", tone: "amber" },
            ]}
            footer="18 role templates · growing teams · 6 reporting depths"
          />
        }
        visualSide="right"
      />

      <ModuleDeepDive
        id="lifecycle"
        eyebrow="Lifecycle"
        tone="blue"
        background="carded"
        title={<>From offer letter to <span className="hi">exit interview.</span></>}
        body={
          <>
            <p>
              Every milestone for every employee — hired, confirmed, promoted, moved,
              left — lives as a first-class event. Not a form someone fills out in HR
              software. The event triggers workflows: access revoked, SOPs
              reassigned, review cycle closed, kudos archived.
            </p>
          </>
        }
        bullets={[
          "Offer → confirm → promote → exit",
          "Auto-revoke access on exit date",
          "Knowledge handover tasks auto-created",
          "Exit interview template · role-specific",
          "Alumni table · rehire pipeline",
          "PII retention configurable by region",
        ]}
        visual={
          <TimelineVisual
            tone="blue"
            steps={[
              { t: "Mar 04 · 2024", title: "Offer accepted · Priya Sharma", meta: "Head of Sales · L6 · Mumbai" },
              { t: "Apr 01 · 2024", title: "Day one · ramp activated", meta: "90-day · 18 milestones · reviewer Arjun" },
              { t: "Jul 02 · 2024", title: "Confirmed · full KRA weight", meta: "Quota live · SOPs at 100% read" },
              { t: "Jan 15 · 2026", title: "Promotion to L7 · pending", meta: "Composite 94 · awaiting calibration" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleDeepDive
        id="access"
        eyebrow="Access control"
        tone="pink"
        title={<>RBAC that <span className="hi">follows the org graph.</span></>}
        body={
          <>
            <p>
              Who sees what is a function of role, not a manually-toggled checkbox.
              A new sales lead automatically sees the sales team's reviews. Move
              them to ops — access flips, cleanly, with a signed audit entry.
            </p>
          </>
        }
        bullets={[
          "Field-level RBAC (salary, PII)",
          "Role-based policies · not per-user",
          "SSO / SAML (Scale+)",
          "Audit trail on every read / write",
          "Data residency per region",
          "GDPR / DPDPA export + delete",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "RBAC policies", stat: "24", delta: "6 roles × 4 scopes", tone: "pink" },
              { label: "Signed audit events", stat: "14.2k", delta: "last 30 days", tone: "lime" },
              { label: "Time-to-revoke on exit", stat: "< 60s", delta: "median across cohort", tone: "blue" },
            ]}
          />
        }
        visualSide="right"
      />

      <ModuleStats
        kicker="Why the graph matters"
        title={<>One data model. <span className="hi">Every module, in sync.</span></>}
        stats={[
          { stat: "0", label: "Sync jobs between modules · it's all one table", tone: "lime" },
          { stat: "3 min", label: "Bulk-import 142 employees from Google Workspace", tone: "blue" },
          { stat: "< 60s", label: "Median time-to-revoke on exit", tone: "pink" },
          { stat: "142", label: "Fields available for RBAC policy · not just six", tone: "amber" },
        ]}
      />

      <div id="connects">
        <ModuleConnects
          sourceName="People"
          title={<>The spine that <span className="hi">every module reads.</span></>}
          subtitle="Every other module derives its context from the graph — roles, reporting lines, and lifecycle events fan out everywhere."
          entries={[
            { name: "KRAs", flow: "KRA packages attach to roles, not people. Move a person, KRAs follow.", href: "/features/kras", iconKey: "kra" },
            { name: "KPIs", flow: "Per-role KPI definitions. Change the role — everyone's targets update.", href: "/features/kpis", iconKey: "kpi" },
            { name: "SOPs", flow: "Auto-assign by role. Day-one onboarding list · zero manual checklist.", href: "/features/sops", iconKey: "sop" },
            { name: "Reviews", flow: "Review trees derive from the graph. No manual 360-panel assembly.", href: "/features/reviews", iconKey: "reviews" },
            { name: "Access", flow: "RBAC policies attach to roles. The graph decides who reads what.", href: "/features/access", iconKey: "access" },
            { name: "AI Engine", flow: "Org context every prompt reads. 'Who reports to Priya' · 'Who ramped in Q3'.", href: "/features/ai-engine", iconKey: "ai" },
          ]}
        />
      </div>

      <ModuleReplaces
        title={<>The stack People <span className="hi">quietly retires.</span></>}
        rows={[
          { old: "A Google Sheet called 'Team (final v7)'", nu: "A typed graph with roles, KRAs, and reporting lines" },
          { old: "An HRMS that only HR opens", nu: "A module every manager uses weekly for reviews + kudos" },
          { old: "Manual onboarding checklists in Notion", nu: "Role templates with 90-day ramps and auto-assigned SOPs" },
          { old: "Offboarding 'did we remove X?' debates", nu: "Exit date triggers signed revoke events across every module" },
          { old: "Field-level access via per-user checkboxes", nu: "RBAC policies attached to roles — the graph is the source of truth" },
        ]}
      />

      <div id="faq">
        <ModuleFaq
          title={<>Things founders ask <span className="hi">before switching from spreadsheets.</span></>}
          items={[
            { q: "Will my existing HRMS break?", a: <p>We sit alongside, not in place of, payroll HRMSs. People becomes the source of truth for org graph, roles, and access; your existing payroll tool keeps doing payroll. Bi-directional sync available for Razorpay Payroll, Keka, and GreytHR.</p> },
            { q: "How is PII handled under DPDPA?", a: <p>PII fields are tagged at the schema level. Residency is configurable (Mumbai / Singapore / customer VPC). Export-on-request and right-to-erasure are one-click per user, with signed receipts for the regulator.</p> },
            { q: "Can we bulk-import from Google Workspace?", a: <p>Yes. OAuth into Workspace, we pull names, emails, departments, and reporting lines. You approve a diff before anything writes. Typical 142-person import takes about three minutes.</p> },
            { q: "What happens to review history when someone changes role?", a: <p>History stays attached to the person, not the role. Past reviews, kudos, and KPI readings are all preserved with the role they held at the time. Promotion calibration uses the full history.</p> },
            { q: "Can contractors and consultants sit in the graph?", a: <p>Yes — with a type flag. Contractors can be assigned KRAs and SOPs but by default don&apos;t appear in compensation reports. Access scopes can be tightened per contractor type.</p> },
          ]}
        />
      </div>

      <ModuleCta
        tone="lime"
        title={<>Start with the <em>graph.</em></>}
        subtitle="14-day free trial. Import your first 50 people in under three minutes."
      />
    </>
  );
}
