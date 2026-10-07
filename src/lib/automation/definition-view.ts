// What an editor is shown of an automation's definition: its scope cut to
// the places they can open, with a flag when places they cannot open are
// kept. Every route that answers with a definition (the builder's GET and
// PUT, publish, activate, pause, duplicate) answers through this, so no
// response lists, names or counts a place its reader cannot open.

import type { Viewer } from "@/lib/access/types";
import { definitionWithScope, isEverywhere, readScope, splitScope } from "./definition";
import { livePlaces, scopeReadable } from "./places-server";

/** Why places are kept that the builder does not list: some exist and the viewer cannot open them, some exist for nobody (in Trash, or deleted). */
export interface ScopeKept {
  cannotOpen: boolean;
  gone: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * The definition with each AI teammate step's teammate left out: a private
 * teammate's slug carries its name, which is its person's. Only the
 * automation's creator, whose teammate it is, reads it (review round 2).
 * Any save holding the step is refused for anyone else, so nothing stored
 * changes.
 */
export function withoutTeammateSlugs(definition: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(definition.actions)) return definition;
  const actions = definition.actions.map((raw) => {
    const a = asRecord(raw);
    const key = typeof a.key === "string" ? a.key : typeof a.action === "string" ? a.action : typeof a.type === "string" ? a.type : null;
    if (key !== "ask_teammate") return raw;
    const field = a.params !== undefined ? "params" : a.config !== undefined ? "config" : "params";
    return { ...a, [field]: { ...asRecord(a[field]), teammate: null } };
  });
  return { ...definition, actions };
}

/**
 * The definition as this viewer may see it: its scope cut to the places they
 * can open, and whether others are kept (never which, never how many). The
 * builder edits only the shown part; the save keeps the rest on the server.
 * scopeHidden says some are kept (so the scope is never read as Everywhere);
 * scopeKept says why, for the line the builder shows.
 */
export async function definitionForViewer(
  viewer: Viewer,
  definition: unknown,
  /** The automation's creator: anyone else gets its teammate steps without the teammate. */
  creatorId?: string | null,
): Promise<{ definition: Record<string, unknown>; scopeHidden: boolean; scopeKept: ScopeKept }> {
  const forThem = (d: Record<string, unknown>) => (creatorId && viewer.userId === creatorId ? d : withoutTeammateSlugs(d));
  const stored = readScope(definition);
  if (isEverywhere(stored)) return { definition: forThem(definitionWithScope(definition, stored)), scopeHidden: false, scopeKept: { cannotOpen: false, gone: false } };
  const [readable, exists] = await Promise.all([scopeReadable(viewer, [stored]), livePlaces(viewer.organizationId, [stored])]);
  const { shown, hidden } = splitScope(stored, readable);
  const { shown: hiddenLive, hidden: hiddenGone } = splitScope(hidden, exists);
  return {
    definition: forThem(definitionWithScope(definition, shown)),
    scopeHidden: !isEverywhere(hidden),
    scopeKept: { cannotOpen: !isEverywhere(hiddenLive), gone: !isEverywhere(hiddenGone) },
  };
}

/** A workflow row with its definition cut for this viewer, and the kept-places flag. */
export async function workflowForViewer<T extends { definition: unknown; createdById?: string | null }>(viewer: Viewer, row: T): Promise<Omit<T, "definition"> & { definition: Record<string, unknown>; scopeHidden: boolean; scopeKept: ScopeKept }> {
  const v = await definitionForViewer(viewer, row.definition, row.createdById ?? null);
  return { ...row, definition: v.definition, scopeHidden: v.scopeHidden, scopeKept: v.scopeKept };
}

/** A version row with its snapshot cut the same way. */
export async function versionForViewer<T extends { definitionJson: unknown }>(viewer: Viewer, row: T, creatorId: string | null): Promise<Omit<T, "definitionJson"> & { definitionJson: Record<string, unknown> }> {
  return { ...row, definitionJson: (await definitionForViewer(viewer, row.definitionJson, creatorId)).definition };
}
