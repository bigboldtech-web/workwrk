// The card kinds a person can add, in the order "Add widget" lists them, and
// the input each one starts from.
//
// This is the extensible half of the widget registry: a new kind is a row
// here (label, description, default size, the surfaces it may be added to), a
// renderer in src/components/dashboards/widget-registry.tsx, and its server
// shape in widgets.ts, widget-data.ts and report-server.ts's sectionFor.
// Phase 6's people widgets (workload by person, headcount) append here with
// surfaces ["space-overview"].
//
// Pure: type-only imports.

import type { StatScope, WidgetInput, WidgetLayout } from "./widgets";

export type WidgetKind = "stat" | "chart" | "list" | "notes";
export type WidgetSurface = "dashboard" | "space-overview";

export interface WidgetKindMeta {
  kind: WidgetKind;
  label: string;
  description: string;
  defaultSize: { w: number; h: number };
  surfaces: ReadonlyArray<WidgetSurface>;
}

export const WIDGET_KIND_META: ReadonlyArray<WidgetKindMeta> = [
  {
    kind: "stat",
    label: "Stat",
    description: "Count or add up tasks that match a filter",
    defaultSize: { w: 3, h: 3 },
    surfaces: ["dashboard", "space-overview"],
  },
  {
    kind: "chart",
    label: "Chart",
    description: "Tasks by status, assignee, priority or a field",
    defaultSize: { w: 6, h: 6 },
    surfaces: ["dashboard", "space-overview"],
  },
  {
    kind: "list",
    label: "List",
    description: "The first tasks that match a filter",
    defaultSize: { w: 6, h: 7 },
    surfaces: ["dashboard", "space-overview"],
  },
  {
    kind: "notes",
    label: "Text",
    description: "A heading or a note",
    defaultSize: { w: 4, h: 3 },
    surfaces: ["dashboard", "space-overview"],
  },
];

export function kindsFor(surface: WidgetSurface): WidgetKindMeta[] {
  return WIDGET_KIND_META.filter((m) => m.surfaces.includes(surface));
}

export function kindMeta(kind: string): WidgetKindMeta | undefined {
  return WIDGET_KIND_META.find((m) => m.kind === kind);
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A fresh card id: "w_" plus 16 characters of [a-z0-9], which satisfies the
 * write schema's /^[A-Za-z0-9_~.-]+$/ and its 64-character cap. Uses the
 * platform's crypto when present, so two tabs adding a card at the same
 * moment do not collide.
 */
export function newWidgetId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let out = "w_";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

const SCOPE_WORDS: Record<StatScope, string> = {
  total: "all tasks",
  open: "open tasks",
  completed: "completed tasks",
  overdue: "overdue tasks",
};

const GROUP_WORDS: Record<string, string> = { status: "status", assignee: "assignee", priority: "priority" };

const SORT_TITLES: Record<string, string> = {
  updated: "Recently updated",
  created: "Recently created",
  due: "Tasks by due date",
  priority: "Tasks by priority",
  title: "Tasks by name",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The title a card gets from its own settings, so an untouched title always
 * says what the card shows: "Completed tasks", "Sum of Points (open tasks)",
 * "Tasks by assignee". The editor keeps an untouched title in step with this
 * as the settings change, and never overwrites one the person typed.
 *
 * `fieldLabels` maps a field key to its label, for a Sum or a group by a
 * field; a key it does not know (its Lists are still loading, or the field
 * is gone) reads as a generic word, never as the raw key. The unset scope,
 * sort and metric read as the server reads them (total, updated, count).
 * Capped at the write schema's 120 characters.
 */
export function defaultWidgetTitle(input: WidgetInput, fieldLabels: ReadonlyMap<string, string> = new Map()): string {
  let title: string;
  switch (input.kind) {
    case "stat": {
      const scope = SCOPE_WORDS[input.scope ?? "total"] ?? "tasks";
      const metric = input.metric ?? { op: "count" as const };
      if (metric.op === "sum") {
        const label = fieldLabels.get(metric.fieldKey)?.trim();
        title = label ? `Sum of ${label} (${scope})` : `Sum (${scope})`;
      } else title = cap(scope);
      break;
    }
    case "chart": {
      const g = input.groupBy;
      const word = typeof g === "object" ? fieldLabels.get(g.field)?.trim() || "field" : GROUP_WORDS[g] ?? "status";
      title = `Tasks by ${word}`;
      break;
    }
    case "list":
      title = SORT_TITLES[input.sort ?? "updated"] ?? "Tasks";
      break;
    case "notes":
      title = "Text";
      break;
    case "passthrough":
      title = "Widget";
      break;
  }
  return title.slice(0, 120);
}

/** The fallback titles cards were given before defaultWidgetTitle (parseWidgets). */
const LEGACY_TITLES: Partial<Record<WidgetInput["kind"], readonly string[]>> = {
  stat: ["Calculation"],
  chart: ["Chart", "Workload by Status"],
  list: ["Task List"],
};

const SCOPE_TITLE = /^Sum(?: of (.+))? \((all|open|completed|overdue) tasks\)$/;

/**
 * Whether a SAVED card's title is still one the settings gave it, so the
 * editor may keep it in step with them. True for its own default, and also
 * for any default title of its kind that no person had to type:
 *   - a label the editor does not know yet (its Lists' fields are still
 *     loading) or no longer knows (the field is gone, the List was dropped),
 *     so "Sum of Points (open tasks)" is not frozen as typed by a slow fetch;
 *   - another setting's default, as on a card saved before titles followed
 *     the settings ("Open tasks" on a card that counts completed ones);
 *   - the fallback words older cards were saved with ("Calculation").
 * A title in none of these shapes is the person's own and is never touched.
 */
export function isUntouchedWidgetTitle(input: WidgetInput, fieldLabels: ReadonlyMap<string, string> = new Map()): boolean {
  if (!("title" in input) || typeof input.title !== "string") return false;
  const title = input.title;
  if (title === defaultWidgetTitle(input, fieldLabels)) return true;
  if (LEGACY_TITLES[input.kind]?.includes(title)) return true;
  const known = new Set(Array.from(fieldLabels.values(), (l) => l.trim()).filter(Boolean));
  switch (input.kind) {
    case "stat": {
      if (Object.values(SCOPE_WORDS).some((w) => cap(w) === title)) return true;
      const m = SCOPE_TITLE.exec(title);
      if (!m) return false;
      if (m[1] === undefined) return true;
      if (known.has(m[1])) return true;
      // A Sum over a field whose label is not known here: its default could
      // have named any label.
      const metric = input.metric;
      return metric?.op === "sum" && !fieldLabels.get(metric.fieldKey)?.trim();
    }
    case "chart": {
      if (!title.startsWith("Tasks by ")) return false;
      const word = title.slice("Tasks by ".length);
      if (word === "field" || Object.values(GROUP_WORDS).includes(word) || known.has(word)) return true;
      const g = input.groupBy;
      return typeof g === "object" && !fieldLabels.get(g.field)?.trim();
    }
    case "list":
      return Object.values(SORT_TITLES).includes(title);
    default:
      return false;
  }
}

/**
 * The input a new card of `kind` starts from. A card added to a Space's
 * Overview starts on that Space; one added to a dashboard starts on every
 * List the viewer can read.
 */
export function newWidgetInput(
  kind: WidgetKind,
  ctx: { id: string; spaceId?: string | null; layout: WidgetLayout },
): WidgetInput {
  const layout = { ...ctx.layout };
  const source = ctx.spaceId ? { kind: "space" as const, spaceId: ctx.spaceId } : { kind: "all" as const };
  const filter = { connector: "AND" as const, rules: [], hideDone: false };
  let input: WidgetInput;
  switch (kind) {
    case "stat":
      input = { id: ctx.id, kind: "stat", title: "", source, filter, metric: { op: "count" }, scope: "open", layout };
      break;
    case "chart":
      input = { id: ctx.id, kind: "chart", title: "", source, filter, groupBy: "status", display: "bar", layout };
      break;
    case "list":
      input = { id: ctx.id, kind: "list", title: "", source, filter: { ...filter, hideDone: true }, sort: "updated", limit: 10, layout };
      break;
    case "notes":
      input = { id: ctx.id, kind: "notes", title: "", text: "", layout };
      break;
  }
  return { ...input, title: defaultWidgetTitle(input) } as WidgetInput;
}
