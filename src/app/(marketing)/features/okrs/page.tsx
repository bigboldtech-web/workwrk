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
  title: "OKRs — WorkwrK | Cascaded, quarterly, actually used",
  description:
    "Company → team → individual OKRs that cascade automatically. Lightweight enough to run every quarter. Not a 40-tab Google Sheet.",
  alternates: { canonical: "https://workwrk.com/features/okrs" },
};

export default function OkrsPage() {
  return (
    <>
      <ModuleHero
        eyebrow="OKRs · Quarterly direction"
        moduleNumber="06"
        iconKey="okr"
        tone="amber"
        title={<>OKRs that <span className="am">close the quarter.</span></>}
        body="Company objective. Three department-level key results. Each KR cascades into individual commitments. Progress is read from KPIs and tasks automatically — no weekly check-in spreadsheet. Ships as quarterly read-outs, not as a dead Notion page."
        badges={["Quarterly cycle", "3-level cascade", "KPI-derived progress", "Weekly read-outs", "Scorecard export"]}
        visual={
          <TimelineVisual
            tone="amber"
            steps={[
              { t: "Week 0", title: "Company objective · set by CEO", meta: "'Profitably hit ₹30Cr ARR by Q4' · one objective, three KRs" },
              { t: "Week 1", title: "Department KRs · cascaded to 4 teams", meta: "Sales, CS, Marketing, Eng · each own 2–3 KRs" },
              { t: "Week 2", title: "Individual commitments · auto-drafted", meta: "Each person's KRAs map to department KRs · weights set" },
              { t: "Week 13", title: "Quarterly scorecard · signed off", meta: "Progress = weighted KPI composite · no manual reporting" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Cascading, cleanly"
        tone="amber"
        title={<>One company objective. <span className="am">Three levels of alignment.</span></>}
        body={
          <>
            <p>
              Company → team → individual. Each level inherits from the one above,
              weighted. A sales rep&apos;s OKR carries 40% of their department&apos;s pipeline
              KR, which carries 30% of the company revenue KR. Move the top; the
              whole tree moves.
            </p>
            <p>
              Progress is read from KPIs + task completion. No weekly check-in.
            </p>
          </>
        }
        bullets={[
          "3 levels · company / team / individual",
          "Weighted cascade · sums to 100%",
          "Progress auto-computed from KPIs",
          "Mid-quarter re-forecast supported",
          "Draft next quarter from current state",
          "Export as scorecard PDF · board-ready",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Company progress · Q1", stat: "68%", delta: "on pace for 91% finish · week 8 of 13", tone: "amber" },
              { label: "Team OKRs at risk", stat: "2", delta: "sales pipeline · eng velocity", tone: "pink" },
              { label: "Individual commitments", stat: "142", delta: "auto-linked to team KRs", tone: "blue" },
            ]}
            footer="Progress pulls from 86 KPIs · updated every 15 min"
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Weekly read-outs"
        tone="blue"
        background="carded"
        title={<>Five minutes a week. <span className="hi">No slide decks.</span></>}
        body={
          <>
            <p>
              Every Monday, department heads get a read-out: which KRs are on
              track, which are drifting, which KPI caused the drift, and what tasks
              should unblock it. Delivered in Slack, email, or in-app — no slide
              deck to prepare.
            </p>
          </>
        }
        bullets={[
          "Monday morning read-out · Slack",
          "Drift attribution · 'this KPI caused it'",
          "Unblock tasks · auto-suggested",
          "AI summary · one paragraph per KR",
          "Forward to board · one click",
          "Mid-quarter forecast · every 4 weeks",
        ]}
        visual={
          <TimelineVisual
            tone="blue"
            steps={[
              { t: "Mon · 9am", title: "CEO read-out · 5 min", meta: "Company on 68% · sales at risk · eng on-pace" },
              { t: "Mon · 9:15", title: "Dept head read-outs · per team", meta: "Attribution · unblock tasks · at-risk ICs" },
              { t: "Mon · 10am", title: "Standup runs against the read-out", meta: "Not 'what did you do' — 'what unblocks the KR'" },
              { t: "Fri · 6pm", title: "Auto-sent weekly digest to board", meta: "Optional · 1-page summary · PDF + Slack" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="OKRs that ship"
        title={<>Lightweight enough to <span className="hi">actually run.</span></>}
        stats={[
          { stat: "3 levels", label: "Company → team → individual · not five tiers of bureaucracy", tone: "amber" },
          { stat: "5 min", label: "Median weekly check-in time · per person", tone: "lime" },
          { stat: "91%", label: "Teams that completed all 4 quarterly cycles · year 1", tone: "blue" },
          { stat: "0", label: "OKR spreadsheets · all data lives in the spine", tone: "pink" },
        ]}
      />

      <ModuleConnects
        sourceName="OKRs"
        title={<>OKRs ride on top of <span className="hi">everything else.</span></>}
        subtitle="An OKR isn't a separate system. It's a view over your KPIs, KRAs, and tasks, layered with the quarter's objective."
        entries={[
          { name: "KPIs", flow: "KR progress is computed from KPI readings. No manual %-complete.", href: "/features/kpis", iconKey: "kpi" },
          { name: "KRAs", flow: "Individual OKRs cascade from role KRAs · weights set automatically.", href: "/features/kras", iconKey: "kra" },
          { name: "Tasks", flow: "Unblock-tasks spawn when KRs drift · SLA + owner assigned.", href: "/features/tasks", iconKey: "tasks" },
          { name: "People", flow: "OKR ownership follows the graph · team + individual levels.", href: "/features/people", iconKey: "people" },
          { name: "AI Engine", flow: "'Why is sales KR drifting' · engine reads attributions + writes plan.", href: "/features/ai-engine", iconKey: "ai" },
          { name: "OKRs", flow: "Draft next quarter from current state · carryover logic handled.", href: "/features/okrs", iconKey: "okr" },
        ]}
      />

      <ModuleReplaces
        title={<>What OKRs <span className="hi">replaces.</span></>}
        rows={[
          { old: "A 40-tab Google Sheet someone updates on Sunday night", nu: "A live view with KPI-derived progress · no weekly update" },
          { old: "Standalone OKR tools disconnected from KPIs and tasks", nu: "OKRs as a view over your existing spine · one source of truth" },
          { old: "Quarterly planning off-sites that produce 60 KRs", nu: "One objective, three KRs, weighted cascade · quarterly cadence" },
          { old: "OKRs that 'we started in Q1 and never looked at again'", nu: "Monday read-outs force the conversation · 91% quarterly completion" },
        ]}
      />

      <ModuleFaq
        title={<>Questions about <span className="hi">planning cadence.</span></>}
        items={[
          { q: "Are OKRs required?", a: <p>No. You can run WorkwrK on KRAs + KPIs + reviews without touching OKRs. OKRs are a thin layer on top for teams that want quarterly direction-setting.</p> },
          { q: "What's the difference between KRAs and OKRs?", a: <p>KRAs are stable accountabilities — what the role owns every quarter. OKRs are the specific targets for this quarter. A KRA: &quot;Own outbound pipeline.&quot; An OKR: &quot;Generate ₹80L in Q1 with 40% conversion.&quot; Both coexist.</p> },
          { q: "Can we use a different OKR methodology (Google-style, Grove-style)?", a: <p>We ship opinionated defaults but it's configurable. Scoring (0–1 vs 0–100), cascade depth, weight sum rules, and mid-quarter re-forecast policies all configurable per org.</p> },
          { q: "What if the CEO changes direction mid-quarter?", a: <p>Mid-quarter re-forecast is built-in. You can change the company objective, and the cascade updates with an audit trail. We don&apos;t pretend the real world is stable.</p> },
        ]}
      />

      <ModuleCta
        tone="amber"
        title={<>Close the <em>quarter.</em></>}
        subtitle="Draft your first OKR tree in the trial · the cascade is automatic."
      />
    </>
  );
}
