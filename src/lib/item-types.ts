// Item-type (Task Type) helpers — defaults, the recommended library,
// and a lazy seeder so every org always has the 4 built-ins even if it
// was created after the seed migration ran.

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
  "Marketing", "Sales & CRM", "HR & Recruiting", "Operations", "PMO",
  "Personal Use", "Support",
];

/** Max custom types per org (matches the "N of 20 used" meter). */
export const ITEM_TYPE_LIMIT = 20;

/** Ensure an org has its 4 built-ins; creates them if absent. Returns
 *  nothing — call before listing so new orgs aren't empty. */
export async function ensureDefaultItemTypes(orgId: string): Promise<void> {
  const count = await prisma.itemType.count({ where: { organizationId: orgId, builtIn: true } });
  if (count > 0) return;
  await prisma.itemType.createMany({
    data: DEFAULT_ITEM_TYPES.map((t) => ({ organizationId: orgId, ...t })),
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
