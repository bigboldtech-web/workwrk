// A List's default values at the moment a task is created, on the client.
//
// Gap 14, List comfort: a List may name values a NEW task starts with
// (Board.settings.defaults, list-comfort.ts). The server applies them in
// POST /api/boards/[id]/items, and ONLY to keys the request did not send
// (planCreateDefaults). So the client's whole job is to leave a defaulted key
// out of the body when the person did not choose a value for it; anything
// the person set is theirs and is never removed.
//
// The one thing this must never do is change a create that has nothing to do
// with defaults. With no settings loaded (still loading, failed, or loaded for
// a different List than the one the task is created in) the body comes back
// unchanged, the same object, so a List with no defaults, or a create racing
// its settings, sends today's body and gets today's status.
//
// Pure: type-only imports plus list-comfort's value check.

import { isValidDefaultFieldValue, type ListDefaults } from "@/lib/list-comfort";
import type { StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

/** GET /api/boards/[id]/settings, as a create surface holds it: keyed by the List it is for. */
export interface LoadedListSettings {
  boardId: string;
  /** The server's PRUNED set: only defaults that still apply. */
  defaults: ListDefaults;
  statuses: StatusOption[];
}

/**
 * The create body with every UNTOUCHED defaulted key left out, so the server
 * fills it from the List's defaults.
 *
 * `touched` names what the person chose, by body key: "status", "priority",
 * "assigneeIds" or "ownerId" (either one counts for both, because they are one
 * assignee set), "tagIds", "itemTypeId", and "metadata.<key>" for a field.
 *
 * `targetBoardId` is the List the body is POSTed to. Settings loaded for any
 * other List are ignored, which is the race a location picker has: the person
 * switched Lists and the first List's answer arrived late.
 */
export function applyDefaultsToCreateBody<T extends Record<string, unknown>>(
  body: T,
  loaded: LoadedListSettings | null,
  touched: ReadonlySet<string>,
  targetBoardId?: string | null,
): T {
  if (!loaded) return body;
  if (targetBoardId && loaded.boardId !== targetBoardId) return body;
  const d = loaded.defaults;
  const next: Record<string, unknown> = { ...body };
  let changed = false;
  const drop = (key: string) => {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  };

  if (!touched.has("status") && d.status && loaded.statuses.some((s) => s.value === d.status)) drop("status");
  if (!touched.has("priority") && d.priority) drop("priority");
  if (!touched.has("assigneeIds") && !touched.has("ownerId") && d.assigneeIds && d.assigneeIds.length > 0) {
    drop("assigneeIds");
    drop("ownerId");
  }
  if (!touched.has("tagIds") && d.tagIds && d.tagIds.length > 0) drop("tagIds");
  if (!touched.has("itemTypeId") && d.itemTypeId) drop("itemTypeId");

  const fieldKeys = Object.keys(d.fields ?? {});
  const md = next.metadata;
  if (fieldKeys.length > 0 && md && typeof md === "object" && !Array.isArray(md)) {
    const copy: Record<string, unknown> = { ...(md as Record<string, unknown>) };
    let mdChanged = false;
    for (const key of fieldKeys) {
      if (touched.has(`metadata.${key}`) || !(key in copy)) continue;
      delete copy[key];
      mdChanged = true;
    }
    if (mdChanged) {
      next.metadata = copy;
      changed = true;
    }
  }
  return changed ? (next as T) : body;
}

/**
 * The stored defaults that still apply, and how many no longer do.
 *
 * A default is stale when what it names has gone: a field removed or retyped
 * so the value no longer fits, a status the List no longer declares, a person
 * deactivated or gone, an archived tag, a deleted task type. People are pruned
 * one by one (a PEOPLE default or the assignee set keeps whoever is left) and
 * every dropped entry counts once, which is the number the List settings
 * panel shows before a Save removes them for good.
 */
export function pruneListDefaults(
  defaults: ListDefaults,
  ctx: {
    statuses: readonly StatusOption[];
    fields: readonly FieldDef[];
    liveUserIds: ReadonlySet<string>;
    liveTagIds: ReadonlySet<string>;
    liveItemTypeIds: ReadonlySet<string>;
  },
): { defaults: ListDefaults; stale: number } {
  let stale = 0;
  const out: ListDefaults = {};

  if (defaults.status !== undefined) {
    if (ctx.statuses.some((s) => s.value === defaults.status)) out.status = defaults.status;
    else stale += 1;
  }
  if (defaults.priority !== undefined) out.priority = defaults.priority;

  if (defaults.assigneeIds) {
    const live = defaults.assigneeIds.filter((id) => ctx.liveUserIds.has(id));
    stale += defaults.assigneeIds.length - live.length;
    if (live.length > 0) out.assigneeIds = live;
  }
  if (defaults.tagIds) {
    const live = defaults.tagIds.filter((id) => ctx.liveTagIds.has(id));
    stale += defaults.tagIds.length - live.length;
    if (live.length > 0) out.tagIds = live;
  }
  if (defaults.itemTypeId) {
    if (ctx.liveItemTypeIds.has(defaults.itemTypeId)) out.itemTypeId = defaults.itemTypeId;
    else {
      stale += 1;
      out.itemTypeId = null;
    }
  } else if (defaults.itemTypeId === null) {
    out.itemTypeId = null;
  }

  if (defaults.fields) {
    const byKey = new Map(ctx.fields.map((f) => [f.key, f] as const));
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults.fields)) {
      const f = byKey.get(key);
      if (!f || !isValidDefaultFieldValue(f, value)) {
        stale += 1;
        continue;
      }
      if (f.type === "USER") {
        if (typeof value === "string" && ctx.liveUserIds.has(value)) fields[key] = value;
        else stale += 1;
        continue;
      }
      if (f.type === "PEOPLE") {
        const ids = value as string[];
        const live = ids.filter((id) => ctx.liveUserIds.has(id));
        stale += ids.length - live.length;
        if (live.length > 0) fields[key] = live;
        continue;
      }
      fields[key] = value;
    }
    if (Object.keys(fields).length > 0) out.fields = fields;
  }
  return { defaults: out, stale };
}
