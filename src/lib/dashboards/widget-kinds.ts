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

import type { WidgetInput, WidgetLayout } from "./widgets";

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
  switch (kind) {
    case "stat":
      return { id: ctx.id, kind: "stat", title: "Open tasks", source, filter, metric: { op: "count" }, scope: "open", layout };
    case "chart":
      return { id: ctx.id, kind: "chart", title: "Tasks by status", source, filter, groupBy: "status", display: "bar", layout };
    case "list":
      return { id: ctx.id, kind: "list", title: "Recently updated", source, filter: { ...filter, hideDone: true }, sort: "updated", limit: 10, layout };
    case "notes":
      return { id: ctx.id, kind: "notes", title: "Text", text: "", layout };
  }
}
