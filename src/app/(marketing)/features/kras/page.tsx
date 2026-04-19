import type { Metadata } from "next";

import {
  ModuleConnects,
  ModuleCta,
  ModuleDeepDive,
  ModuleFaq,
  ModuleHero,
  ModuleReplaces,
  ModuleStats,
  TimelineVisual,
  DashboardVisual,
} from "@/components/modules";
export const metadata: Metadata = {
  title: "KRAs — WorkwrK | AI-drafted, human-approved accountabilities",
  description:
    "Per-role Key Result Areas drafted by AI from top-performer data and approved by leaders. Map KRAs to KPIs to roles. Update once, cascade everywhere.",
  alternates: { canonical: "https://workwrk.com/features/kras" },
};

export default function KrasPage() {
  return (
    <>
      <ModuleHero
        eyebrow="KRAs · Key Result Areas"
        moduleNumber="03"
        iconKey="kra"
        tone="pink"
        title={<>KRAs drafted in <span className="pk">ten minutes.</span></>}
        body="For every role in your org, AI reads your top performers, your composite score data, and your existing SOPs — and drafts a KRA package you approve in one sitting. No 6-week leadership retreat. No generic template from 2019."
        badges={["AI drafts", "Versioned", "KPI-linked", "Role-inherited", "Peer benchmarks"]}
        visual={
          <TimelineVisual
            tone="pink"
            steps={[
              { t: "Step 1 · 0:00", title: "AI reads your top SDR's 6-month record", meta: "KPI streams · review notes · kudos · SOP compliance" },
              { t: "Step 2 · 2 min", title: "Drafts 5 KRAs + 14 KPIs for the role", meta: "Benchmarked against 214 SDRs across our customers" },
              { t: "Step 3 · 5 min", title: "Founder edits 2 bullets, approves the rest", meta: "Diff-view shows what AI suggested vs approved" },
              { t: "Step 4 · 8 min", title: "Published · assigned to 4 people in the role", meta: "Notifications fire · SOPs auto-map · KPIs live" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Drafted, not dreamt up"
        tone="pink"
        title={<>Every KRA has <span className="pk">measurable evidence.</span></>}
        body={
          <>
            <p>
              The days of KRAs that read &quot;Own customer delight&quot; are over. Every KRA
              is tied to 2–4 KPIs with concrete targets, an owner, and a revision
              cadence. If it can&apos;t be measured, it&apos;s not a KRA — it&apos;s a value
              statement, which lives elsewhere.
            </p>
            <p>
              AI-drafted KRAs cite the exact KPI readings and top-performer
              histories they were inferred from. No hand-waving.
            </p>
          </>
        }
        bullets={[
          "Every KRA maps to 2–4 KPIs",
          "Inferred from top performers + peer data",
          "Revision cadence (monthly / quarterly)",
          "Version diff · who changed what, when",
          "Stretch target + baseline · not single number",
          "Sign-off workflow · CEO / CXO / role lead",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "KRAs defined", stat: "94", delta: "across 18 roles", tone: "pink" },
              { label: "Avg KRAs per role", stat: "5", delta: "median · cap 7", tone: "blue" },
              { label: "Quarterly revision rate", stat: "38%", delta: "changes shipped per qtr", tone: "lime" },
            ]}
            footer="Next review · Mar 31 · ceo + dept heads"
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Inherit by role"
        tone="blue"
        background="carded"
        title={<>Change a role. <span className="hi">Everyone in it updates.</span></>}
        body={
          <>
            <p>
              KRAs attach to the role, not the person. Promote someone from L4 to L5
              — they inherit the L5 KRA pack the same day. Ship a new role, clone
              the closest one, tweak. No spreadsheet of &quot;whose KRAs are whose.&quot;
            </p>
            <p>
              For people who straddle two roles (selling AE who also manages two
              SDRs), KRAs can be split — weights add to 100%.
            </p>
          </>
        }
        bullets={[
          "Role-level, not person-level",
          "Propagate instantly on role edit",
          "Split weights for dual-role people",
          "Inherit KPIs · via the KRA-KPI map",
          "Per-person overrides possible (flagged)",
          "Full history preserved across role moves",
        ]}
        visual={
          <TimelineVisual
            tone="blue"
            steps={[
              { t: "Mar 01", title: "Role edit · 'Senior SDR' adds NPS KRA", meta: "Signed off by head of sales" },
              { t: "Mar 01 · 2m later", title: "6 people in role · auto-inherited", meta: "Slack pings sent · acknowledgements pending" },
              { t: "Mar 02", title: "Neha M. acknowledged the new KRA", meta: "Added to her weekly check-in dashboard" },
              { t: "Mar 08", title: "NPS readings start flowing into composites", meta: "First weekly delta visible" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="KRAs in practice"
        title={<>Fewer hand-drafted words. <span className="hi">More measurable ones.</span></>}
        stats={[
          { stat: "10 min", label: "Median time to draft KRAs for a new role · with AI", tone: "pink" },
          { stat: "11×", label: "More KRAs drafted per month · vs manual authoring", tone: "lime" },
          { stat: "0", label: "KRAs without a KPI · the system literally prevents it", tone: "amber" },
          { stat: "94%", label: "Manager confidence in promotion calls · up from 41%", tone: "blue" },
        ]}
      />

      <ModuleConnects
        sourceName="KRAs"
        title={<>The spine that <span className="hi">glues</span> performance together.</>}
        subtitle="A KRA touches scoring, reviews, SOPs, and tasks. It's the smallest unit of accountability the system understands."
        entries={[
          { name: "KPIs", flow: "KRAs bundle KPIs. KRA score = weighted KPI composite.", href: "/features/kpis", iconKey: "kpi" },
          { name: "People", flow: "Attach to role. Role inheritance keeps everyone aligned.", href: "/features/people", iconKey: "people" },
          { name: "SOPs", flow: "Every KRA maps to the SOPs that fulfil it. Drift visible live.", href: "/features/sops", iconKey: "sop" },
          { name: "Tasks", flow: "KRA misses spawn remediation tasks with SLA + owner.", href: "/features/tasks", iconKey: "tasks" },
          { name: "Reviews", flow: "Review templates are generated from the role's KRA pack.", href: "/features/reviews", iconKey: "reviews" },
          { name: "AI Engine", flow: "'Suggest new KRA for Priya's L7 promotion' · draft in seconds.", href: "/features/ai-engine", iconKey: "ai" },
        ]}
      />

      <ModuleReplaces
        title={<>What happens without <span className="hi">structured KRAs.</span></>}
        rows={[
          { old: "Annual goal-setting off-sites with post-its", nu: "Quarterly KRA revisions that take an afternoon, not a week" },
          { old: "KRAs in a Notion page last edited 8 months ago", nu: "Versioned KRAs with diffs, sign-offs, and live links to KPIs" },
          { old: "KRAs that read 'own customer success' with no target", nu: "Every KRA ties to 2–4 KPIs with actual numbers" },
          { old: "A different KRA doc per manager · no consistency", nu: "Role-level KRAs · everyone in the role inherits the same pack" },
        ]}
      />

      <ModuleFaq
        title={<>Questions about <span className="hi">accountability design.</span></>}
        items={[
          { q: "Does AI-drafted mean AI-imposed?", a: <p>No. Every AI-drafted KRA is in draft state until a human (usually the role lead or CEO) approves. The diff view shows every change AI suggested vs what you approved. You can also reject the whole draft and start blank.</p> },
          { q: "How is this different from OKRs?", a: <p>KRAs are stable — the role&apos;s accountabilities that don&apos;t change quarter-to-quarter. OKRs are the specific objectives within a quarter. A KRA says &quot;own outbound pipeline.&quot; An OKR says &quot;generate ₹80L in Q1.&quot; Both live in the system; they&apos;re different layers.</p> },
          { q: "What if our roles don't match any template?", a: <p>You start blank. AI drafts from scratch using your org data if you have it, and a blank template otherwise. After the first role, subsequent ones can clone-and-edit, which is usually 80% faster.</p> },
          { q: "Can a single KRA belong to two roles?", a: <p>Yes. &quot;Maintain SOP compliance above 90%&quot; can live on both the AE role and the SDR role. Changes propagate to both roles when you edit the KRA.</p> },
          { q: "How often should we revise KRAs?", a: <p>Quarterly is the default cadence. For early-stage teams scaling fast, monthly. For mature teams, twice a year. The system suggests revision windows based on how your composite scores drift from the KRA targets.</p> },
        ]}
      />

      <ModuleCta
        tone="pink"
        title={<>Accountability that <em>works.</em></>}
        subtitle="Draft your first role's KRAs in 10 minutes · free trial."
      />
    </>
  );
}
