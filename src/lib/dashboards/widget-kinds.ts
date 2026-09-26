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
 * Whether a card saved BEFORE titleEdited existed still has a title its
 * settings gave it, read from the title's shape. It is the fallback for
 * those cards alone: a card that carries the flag is decided by the flag
 * (titleModeFor), because a person may well type a title shaped like a
 * default ("Tasks by Owner"), and the shape cannot tell. True for its own
 * default, and also for any default title of its kind that no person had to
 * type:
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

// ── The editor's title ────────────────────────────────────────────────
//
// The widget editor keeps a card's title in one of four modes:
//   auto     the settings' default, re-derived as they change
//   typed    the person's own words, never overwritten
//   cleared  the person emptied the field; it stays empty until a setting
//            changes, and then goes back to auto
//   saved    a card saved before titleEdited existed: judged once by its
//            title's shape (isUntouchedWidgetTitle) against the fields of the
//            Lists it was saved with, and then treated as auto or typed
// Saving writes titleEdited: true for a typed title, false for one the
// settings gave, and nothing for an older card not judged yet, so it stays
// as it was.

export type TitleMode = "auto" | "typed" | "cleared" | "saved";

/** What the title does now: follow the settings or not, and the flag a save writes. */
export interface TitleState {
  follows: boolean;
  edited: boolean | undefined;
}

function titleEditedOf(input: WidgetInput): boolean | undefined {
  return "titleEdited" in input && typeof input.titleEdited === "boolean" ? input.titleEdited : undefined;
}

/** The mode the editor opens a card in. */
export function titleModeFor(mode: "add" | "edit", initial: WidgetInput): TitleMode {
  if (mode === "add") return "auto";
  const flag = titleEditedOf(initial);
  if (flag === true) return "typed";
  if (flag === false) return "auto";
  return "saved";
}

/** The mode after the person types in the Title field. */
export function titleModeAfterTyping(value: string): TitleMode {
  return value === "" ? "cleared" : "typed";
}

/**
 * The mode after a settings change: an emptied field goes back to the
 * settings. Every other mode stays; an older card's judgement does not
 * depend on the settings (titleState), so no change can flip it.
 */
export function titleModeAfterSettingsChange(titleMode: TitleMode): TitleMode {
  return titleMode === "cleared" ? "auto" : titleMode;
}

/**
 * Whether isUntouchedWidgetTitle's answer for this title depends on the
 * field labels: a "Sum of X" or a "Tasks by X" that could be naming a field.
 * Every other shape reads the same whether or not the labels have arrived.
 */
function shapeNeedsLabels(input: WidgetInput): boolean {
  if (!("title" in input)) return false;
  if (input.kind === "stat") return SCOPE_TITLE.exec(input.title)?.[1] !== undefined;
  if (input.kind === "chart") {
    if (!input.title.startsWith("Tasks by ")) return false;
    const word = input.title.slice("Tasks by ".length);
    return word !== "field" && !Object.values(GROUP_WORDS).includes(word);
  }
  return false;
}

/**
 * What the title does in `titleMode`. An older card ("saved") is judged
 * against `savedLabels`, the fields of the Lists it was SAVED with, whatever
 * the draft's source is now, so dropping the List that named its field
 * cannot flip the answer. `savedLabelsReady` is true once those have
 * arrived; a shape that could name a field is not judged before then (with
 * no labels, "Tasks by Owner" reads as a default for any field, and judging
 * it early is how a typed title got replaced). Until it is judged, the
 * title stays as it is and a save writes no flag.
 */
export function titleState(
  titleMode: TitleMode,
  initial: WidgetInput,
  savedLabels: ReadonlyMap<string, string>,
  savedLabelsReady: boolean,
): TitleState {
  if (titleMode === "auto") return { follows: true, edited: false };
  if (titleMode === "cleared") return { follows: false, edited: false };
  if (titleMode === "typed") return { follows: false, edited: true };
  if (!savedLabelsReady && shapeNeedsLabels(initial)) return { follows: false, edited: undefined };
  const untouched = isUntouchedWidgetTitle(initial, savedLabels);
  return { follows: untouched, edited: !untouched };
}

/**
 * The field label a card's own title names for the field it sums or groups
 * by ("Points" in "Sum of Points (open tasks)"), or null.
 */
function labelInTitle(input: WidgetInput): { key: string; label: string } | null {
  if (input.kind === "stat" && input.metric?.op === "sum") {
    const label = SCOPE_TITLE.exec(input.title)?.[1];
    return label ? { key: input.metric.fieldKey, label } : null;
  }
  if (input.kind === "chart" && typeof input.groupBy === "object" && input.title.startsWith("Tasks by ")) {
    const label = input.title.slice("Tasks by ".length);
    return label && label !== "field" ? { key: input.groupBy.field, label } : null;
  }
  return null;
}

/**
 * The labels an auto title is derived from. Until the chosen Lists' fields
 * arrive, the saved card's field keeps the label its saved title names, so
 * the Title field shows the saved "Sum of Points (open tasks)" instead of
 * "Sum (open tasks)" while they load, and a scope changed meanwhile still
 * reads "Sum of Points (completed tasks)". Once they have arrived the real
 * labels decide, and a field that is gone reads as the generic word.
 */
export function titleLabels(
  initial: WidgetInput,
  fieldLabels: ReadonlyMap<string, string>,
  labelsReady: boolean,
): ReadonlyMap<string, string> {
  if (labelsReady) return fieldLabels;
  const named = labelInTitle(initial);
  if (!named || fieldLabels.get(named.key)?.trim()) return fieldLabels;
  return new Map([...fieldLabels, [named.key, named.label]]);
}

/** The field a card's default title names: the one it sums or groups by. */
function titleFieldKey(input: WidgetInput): string | null {
  if (input.kind === "stat" && input.metric?.op === "sum") return input.metric.fieldKey;
  if (input.kind === "chart" && typeof input.groupBy === "object") return input.groupBy.field;
  return null;
}

/**
 * The card as the editor shows and saves it: the settings' title while it
 * follows them, and titleEdited saying who wrote it. A default that would
 * name a field whose label has not arrived yet keeps the title as it is
 * until it has ("Calculation" on an older Sum card does not flash "Sum
 * (open tasks)" first). A notes card is returned as it is: its title never
 * follows anything.
 */
export function withEditorTitle(
  draft: WidgetInput,
  o: { state: TitleState; labels: ReadonlyMap<string, string>; labelsReady: boolean },
): WidgetInput {
  if (draft.kind !== "stat" && draft.kind !== "chart" && draft.kind !== "list") return draft;
  const key = titleFieldKey(draft);
  const waiting = !o.labelsReady && key !== null && !o.labels.get(key)?.trim();
  const title = o.state.follows && !waiting ? defaultWidgetTitle(draft, o.labels) : draft.title;
  const { titleEdited: _drop, ...rest } = draft;
  void _drop;
  return { ...rest, title, ...(o.state.edited === undefined ? {} : { titleEdited: o.state.edited }) } as WidgetInput;
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
