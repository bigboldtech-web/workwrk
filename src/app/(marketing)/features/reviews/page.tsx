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
  DataTableVisual,
} from "@/components/modules";
export const metadata: Metadata = {
  title: "Reviews — WorkwrK | 48-hour cycles, pre-filled with real data",
  description:
    "Manager + peer + self reviews land pre-populated with KPI readings, SOP compliance, and kudos history. Two-day cycle, not two weeks.",
  alternates: { canonical: "https://workwrk.com/features/reviews" },
};

export default function ReviewsPage() {
  return (
    <>
      <ModuleHero
        eyebrow="Reviews · 48-hour cycle"
        moduleNumber="05"
        iconKey="reviews"
        tone="blue"
        title={<>From two weeks to <span className="bl">forty-eight hours.</span></>}
        body="Reviews pre-fill with the quarter's KPI readings, SOP compliance %, kudos history, and KRA-level deltas. The manager spends their time on the part only they can do: the judgment call. The rest — pulling the numbers, chasing the peer feedback, reconciling — is already done."
        badges={["360° · manager + peer + self", "KPI pre-fill", "Calibration σ", "PDF export", "Two-day median"]}
        visual={
          <TimelineVisual
            tone="blue"
            steps={[
              { t: "Day 0 · 9am", title: "Cycle launched · 142 employees", meta: "Managers notified · peer pools auto-built from org graph" },
              { t: "Day 0 · 11am", title: "All reviews pre-filled with live data", meta: "Q1 KPIs · SOP compliance · kudos · KRA deltas" },
              { t: "Day 1 · EOD", title: "94% of reviews submitted", meta: "AI-surfaced outliers flagged to HR for calibration" },
              { t: "Day 2 · 5pm", title: "Calibration session · 30 min", meta: "σ outside tolerance flagged · sign-off by CEO" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Pre-filled · not pre-written"
        tone="blue"
        title={<>The data shows up. <span className="bl">You bring the judgment.</span></>}
        body={
          <>
            <p>
              When a manager opens a review, they see: every KPI reading for the
              quarter, SOP compliance %, kudos received and given, KRA score
              deltas, and meeting-attendance heat. Everything they&apos;d normally
              spend 90 minutes compiling.
            </p>
            <p>
              The manager writes the part only humans write: what the numbers
              don&apos;t show. The narrative. The coaching. The promotion case.
            </p>
          </>
        }
        bullets={[
          "Quarter's KPI readings auto-attached",
          "SOP compliance % · by SOP",
          "Kudos threads · given + received",
          "KRA score delta vs last cycle",
          "AI-suggested strengths + growth areas",
          "Signed final PDF for HR / audit",
        ]}
        visual={
          <DataTableVisual
            title="Q1 2026 · review cycle"
            meta="142 employees · day 1 of 2 · calibrated"
            tone="blue"
            rows={[
              { a: "Priya Sharma", b: "submitted · 94 comp", score: 94, delta: "+4", up: true },
              { a: "Amit Joshi", b: "submitted · 87 comp", score: 87, delta: "+2", up: true },
              { a: "Ravi Kumar", b: "pending peer · 78", score: 78, delta: "−5", up: false },
              { a: "Neha Mehta", b: "submitted · 79 comp", score: 79, delta: "+8", up: true },
              { a: "Sanjay Rao", b: "on PIP track · 45", score: 45, delta: "−8", up: false },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Calibration"
        tone="amber"
        background="carded"
        title={<>One manager's 4 ≠ <span className="am">another manager's 4.</span></>}
        body={
          <>
            <p>
              Every manager grades differently. One gives 5s freely; another treats a
              4 as exceptional. Without calibration, promotion decisions are chaos.
              The system tracks each manager&apos;s σ against peer-manager mean — and
              flags anyone more than 1σ off the cohort for recalibration.
            </p>
            <p>
              30-minute calibration sessions replace the traditional 3-hour grading
              meeting. The data does most of the work.
            </p>
          </>
        }
        bullets={[
          "Per-manager σ tracked across cycles",
          "Auto-flag when > 1σ from peer mean",
          "Calibration session agenda · pre-built",
          "CEO / CXO sign-off workflow",
          "Cross-team fairness dashboards",
          "Audit trail for HR · every cycle",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Calibration σ", stat: "0.3", delta: "within tolerance · target <0.5", tone: "lime" },
              { label: "Managers flagged", stat: "2", delta: "of 14 · both above peer mean", tone: "amber" },
              { label: "Promotion consistency", stat: "91%", delta: "up from 52% pre-WorkwrK", tone: "blue" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="Reviews in practice"
        title={<>Reviews people <span className="hi">don't dread.</span></>}
        stats={[
          { stat: "2 days", label: "Median cycle time · from launch to sign-off", tone: "blue" },
          { stat: "94%", label: "Submission rate by day one · across our customers", tone: "lime" },
          { stat: "90 min", label: "Median manager time per review · down from 5 hr", tone: "pink" },
          { stat: "0.3σ", label: "Cross-manager calibration variance · median", tone: "amber" },
        ]}
      />

      <ModuleConnects
        sourceName="Reviews"
        title={<>A review is <span className="hi">the intersection of every module.</span></>}
        subtitle="Pre-fill data comes from everywhere. Results write back to everywhere. A review isn't a document — it's a cross-cutting event."
        entries={[
          { name: "KPIs", flow: "Quarter's readings auto-attach. No manual compilation.", href: "/features/kpis", iconKey: "kpi" },
          { name: "KRAs", flow: "KRA score delta vs last cycle · the first thing the manager sees.", href: "/features/kras", iconKey: "kra" },
          { name: "SOPs", flow: "Compliance % per SOP, shown inline · discipline visible.", href: "/features/sops", iconKey: "sop" },
          { name: "Kudos", flow: "Given + received in the quarter · context for the conversation.", href: "/features/kudos", iconKey: "kudos" },
          { name: "People", flow: "Review history stays attached to the person across role moves.", href: "/features/people", iconKey: "people" },
          { name: "AI Engine", flow: "'Summarise Priya's last 4 cycles' · done in two seconds.", href: "/features/ai-engine", iconKey: "ai" },
        ]}
      />

      <ModuleReplaces
        title={<>What 48-hour reviews <span className="hi">retire.</span></>}
        rows={[
          { old: "A 2-week review cycle with chase emails on day 11", nu: "A 48-hour cycle · 94% submitted by end of day one" },
          { old: "A Google Doc template that one manager customises by hand", nu: "A standard template pre-filled with live data · consistent" },
          { old: "'Can you export your KPIs for the review?'", nu: "KPIs auto-attach · the manager opens the review and it's there" },
          { old: "A 3-hour calibration meeting every quarter", nu: "A 30-minute session driven by σ-flagged outliers" },
          { old: "Subjective promotion calls based on recency bias", nu: "Composite scores spanning 6 cycles · pattern-matched" },
        ]}
      />

      <ModuleFaq
        title={<>Questions from <span className="hi">HR leaders.</span></>}
        items={[
          { q: "Can we configure our own competency framework?", a: <p>Yes. You define the rating scale (1–5, 1–7, or qualitative), the competencies, and the rubric. The system ships with three common frameworks (Indian SMB default, tech-startup, services) but you can fork or start blank.</p> },
          { q: "How does peer feedback work?", a: <p>Peer pools are auto-built from the org graph (reporting, project collaborators, cross-functional work). Each employee receives feedback requests from 3–5 peers. Feedback is aggregated and anonymised before the manager sees it. Optional direct-attribution on high-trust teams.</p> },
          { q: "What about 360 feedback from direct reports?", a: <p>Upward reviews are supported and often the most valuable signal. They&apos;re anonymised by default. Enforced floor: at least 3 reviewers, so anonymity is preserved.</p> },
          { q: "Can we run off-cycle reviews?", a: <p>Yes. Light-touch mid-cycle pulse reviews (15 min per person) and PIP / spot-check reviews on any cadence. The full formal cycle is quarterly by default but configurable.</p> },
          { q: "How do exports work for HR files?", a: <p>Every signed review exports as PDF with full data trace — KPIs, SOPs, kudos, manager rating, peer aggregate, calibration signature. One-click per person or bulk for the whole cycle.</p> },
        ]}
      />

      <ModuleCta
        tone="blue"
        title={<>A review cycle that <em>closes.</em></>}
        subtitle="Run your first cycle in the 14-day trial. Pre-fill happens on day one."
      />
    </>
  );
}
