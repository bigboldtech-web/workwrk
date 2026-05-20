// GET /api/products/installations         — list this org's installs
// POST /api/products/installations         — install a product { productSlug, settings? }
// DELETE /api/products/installations       — remove an install { productSlug }
//
// Admin or owner only for POST/DELETE. GET is any authed user (the
// sidebar needs to know what's installed).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { AGENTS_BY_PRODUCT } from "@/lib/agents/catalog";

async function resolveOrgAndRole() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, accessLevel: true },
  });
  if (!user?.organizationId) {
    return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  }

  return {
    userId: user.id,
    orgId: user.organizationId,
    accessLevel: user.accessLevel,
  };
}

export async function GET() {
  const ctx = await resolveOrgAndRole();
  if ("error" in ctx) return ctx.error;

  const installations = await prisma.productInstallation.findMany({
    where: { organizationId: ctx.orgId, status: { not: "REMOVED" } },
    include: {
      product: {
        select: { slug: true, name: true, tagline: true, iconKey: true, hue: true, pathPrefix: true },
      },
    },
    orderBy: { product: { displayOrder: "asc" } },
  });

  return NextResponse.json({
    installations: installations.map((i) => ({
      productSlug: i.product.slug,
      productName: i.product.name,
      tagline: i.product.tagline,
      iconKey: i.product.iconKey,
      hue: i.product.hue,
      pathPrefix: i.product.pathPrefix,
      status: i.status,
      installedAt: i.installedAt.toISOString(),
      settings: i.settings,
    })),
  });
}

const installSchema = z.object({
  productSlug: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveOrgAndRole();
  if ("error" in ctx) return ctx.error;
  if (ctx.accessLevel !== "SUPER_ADMIN" && ctx.accessLevel !== "COMPANY_ADMIN") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = installSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { slug: parsed.data.productSlug } });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const installation = await prisma.productInstallation.upsert({
    where: {
      organizationId_productId: {
        organizationId: ctx.orgId,
        productId: product.id,
      },
    },
    create: {
      organizationId: ctx.orgId,
      productId: product.id,
      installedById: ctx.userId,
      status: "ACTIVE",
      settings: (parsed.data.settings ?? {}) as object,
    },
    update: {
      status: "ACTIVE",
      installedById: ctx.userId,
      pausedAt: null,
      removedAt: null,
      ...(parsed.data.settings ? { settings: parsed.data.settings as object } : {}),
    },
  });

  // Auto-install prebuilt agents that ship with this product. Idempotent
  // via upsert; if the org previously had an agent then uninstalled it
  // (status=ARCHIVED), this re-enables. Best-effort: failure here does
  // not block the product install — the user can install agents manually
  // from /agents later.
  try {
    const agents = AGENTS_BY_PRODUCT[product.slug] ?? [];
    for (const a of agents) {
      await prisma.agent.upsert({
        where: { organizationId_slug: { organizationId: ctx.orgId, slug: a.slug } },
        create: {
          organizationId: ctx.orgId,
          slug: a.slug,
          name: a.name,
          persona: a.persona,
          description: a.description,
          systemPrompt: a.systemPrompt,
          productSlug: a.productSlug,
          tools: a.tools as object,
          isPrebuilt: true,
          prebuiltSlug: a.slug,
          status: "ENABLED",
          createdById: ctx.userId,
        },
        update: {
          status: "ENABLED",
          name: a.name,
          persona: a.persona,
          description: a.description,
          systemPrompt: a.systemPrompt,
        },
      });
    }
  } catch (err) {
    console.error("[products/installations] agent auto-install failed:", err);
  }

  return NextResponse.json({
    installation: {
      productSlug: product.slug,
      status: installation.status,
      installedAt: installation.installedAt.toISOString(),
    },
  });
}

const removeSchema = z.object({ productSlug: z.string().min(1) });

export async function DELETE(req: Request) {
  const ctx = await resolveOrgAndRole();
  if ("error" in ctx) return ctx.error;
  if (ctx.accessLevel !== "SUPER_ADMIN" && ctx.accessLevel !== "COMPANY_ADMIN") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { slug: parsed.data.productSlug } });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  await prisma.productInstallation.update({
    where: {
      organizationId_productId: {
        organizationId: ctx.orgId,
        productId: product.id,
      },
    },
    data: {
      status: "REMOVED",
      removedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
