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
} from "@/components/modules";
import { WrittenSopVisual, ScribeVisual, FlowVisual, HeroSopVisual } from "./visuals";

export const metadata: Metadata = {
  title: "SOPs — WorkwrK | Written, Scribe-recorded, Process flows",
  description:
    "Three kinds of SOPs — written playbooks, Scribe screen-recordings, and branching process flows. Versioned, assignable, audited, auto-extracted by AI.",
  alternates: { canonical: "https://workwrk.com/features/sops" },
  openGraph: {
    title: "SOPs that don't rot — WorkwrK",
    description:
      "Written SOPs, Scribe recordings, and branching flows. Versioned, assignable, auto-audited.",
    url: "https://workwrk.com/features/sops",
  },
};

export default function SopsPage() {
  return (
    <>
      <ModuleHero
        eyebrow="SOPs · Standard Operating Procedures"
        moduleNumber="04"
        iconKey="sop"
        tone="pink"
        title={
          <>
            The SOPs your team <span className="pk">actually opens.</span>
          </>
        }
        body="Three shapes of process in one module. Written playbooks for knowledge. Scribe screen-recordings for 'just watch me do it.' Branching flows for 'it depends.' All versioned, all assignable, all nightly-audited — so the one that runs production matches the one in the doc."
        badges={["Versioned", "Assignable by role", "Audit trail", "AI extraction", "GDPR-compliant"]}
        visual={<HeroSopVisual />}
      />

      <ModuleAnchorNav
        items={[
          { id: "written", label: "Written SOPs", tone: "pink" },
          { id: "scribe", label: "Scribe recordings", tone: "blue" },
          { id: "flows", label: "Process flows", tone: "amber" },
          { id: "connects", label: "Connects to", tone: "lime" },
          { id: "replaces", label: "Replaces" },
          { id: "faq", label: "FAQ" },
        ]}
      />

      <ModuleDeepDive
        id="written"
        eyebrow="Written SOPs"
        tone="pink"
        title={
          <>
            Playbooks with <span className="hi">sections, assignees, and a memory.</span>
          </>
        }
        body={
          <>
            <p>
              Every written SOP has a stable structure — purpose, owner,
              scope, steps, exceptions, revision notes. No more 40-page Google Docs
              where step 3 still references a tool you deprecated in 2023.
            </p>
            <p>
              Each revision is signed and diffed. Anyone reading today sees exactly
              what changed since the last time they read it, and who approved the
              change. Old versions stay readable for audit — they don&apos;t vanish.
            </p>
          </>
        }
        bullets={[
          "Structured sections: steps, exceptions, KPIs",
          "Owner + reviewer fields, not freeform text",
          "Diff view between any two revisions",
          "Read-receipts per user · per version",
          "Auto-assign by role, team, or KRA",
          "One-click export to PDF for ISO audits",
        ]}
        visual={<WrittenSopVisual />}
        visualSide="right"
      />

      <ModuleDeepDive
        id="scribe"
        eyebrow="Scribe — screen recordings"
        tone="blue"
        background="carded"
        title={
          <>
            Hit record. Walk through it once. <span className="hi">Ship the SOP.</span>
          </>
        }
        body={
          <>
            <p>
              Most people would rather show you than write it down. Scribe records
              your screen + narration, transcribes, chapters, and extracts the steps
              into a clean written SOP you can edit — in about the time it takes to
              do the task once.
            </p>
            <p>
              The video stays attached. New hires watch the 90 seconds, skim the
              steps, and get on with the job. No more 2-week shadowing plans that
              nobody has time for.
            </p>
          </>
        }
        bullets={[
          "One-click browser record (Chrome + Firefox)",
          "Auto-chaptered by UI state change",
          "Whisper transcript · timestamped",
          "AI drafts the step list — you approve",
          "Redact PII before publish · auto-blur",
          "Re-record a single chapter, SOP updates",
        ]}
        visual={<ScribeVisual />}
        visualSide="left"
      />

      <ModuleDeepDive
        id="flows"
        eyebrow="Process flows"
        tone="amber"
        title={
          <>
            For the processes that <span className="hi">actually branch.</span>
          </>
        }
        body={
          <>
            <p>
              Some processes aren&apos;t a list. A refund depends on reason, tier,
              region, and how long ago. Support escalation depends on severity and
              whether the customer is enterprise. You draw the decision tree once;
              the system walks each person through the exact path for their case.
            </p>
            <p>
              Every branch logs. You can see which paths get walked most — and which
              branches never trigger, meaning you can delete them.
            </p>
          </>
        }
        bullets={[
          "Drag-and-drop flow builder · no code",
          "Conditional branches on any data field",
          "Auto-generate tasks on reaching a step",
          "Route to different owners per branch",
          "Path analytics: which branches fire",
          "SLA timers per step, escalate on breach",
        ]}
        visual={<FlowVisual />}
        visualSide="right"
      />

      <ModuleStats
        kicker="Why teams actually use these"
        title={
          <>
            SOPs that stop being <span className="hi">write-only.</span>
          </>
        }
        stats={[
          { stat: "3.2×", label: "Compliance lift vs Drive folders · across 142 teams", tone: "pink" },
          { stat: "18 min", label: "Median time from 'record screen' to published SOP", tone: "blue" },
          { stat: "94%", label: "Read-receipt rate on Scribe SOPs in the first 7 days", tone: "lime" },
          { stat: "46", label: "Average SOPs per team by month six · up from 4 in Drive", tone: "amber" },
        ]}
      />

      <div id="connects">
        <ModuleConnects
          sourceName="SOPs"
          title={
            <>
              One source of truth. <span className="hi">Every module reads it.</span>
            </>
          }
          subtitle="A versioned SOP isn't a static document — it's a signal. Every other module subscribes to it and reacts when you hit publish."
          entries={[
            {
              name: "People",
              flow: "New joiners auto-get assigned every SOP that matches their role. Compliance tracked per user.",
              href: "/features/people",
              iconKey: "people",
            },
            {
              name: "Tasks",
              flow: "Flow branches spawn tasks. Step-level SLAs escalate automatically when someone stalls.",
              href: "/features/tasks",
              iconKey: "tasks",
            },
            {
              name: "Reviews",
              flow: "Manager reviews pre-fill with SOP compliance %. No one has to compile it manually.",
              href: "/features/reviews",
              iconKey: "reviews",
            },
            {
              name: "KRAs",
              flow: "KRAs map to the SOPs that fulfil them. A missed KRA points you at the SOP that drifted.",
              href: "/features/kras",
              iconKey: "kra",
            },
            {
              name: "AI Engine",
              flow: "Ask 'why did refund volume spike last week' — AI reads SOP versions and finds the change.",
              href: "/features/ai-engine",
              iconKey: "ai",
            },
            {
              name: "Analytics",
              flow: "Per-SOP compliance, read rate, and path distribution — exportable as SQL or CSV.",
              href: "/features/analytics",
              iconKey: "analytics",
            },
          ]}
        />
      </div>

      <div id="replaces">
        <ModuleReplaces
          title={
            <>
              The five places your <span className="hi">current SOPs live.</span>
            </>
          }
          rows={[
            {
              old: "A Google Drive folder called 'SOPs (FINAL)' that nobody opens",
              nu: "A searchable library with read-receipts, compliance %, and revision diffs",
            },
            {
              old: "A Notion page last edited 11 months ago by someone who left",
              nu: "Owner field, reviewer field, and nightly freshness checks against drift",
            },
            {
              old: "Loom videos scattered across 8 people's personal accounts",
              nu: "Scribe recordings attached to the SOP — with transcripts and step extraction",
            },
            {
              old: "A whiteboard photo in the #ops Slack channel from March",
              nu: "A branching flow that routes each case through the correct path — and logs it",
            },
            {
              old: "Tribal knowledge stuck in the head of one senior IC",
              nu: "A Scribe recording of their screen, transcribed and assigned to the whole team",
            },
          ]}
        />
      </div>

      <div id="faq">
        <ModuleFaq
          title={
            <>
              Questions teams ask <span className="hi">before switching.</span>
            </>
          }
          items={[
            {
              q: "Can we bulk-import our existing Drive / Notion SOPs?",
              a: (
                <>
                  <p>
                    Yes. Point us at a Drive folder or Notion workspace and we import
                    every doc — keeping revision history where it exists. AI categorises
                    each one by role and suggests an owner.
                  </p>
                  <p>
                    Imports take about four minutes per 100 SOPs. Nothing is published
                    until you approve — draft state first, always.
                  </p>
                </>
              ),
            },
            {
              q: "What happens when the SOP and reality drift apart?",
              a: (
                <>
                  <p>
                    Each SOP has a freshness score — computed nightly from its
                    read-receipt rate, the KPIs of the people who own it, and whether
                    flow-branch analytics match the written flow. When freshness drops
                    below threshold, the owner gets a Slack ping to review.
                  </p>
                </>
              ),
            },
            {
              q: "Do Scribe recordings use a third-party AI?",
              a: (
                <>
                  <p>
                    Transcription is Whisper-class, run inside our private
                    infrastructure. Step extraction is done by Claude under our
                    enterprise agreement — your recordings never train anyone&apos;s model
                    and are deleted from the processing tier within 24 hours.
                  </p>
                </>
              ),
            },
            {
              q: "How do process flows handle exceptions?",
              a: (
                <>
                  <p>
                    Every branch can have an &quot;escalate&quot; path that routes to a
                    named owner and starts an SLA timer. If the step doesn&apos;t complete
                    in the allotted time, it escalates one level up the org chart and
                    notifies the backup owner automatically.
                  </p>
                </>
              ),
            },
            {
              q: "Can auditors pull a clean trail for ISO 9001 / SOC 2?",
              a: (
                <>
                  <p>
                    Yes. Every SOP exports as PDF with: signed revisions, approval
                    trail, reviewer identities, read-receipts per user-version, and
                    compliance percentages over any date range. Built with Indian
                    manufacturing and fintech audit cycles in mind.
                  </p>
                </>
              ),
            },
            {
              q: "Do you support on-premise hosting for sensitive SOPs?",
              a: (
                <>
                  <p>
                    On Scale+. We deploy the SOP module (plus People, Tasks, and
                    Access) to your VPC, with Scribe recordings stored in your S3
                    bucket. Contact sales for the architecture doc.
                  </p>
                </>
              ),
            },
          ]}
        />
      </div>

      <ModuleCta
        tone="pink"
        title={
          <>
            Try SOPs that <em>work</em>.
          </>
        }
        subtitle="14-day free trial. Import your existing SOPs on day one. Record your first Scribe SOP in the next ten minutes."
      />
    </>
  );
}
