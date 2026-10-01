// Item-type (Task Type) helpers — defaults, the recommended library,
// and a lazy seeder so every org always has the 4 built-ins even if it
// was created after the seed migration ran.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export interface ItemTypeLite {
  id: string;
  singular: string;
  plural: string;
  icon: string;
  description: string | null;
  category: string | null;
  isDefault: boolean;
  builtIn: boolean;
}

// The 4 seeded built-ins. Mirrors the migration's CROSS JOIN values.
export const DEFAULT_ITEM_TYPES: Array<Omit<ItemTypeLite, "id">> = [
  { singular: "Task",          plural: "Tasks",          icon: "CircleDot",     description: "A standard task",        category: null, isDefault: true,  builtIn: true },
  { singular: "Milestone",     plural: "Milestones",     icon: "Diamond",       description: "A key checkpoint",       category: null, isDefault: false, builtIn: true },
  { singular: "Form Response", plural: "Form Responses", icon: "ClipboardList", description: "A submitted form entry", category: null, isDefault: false, builtIn: true },
  { singular: "Meeting Note",  plural: "Meeting Notes",  icon: "NotebookPen",   description: "Notes from a meeting",   category: null, isDefault: false, builtIn: true },
];

// One-click "Recommended" library. NOTE (architecture): Objective /
// Key Result / Goal / Person are intentionally EXCLUDED — they overlap
// our first-class OKR/KRA/KPI/User models. Item types are presentational
// re-skins; to relate an Item to those, link via EntityLink — don't
// re-type it into a duplicate.
export interface RecommendedItemType {
  singular: string;
  plural: string;
  icon: string;
  description: string;
  category: string;
}

export const RECOMMENDED_ITEM_TYPES: RecommendedItemType[] = [
  { singular: "Account",    plural: "Accounts",    icon: "Building2",    description: "A customer or company account",       category: "Sales & CRM" },
  { singular: "Lead",       plural: "Leads",       icon: "UserPlus",     description: "A prospective customer",               category: "Sales & CRM" },
  { singular: "Deal",       plural: "Deals",       icon: "Handshake",    description: "A sales opportunity",                  category: "Sales & CRM" },
  { singular: "Bug",        plural: "Bugs",        icon: "Bug",          description: "A defect to fix",                      category: "Software Development" },
  { singular: "User Story",  plural: "User Stories", icon: "BookOpen",   description: "A unit of product work",               category: "Software Development" },
  { singular: "Campaign",   plural: "Campaigns",   icon: "Megaphone",    description: "A marketing campaign",                 category: "Marketing" },
  { singular: "Content",    plural: "Content",     icon: "FileText",     description: "A content piece",                      category: "Marketing" },
  { singular: "Project",    plural: "Projects",    icon: "FolderKanban", description: "A project",                            category: "PMO" },
  { singular: "Initiative", plural: "Initiatives", icon: "Flag",         description: "A strategic initiative",               category: "PMO" },
  { singular: "Request",    plural: "Requests",    icon: "Inbox",        description: "An incoming request",                  category: "Support" },
  { singular: "Asset",      plural: "Assets",      icon: "Box",          description: "A tracked asset",                      category: "Operations" },
  { singular: "Resource",   plural: "Resources",   icon: "Package",      description: "A reusable resource",                  category: "Operations" },
];

export const ITEM_TYPE_CATEGORIES: string[] = [
  "Finance & Accounting", "Creative & Design", "IT", "Software Development",
  "Marketing", "Sales & CRM", "People & HR", "Operations", "PMO",
  "Personal Use", "Support",
];

/** Max custom types per org (matches the "N of 20 used" meter). */
export const ITEM_TYPE_LIMIT = 20;

/** The columns the seed and repair pass reads for every type in an org. */
export interface ItemTypeRepairRow {
  id: string;
  singular: string;
  builtIn: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** What ensureDefaultItemTypes must do to leave an org with exactly one
 *  set of built-ins and at most one default type. */
export interface ItemTypeRepairPlan {
  /** No built-ins at all: create the 4. */
  seed: boolean;
  /** When seeding, whether the new Task takes the default (false when some
   *  custom type already holds it, so the org never ends with two). */
  seedTaskAsDefault: boolean;
  /** Duplicate built-ins to delete, each with the surviving row that its
   *  tasks and List defaults are repointed to. */
  remove: Array<{ id: string; keepId: string }>;
  /** Surviving rows whose isDefault must be cleared. */
  clearDefaultIds: string[];
  /** A surviving row that must become the default (it inherits the flag
   *  from a removed duplicate), or null. */
  setDefaultId: string | null;
}

/** True when the plan has nothing to do (the common, healthy case). */
export function itemTypePlanIsNoop(p: ItemTypeRepairPlan): boolean {
  return !p.seed && p.remove.length === 0 && p.clearDefaultIds.length === 0 && p.setDefaultId === null;
}

const oldestFirst = (a: ItemTypeRepairRow, b: ItemTypeRepairRow) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Pure: work out the repair for one org's item types.
 *
 *  Built-ins can't be renamed (PATCH refuses it), so two built-ins with the
 *  same singular are always a double seed, never two real choices: the
 *  oldest of each name survives (ties on createdAt break on id). A removed
 *  duplicate's default flag moves to its survivor. If more than one row is
 *  still the default after that, the most recently updated one keeps it,
 *  because a deliberate "Set as default" is the newest write (PATCH clears
 *  the others first); a double seed leaves two equal Tasks, which the
 *  dedupe above already collapsed into one. */
export function planItemTypeRepair(rows: ItemTypeRepairRow[]): ItemTypeRepairPlan {
  const builtIns = rows.filter((r) => r.builtIn);
  if (builtIns.length === 0) {
    return {
      seed: true,
      seedTaskAsDefault: !rows.some((r) => r.isDefault),
      remove: [],
      clearDefaultIds: [],
      setDefaultId: null,
    };
  }

  const bySingular = new Map<string, ItemTypeRepairRow[]>();
  for (const r of builtIns) {
    const group = bySingular.get(r.singular);
    if (group) group.push(r);
    else bySingular.set(r.singular, [r]);
  }

  const remove: Array<{ id: string; keepId: string }> = [];
  const removed = new Set<string>();
  const inheritsDefault = new Set<string>();
  for (const group of bySingular.values()) {
    if (group.length < 2) continue;
    const [keep, ...dupes] = [...group].sort(oldestFirst);
    for (const d of dupes) {
      remove.push({ id: d.id, keepId: keep.id });
      removed.add(d.id);
      if (d.isDefault && !keep.isDefault) inheritsDefault.add(keep.id);
    }
  }

  const survivors = rows.filter((r) => !removed.has(r.id));
  const defaults = survivors.filter((r) => r.isDefault || inheritsDefault.has(r.id));
  let winner: ItemTypeRepairRow | null = null;
  if (defaults.length > 0) {
    winner = [...defaults].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || oldestFirst(a, b),
    )[0];
  }
  const clearDefaultIds = survivors
    .filter((r) => r.isDefault && r.id !== winner?.id)
    .map((r) => r.id);
  const setDefaultId = winner && !winner.isDefault ? winner.id : null;

  return { seed: false, seedTaskAsDefault: false, remove, clearDefaultIds, setDefaultId };
}

const REPAIR_SELECT = {
  id: true, singular: true, builtIn: true, isDefault: true, createdAt: true, updatedAt: true,
} as const;

/** Ensure an org has its 4 built-ins exactly once, and at most one default
 *  type. Returns nothing: call before listing so new orgs aren't empty.
 *
 *  This used to be a bare count() then createMany() with no lock, so two
 *  overlapping first reads (two tabs, the Task system tab's mount fetch
 *  under StrictMode, the create-task modal and a container menu firing
 *  together) both saw 0 and both seeded: every built-in twice and two
 *  Default Tasks, which nobody could delete because built-ins are
 *  protected. Now the healthy case is one plain read; anything else runs
 *  under a per-org transaction-scoped advisory lock and re-reads inside it,
 *  so a second caller waits, sees the first caller's rows and does nothing.
 *  The same pass also heals an org that was already double-seeded. */
export async function ensureDefaultItemTypes(orgId: string): Promise<void> {
  const rows = await prisma.itemType.findMany({ where: { organizationId: orgId }, select: REPAIR_SELECT });
  if (itemTypePlanIsNoop(planItemTypeRepair(rows))) return;

  await prisma.$transaction(async (tx) => {
    // $executeRaw tagged template (not $queryRaw with values): same idiom as
    // the other advisory locks here, and it avoids the dev-only P2010 split.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"itemtype-seed:" + orgId}))`;
    const fresh = await tx.itemType.findMany({ where: { organizationId: orgId }, select: REPAIR_SELECT });
    const plan = planItemTypeRepair(fresh);
    if (itemTypePlanIsNoop(plan)) return;

    if (plan.seed) {
      await tx.itemType.createMany({
        data: DEFAULT_ITEM_TYPES.map((t) => ({
          organizationId: orgId,
          ...t,
          isDefault: t.isDefault && plan.seedTaskAsDefault,
        })),
      });
      return;
    }

    // Repoint everything that names a duplicate before deleting it: tasks
    // (Item.itemTypeId) and a List's default task type
    // (Board.settings.defaultItemTypeId). Nothing a person chose is lost;
    // it now names the identical surviving built-in.
    for (const { id, keepId } of plan.remove) {
      await tx.item.updateMany({ where: { organizationId: orgId, itemTypeId: id }, data: { itemTypeId: keepId } });
      const boards = await tx.board.findMany({
        where: { organizationId: orgId, settings: { path: ["defaultItemTypeId"], equals: id } },
        select: { id: true, settings: true },
      });
      for (const b of boards) {
        const settings = b.settings && typeof b.settings === "object" && !Array.isArray(b.settings)
          ? (b.settings as Record<string, unknown>)
          : {};
        await tx.board.update({ where: { id: b.id }, data: { settings: { ...settings, defaultItemTypeId: keepId } as Prisma.InputJsonValue } });
      }
    }
    if (plan.remove.length > 0) {
      await tx.itemType.deleteMany({ where: { organizationId: orgId, id: { in: plan.remove.map((r) => r.id) } } });
    }
    if (plan.clearDefaultIds.length > 0) {
      await tx.itemType.updateMany({ where: { organizationId: orgId, id: { in: plan.clearDefaultIds } }, data: { isDefault: false } });
    }
    if (plan.setDefaultId) {
      await tx.itemType.update({ where: { id: plan.setDefaultId }, data: { isDefault: true } });
    }
  });
}

/** List an org's item types (built-ins first, then alphabetical). */
export async function listItemTypes(orgId: string): Promise<ItemTypeLite[]> {
  await ensureDefaultItemTypes(orgId);
  const rows = await prisma.itemType.findMany({
    where: { organizationId: orgId },
    orderBy: [{ builtIn: "desc" }, { singular: "asc" }],
    select: {
      id: true, singular: true, plural: true, icon: true,
      description: true, category: true, isDefault: true, builtIn: true,
    },
  });
  return rows;
}
