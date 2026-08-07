/**
 * Trigger catalog — every event key the Automation Hub can react to.
 *
 * `isEmitting: true`  = the key is actually passed to `dispatchEvent`
 *                       somewhere in src/ today, so ACTIVE workflows on
 *                       it fire for real.
 * `isEmitting: false` = catalog-only seed (the plan's Cashkr/candidate
 *                       keys). The builder shows them as "not yet
 *                       emitting"; they light up automatically once the
 *                       owning domain starts dispatching — no engine
 *                       change needed.
 *
 * Real emitters today (grep `dispatchEvent` from @/services/webhookDispatcher):
 *   task.created          — api/v1/tasks POST, api/integrations/ingest
 *   task.status_changed   — api/items/[id] PATCH (board items)
 *   task.assignee_changed — api/items/[id] PATCH (board items)
 *   kpi.recorded          — api/v1/kpi-records POST, api/integrations/ingest
 *   kudos.created         — api/v1/kudos POST, api/integrations/ingest
 */

export interface TriggerField {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "user" | "boolean";
}

export interface AutomationTrigger {
  key: string;
  name: string;
  category: string;
  description: string;
  isEmitting: boolean;
  /** Payload fields the condition builder can test. */
  fields: TriggerField[];
}

const TASK_FIELDS: TriggerField[] = [
  { key: "id", label: "Task id", type: "string" },
  { key: "title", label: "Title", type: "string" },
  { key: "status", label: "Status", type: "string" },
  { key: "priority", label: "Priority", type: "string" },
  { key: "ownerId", label: "Assignee", type: "user" },
  { key: "assigneeId", label: "Assignee (alias)", type: "user" },
  { key: "boardId", label: "Board id", type: "string" },
  { key: "dueAt", label: "Due date", type: "date" },
];

export const AUTOMATION_TRIGGERS: AutomationTrigger[] = [
  // ── Emitting today ────────────────────────────────────────────────
  {
    key: "task.created",
    name: "Task created",
    category: "Tasks",
    description: "A task is created via the API or an integration ingest.",
    isEmitting: true,
    fields: TASK_FIELDS,
  },
  {
    key: "task.status_changed",
    name: "Task status changes",
    category: "Tasks",
    description: "A board task moves to a different status.",
    isEmitting: true,
    fields: [...TASK_FIELDS, { key: "previousStatus", label: "Previous status", type: "string" }],
  },
  {
    key: "task.assignee_changed",
    name: "Task assignee changes",
    category: "Tasks",
    description: "A board task is assigned, reassigned, or unassigned.",
    isEmitting: true,
    fields: [...TASK_FIELDS, { key: "previousAssigneeId", label: "Previous assignee", type: "user" }],
  },
  {
    key: "kpi.recorded",
    name: "KPI reading recorded",
    category: "Performance",
    description: "A KPI actual is recorded for a person and period.",
    isEmitting: true,
    fields: [
      { key: "id", label: "Record id", type: "string" },
      { key: "kpiId", label: "KPI id", type: "string" },
      { key: "userId", label: "Person", type: "user" },
      { key: "period", label: "Period", type: "string" },
      { key: "targetValue", label: "Target value", type: "number" },
      { key: "actualValue", label: "Actual value", type: "number" },
      { key: "score", label: "Score", type: "number" },
    ],
  },
  {
    key: "kudos.created",
    name: "Kudos given",
    category: "People",
    description: "Someone posts kudos to a teammate.",
    isEmitting: true,
    fields: [
      { key: "id", label: "Kudos id", type: "string" },
      { key: "giverId", label: "Giver", type: "user" },
      { key: "receiverId", label: "Receiver", type: "user" },
      { key: "companyValue", label: "Company value", type: "string" },
    ],
  },

  // ── Catalog-only (not yet emitting) ───────────────────────────────
  {
    key: "review.completed",
    name: "Review completed",
    category: "Performance",
    description: "A performance review cycle entry is finalized.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Review id", type: "string" },
      { key: "userId", label: "Person", type: "user" },
      { key: "score", label: "Overall score", type: "number" },
    ],
  },
  {
    key: "sop.published",
    name: "SOP published",
    category: "Docs",
    description: "A standard operating procedure is published to the org.",
    isEmitting: false,
    fields: [
      { key: "id", label: "SOP id", type: "string" },
      { key: "title", label: "Title", type: "string" },
    ],
  },
  {
    key: "lead.created",
    name: "Lead created",
    category: "Leads",
    description: "A new lead lands in the pipeline.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Lead id", type: "string" },
      { key: "source", label: "Source", type: "string" },
      { key: "status", label: "Status", type: "string" },
      { key: "ownerId", label: "Owner", type: "user" },
    ],
  },
  {
    key: "lead.status_changed",
    name: "Lead status changes",
    category: "Leads",
    description: "A lead moves to a different pipeline stage.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Lead id", type: "string" },
      { key: "status", label: "Status", type: "string" },
      { key: "previousStatus", label: "Previous status", type: "string" },
      { key: "ownerId", label: "Owner", type: "user" },
    ],
  },
  {
    key: "lead.owner_changed",
    name: "Lead owner changes",
    category: "Leads",
    description: "A lead is claimed or handed to a different owner.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Lead id", type: "string" },
      { key: "ownerId", label: "Owner", type: "user" },
      { key: "previousOwnerId", label: "Previous owner", type: "user" },
    ],
  },
  {
    key: "quote.generated",
    name: "Quote generated",
    category: "Cashkr Ops",
    description: "A buyback quote is generated for a device.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Quote id", type: "string" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "deviceModel", label: "Device model", type: "string" },
    ],
  },
  {
    key: "quote.accepted",
    name: "Quote accepted",
    category: "Cashkr Ops",
    description: "A customer accepts a buyback quote.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Quote id", type: "string" },
      { key: "amount", label: "Amount", type: "number" },
    ],
  },
  {
    key: "pickup.scheduled",
    name: "Pickup scheduled",
    category: "Cashkr Ops",
    description: "A device pickup is scheduled.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Pickup id", type: "string" },
      { key: "scheduledAt", label: "Scheduled time", type: "date" },
      { key: "city", label: "City", type: "string" },
    ],
  },
  {
    key: "pickup.completed",
    name: "Pickup completed",
    category: "Cashkr Ops",
    description: "A device pickup is completed by the field agent.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Pickup id", type: "string" },
      { key: "agentId", label: "Agent", type: "user" },
    ],
  },
  {
    key: "payment.successful",
    name: "Payment successful",
    category: "Cashkr Ops",
    description: "A customer payout or payment succeeds.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Payment id", type: "string" },
      { key: "amount", label: "Amount", type: "number" },
    ],
  },
  {
    key: "payment.failed",
    name: "Payment failed",
    category: "Cashkr Ops",
    description: "A customer payout or payment fails.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Payment id", type: "string" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "failureReason", label: "Failure reason", type: "string" },
    ],
  },
];

const TRIGGER_BY_KEY = new Map(AUTOMATION_TRIGGERS.map((t) => [t.key, t] as const));

export function getTrigger(key: string): AutomationTrigger | undefined {
  return TRIGGER_BY_KEY.get(key);
}
