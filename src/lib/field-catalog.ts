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
  Phone, DollarSign, Percent, Star, Tag, User as UserIcon,
  Paperclip, Sigma, ArrowRightLeft, Network, ToggleLeft, PenLine,
  MapPin, GaugeCircle, Activity, BarChart3, Languages, FileText,
  CheckCheck, Shirt, ThumbsUp, Sparkles, ListFilter, Target,
  type LucideIcon,
} from "lucide-react";

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
  | "KRA";

export interface FieldCatalogEntry {
  type: FieldType;
  label: string;
  Icon: LucideIcon;
  group: "Common" | "AI" | "Advanced" | "WorkwrK";
  /** Whether this phase ships a real renderer (true) or a stub (false). */
  tier1: boolean;
  description?: string;
}

export const FIELD_CATALOG: FieldCatalogEntry[] = [
  // ── Common ──────────────────────────────────────────────────
  { type: "TEXT",        label: "Text",          Icon: Type,        group: "Common", tier1: true },
  { type: "LONG_TEXT",   label: "Long text",     Icon: AlignLeft,   group: "Common", tier1: true },
  { type: "NUMBER",      label: "Number",        Icon: Hash,        group: "Common", tier1: true },
  { type: "DATE",        label: "Date",          Icon: CalIcon,     group: "Common", tier1: true },
  { type: "DATETIME",    label: "Date & time",   Icon: CalendarClock, group: "Common", tier1: true },
  { type: "DROPDOWN",    label: "Dropdown",      Icon: ChevronDown, group: "Common", tier1: true },
  { type: "MULTI_SELECT",label: "Multi-select",  Icon: ListChecks,  group: "Common", tier1: true },
  { type: "CHECKBOX",    label: "Checkbox",      Icon: CheckSquare, group: "Common", tier1: true },
  { type: "LABELS",      label: "Labels",        Icon: Tag,         group: "Common", tier1: true },
  { type: "URL",         label: "Website",       Icon: LinkIcon,    group: "Common", tier1: true },
  { type: "EMAIL",       label: "Email",         Icon: AtSign,      group: "Common", tier1: true },
  { type: "PHONE",       label: "Phone",         Icon: Phone,       group: "Common", tier1: true },
  { type: "MONEY",       label: "Money",         Icon: DollarSign,  group: "Common", tier1: true },
  { type: "PERCENT",     label: "Percent",       Icon: Percent,     group: "Common", tier1: true },
  { type: "RATING",      label: "Rating",        Icon: Star,        group: "Common", tier1: true },
  { type: "USER",        label: "Person",        Icon: UserIcon,    group: "Common", tier1: true },
  { type: "FILES",       label: "Files",         Icon: Paperclip,   group: "Common", tier1: true },

  // ── AI ──────────────────────────────────────────────────────
  { type: "SUMMARY",       label: "Summary",       Icon: FileText,   group: "AI", tier1: false, description: "AI summary of the row" },
  { type: "SENTIMENT",     label: "Sentiment",     Icon: Activity,   group: "AI", tier1: false },
  { type: "CATEGORIZE",    label: "Categorize",    Icon: Sparkles,   group: "AI", tier1: false },
  { type: "TRANSLATION",   label: "Translation",   Icon: Languages,  group: "AI", tier1: false },
  { type: "CUSTOM_TEXT",   label: "Custom text",   Icon: Sparkles,   group: "AI", tier1: false, description: "Free-form AI text on the row" },
  { type: "CUSTOM_DROPDOWN", label: "Custom dropdown", Icon: Sparkles, group: "AI", tier1: false },

  // ── WorkwrK AI-OS ───────────────────────────────────────────
  { type: "KRA", label: "KRA tag", Icon: Target, group: "WorkwrK", tier1: true, description: "Tag this row with an organizational KRA" },

  // ── Advanced ────────────────────────────────────────────────
  { type: "FORMULA",          label: "Formula",         Icon: Sigma,         group: "Advanced", tier1: false },
  { type: "ROLLUP",           label: "Rollup",          Icon: ListFilter,    group: "Advanced", tier1: false },
  { type: "RELATIONSHIP",     label: "Relationship",    Icon: ArrowRightLeft,group: "Advanced", tier1: false },
  { type: "LOCATION",         label: "Location",        Icon: MapPin,        group: "Advanced", tier1: false },
  { type: "PROGRESS_AUTO",    label: "Progress (auto)", Icon: GaugeCircle,   group: "Advanced", tier1: false },
  { type: "PROGRESS_MANUAL",  label: "Progress (manual)", Icon: GaugeCircle, group: "Advanced", tier1: false },
  { type: "BUTTON",           label: "Button",          Icon: ToggleLeft,    group: "Advanced", tier1: false },
  { type: "SIGNATURE",        label: "Signature",       Icon: PenLine,       group: "Advanced", tier1: false },
  { type: "VOTING",           label: "Voting",          Icon: ThumbsUp,      group: "Advanced", tier1: false },
  { type: "ACTION_ITEMS",     label: "Action items",    Icon: CheckCheck,    group: "Advanced", tier1: false },
  { type: "TSHIRT_SIZE",      label: "T-shirt size",    Icon: Shirt,         group: "Advanced", tier1: false },
];

export const FIELD_TYPE_BY_KEY: Record<FieldType, FieldCatalogEntry> = Object.fromEntries(
  FIELD_CATALOG.map((e) => [e.type, e]),
) as Record<FieldType, FieldCatalogEntry>;

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
