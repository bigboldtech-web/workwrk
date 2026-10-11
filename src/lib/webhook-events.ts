// The webhook events, as ONE list: the names POST /api/webhooks accepts for a
// subscription and the OpenAPI document's x-events. Every name here is one
// something passes to dispatchEvent (src/services/webhookDispatcher.ts),
// which delivers it to every ACTIVE subscription that names it or "*";
// webhook-events.test.ts reads the source and holds both directions, so a
// name nothing sends can never be offered and a name that is sent can never
// be missing.
//
// Not here: the integration webhooks (Settings > Integrations, a Slack or
// custom URL, src/lib/webhooks.ts broadcastWebhook) carry their own event
// names (meeting_created, sop_published, reviews_finalized, user_invited)
// and never reach a subscription made here. The automation time triggers
// (task.date_arrives, schedule.every) run automations directly and are never
// sent to a webhook either.
//
// Pure: no imports.

export interface WebhookEvent {
  name: string;
  description: string;
}

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  { name: "kudos.created", description: "Fired on every new kudos." },
  { name: "kpi.recorded", description: "Fired when a KPI reading is logged through this API (POST /kpi-records) or an integration." },
  {
    name: "task.created",
    description:
      "Fired for a task added to a List in the app, a task made through this API (POST /tasks) or an integration, " +
      "and a task an automation's Create a task step makes. Not fired for tasks that arrive any other way: " +
      "copies (duplicating a task, a List or a Space), tasks from a template, the next task of a repeating task, " +
      "tasks an SOP adds, a form response that makes a task, meeting action items, quick add from My work, " +
      "tasks an AI teammate or a workflow makes, and imports.",
  },
  {
    name: "task.status_changed",
    description:
      "Fired when a task's status changes: one task edited in the app or by an AI teammate, a bulk edit, or an automation step. Carries previousStatus.",
  },
  {
    name: "task.assignee_changed",
    description:
      "Fired when a task's main assignee changes: one task edited in the app or by an AI teammate, a bulk edit, or an automation step. Carries previousAssigneeId.",
  },
  {
    name: "task.field_changed",
    description:
      "Fired once for each field a change touches (title, priority, dates and the List's own fields): one task edited in the app or by an AI teammate, " +
      "a bulk edit, an AI field fill, or an automation's Set a field step. One edit of one task fires it for at most 20 fields; " +
      "a change to more fields than that sends the first 20 only.",
  },
];

/** Every event name a subscription may name, and "*" for all of them. */
export const WEBHOOK_EVENT_NAMES: readonly string[] = WEBHOOK_EVENTS.map((e) => e.name);
export const WEBHOOK_ANY = "*";

/** The stored names of a subscription that nothing sends (kept, never dropped; GET /api/webhooks reports them). */
export function unsentWebhookEvents(events: readonly string[]): string[] {
  return events.filter((e) => e !== WEBHOOK_ANY && !WEBHOOK_EVENT_NAMES.includes(e));
}
