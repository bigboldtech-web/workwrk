// Per-product workspaces — the "teams build their own town inside
// their app" vision pillar. A Workspace is a named space inside a
// product (e.g. "Sales Team A" / "Sales Team B" both inside CRM).
//
// First cut is a naming-only layer:
//   - One default workspace per (org, productSlug), auto-created on
//     first access via `ensureDefaultWorkspace`.
//   - Admins can create additional named workspaces from the switcher.
//   - Membership tracked, but data isn't workspace-scoped yet — that
//     lands once Studio (the board builder) is wired and customer
//     workspace customizations have somewhere to live.
//
// Conventions:
//   - Slug is generated from the name; collisions get a `-2`, `-3`, …
//     suffix scoped to (org, productSlug).
//   - The user who creates a workspace is added as OWNER.
//   - The default workspace is org-wide visible; no membership rows
//     are pre-created for it. UI treats "no members" on the default
//     as "everyone in the org" so existing orgs don't get locked out.

import { prisma } from "@/lib/prisma";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  color: string | null;
  description: string | null;
  memberCount: number;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "workspace";
}

async function uniqueSlug(
  organizationId: string,
  productSlug: string,
  desired: string,
): Promise<string> {
  // Try the bare slug first, then `-2`, `-3`, … until one's free.
  // Capped at 50 attempts which is far past any realistic collision.
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? desired : `${desired}-${i + 1}`;
    const clash = await prisma.workspace.findFirst({
      where: { organizationId, productSlug, slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  // Pathological case — pile on a timestamp.
  return `${desired}-${Date.now()}`;
}

/**
 * Ensure a default workspace exists for (org, productSlug). Idempotent
 * — re-running for an org that already has one is a no-op. Returns
 * the default workspace id.
 */
export async function ensureDefaultWorkspace(
  organizationId: string,
  productSlug: string,
): Promise<string> {
  const existing = await prisma.workspace.findFirst({
    where: { organizationId, productSlug, isDefault: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.workspace.create({
    data: {
      organizationId,
      productSlug,
      name: "Main workspace",
      slug: "main",
      isDefault: true,
      description: "Default workspace — everyone in the org sees this.",
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Workspaces visible to a user for a given product. Includes:
 *   - The default workspace (always visible to all org users).
 *   - Any workspaces this user is an explicit member of.
 * Admins see *all* workspaces in the org for the product (we let the
 * caller pass `includeAll` for that case).
 */
export async function listWorkspacesForUser(
  userId: string,
  productSlug: string,
  opts: { includeAll?: boolean } = {},
): Promise<WorkspaceSummary[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });
  if (!user) return [];

  // Make sure the default exists before listing so the switcher is
  // never empty on a brand-new (org, product) pair.
  await ensureDefaultWorkspace(user.organizationId, productSlug);

  const whereClause = opts.includeAll
    ? { organizationId: user.organizationId, productSlug }
    : {
        organizationId: user.organizationId,
        productSlug,
        OR: [
          { isDefault: true },
          { members: { some: { userId } } },
        ],
      };

  const rows = await prisma.workspace.findMany({
    where: whereClause,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      isDefault: true,
      color: true,
      description: true,
      _count: { select: { members: true } },
    },
  });

  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    isDefault: w.isDefault,
    color: w.color,
    description: w.description,
    memberCount: w._count.members,
  }));
}

/**
 * Create a new workspace inside a product for the current user's org.
 * The creator is added as OWNER. Slug is auto-derived from the name
 * with collision-handling inside the (org, product) scope.
 */
export async function createWorkspace(args: {
  organizationId: string;
  productSlug: string;
  userId: string;
  name: string;
  color?: string;
  description?: string;
}): Promise<WorkspaceSummary> {
  const trimmed = args.name.trim();
  if (!trimmed) throw new Error("Workspace name is required");

  const slug = await uniqueSlug(args.organizationId, args.productSlug, toSlug(trimmed));

  const created = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: {
        organizationId: args.organizationId,
        productSlug: args.productSlug,
        name: trimmed,
        slug,
        isDefault: false,
        color: args.color ?? null,
        description: args.description ?? null,
        createdById: args.userId,
      },
      select: {
        id: true, name: true, slug: true, isDefault: true,
        color: true, description: true,
      },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: ws.id, userId: args.userId, role: "OWNER" },
    });
    return ws;
  });

  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    isDefault: created.isDefault,
    color: created.color,
    description: created.description,
    memberCount: 1,
  };
}
