// Task system's small pure decisions (settings-cleanup Phase 6), kept out of
// the components so each is tested on its own: the Task types tab's one
// primary, and the words of every empty line on the three tabs (B10: one
// inline row, "No {things} yet · {Action}", the action a text link).

import type { PrimaryAction } from "@/components/layout/os/page-header";

/** The "New type" primary for what the list said: grey, with its reason, once every custom type is in use. */
export function newTypePrimary(usage: { used: number; limit: number } | null, open: () => void): PrimaryAction {
  const full = !!usage && usage.used >= usage.limit;
  return {
    label: "New type",
    onClick: open,
    disabled: full,
    title: full && usage ? `All ${usage.limit} custom types are in use. Delete one to add another.` : undefined,
  };
}

/**
 * The height the Tags toolbar (its search and Show archived) really takes at
 * each width, held by the header before it arrives (settings-cleanup Phase 4
 * review, L3). Measured at 1px steps from 960 to 300 in the settings
 * takeover, rail included: one 44px line from 531, two lines (88) below.
 * A literal string, so the stylesheet holds every class.
 */
export const TAGS_TOOLBAR_ROW = "min-h-11 max-[531px]:min-h-[88px]";

/** The footer's end line under the Task types table: how many of the custom types are used. */
export function customTypesLine(usage: { used: number; limit: number }): string {
  return `${usage.used} of ${usage.limit} custom types`;
}

/** A tag group's name in a sentence: singular and plural. */
export const TAG_GROUP_NOUN: Record<string, { one: string; many: string }> = {
  COST_CENTER: { one: "cost center", many: "cost centers" },
  BUSINESS_UNIT: { one: "business unit", many: "business units" },
  LOCATION: { one: "location", many: "locations" },
  REGION: { one: "region", many: "regions" },
  PROJECT: { one: "project", many: "projects" },
  FUNCTION: { one: "function", many: "functions" },
  CUSTOM: { one: "custom tag", many: "custom tags" },
};

export const tagNoun = (type: string) => TAG_GROUP_NOUN[type] ?? { one: "tag", many: "tags" };

export type EmptyLine = { text: string; action: { kind: "add" | "clear" | "archived"; label: string } | null };

/**
 * The one line a tag group shows when it shows no tag: a search that matches
 * nothing here offers to clear it; a group whose only tags are archived (and
 * hidden) says so and offers to show them; an empty group offers to add one.
 */
export function tagGroupEmptyLine(type: string, opts: { query: string; hiddenArchived: number }): EmptyLine {
  const n = tagNoun(type);
  if (opts.query.trim()) return { text: `No ${n.many} match`, action: { kind: "clear", label: "Clear the search" } };
  if (opts.hiddenArchived > 0) {
    return { text: opts.hiddenArchived === 1 ? `1 archived ${n.one}` : `${opts.hiddenArchived} archived ${n.many}`, action: { kind: "archived", label: "Show archived" } };
  }
  return { text: `No ${n.many} yet`, action: { kind: "add", label: `Add a ${n.one}` } };
}

/** The Recommended card's line when it lists nothing: a filter that hides every type offers to clear it. */
export function recommendedEmptyLine(filtered: boolean): EmptyLine {
  return filtered
    ? { text: "No recommended types match", action: { kind: "clear", label: "Clear the filter" } }
    : { text: "Every recommended type is added", action: null };
}
