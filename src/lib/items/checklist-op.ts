// One change to a task's checklist, applied to the STORED list (pen test
// 2026-11-28, V-33).
//
// The drawer saved the whole checklist array on every tick, add, remove and
// drag, so two people working on one checklist at once erased each other: the
// later save carried the list as it was before the other's change. Now each
// change travels as what it is, and the server applies it to the list as it
// stands, on the locked row (item-patch.ts metadataWriter). The items carry no
// ids, so an item is found by its text, the one nearest where the editor saw
// it; an item someone else already removed is simply not changed again.
//
// Pure module.

import { z } from "zod";

const text = z.string().min(1).max(2000);
const index = z.number().int().min(0).max(10_000);

export const checklistOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), text }),
  z.object({ kind: z.literal("toggle"), index, text, done: z.boolean() }),
  z.object({ kind: z.literal("remove"), index, text }),
  // `to` is the place in the list without the moved item, as the editor counts it.
  z.object({ kind: z.literal("move"), index, text, to: index }),
]);

export type ChecklistOp = z.infer<typeof checklistOpSchema>;

/** A list can hold at most this many items; an add past it changes nothing. */
export const CHECKLIST_MAX_ITEMS = 500;

function textOf(entry: unknown): string | null {
  return entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as { text?: unknown }).text === "string"
    ? (entry as { text: string }).text
    : null;
}

/** The index of the item with this text nearest `near`, or -1. */
function locate(list: readonly unknown[], wanted: string, near: number): number {
  let best = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (textOf(list[i]) !== wanted) continue;
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  }
  return best;
}

/** The stored checklist after `op`. Anything stored that is not a list reads as empty. */
export function applyChecklistOp(stored: unknown, op: ChecklistOp): unknown[] {
  const list = Array.isArray(stored) ? [...stored] : [];
  if (op.kind === "add") {
    if (list.length >= CHECKLIST_MAX_ITEMS) return list;
    list.push({ text: op.text, done: false });
    return list;
  }
  const at = locate(list, op.text, op.index);
  if (at < 0) return list;
  if (op.kind === "toggle") {
    list[at] = { ...(list[at] as Record<string, unknown>), done: op.done };
    return list;
  }
  const [item] = list.splice(at, 1);
  if (op.kind === "remove") return list;
  const to = Math.max(0, Math.min(op.to, list.length));
  list.splice(to, 0, item);
  return list;
}
