/**
 * Trigger catalog, every event key the Automation Hub can react to.
 *
 * `isEmitting: true`  = the key is actually passed to `dispatchEvent`
 *                       somewhere in src/ today, so ACTIVE workflows on
 *                       it fire for real.
 * `isEmitting: false` = catalog-only seed (the plan's Cashkr/candidate
 *                       keys). The builder shows them as "not yet
 *                       emitting"; they light up automatically once the
 *                       owning domain starts dispatching, no engine
 *                       change needed.
 *
 * Real emitters today (grep `dispatchEvent` from @/services/webhookDispatcher):
 *   task.created         api/boards/[id]/items POST, api/v1/tasks POST,
 *                        api/integrations/ingest
 *   task.status_changed  api/items/[id] PATCH (board items)
 *   task.assignee_changed api/items/[id] PATCH (board items)
 *   task.field_changed   api/items/[id] PATCH (one event per changed field)
 *   task.date_arrives    the automation-schedule cron (lib/automation/schedule.ts)
 *   schedule.every       the automation-schedule cron (lib/automation/schedule.ts)
 *   kpi.recorded         api/v1/kpi-records POST, api/integrations/ingest
 *   kudos.created        api/v1/kudos POST, api/integrations/ingest
 */

export interface TriggerField {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "user" | "boolean" | "status" | "priority" | "list";
  /** Kept so an older condition on it still reads, but not offered for new ones. */
  legacy?: boolean;
}

export interface AutomationTrigger {
  key: string;
  name: string;
  /** Reads after "When": "a task is created". The display name everywhere a run or row names its trigger. */
  phrase: string;
  category: string;
  description: string;
  isEmitting: boolean;
  /** Payload fields the condition builder can test. */
  fields: TriggerField[];
}

const TASK_FIELDS: TriggerField[] = [
  { key: "title", label: "Title", type: "string" },
  { key: "status", label: "Status", type: "status" },
  { key: "priority", label: "Priority", type: "priority" },
  { key: "ownerId", label: "Assignee", type: "user" },
  { key: "dueAt", label: "Due date", type: "date" },
  { key: "boardId", label: "List", type: "list" },
  { key: "actorId", label: "Who did it", type: "user" },
  { key: "id", label: "Task", type: "string", legacy: true },
  { key: "assigneeId", label: "Assignee", type: "user", legacy: true },
];

export const AUTOMATION_TRIGGERS: AutomationTrigger[] = [
  // ── Emitting today ────────────────────────────────────────────────
  {
    key: "task.created",
    name: "Task created",
    phrase: "a task is created",
    category: "Tasks",
    description: "A task is created in a List, through the API or by an integration.",
    isEmitting: true,
    fields: TASK_FIELDS,
  },
  {
    key: "task.status_changed",
    name: "Task status changes",
    phrase: "a task's status changes",
    category: "Tasks",
    description: "A board task moves to a different status.",
    isEmitting: true,
    fields: [...TASK_FIELDS, { key: "previousStatus", label: "Previous status", type: "status" }],
  },
  {
    key: "task.assignee_changed",
    name: "Task assignee changes",
    phrase: "a task's assignee changes",
    category: "Tasks",
    description: "A board task is assigned, reassigned, or unassigned.",
    isEmitting: true,
    fields: [...TASK_FIELDS, { key: "previousAssigneeId", label: "Previous assignee", type: "user" }],
  },
  {
    key: "kpi.recorded",
    name: "KPI reading recorded",
    phrase: "a KPI reading is recorded",
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
    phrase: "someone gives kudos",
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

  {
    key: "task.field_changed",
    name: "Task field changes",
    phrase: "a task field changes",
    category: "Tasks",
    description: "A task's priority, dates, title or one of its List's fields changes. Pick which field under When.",
    isEmitting: true,
    fields: [
      ...TASK_FIELDS,
      { key: "field", label: "Changed field", type: "string" },
      { key: "value", label: "New value", type: "string" },
      { key: "previousValue", label: "Previous value", type: "string" },
    ],
  },
  {
    key: "task.date_arrives",
    name: "Task date arrives",
    phrase: "a task's date arrives",
    category: "Time",
    description: "A task's due date or start date arrives, or a set number of days before or after it.",
    isEmitting: true,
    fields: [...TASK_FIELDS, { key: "startAt", label: "Start date", type: "date" }, { key: "dateField", label: "Which date", type: "string" }],
  },
  {
    key: "schedule.every",
    name: "On a schedule",
    phrase: "the scheduled time comes",
    category: "Time",
    description: "Every day, every week on a chosen day, or every month on a chosen date, at a set time.",
    isEmitting: true,
    fields: [
      { key: "firedAt", label: "Time it ran", type: "date" },
      { key: "period", label: "Period", type: "string" },
    ],
  },

  // ── Catalog-only (not yet emitting) ───────────────────────────────
  {
    key: "review.completed",
    name: "Review completed",
    phrase: "a review is completed",
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
    phrase: "an SOP is published",
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
    phrase: "a lead is created",
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
    phrase: "a lead's status changes",
    category: "Leads",
    description: "A lead moves to a different pipeline stage.",
    isEmitting: false,
    fields: [
      { key: "id", label: "Lead id", type: "string" },
      { key: "status", label: "Status", type: "string" },
      { key: "previousStatus", label: "Previous status", type: "status" },
      { key: "ownerId", label: "Owner", type: "user" },
    ],
  },
  {
    key: "lead.owner_changed",
    name: "Lead owner changes",
    phrase: "a lead's owner changes",
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
    phrase: "a quote is generated",
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
    phrase: "a quote is accepted",
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
    phrase: "a pickup is scheduled",
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
    phrase: "a pickup is completed",
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
    phrase: "a payment succeeds",
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
    phrase: "a payment fails",
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

/**
 * The Cashkr-era triggers (leads, quotes, pickups, payments) belong to a
 * vertical this product no longer ships. They are HIDDEN behind a product
 * flag, never deleted: a workflow already built on one keeps its trigger, its
 * name still resolves everywhere, and an org that turns the flag on
 * (Organization.settings.automation.legacyTriggers === true) gets them back
 * in the picker. Decided in docs/plans/competitor-gap-2026-09.md section 7.
 */
const LEGACY_TRIGGER_PREFIXES = ["lead.", "quote.", "pickup.", "payment."] as const;

export function isLegacyTrigger(key: string): boolean {
  return LEGACY_TRIGGER_PREFIXES.some((p) => key.startsWith(p));
}

/** The org's product flag, read tolerantly: absent means off. */
export function legacyTriggersEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const automation = (settings as Record<string, unknown>).automation;
  if (!automation || typeof automation !== "object" || Array.isArray(automation)) return false;
  return (automation as Record<string, unknown>).legacyTriggers === true;
}

/**
 * The catalog as the builder sees it: every trigger, with `hidden: true` on a
 * legacy one while the flag is off. Hidden triggers stay in the list so an
 * existing workflow, a template or a log row can still print the name; the
 * picker leaves them out unless one is the workflow's current trigger.
 */
export function triggersForOrg(showLegacy: boolean): Array<AutomationTrigger & { hidden?: boolean }> {
  return AUTOMATION_TRIGGERS.map((t) => (!showLegacy && isLegacyTrigger(t.key) ? { ...t, hidden: true } : t));
}

/**
 * The trigger as people read it: "When a task is created". A key that is no
 * longer in the catalog reads as words too, never as the raw key.
 */
export function triggerDisplayName(key: string | null | undefined): string {
  if (!key) return "No trigger";
  const t = TRIGGER_BY_KEY.get(key);
  return t ? `When ${t.phrase}` : "A trigger that no longer exists";
}

/** The trigger fields a condition can test, by key. */
export function triggerFieldsFor(key: string | null | undefined): TriggerField[] {
  return (key && TRIGGER_BY_KEY.get(key)?.fields) || [];
}
