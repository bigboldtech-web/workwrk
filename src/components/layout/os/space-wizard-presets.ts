import type {
  ModuleKey,
  PresetId,
  StatusDef,
  ViewKey,
  WorkflowConfig,
} from "./space-wizard-types";

export interface PresetDef {
  id: PresetId;
  title: string;
  blurb: string;
}

export const PRESETS: PresetDef[] = [
  { id: "starter", title: "Starter", blurb: "For everyday tasks" },
  { id: "people-hr", title: "People & HR", blurb: "Onboarding, reviews, kudos" },
  { id: "engineering", title: "Engineering", blurb: "Sprints, dependencies, code" },
  { id: "marketing", title: "Marketing", blurb: "Campaigns and calendars" },
  { id: "operations", title: "Operations", blurb: "Projects and Gantt timelines" },
  { id: "sales", title: "Sales", blurb: "Deal pipeline · Kanban + KPI tracking" },
  { id: "support", title: "Support", blurb: "Ticket queue · SOP-driven responses" },
  { id: "customer-success", title: "Customer Success", blurb: "Renewals, upsells, health scoring" },
];

export interface ViewCatalogEntry {
  key: ViewKey;
  label: string;
  shipped: boolean;
  required?: boolean;
  swatch: string; // tile color in the picker
}

export const VIEW_CATALOG: ViewCatalogEntry[] = [
  { key: "LIST", label: "List", shipped: true, required: true, swatch: "#71717A" },
  { key: "BOARD", label: "Board", shipped: true, swatch: "#3B82F6" },
  { key: "CALENDAR", label: "Calendar", shipped: false, swatch: "#F97316" },
  { key: "TEAM", label: "Team", shipped: false, swatch: "#A855F7" },
  { key: "GANTT", label: "Gantt", shipped: false, swatch: "#EF4444" },
  { key: "TIMELINE", label: "Timeline", shipped: false, swatch: "#F59E0B" },
  { key: "MAP", label: "Map", shipped: false, swatch: "#EA580C" },
  { key: "ACTIVITY", label: "Activity", shipped: false, swatch: "#0EA5E9" },
  { key: "TABLE", label: "Table", shipped: false, swatch: "#10B981" },
  { key: "MIND_MAP", label: "Mind Map", shipped: false, swatch: "#EC4899" },
  { key: "WORKLOAD", label: "Workload", shipped: false, swatch: "#14B8A6" },
];

export interface ModuleCatalogEntry {
  key: ModuleKey;
  label: string;
  blurb: string;
  group: "WORKWRK_NATIVE" | "PROJECT_MGMT";
  /** Whether the wizard shows this in the MVP catalog. Hidden modules are
   *  still valid and can be enabled programmatically or via presets. */
  shownInWizard: boolean;
}

export const MODULE_CATALOG: ModuleCatalogEntry[] = [
  // ── WorkwrK-native ────────────────────────────────────────────
  { key: "KRA", label: "KRAs", blurb: "Key result areas this Space owns", group: "WORKWRK_NATIVE", shownInWizard: true },
  { key: "KPI", label: "KPIs", blurb: "Metrics members are scored on", group: "WORKWRK_NATIVE", shownInWizard: true },
  { key: "SOP", label: "SOPs", blurb: "Required reading + acknowledgements", group: "WORKWRK_NATIVE", shownInWizard: true },
  { key: "NOTES", label: "Notes", blurb: "Embedded docs across tasks", group: "WORKWRK_NATIVE", shownInWizard: true },
  { key: "WHITEBOARDS", label: "Whiteboards", blurb: "Excalidraw canvases anywhere", group: "WORKWRK_NATIVE", shownInWizard: true },
  { key: "TIME_TRACKING", label: "Time Tracking", blurb: "Timers + manual entries", group: "WORKWRK_NATIVE", shownInWizard: true },
  { key: "CALENDAR_VIEW", label: "Calendar view", blurb: "Hierarchical work-visibility calendar", group: "WORKWRK_NATIVE", shownInWizard: true },
  { key: "REVIEWS", label: "Performance Reviews", blurb: "Weekly + quarterly cycles", group: "WORKWRK_NATIVE", shownInWizard: false },
  { key: "KUDOS", label: "Kudos", blurb: "Peer recognition", group: "WORKWRK_NATIVE", shownInWizard: false },
  { key: "CANDOR", label: "Candor", blurb: "Anonymous feedback", group: "WORKWRK_NATIVE", shownInWizard: false },
  { key: "SURVEYS", label: "Surveys", blurb: "Pulse + engagement", group: "WORKWRK_NATIVE", shownInWizard: false },
  { key: "ANNOUNCEMENTS", label: "Announcements", blurb: "Broadcast to the team", group: "WORKWRK_NATIVE", shownInWizard: false },
  { key: "COMPENSATION", label: "Compensation", blurb: "Comp bands + adjustments", group: "WORKWRK_NATIVE", shownInWizard: false },
  { key: "ORG_CHART", label: "Org Chart", blurb: "Reports-to visualization", group: "WORKWRK_NATIVE", shownInWizard: false },
  { key: "HIRING", label: "Hiring Pipeline", blurb: "Candidate tracking", group: "WORKWRK_NATIVE", shownInWizard: false },

  // ── Generic project mgmt ──────────────────────────────────────
  { key: "PRIORITY", label: "Priority", blurb: "Low / Normal / High / Urgent", group: "PROJECT_MGMT", shownInWizard: true },
  { key: "TAGS", label: "Tags", blurb: "Lightweight labels", group: "PROJECT_MGMT", shownInWizard: true },
  { key: "CUSTOM_FIELDS", label: "Custom Fields", blurb: "30-type field shelf", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "TIME_ESTIMATES", label: "Time Estimates", blurb: "Forecast effort", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "SPRINTS", label: "Sprints", blurb: "Time-boxed iterations", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "SPRINT_POINTS", label: "Sprint Points", blurb: "Estimation poker", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "DEPENDENCIES", label: "Dependencies", blurb: "Blocked-by + blocks", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "MULTIPLE_ASSIGNEES", label: "Multiple Assignees", blurb: "Shared ownership", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "WIP_LIMITS", label: "WIP Limits", blurb: "Caps per status", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "INCOMPLETE_WARNING", label: "Incomplete Warning", blurb: "Block close until complete", group: "PROJECT_MGMT", shownInWizard: false },
  { key: "EMAIL", label: "Email", blurb: "Email-to-task ingest", group: "PROJECT_MGMT", shownInWizard: false },
];

// ── Status palettes ──────────────────────────────────────────────
const STATUS_COLORS = {
  todo: "#71717A",
  planning: "#6B7280",
  inProgress: "#6366F1",
  inReview: "#F59E0B",
  atRisk: "#F97316",
  updateRequired: "#EAB308",
  onHold: "#A1A1AA",
  active: "#06B6D4",
  draft: "#94A3B8",
  planned: "#3B82F6",
  published: "#10B981",
  complete: "#10B981",
  done: "#10B981",
  cancelled: "#EC4899",
} as const;

const STARTER_STATUSES: StatusDef[] = [
  { key: "TO_DO", label: "TO DO", group: "ACTIVE", color: STATUS_COLORS.todo },
  { key: "IN_PROGRESS", label: "IN PROGRESS", group: "ACTIVE", color: STATUS_COLORS.inProgress },
  { key: "COMPLETE", label: "COMPLETE", group: "DONE", color: STATUS_COLORS.complete },
];

const HR_STATUSES: StatusDef[] = [
  { key: "DRAFT", label: "DRAFT", group: "ACTIVE", color: STATUS_COLORS.draft },
  { key: "ACTIVE", label: "ACTIVE", group: "ACTIVE", color: STATUS_COLORS.active },
  { key: "COMPLETE", label: "COMPLETE", group: "DONE", color: STATUS_COLORS.complete },
];

const ENG_STATUSES: StatusDef[] = [
  { key: "TO_DO", label: "TO DO", group: "ACTIVE", color: STATUS_COLORS.todo },
  { key: "IN_PROGRESS", label: "IN PROGRESS", group: "ACTIVE", color: STATUS_COLORS.inProgress },
  { key: "IN_REVIEW", label: "IN REVIEW", group: "ACTIVE", color: STATUS_COLORS.inReview },
  { key: "DONE", label: "DONE", group: "DONE", color: STATUS_COLORS.done },
];

const MARKETING_STATUSES: StatusDef[] = [
  { key: "PLANNED", label: "PLANNED", group: "ACTIVE", color: STATUS_COLORS.planned },
  { key: "IN_PROGRESS", label: "IN PROGRESS", group: "ACTIVE", color: STATUS_COLORS.inProgress },
  { key: "PUBLISHED", label: "PUBLISHED", group: "DONE", color: STATUS_COLORS.published },
];

const OPS_STATUSES: StatusDef[] = [
  { key: "PLANNING", label: "PLANNING", group: "ACTIVE", color: STATUS_COLORS.planning },
  { key: "IN_PROGRESS", label: "IN PROGRESS", group: "ACTIVE", color: STATUS_COLORS.inProgress },
  { key: "AT_RISK", label: "AT RISK", group: "ACTIVE", color: STATUS_COLORS.atRisk },
  { key: "COMPLETE", label: "COMPLETE", group: "DONE", color: STATUS_COLORS.complete },
  { key: "CANCELLED", label: "CANCELLED", group: "CLOSED", color: STATUS_COLORS.cancelled },
];

// Sales pipeline — Kanban-native by default. Closed-lost is intentionally
// in the CLOSED group (analytics treats lost separately from won).
const SALES_STATUSES: StatusDef[] = [
  { key: "PROSPECT", label: "PROSPECT", group: "ACTIVE", color: STATUS_COLORS.draft },
  { key: "QUALIFIED", label: "QUALIFIED", group: "ACTIVE", color: STATUS_COLORS.active },
  { key: "PROPOSAL", label: "PROPOSAL", group: "ACTIVE", color: STATUS_COLORS.inProgress },
  { key: "NEGOTIATION", label: "NEGOTIATION", group: "ACTIVE", color: STATUS_COLORS.atRisk },
  { key: "CLOSED_WON", label: "CLOSED WON", group: "DONE", color: STATUS_COLORS.complete },
  { key: "CLOSED_LOST", label: "CLOSED LOST", group: "CLOSED", color: STATUS_COLORS.cancelled },
];

// Customer support — short ticket lifecycle. Awaiting-customer is the
// "blocked on user" pause; resolution-time KPIs typically clock from
// OPEN→RESOLVED minus the awaiting-customer span.
const SUPPORT_STATUSES: StatusDef[] = [
  { key: "OPEN", label: "OPEN", group: "ACTIVE", color: STATUS_COLORS.todo },
  { key: "IN_PROGRESS", label: "IN PROGRESS", group: "ACTIVE", color: STATUS_COLORS.inProgress },
  { key: "AWAITING_CUSTOMER", label: "AWAITING CUSTOMER", group: "ACTIVE", color: STATUS_COLORS.updateRequired },
  { key: "RESOLVED", label: "RESOLVED", group: "DONE", color: STATUS_COLORS.complete },
  { key: "CLOSED", label: "CLOSED", group: "CLOSED", color: STATUS_COLORS.cancelled },
];

// Customer success — account lifecycle, not deal lifecycle. ONBOARDING
// kicks in post-close, ADOPTION measures engagement, AT_RISK is the
// churn signal, RENEWED and EXPANSION are the two healthy exits, and
// CHURNED is the closed-lost analogue.
const CS_STATUSES: StatusDef[] = [
  { key: "ONBOARDING", label: "ONBOARDING", group: "ACTIVE", color: STATUS_COLORS.draft },
  { key: "ADOPTION", label: "ADOPTION", group: "ACTIVE", color: STATUS_COLORS.active },
  { key: "HEALTHY", label: "HEALTHY", group: "ACTIVE", color: STATUS_COLORS.inProgress },
  { key: "AT_RISK", label: "AT RISK", group: "ACTIVE", color: STATUS_COLORS.atRisk },
  { key: "RENEWED", label: "RENEWED", group: "DONE", color: STATUS_COLORS.complete },
  { key: "EXPANSION", label: "EXPANSION", group: "DONE", color: STATUS_COLORS.published },
  { key: "CHURNED", label: "CHURNED", group: "CLOSED", color: STATUS_COLORS.cancelled },
];

interface PresetWorkflow {
  views: ViewKey[];
  defaultView: ViewKey;
  statuses: StatusDef[];
  modules: ModuleKey[];
}

const PRESET_WORKFLOWS: Record<PresetId, PresetWorkflow> = {
  starter: {
    views: ["LIST", "BOARD"],
    defaultView: "LIST",
    statuses: STARTER_STATUSES,
    modules: ["KRA", "KPI", "SOP", "NOTES", "WHITEBOARDS", "PRIORITY", "TAGS"],
  },
  "people-hr": {
    views: ["LIST", "BOARD"],
    defaultView: "LIST",
    statuses: HR_STATUSES,
    modules: ["KRA", "KPI", "SOP", "REVIEWS", "KUDOS", "CANDOR", "NOTES", "WHITEBOARDS"],
  },
  engineering: {
    views: ["BOARD", "LIST", "GANTT"],
    defaultView: "BOARD",
    statuses: ENG_STATUSES,
    modules: ["KRA", "KPI", "SPRINTS", "DEPENDENCIES", "TIME_TRACKING", "PRIORITY", "NOTES", "WHITEBOARDS"],
  },
  marketing: {
    views: ["BOARD", "CALENDAR"],
    defaultView: "BOARD",
    statuses: MARKETING_STATUSES,
    modules: ["KRA", "KPI", "TAGS", "TIME_ESTIMATES", "CUSTOM_FIELDS", "NOTES", "WHITEBOARDS", "CALENDAR_VIEW"],
  },
  operations: {
    views: ["LIST", "GANTT", "TIMELINE"],
    defaultView: "LIST",
    statuses: OPS_STATUSES,
    modules: ["KRA", "KPI", "SOP", "PRIORITY", "DEPENDENCIES", "TIME_TRACKING", "NOTES", "WHITEBOARDS"],
  },
  // The user's "Lego" framing in action: Sales gets a board-by-default
  // Space with a pipeline status set + the modules a sales team actually
  // touches (custom fields for deal value, time tracking per deal).
  // Not a CRM app — it's the same primitives, pre-arranged for a real
  // use case. Customer renames/restructures freely.
  sales: {
    views: ["BOARD", "LIST", "CALENDAR"],
    defaultView: "BOARD",
    statuses: SALES_STATUSES,
    modules: [
      "KRA", "KPI", "NOTES", "WHITEBOARDS",
      "PRIORITY", "TAGS", "CUSTOM_FIELDS",
      "TIME_TRACKING", "MULTIPLE_ASSIGNEES",
    ],
  },
  support: {
    views: ["BOARD", "LIST"],
    defaultView: "BOARD",
    statuses: SUPPORT_STATUSES,
    modules: [
      "KRA", "KPI", "SOP", "NOTES",
      "PRIORITY", "TAGS", "TIME_TRACKING", "TIME_ESTIMATES",
    ],
  },
  // Customer Success — account book is fundamentally a list with a
  // calendar overlay (renewal dates) and a Kanban for at-a-glance
  // health stage. Custom fields land ARR/contract-end-date/CSM owner;
  // SOPs script handoff + escalation playbooks.
  "customer-success": {
    views: ["LIST", "BOARD", "CALENDAR"],
    defaultView: "LIST",
    statuses: CS_STATUSES,
    modules: [
      "KRA", "KPI", "SOP", "NOTES",
      "PRIORITY", "TAGS", "CUSTOM_FIELDS",
      "MULTIPLE_ASSIGNEES", "CALENDAR_VIEW",
    ],
  },
};

/** Materialize a fresh workflow config from a preset choice. */
export function workflowFromPreset(preset: PresetId, ownerId: string | null = null): WorkflowConfig {
  const w = PRESET_WORKFLOWS[preset];
  return {
    preset,
    ownerId,
    linkedKraIds: [],
    defaultViews: [...w.views],
    defaultViewKey: w.defaultView,
    statuses: w.statuses.map((s) => ({ ...s })),
    modules: [...w.modules],
  };
}
