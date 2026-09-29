// The automation definition JSON, read and written in one place.
//
// AutomationWorkflow.definition is the DRAFT, the copy the builder edits.
// AutomationWorkflowVersion.definitionJson is a published snapshot, and the
// engine runs the snapshot the workflow's publishedVersionId names, so a
// Save draft never changes what a live automation does (spec-ai-automation
// /automation/workflows/[id], "The live automation keeps running the old
// version until you republish").
//
// Keys this module owns inside the definition, every one optional so a row
// written by an older release reads exactly as it always did:
//
//   conditions  the AND / OR tree (conditions.ts evaluates it)
//   actions     the ordered "Then ... and then ..." list
//   trigger     the DRAFT trigger key. The row's triggerEvent column is the
//               LIVE trigger once a version is published (the matcher reads
//               the column), so a draft trigger change waits for Republish.
//   when        trigger options: { field } for "a task field changes",
//               { dateField, offsetDays } for "a task date arrives",
//               { every, at, weekday, monthDay } for "on a schedule"
//   scope       where it runs: { listIds, folderIds, spaceIds }. Missing or
//               empty on every key reads as Everywhere, so old rows need no
//               migration.
//   __snapshot  on a version row only: why a draft was kept as a version
//               (the draft that a restore replaced). Never executed.
//
// Pure: no Prisma, no I/O. The engine, the API routes and the builder share it.

export interface AutomationScope {
  listIds: string[];
  folderIds: string[];
  spaceIds: string[];
}

export const EVERYWHERE: AutomationScope = Object.freeze({ listIds: [], folderIds: [], spaceIds: [] }) as AutomationScope;

/** The most places one automation may name, per kind. */
export const MAX_SCOPE_IDS = 200;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const id = x.trim();
    if (!id || id.length > 64 || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_SCOPE_IDS) break;
  }
  return out;
}

/** The scope a definition carries. Anything missing or malformed reads as Everywhere. */
export function readScope(definition: unknown): AutomationScope {
  const scope = asRecord(asRecord(definition).scope);
  return {
    listIds: idList(scope.listIds),
    folderIds: idList(scope.folderIds),
    spaceIds: idList(scope.spaceIds),
  };
}

export function isEverywhere(scope: AutomationScope): boolean {
  return scope.listIds.length === 0 && scope.folderIds.length === 0 && scope.spaceIds.length === 0;
}

/** Where the triggering record lives: its List and that List's Folder and Space. */
export interface ScopePlace {
  boardId: string | null;
  folderId: string | null;
  spaceId: string | null;
}

/**
 * Does a scoped automation run for a record in this place? Everywhere always
 * does. A scoped one runs only for a record whose List, Folder or Space is
 * named; an event with no List at all (a KPI reading, kudos) never matches a
 * scoped automation, because "only in these Lists" cannot mean "and also
 * everything that is in no List".
 */
export function scopeMatches(scope: AutomationScope, place: ScopePlace | null): boolean {
  if (isEverywhere(scope)) return true;
  if (!place || !place.boardId) return false;
  if (scope.listIds.includes(place.boardId)) return true;
  if (place.folderId && scope.folderIds.includes(place.folderId)) return true;
  if (place.spaceId && scope.spaceIds.includes(place.spaceId)) return true;
  return false;
}

/** The scope to store: deduped, bounded, and absent when it is Everywhere. */
export function scopeForSave(raw: unknown): AutomationScope | undefined {
  const s = readScope({ scope: raw });
  return isEverywhere(s) ? undefined : s;
}

/** The draft trigger: the definition's own key, else the row's column (older rows). */
export function draftTrigger(definition: unknown, rowTrigger: string | null): string | null {
  const t = asRecord(definition).trigger;
  if (typeof t === "string" && t.trim()) return t.trim();
  if (t === null) return null;
  return rowTrigger;
}

/** Trigger options (`definition.when`), kept as plain JSON. */
export function readWhen(definition: unknown): Record<string, unknown> {
  return asRecord(asRecord(definition).when);
}

/**
 * Does the event satisfy the trigger's own options? "When a task field
 * changes" with a field picked runs only for that field; with none picked
 * (or an older row) it runs for every field change. Every other trigger has
 * no event-time option (the schedule triggers are matched by the cron).
 */
export function whenMatches(event: string, when: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  if (event === "task.field_changed") {
    const field = typeof when.field === "string" ? when.field.trim() : "";
    if (!field) return true;
    return payload.field === field;
  }
  return true;
}

/**
 * The definition the engine executes: the published snapshot when there is
 * one, else the row's own definition (a row written before versions existed,
 * or whose version row is missing, keeps running exactly as before).
 */
export function liveDefinition(
  workflow: { definition: unknown; publishedVersionId: string | null },
  version: { id: string; definitionJson: unknown } | null | undefined,
): unknown {
  if (workflow.publishedVersionId && version && version.id === workflow.publishedVersionId) {
    return version.definitionJson;
  }
  return workflow.definition;
}

/** JSON with object keys sorted, so two reads of one value compare equal. */
export function stableJson(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => o[k] !== undefined)
          .sort()
          .map((k) => [k, norm(o[k])]),
      );
    }
    return x ?? null;
  };
  return JSON.stringify(norm(v));
}

/** The parts of a definition that change behaviour (no snapshot markers). */
function behaviour(definition: unknown, rowTrigger: string | null): Record<string, unknown> {
  const d = asRecord(definition);
  return {
    trigger: draftTrigger(definition, rowTrigger),
    when: readWhen(definition),
    conditions: d.conditions ?? null,
    actions: Array.isArray(d.actions) ? d.actions : [],
    scope: readScope(definition),
  };
}

/**
 * Does the draft differ from the published version? Drives the builder's
 * "Unpublished changes" line, so an Owner can see that Republish is needed.
 */
export function draftDiffersFromLive(
  draft: unknown,
  rowTrigger: string | null,
  published: unknown | null,
  publishedTrigger: string | null,
): boolean {
  if (published === null || published === undefined) return false;
  return stableJson(behaviour(draft, rowTrigger)) !== stableJson(behaviour(published, publishedTrigger));
}

/** Why a version row exists when it was not a publish. */
export interface VersionSnapshotNote {
  reason: "kept-before-restore";
  /** The version number whose definition replaced the draft. */
  restoredFrom: number;
}

export function readSnapshotNote(definitionJson: unknown): VersionSnapshotNote | null {
  const n = asRecord(asRecord(definitionJson).__snapshot);
  if (n.reason === "kept-before-restore" && typeof n.restoredFrom === "number") {
    return { reason: "kept-before-restore", restoredFrom: n.restoredFrom };
  }
  return null;
}

/** A version's definition with the snapshot marker removed, ready to become a draft. */
export function withoutSnapshotNote(definitionJson: unknown): Record<string, unknown> {
  const d = { ...asRecord(definitionJson) };
  delete d.__snapshot;
  return d;
}
