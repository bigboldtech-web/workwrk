// What an editor is shown of an automation's definition: its scope cut to
// the places they can open, with a flag when places they cannot open are
// kept. Every route that answers with a definition (the builder's GET and
// PUT, publish, activate, pause, duplicate) answers through this, so no
// response lists, names or counts a place its reader cannot open.

import type { Viewer } from "@/lib/access/types";
import { definitionWithScope, isEverywhere, readScope, splitScope } from "./definition";
import { scopeReadable } from "./places-server";

/**
 * The definition as this viewer may see it: its scope cut to the places they
 * can open, and whether others are kept (never which, never how many). The
 * builder edits only the shown part; the save keeps the rest on the server.
 */
export async function definitionForViewer(viewer: Viewer, definition: unknown): Promise<{ definition: Record<string, unknown>; scopeHidden: boolean }> {
  const stored = readScope(definition);
  if (isEverywhere(stored)) return { definition: definitionWithScope(definition, stored), scopeHidden: false };
  const { shown, hidden } = splitScope(stored, await scopeReadable(viewer, [stored]));
  return { definition: definitionWithScope(definition, shown), scopeHidden: !isEverywhere(hidden) };
}

/** A workflow row with its definition cut for this viewer, and the kept-places flag. */
export async function workflowForViewer<T extends { definition: unknown }>(viewer: Viewer, row: T): Promise<Omit<T, "definition"> & { definition: Record<string, unknown>; scopeHidden: boolean }> {
  const v = await definitionForViewer(viewer, row.definition);
  return { ...row, definition: v.definition, scopeHidden: v.scopeHidden };
}

/** A version row with its snapshot cut the same way. */
export async function versionForViewer<T extends { definitionJson: unknown }>(viewer: Viewer, row: T): Promise<Omit<T, "definitionJson"> & { definitionJson: Record<string, unknown> }> {
  return { ...row, definitionJson: (await definitionForViewer(viewer, row.definitionJson)).definition };
}
