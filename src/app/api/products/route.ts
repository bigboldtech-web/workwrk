// GET /api/products
//
// The global product catalog (every Product row) joined to THIS org's
// ProductInstallation state for each, which is what the header always said
// it returned and, until Phase 7, did not: it returned the catalog alone.
//
//   { products: [{ slug, name, tagline, ..., installation: { status } | null }],
//     canManage }
//
// Any signed-in person may list products (Marketplace is every Member,
// access 5.2.1); install state is scoped to their organization. `canManage`
// is whether the viewer may turn a module on or off (Owner and Admin, the
// same audience POST and DELETE /api/products/installations enforce).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { legacySessionTiers } from "@/lib/access/legacy-session";
import { MODULE_BY_SLUG, moduleNeedsUpgrade } from "@/lib/modules";
import { sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = session.user as { organizationId?: string };

  const [products, installations, org] = await Promise.all([
    prisma.product.findMany({
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        tagline: true,
        description: true,
        iconKey: true,
        hue: true,
        suite: true,
        tier: true,
        status: true,
        defaultEnabled: true,
        legacyModuleKey: true,
        pathPrefix: true,
      },
    }),
    user.organizationId
      ? prisma.productInstallation.findMany({
          where: { organizationId: user.organizationId },
          select: { productId: true, status: true, installedAt: true },
        })
      : Promise.resolve([]),
    user.organizationId
      ? prisma.organization.findUnique({ where: { id: user.organizationId }, select: { plan: true } })
      : Promise.resolve(null),
  ]);
  const byProduct = new Map(installations.map((i) => [i.productId, i]));
  const plan = org?.plan ? String(org.plan) : "STARTER";

  return NextResponse.json({
    products: products.map(({ id, ...p }) => {
      const inst = byProduct.get(id);
      return {
        ...p,
        installation: inst ? { status: inst.status, installedAt: inst.installedAt.toISOString() } : null,
        // Talk and Tables on Starter, never had (src/lib/modules.ts): the
        // switch would be refused, so the page shows the plan instead.
        needsUpgrade: !!MODULE_BY_SLUG[p.slug] && moduleNeedsUpgrade(plan, !!inst),
      };
    }),
    plan,
    canManage: (await legacySessionTiers()).admin,
    // Who may move the workspace to Growth (Plan & billing): with the Owner
    // split on, not every Admin.
    canChangePlan: await sessionMayManageOwnerPage(session, "billing"),
  });
}
