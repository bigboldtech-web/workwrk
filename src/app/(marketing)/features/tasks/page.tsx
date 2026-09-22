// /features/tasks, rewritten against the product.
//
// Gone from the old page: an invented customer ("Karim Al-Saadi, Stratum
// Logistics") whose quote also named a third party chat product, an FAQ
// answer comparing the product to a competitor by name outside /compare,
// and "auto-escalation when overdue" sold as the headline mechanism when
// nothing in the repo escalates a task by itself.
//
// What is here instead is the part of this product that has the most work
// in it and was the least described: the views, the fields, and everything
// a person can rearrange.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Tasks, lists and boards",
  description:
    "Lists, boards and every view, with custom fields, per-list statuses, grouping, filtering, saved views, bulk actions and drag to reorder or reschedule.",
  alternates: { canonical: "https://workwrk.com/features/tasks" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Tasks, lists and boards",
    description: "Every view, custom fields, per-list statuses, saved views and bulk actions. The work block.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Every view, custom fields, per-list statuses, saved views and bulk actions. The work block." },
};

export default function TasksFeaturePage() {
  return (
    <FeatureSubPage
      slug="tasks"
      hubSlug="work"
      eyebrow="Work"
      title="One task. Every view. One record."
      lede="Spaces, folders, lists and boards, with the view types a team actually argues about."
      capabilities={[
        { title: "Every view",
          body: "List, Board, Table, Calendar, Gantt, Timeline, Workload, Gallery and the rest, on the same data. Name a view and it is saved, for you or for everyone.",
        },
        { title: "Columns you control",
          body: "Add, reorder, hide, resize and freeze columns. Custom fields of thirty types, including a link to a doc, an SOP or another record.",
        },
        { title: "Group, filter, sort, search",
          body: "Group by any field, filter on several at once, sort, and search inside the list. Bulk actions on the selection, and drag to reorder or to reschedule.",
        },
        { title: "Subtasks and checklists",
          body: "Subtasks, a checklist on the task, priority, tags, assignees and per list statuses, so Done means what your team decided it means.",
        },
        { title: "Dates, repeats and reminders",
          body: "A start and a due date, a recurrence that rolls forward on completion, and a reminder that actually fires into the bell.",
        },
        { title: "Time on the task",
          body: "A timer on the task, and the logged time visible on the calendar and in the planner beside the work it belongs to.",
        },
      ]}
      workflowTitle="What a task carries."
      workflowSteps={[
        "The status, the owner and the dates, in one place rather than four",
        "Links to the doc, the SOP, the KRA or the record it came from",
        "Its subtasks, its checklist and the conversation held on it",
        "The goal it is linked to, so finishing it shows up where the goal is read",
      ]}
      surfaceKey="board-list"
      surfaceCrumb="My work"
      surfaceLabel="The Work block: the Onboarding board as a list, with statuses, owners and due dates on every row."
      relatedSlugs={["sops", "okrs", "kpis"]}
      faq={[
        {
          q: "Can I keep my own view of a list?",
          a: "Yes. A view holds its own grouping, filters, sort, visible columns and widths, and it can be private to you or shared with everyone on the list.",
        },
        {
          q: "Can a list have its own statuses?",
          a: "Yes. Statuses are per list, so an onboarding list and an engineering list do not have to pretend to be the same pipeline.",
        },
        {
          q: "Does a task escalate on its own when it is overdue?",
          a: "No. Overdue is visible everywhere it should be and a reminder fires, but nothing reassigns or escalates a task by itself. When that ships it will be described here as a mechanism, not as a mood.",
        },
        {
          q: "Can I import a list from a spreadsheet?",
          a: "You can import into a table from a CSV. There is no importer that reads another product's export for you, and we would rather say so.",
        },
      ]}
    />
  );
}
