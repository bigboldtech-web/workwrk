// Field catalog — the 30-type vocabulary from the 2026-06-02 ClickUp
// screenshot. Each FieldType is a key that lives inside
// Board.schema.fields[].type and Item.metadata[field.key].
//
// Tier 1 — fully rendered in TABLE + drawer: TEXT, LONG_TEXT, NUMBER,
//          DATE, DATETIME, DROPDOWN, MULTI_SELECT, CHECKBOX, URL,
//          EMAIL, PHONE, MONEY, PERCENT, RATING, LABELS, USER, FILES.
// Tier 2 — placeholder in MVP, renders as "—" until wired:
//          FORMULA, ROLLUP, RELATIONSHIP, BUTTON, SIGNATURE,
//          LOCATION, PROGRESS_AUTO, PROGRESS_MANUAL, SENTIMENT,
//          CATEGORIZE, TRANSLATION, SUMMARY, ACTION_ITEMS,
//          TSHIRT_SIZE, VOTING, CUSTOM_TEXT, CUSTOM_DROPDOWN.

import {
  Type, AlignLeft, Hash, Calendar as CalIcon, CalendarClock,
  ChevronDown, ListChecks, CheckSquare, Link as LinkIcon, AtSign,
  Phone, DollarSign, Percent, Star, Tag, User as UserIcon, Users,
  Paperclip, Sigma, ArrowRightLeft, ToggleLeft, PenLine,
  MapPin, GaugeCircle, Gauge, Activity, Languages, FileText, ScrollText,
  CheckCheck, Shirt, ThumbsUp, Sparkles, ListFilter, Target, BookOpen,
  Flag, Box, CircleDot, MessageSquare, GanttChart, Clock, Link2,
  CalendarCheck, GitPullRequest,
  type LucideIcon,
} from "lucide-react";

// Per-type icon colors — grouped into ClickUp's families so the Fields panel
// reads as one system (blue = text, green = number/date/choice, pink = contact/
// people, violet = boolean/rating/AI, orange = progress, amber = connections).
const C = {
  blue: "#3B82F6", green: "#10B981", pink: "#EC4899", violet: "#8B5CF6",
  orange: "#F97316", amber: "#B45309", indigo: "#6366F1",
} as const;

export type FieldType =
  // text / number
  | "TEXT" | "LONG_TEXT" | "NUMBER"
  // time
  | "DATE" | "DATETIME"
  // selectable
  | "DROPDOWN" | "MULTI_SELECT" | "CHECKBOX" | "LABELS" | "TSHIRT_SIZE"
  // contact / link
  | "URL" | "EMAIL" | "PHONE"
  // money / progress
  | "MONEY" | "PERCENT" | "RATING" | "PROGRESS_AUTO" | "PROGRESS_MANUAL"
  // people / files
  | "USER" | "PEOPLE" | "FILES"
  // structural / relational
  | "RELATIONSHIP" | "ROLLUP" | "FORMULA" | "LOCATION"
  // actions
  | "BUTTON" | "SIGNATURE" | "VOTING" | "ACTION_ITEMS"
  // AI-typed
  | "SUMMARY" | "SENTIMENT" | "CATEGORIZE" | "TRANSLATION"
  | "CUSTOM_TEXT" | "CUSTOM_DROPDOWN"
  // WorkwrK AI-OS gating fields (Phase 4)
  | "KRA"
  // connection-as-field — link a Doc / SOP to the row (mirror KRA)
  | "LINKED_DOC" | "LINKED_SOP";

export interface FieldCatalogEntry {
  type: FieldType;
  label: string;
  Icon: LucideIcon;
  /** Icon tint (ClickUp-style colored field icons). */
  color: string;
  group: "Common" | "AI" | "Advanced" | "WorkwrK";
  /** Whether this phase ships a real renderer (true) or a stub (false). */
  tier1: boolean;
  description?: string;
}

export const FIELD_CATALOG: FieldCatalogEntry[] = [
  // ── Common ──────────────────────────────────────────────────
  { type: "TEXT",        label: "Text",          Icon: Type,        color: C.blue,   group: "Common", tier1: true,  description: "A short line of text" },
  { type: "LONG_TEXT",   label: "Long text",     Icon: AlignLeft,   color: C.blue,   group: "Common", tier1: true,  description: "A multi-line text area" },
  { type: "NUMBER",      label: "Number",        Icon: Hash,        color: C.green,  group: "Common", tier1: true,  description: "A numeric value" },
  { type: "DATE",        label: "Date",          Icon: CalIcon,     color: C.green,  group: "Common", tier1: true,  description: "A single date" },
  { type: "DATETIME",    label: "Date & time",   Icon: CalendarClock, color: C.green, group: "Common", tier1: true, description: "A date with a time" },
  { type: "DROPDOWN",    label: "Dropdown",      Icon: ChevronDown, color: C.green,  group: "Common", tier1: true,  description: "Pick one option from a list" },
  { type: "MULTI_SELECT",label: "Multi-select",  Icon: ListChecks,  color: C.green,  group: "Common", tier1: true,  description: "Pick several options from a list" },
  { type: "CHECKBOX",    label: "Checkbox",      Icon: CheckSquare, color: C.violet, group: "Common", tier1: true,  description: "A simple yes / no checkbox" },
  { type: "LABELS",      label: "Labels",        Icon: Tag,         color: C.green,  group: "Common", tier1: true,  description: "Multiple colored labels" },
  { type: "URL",         label: "Website",       Icon: LinkIcon,    color: C.pink,   group: "Common", tier1: true,  description: "A web link" },
  { type: "EMAIL",       label: "Email",         Icon: AtSign,      color: C.pink,   group: "Common", tier1: true,  description: "An email address" },
  { type: "PHONE",       label: "Phone",         Icon: Phone,       color: C.pink,   group: "Common", tier1: true,  description: "A phone number" },
  { type: "MONEY",       label: "Money",         Icon: DollarSign,  color: C.green,  group: "Common", tier1: true,  description: "A currency amount" },
  { type: "PERCENT",     label: "Percent",       Icon: Percent,     color: C.green,  group: "Common", tier1: true,  description: "A percentage value" },
  { type: "RATING",      label: "Rating",        Icon: Star,        color: C.violet, group: "Common", tier1: true,  description: "A star rating" },
  { type: "USER",        label: "Person",        Icon: UserIcon,    color: C.pink,   group: "Common", tier1: true,  description: "A single person" },
  { type: "PEOPLE",      label: "People",        Icon: Users,       color: C.pink,   group: "Common", tier1: true, description: "Multiple people on one row" },
  { type: "FILES",       label: "Files",         Icon: Paperclip,   color: C.violet, group: "Common", tier1: true,  description: "Attach files to the row" },

  // ── AI ──────────────────────────────────────────────────────
  { type: "SUMMARY",       label: "Summary",       Icon: ScrollText, color: C.violet, group: "AI", tier1: false, description: "AI summary of the row" },
  { type: "SENTIMENT",     label: "Sentiment",     Icon: Activity,   color: C.violet, group: "AI", tier1: false, description: "AI sentiment score" },
  { type: "CATEGORIZE",    label: "Categorize",    Icon: Sparkles,   color: C.violet, group: "AI", tier1: false, description: "AI auto-categorization" },
  { type: "TRANSLATION",   label: "Translation",   Icon: Languages,  color: C.violet, group: "AI", tier1: false, description: "AI translation of text" },
  { type: "CUSTOM_TEXT",   label: "Custom text",   Icon: Sparkles,   color: C.violet, group: "AI", tier1: false, description: "Free-form AI text on the row" },
  { type: "CUSTOM_DROPDOWN", label: "Custom dropdown", Icon: Sparkles, color: C.violet, group: "AI", tier1: false, description: "AI-picked option from a list" },

  // ── WorkwrK AI-OS ───────────────────────────────────────────
  { type: "KRA", label: "KRA tag", Icon: Target, color: C.amber, group: "WorkwrK", tier1: true, description: "Tag this row with an organizational KRA" },
  { type: "LINKED_DOC", label: "Linked Doc", Icon: FileText, color: C.amber, group: "WorkwrK", tier1: true, description: "Link a Doc to this row" },
  { type: "LINKED_SOP", label: "Linked SOP", Icon: BookOpen, color: C.amber, group: "WorkwrK", tier1: true, description: "Link an SOP to this row" },

  // ── Advanced ────────────────────────────────────────────────
  { type: "FORMULA",          label: "Formula",         Icon: Sigma,         color: C.green,  group: "Advanced", tier1: false, description: "Compute a value from other fields" },
  { type: "ROLLUP",           label: "Rollup",          Icon: ListFilter,    color: C.amber,  group: "Advanced", tier1: false, description: "Aggregate values from linked rows" },
  { type: "RELATIONSHIP",     label: "Relationship",    Icon: ArrowRightLeft, color: C.amber, group: "Advanced", tier1: true, description: "Link any Doc, SOP, KRA or Form" },
  { type: "LOCATION",         label: "Location",        Icon: MapPin,        color: C.pink,   group: "Advanced", tier1: true, description: "An address or place" },
  { type: "PROGRESS_AUTO",    label: "Progress (auto)", Icon: Gauge,         color: C.orange, group: "Advanced", tier1: false, description: "Progress computed automatically" },
  { type: "PROGRESS_MANUAL",  label: "Progress (manual)", Icon: GaugeCircle, color: C.orange, group: "Advanced", tier1: true, description: "A manual progress bar" },
  { type: "BUTTON",           label: "Button",          Icon: ToggleLeft,    color: C.indigo, group: "Advanced", tier1: false, description: "A button that runs an action" },
  { type: "SIGNATURE",        label: "Signature",       Icon: PenLine,       color: C.pink,   group: "Advanced", tier1: false, description: "Capture a signature" },
  { type: "VOTING",           label: "Voting",          Icon: ThumbsUp,      color: C.violet, group: "Advanced", tier1: true, description: "Let people upvote the row" },
  { type: "ACTION_ITEMS",     label: "Action items",    Icon: CheckCheck,    color: C.green,  group: "Advanced", tier1: false, description: "A checklist of action items" },
  { type: "TSHIRT_SIZE",      label: "T-shirt size",    Icon: Shirt,         color: C.amber,  group: "Advanced", tier1: true, description: "Sizing from XS to XL" },
];

export const FIELD_TYPE_BY_KEY: Record<FieldType, FieldCatalogEntry> = Object.fromEntries(
  FIELD_CATALOG.map((e) => [e.type, e]),
) as Record<FieldType, FieldCatalogEntry>;

// ── Built-in columns (ClickUp "Properties") ────────────────────
// The fixed, non-custom-field columns the table can show. Visibility per view:
//   defaultShown  → shown unless its key is in View.config.hiddenFields
//   !defaultShown → shown only if its key is in View.config.extraColumns
// `locked` columns (Task Name, Status) are always shown and can't be toggled.
// This single list drives the Fields panel's Shown/Properties split AND the
// table's column set, so there's one source of truth.
export interface BuiltinColumn {
  key: string;
  label: string;
  Icon: LucideIcon;
  color: string;
  defaultShown: boolean;
  locked?: boolean;
  /** No backing data yet — shown in the Properties list but disabled ("Soon"),
   *  like ClickUp greys out Duration. Never renders as a real column. */
  soon?: boolean;
}

export const BUILTIN_COLUMNS: BuiltinColumn[] = [
  { key: "__name",            label: "Task Name",    Icon: Type,          color: C.blue,     defaultShown: true, locked: true },
  { key: "__builtin_status",  label: "Status",       Icon: CircleDot,     color: C.violet,   defaultShown: true, locked: true },
  { key: "__builtin_owner",   label: "Assignee",     Icon: UserIcon,      color: C.pink,     defaultShown: true },
  { key: "__builtin_due",     label: "Due date",     Icon: CalIcon,       color: C.green,    defaultShown: true },
  { key: "__builtin_priority",label: "Priority",     Icon: Flag,          color: C.orange,   defaultShown: true },
  { key: "__builtin_type",    label: "Task Type",    Icon: Box,           color: C.amber,    defaultShown: false },
  { key: "__builtin_tags",    label: "Tags",         Icon: Tag,           color: C.green,    defaultShown: false },
  { key: "__builtin_created", label: "Date created", Icon: CalIcon,       color: C.green,    defaultShown: false },
  { key: "__builtin_updated", label: "Date updated", Icon: CalIcon,       color: C.green,    defaultShown: false },
  { key: "__builtin_start",   label: "Start date",   Icon: CalendarClock, color: C.green,    defaultShown: false },
  { key: "__builtin_taskid",  label: "Task ID",      Icon: Hash,          color: "#94A3B8",  defaultShown: false },
  { key: "__builtin_comments",label: "Comments",     Icon: MessageSquare, color: C.violet,   defaultShown: false },
  { key: "__builtin_timeline",label: "Timeline",     Icon: GanttChart,    color: C.green,    defaultShown: false },
  { key: "__builtin_time",    label: "Time tracked", Icon: Clock,         color: C.orange,   defaultShown: false },
  { key: "__builtin_createdby",label: "Created by",  Icon: UserIcon,      color: C.pink,     defaultShown: false },
  { key: "__builtin_docs",    label: "Linked Docs",  Icon: FileText,      color: C.amber,    defaultShown: false },
  { key: "__builtin_linked",  label: "Linked tasks", Icon: Link2,         color: C.amber,    defaultShown: false },
  { key: "__builtin_sops",    label: "Linked SOPs",  Icon: BookOpen,      color: C.amber,    defaultShown: false },

  // "Soon" — full ClickUp property list for parity; no backing data yet, so
  // these render disabled in the Fields panel (never a real column).
  { key: "__soon_assigned_comments", label: "Assigned Comments", Icon: MessageSquare,  color: C.violet,   defaultShown: false, soon: true },
  { key: "__soon_custom_task_id",    label: "Custom Task ID",    Icon: Hash,           color: "#94A3B8",  defaultShown: false, soon: true },
  { key: "__soon_date_closed",       label: "Date closed",       Icon: CalIcon,        color: C.green,    defaultShown: false, soon: true },
  { key: "__soon_date_done",         label: "Date done",         Icon: CalendarCheck,  color: C.green,    defaultShown: false, soon: true },
  { key: "__soon_dependencies",      label: "Dependencies",      Icon: Link2,          color: C.amber,    defaultShown: false, soon: true },
  { key: "__soon_duration",          label: "Duration",          Icon: Clock,          color: C.orange,   defaultShown: false, soon: true },
  { key: "__soon_latest_comment",    label: "Latest comment",    Icon: MessageSquare,  color: C.violet,   defaultShown: false, soon: true },
  { key: "__soon_lists",             label: "Lists",             Icon: ListChecks,     color: C.green,    defaultShown: false, soon: true },
  { key: "__soon_pull_requests",     label: "Pull Requests",     Icon: GitPullRequest, color: C.indigo,   defaultShown: false, soon: true },
  { key: "__soon_sprint_points",     label: "Sprint points",     Icon: Target,         color: C.amber,    defaultShown: false, soon: true },
  { key: "__soon_sprints",           label: "Sprints",           Icon: GaugeCircle,    color: C.amber,    defaultShown: false, soon: true },
  { key: "__soon_time_estimate",     label: "Time estimate",     Icon: Clock,          color: C.orange,   defaultShown: false, soon: true },
];

export const BUILTIN_COLUMN_BY_KEY: Record<string, BuiltinColumn> = Object.fromEntries(
  BUILTIN_COLUMNS.map((c) => [c.key, c]),
);

/** Effective visibility of a built-in column for a view. */
export function isBuiltinShown(
  key: string,
  hidden: Iterable<string>,
  extra: Iterable<string>,
): boolean {
  const col = BUILTIN_COLUMN_BY_KEY[key];
  if (!col) return false;
  if (col.locked) return true;
  if (col.soon) return false; // no data yet — never a real column
  return col.defaultShown ? !new Set(hidden).has(key) : new Set(extra).has(key);
}

// ── FieldDef stored in Board.schema.fields ─────────────────────

export interface FieldChoice {
  value: string;
  label: string;
  color?: string;
}

export interface FieldOptions {
  choices?: FieldChoice[];      // DROPDOWN | MULTI_SELECT | LABELS | TSHIRT_SIZE
  currency?: string;            // MONEY  (default "USD")
  decimals?: number;            // NUMBER | MONEY | PERCENT
  formula?: string;             // FORMULA  (Phase 4)
  ratingMax?: number;           // RATING  (default 5)
  prompt?: string;              // AI fields  (Phase 4)
}

export interface FieldDef {
  key: string;        // unique within board, auto-slugified from label
  label: string;
  type: FieldType;
  position: number;
  options?: FieldOptions;
}

/** Schema shape stored on Board.schema (a Prisma Json column). */
export interface BoardSchema {
  fields: FieldDef[];
}

export function emptyBoardSchema(): BoardSchema {
  return { fields: [] };
}

export function parseBoardSchema(raw: unknown): BoardSchema {
  if (raw && typeof raw === "object" && Array.isArray((raw as BoardSchema).fields)) {
    return raw as BoardSchema;
  }
  return emptyBoardSchema();
}

// ── Field-key slug helper ──────────────────────────────────────

export function slugifyFieldKey(label: string, existing: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  if (!existing.includes(base)) return base;
  for (let i = 2; i < 200; i++) {
    const candidate = `${base}_${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

// ── Default options per type ───────────────────────────────────

export function defaultOptionsFor(type: FieldType): FieldOptions | undefined {
  switch (type) {
    case "DROPDOWN":
    case "CUSTOM_DROPDOWN":
      return { choices: [
        { value: "option_1", label: "Option 1", color: "#3b82f6" },
        { value: "option_2", label: "Option 2", color: "#10b981" },
      ]};
    case "MULTI_SELECT":
    case "LABELS":
      return { choices: [] };
    case "MONEY":
      return { currency: "USD", decimals: 2 };
    case "NUMBER":
      return { decimals: 0 };
    case "PERCENT":
      return { decimals: 0 };
    case "RATING":
      return { ratingMax: 5 };
    case "TSHIRT_SIZE":
      return { choices: [
        { value: "xs", label: "XS", color: "#94a3b8" },
        { value: "s",  label: "S",  color: "#22c55e" },
        { value: "m",  label: "M",  color: "#3b82f6" },
        { value: "l",  label: "L",  color: "#f59e0b" },
        { value: "xl", label: "XL", color: "#ef4444" },
      ]};
    default:
      return undefined;
  }
}
