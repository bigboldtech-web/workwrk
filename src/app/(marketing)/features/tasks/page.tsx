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
  TimelineVisual,
  DataTableVisual,
} from "@/components/modules";
export const metadata: Metadata = {
  title: "Tasks — WorkwrK | Auto-escalating work from every module",
  description:
    "Tasks born from reviews, SOPs, meetings, and KR drift. SLA timers, auto-escalation, full audit — not another Jira.",
  alternates: { canonical: "https://workwrk.com/features/tasks" },
};

export default function TasksPage() {
  return (
    <>
      <ModuleHero
        eyebrow="Tasks · Auto-escalating"
        moduleNumber="07"
        iconKey="tasks"
        tone="blue"
        title={<>Work that <span className="bl">doesn't slip.</span></>}
        body="Tasks aren't a standalone inbox. They're born from SOP step-completions, review action items, flow branches, and KR drift — with SLAs, owners, and escalation paths wired in automatically. You don&apos;t 'track your tasks' — they track themselves."
        badges={["SLA timers", "Auto-escalation", "Born from modules", "Signed audit", "Slack-native"]}
        visual={
          <DataTableVisual
            title="Open tasks · L1 support"
            meta="12 open · 3 at SLA risk · 1 escalated"
            tone="blue"
            rows={[
              { a: "Refund #44291", b: "from SOP · SLA 4h · 2h left", score: 50, delta: "on track", up: true },
              { a: "Review action · Ravi", b: "from Q1 cycle · SLA 7d", score: 40, delta: "on track", up: true },
              { a: "Vendor onboard", b: "from flow · SLA 2d · 4h left", score: 85, delta: "at risk", up: false },
              { a: "KR drift: NPS", b: "from OKR · auto-spawned", score: 15, delta: "owner pending", up: false },
              { a: "P0 ticket #112", b: "SLA 15m · escalated to L2", score: 100, delta: "escalated", up: false },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Born from the spine"
        tone="blue"
        title={<>Tasks don't appear <span className="bl">from thin air.</span></>}
        body={
          <>
            <p>
              An SOP has a step that requires action — a task spawns. A review
              surfaces a growth area — a coaching task spawns. A KR drifts — an
              unblock task spawns. Every task carries its origin so the reviewer
              can see <em>why</em> it exists, not just that it&apos;s open.
            </p>
          </>
        }
        bullets={[
          "Spawn sources · SOP / review / flow / KR / AI",
          "Origin trace · one-click back to source",
          "Auto-owner from source · or escalation path",
          "Templates for common task shapes",
          "Batched creation from AI suggestions",
          "Per-source SLA defaults (configurable)",
        ]}
        visual={
          <TimelineVisual
            tone="blue"
            steps={[
              { t: "10:02am", title: "SOP step 'call vendor' hit", meta: "→ Task spawned · owner Neha · SLA 24h" },
              { t: "10:47am", title: "Q1 review flagged SOP gap for Ravi", meta: "→ Coaching task · Priya · SLA 14d" },
              { t: "11:15am", title: "NPS KR dropped 8 points this week", meta: "→ Unblock task · head of CS · SLA 48h" },
              { t: "11:23am", title: "AI surfaced attrition risk · Sanjay", meta: "→ 1:1 task · reporting manager · SLA 72h" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Auto-escalation"
        tone="pink"
        background="carded"
        title={<>If no one acts, <span className="pk">someone does.</span></>}
        body={
          <>
            <p>
              Every task has a timer. Breach it — and it escalates one level up the
              org chart, with a new owner and a fresh SLA. Breach again — next
              level. Nothing stays buried in someone&apos;s inbox for three weeks.
            </p>
          </>
        }
        bullets={[
          "Per-task SLA · owner-derived or custom",
          "Escalation path · up the org graph",
          "Slack pings on approach + breach",
          "Escalation history on the task",
          "Blameless log · not a shame game",
          "Pause / defer with justification",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Open tasks org-wide", stat: "214", delta: "median age 1.8 days", tone: "blue" },
              { label: "SLA breach rate", stat: "3%", delta: "down from 24% pre-WorkwrK", tone: "lime" },
              { label: "Escalations this week", stat: "6", delta: "2 auto-resolved · 4 awaiting L2", tone: "pink" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="Tasks in practice"
        title={<>Work that <span className="hi">closes itself.</span></>}
        stats={[
          { stat: "97%", label: "Tasks closed within SLA · across our customers", tone: "blue" },
          { stat: "1.8 days", label: "Median task age · org-wide", tone: "lime" },
          { stat: "6×", label: "More signal-driven tasks vs manually-created", tone: "amber" },
          { stat: "0", label: "Tasks that get forgotten · auto-escalation prevents it", tone: "pink" },
        ]}
      />

      <ModuleConnects
        sourceName="Tasks"
        title={<>Tasks are a <span className="hi">reaction surface.</span></>}
        subtitle="Every module can emit tasks. A task is how the system says 'someone needs to do something.'"
        entries={[
          { name: "SOPs", flow: "Flow branches spawn tasks. Step-level SLAs handled.", href: "/features/sops", iconKey: "sop" },
          { name: "Reviews", flow: "Action items from each cycle spawn owned, SLA'd tasks.", href: "/features/reviews", iconKey: "reviews" },
          { name: "OKRs", flow: "KR drift auto-spawns unblock tasks · routed to department head.", href: "/features/okrs", iconKey: "okr" },
          { name: "KRAs", flow: "KRA miss → remediation task with owner and 14-day SLA.", href: "/features/kras", iconKey: "kra" },
          { name: "People", flow: "Escalation path follows the org graph · no manual routing.", href: "/features/people", iconKey: "people" },
          { name: "AI Engine", flow: "AI can suggest tasks; human approves before it spawns.", href: "/features/ai-engine", iconKey: "ai" },
        ]}
      />

      <ModuleReplaces
        title={<>What Tasks <span className="hi">replaces.</span></>}
        rows={[
          { old: "A separate project tracker (Asana, Trello, Monday)", nu: "Tasks born directly from the modules that need them" },
          { old: "SLA tracking via spreadsheet + reminder bot", nu: "SLA timers native · auto-escalation built in" },
          { old: "Tasks that 'disappear' into personal inboxes", nu: "Every task is org-visible · with signed audit trail" },
          { old: "Manual assignment ('who's handling this?')", nu: "Auto-owner from source module · or escalation path" },
        ]}
      />

      <ModuleFaq
        title={<>Questions from <span className="hi">ops leaders.</span></>}
        items={[
          { q: "Is this a replacement for Jira or Linear?", a: <p>Not for engineering work. We integrate with Linear for dev tasks and Jira for teams that use it. Our Tasks module is for the work that flows out of operations — SOP execution, review actions, KR unblocks. Not sprints.</p> },
          { q: "Can I create ad-hoc tasks too?", a: <p>Yes. The module-spawned ones are the bulk, but you can create manual tasks any time — with source = &quot;manual,&quot; an owner, and an SLA of your choosing.</p> },
          { q: "What happens when someone is on leave?", a: <p>Each user has a delegate. When they&apos;re marked on leave, their open tasks auto-delegate. No SLA breaches due to out-of-office.</p> },
          { q: "Do we get task analytics?", a: <p>Yes. Task-aging, SLA breach rate, escalation path frequency, per-source distribution — all exportable to SQL or Analytics module.</p> },
        ]}
      />

      <ModuleCta
        tone="blue"
        title={<>Work that <em>tracks itself.</em></>}
        subtitle="Free trial · your first task spawns from the first SOP step you publish."
      />
    </>
  );
}
