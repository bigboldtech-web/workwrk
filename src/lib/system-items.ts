// Items the product writes for itself, and the one rule that keeps them out
// of a person's work.
//
// WHY THIS EXISTS. spec-planner.md section 1 Access resolves a meeting to
// `{ type: "item", id }` in a hidden per-organization "Meetings" List rather
// than adding a `meeting` ObjectRef to the access model, so every meeting
// now has an Item row whose assignees are its attendees
// (scripts/backfill-meeting-items.mjs writes them).
//
// That is exactly the shape the access ladder wants, and it is exactly the
// shape "my assigned work" queries want too. Without this rule, a standup a
// person attends appears in My Work, in the Today list, in their ICS feed
// and in the task picker on the Timesheets add row as if it were a task
// somebody gave them. The Items are PLUMBING (spec-planner: "hidden from the
// Spaces tree, not shareable and carrying no views, so it is plumbing rather
// than a surface"), and this is what makes "hidden" true rather than stated.
//
// One constant, one `where` fragment, so a surface cannot forget half of it
// and no route grows its own idea of what counts as a real task.
//
// Pure: no prisma import, no React. Safe in a vitest node run.

/**
 * `Item.itemType` values written by the product for its own bookkeeping.
 *
 * A scalar on Item, deliberately, rather than a join through Board: every
 * query below already scans Item, and adding a join to each of them to hide
 * seven rows would be a cost paid on every page load forever.
 */
export const SYSTEM_ITEM_TYPES = ["meeting"] as const;

export type SystemItemType = typeof SYSTEM_ITEM_TYPES[number];

/** Is this an Item the product wrote for itself? */
export function isSystemItemType(itemType: string | null | undefined): boolean {
  return typeof itemType === "string" && (SYSTEM_ITEM_TYPES as readonly string[]).includes(itemType);
}

/**
 * The Prisma `where` fragment every "my work" query spreads.
 *
 *   const rows = await prisma.item.findMany({
 *     where: { organizationId, ...NOT_SYSTEM_ITEMS, OR: [...] },
 *   });
 *
 * Typed as a plain object rather than Prisma.ItemWhereInput so this module
 * stays free of the generated client and can be unit-tested in node.
 */
export const NOT_SYSTEM_ITEMS: { itemType: { notIn: string[] } } = {
  itemType: { notIn: [...SYSTEM_ITEM_TYPES] },
};
