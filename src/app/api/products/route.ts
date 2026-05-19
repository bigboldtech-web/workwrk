// GET /api/products
//
// Returns the global product catalog (every Product row) plus the
// currently-authed org's ProductInstallation state for each.
//
// Authentication required (any authed user can list products); install
// state is scoped to their organization.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    orderBy: { displayOrder: "asc" },
    select: {
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
  });

  return NextResponse.json({ products });
}
