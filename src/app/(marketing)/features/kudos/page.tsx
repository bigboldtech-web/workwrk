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
} from "@/components/modules";
export const metadata: Metadata = {
  title: "Kudos — WorkwrK | Peer recognition that feeds scoring",
  description:
    "Values-tagged peer recognition. Visible in the feed, counted in composite scores, surfaced in reviews. Recognition that actually matters.",
  alternates: { canonical: "https://workwrk.com/features/kudos" },
};

export default function KudosPage() {
  return (
    <>
      <ModuleHero
        eyebrow="Kudos · Peer recognition"
        moduleNumber="08"
        iconKey="kudos"
        tone="pink"
        title={<>Recognition that <span className="pk">shows up in reviews.</span></>}
        body="Tag recognition to a company value. Post to the team feed. And — because it lives on the spine — it counts into composite scores and pre-fills the next review. Kudos aren&apos;t just feel-good; they&apos;re a signal the system learns from."
        badges={["Values-tagged", "Public feed", "Scoring signal", "Review pre-fill", "Slack-native"]}
        visual={
          <TimelineVisual
            tone="pink"
            steps={[
              { t: "2h ago", title: "Priya → Ravi · ✦ Integrity", meta: "'Owned the client escalation end-to-end · no blame throwing'" },
              { t: "Yesterday", title: "Amit → Neha · ✦ Customer focus", meta: "'Re-wrote the onboarding email after one user feedback session'" },
              { t: "Mon", title: "Arjun → Whole sales team · ✦ Grit", meta: "'₹80L pipeline by Jan 20 · eight working days ahead'" },
              { t: "Last week", title: "Anonymous → Ravi · ✦ Ownership", meta: "From upward review · aggregated, not attributed" },
            ]}
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Tagged to values"
        tone="pink"
        title={<>Every kudos has <span className="pk">a reason.</span></>}
        body={
          <>
            <p>
              Define your company values once (Integrity, Ownership, Customer
              focus, Grit — or your own). Every kudos ties to one. Over a quarter,
              the system knows exactly which values are being lived, and by whom.
            </p>
            <p>
              &quot;Great job&quot; kudos aren&apos;t allowed. The tag is required.
            </p>
          </>
        }
        bullets={[
          "Company values · customisable",
          "One required value tag per kudos",
          "Public team feed · optional anonymous",
          "Slack + in-app posting",
          "Aggregate value reports per person",
          "Exportable to HR cultural dashboard",
        ]}
        visual={
          <DashboardVisual
            tiles={[
              { label: "Kudos this quarter", stat: "241", delta: "median 1.7 per person", tone: "pink" },
              { label: "Most recognised value", stat: "Ownership", delta: "41% of all kudos", tone: "lime" },
              { label: "Kudos decay alerts", stat: "2", delta: "people gone > 60 days without", tone: "amber" },
            ]}
            footer="Values — Integrity · Ownership · Customer focus · Grit · Curiosity"
          />
        }
      />

      <ModuleDeepDive
        eyebrow="Signal, not just sentiment"
        tone="lime"
        background="carded"
        title={<>Kudos counts into <span className="hi">composite scoring.</span></>}
        body={
          <>
            <p>
              Recognition is one of the six signals in the composite performance
              score (weight varies by role). The system tracks both given and
              received — because people who notice others are themselves
              leadership material.
            </p>
            <p>
              Kudos decay alerts fire when someone goes 60+ days without receiving
              any. Usually the first sign of disengagement.
            </p>
          </>
        }
        bullets={[
          "One of six composite signals",
          "Given + received both weighted",
          "Anti-gaming: rate limits + peer-peer only",
          "Decay alerts on 60-day silence",
          "Manager tag boost (optional)",
          "Value-distribution per person",
        ]}
        visual={
          <TimelineVisual
            tone="lime"
            steps={[
              { t: "Q1 2026", title: "Priya received 14 kudos · 9 Ownership", meta: "Composite kudos signal · 92nd percentile company-wide" },
              { t: "Q1 2026", title: "Priya gave 8 kudos · 5 Customer-focus", meta: "Signal-giver score · top 25% · leadership pattern" },
              { t: "Q1 2026", title: "Ravi · decay alert triggered", meta: "62 days since last received kudos · flagged to manager" },
              { t: "Q1 2026", title: "Engine suggested 3 kudos", meta: "From recent wins · for manager to review + post" },
            ]}
          />
        }
        visualSide="left"
      />

      <ModuleStats
        kicker="Why kudos matters"
        title={<>Recognition that <span className="hi">actually sticks.</span></>}
        stats={[
          { stat: "3.2×", label: "Kudos volume vs teams without structured recognition", tone: "pink" },
          { stat: "−38%", label: "Regretted attrition on teams with healthy kudos rhythm", tone: "lime" },
          { stat: "74%", label: "Of reviews pre-filled with at least one kudos · quarter over quarter", tone: "blue" },
          { stat: "0", label: "'Great job' empty kudos · tag required", tone: "amber" },
        ]}
      />

      <ModuleConnects
        sourceName="Kudos"
        title={<>Recognition is <span className="hi">never a silo.</span></>}
        subtitle="Kudos flow into reviews, scoring, and culture dashboards. They're a first-class signal — not a feel-good add-on."
        entries={[
          { name: "People", flow: "Kudos history follows the person · across role moves.", href: "/features/people", iconKey: "people" },
          { name: "Reviews", flow: "Q's kudos auto-attach to the review · context for the conversation.", href: "/features/reviews", iconKey: "reviews" },
          { name: "AI Engine", flow: "'Draft a kudos post for this Slack win' · one-shot.", href: "/features/ai-engine", iconKey: "ai" },
          { name: "Kudos", flow: "Aggregates roll up · team value distribution over time.", href: "/features/kudos", iconKey: "kudos" },
        ]}
      />

      <ModuleReplaces
        title={<>What Kudos <span className="hi">replaces.</span></>}
        rows={[
          { old: "Bonusly / Matter / 15Five separate subscription", nu: "Kudos inside your existing operating system · no extra seat fee" },
          { old: "Shout-outs in the Friday Slack that nobody archives", nu: "Values-tagged, searchable, counted into scoring" },
          { old: "Recognition only at performance-review time", nu: "In-the-moment recognition · with review pre-fill as a bonus" },
          { old: "'We should do more kudos' · as an org-wide aspiration", nu: "Kudos decay alerts · signal when recognition stops" },
        ]}
      />

      <ModuleFaq
        title={<>Questions about <span className="hi">recognition design.</span></>}
        items={[
          { q: "Can kudos be anonymous?", a: <p>Optional. Team-visible anonymous (no name shown but aggregated) is popular for upward recognition. Full anonymity — where even the system doesn't know who posted — is not supported, to prevent gaming.</p> },
          { q: "What stops people from farming kudos?", a: <p>Rate limits (max per week), peer-only (can't kudos yourself or your direct reports without moderation), and anti-swap detection (mutual kudos patterns flagged). Manager kudos are weighted separately.</p> },
          { q: "Can we integrate kudos with Slack?", a: <p>Yes. /kudos @user ✦ ownership message posts to both Slack + the in-app feed. Results are identical whether posted from Slack, web, or the mobile PWA.</p> },
          { q: "Do monetary rewards tie in?", a: <p>Optional. You can attach a small reward (e.g. ₹500) to each kudos or to milestone aggregates (e.g. 10 kudos → ₹5000). Razorpay integration handles payout; most teams opt out.</p> },
        ]}
      />

      <ModuleCta
        tone="pink"
        title={<>Recognition that <em>counts.</em></>}
        subtitle="Free trial includes the full kudos module · values customisable on day one."
      />
    </>
  );
}
