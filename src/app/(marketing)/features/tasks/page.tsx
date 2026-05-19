import type { Metadata } from "next";
import { CheckSquare, Repeat, Bell, ArrowUpRight, Users, Calendar } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Tasks — WorkwrK",
  description: "Personal, team, and cross-functional tasks with auto-escalation. The execution layer of workwrk — built so things don't fall through the cracks.",
  alternates: { canonical: "https://workwrk.com/features/tasks" },
};

export default function TasksFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="work"
      hue="sky"
      eyebrow="Work hub · Tasks"
      title={<>Tasks that <GradientText hue="sky">don't fall through cracks.</GradientText></>}
      lede="Personal, team, and cross-functional tasks with auto-escalation when an SLA breaches. The kind of accountability spreadsheets can't enforce."
      capabilities={[
        { icon: CheckSquare,  title: "Five views",        body: "List, board, calendar, timeline, swimlane. Pick whatever your team thinks in." },
        { icon: Bell,         title: "Auto-escalation",   body: "Past due 24h? Notify the assignee. 48h? Notify the manager. 72h? Manager's manager." },
        { icon: ArrowUpRight, title: "Linked to KPIs",    body: "Task completion rate is a KPI in itself — auto-pulled into review scores." },
        { icon: Repeat,       title: "Recurring + chains",body: "Weekly standup tasks, monthly close, quarterly review prep. Set once, run forever." },
        { icon: Users,        title: "Cross-functional",  body: "Tasks span departments. Ownership is clear; routing is automatic; status is shared." },
        { icon: Calendar,     title: "Calendar integration", body: "Two-way sync with Google + Microsoft. Tasks show as time blocks; deadlines as events." },
      ]}
      relatedSlugs={["sops", "okrs", "kpis", "ai-engine"]}
      testimonial={{
        quote: "Auto-escalation alone justified the switch. We went from chasing things in Slack to never having to chase.",
        author: "Karim Al-Saadi",
        role: "VP Ops",
        company: "Stratum Logistics",
      }}
      faq={[
        { q: "Can tasks be private?",                      a: "Yes — personal tasks are scoped to you. Team and cross-functional tasks are visible to the stakeholders." },
        { q: "How does this differ from Asana?",            a: "Tasks share a data model with KPIs, OKRs, SOPs, and reviews. Closing a task auto-increments the related KPI. Asana is a silo; workwrk is connected." },
        { q: "Does auto-escalation get noisy?",             a: "Configurable per task type. Some teams want hard escalation; others want a single nudge. You decide." },
      ]}
    />
  );
}
