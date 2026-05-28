// Idempotent product-catalog seed. Upserts every CatalogProduct into
// the Product table by slug. Safe to run on every deploy.
//
// Usage:
//   npx tsx scripts/seed-products.ts
//
// Strategy:
//   1. For each catalog entry, upsert into Product by slug.
//   2. For every existing org, ensure ProductInstallation rows exist for
//      every product whose legacyModuleKey appears in their settings.
//      enabledModules — this is the backwards-compat path so existing
//      orgs don't lose any modules on the day this ships.
//   3. CROSS-suite + defaultEnabled=true products auto-install for
//      every org (the universal core).

import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { PRODUCT_CATALOG, DEFAULT_INSTALLED_SLUGS } from "../src/lib/products/catalog";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function upsertProducts() {
  console.log(`Seeding ${PRODUCT_CATALOG.length} products...`);
  let created = 0;
  let updated = 0;

  for (const p of PRODUCT_CATALOG) {
    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        iconKey: p.iconKey,
        hue: p.hue,
        suite: p.suite,
        tier: p.tier,
        status: p.status,
        defaultEnabled: p.defaultEnabled,
        displayOrder: p.displayOrder,
        legacyModuleKey: p.legacyModuleKey,
        pathPrefix: p.pathPrefix,
        seededAgents: (p.seededAgents ?? []) as object,
        seededTemplates: (p.seededTemplates ?? []) as object,
        seededIntegrations: (p.seededIntegrations ?? []) as object,
      },
      update: {
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        iconKey: p.iconKey,
        hue: p.hue,
        suite: p.suite,
        tier: p.tier,
        status: p.status,
        defaultEnabled: p.defaultEnabled,
        displayOrder: p.displayOrder,
        legacyModuleKey: p.legacyModuleKey,
        pathPrefix: p.pathPrefix,
        seededAgents: (p.seededAgents ?? []) as object,
        seededTemplates: (p.seededTemplates ?? []) as object,
        seededIntegrations: (p.seededIntegrations ?? []) as object,
      },
    });
    if (existing) updated++;
    else created++;
  }

  console.log(`  ✓ ${created} created, ${updated} updated`);
}

async function backfillExistingOrgs() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, settings: true },
  });
  if (orgs.length === 0) {
    console.log("No existing orgs to backfill.");
    return;
  }

  console.log(`Backfilling ProductInstallation for ${orgs.length} orgs...`);
  const products = await prisma.product.findMany({
    select: { id: true, slug: true, legacyModuleKey: true, defaultEnabled: true },
  });

  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const byLegacy = new Map(
    products.filter((p) => p.legacyModuleKey).map((p) => [p.legacyModuleKey!, p]),
  );

  let totalInstalls = 0;

  for (const org of orgs) {
    const settings = (org.settings as Record<string, unknown> | null) ?? {};
    const enabledModules = Array.isArray(settings.enabledModules)
      ? (settings.enabledModules as string[])
      : null;

    const slugsToInstall = new Set<string>();
    // Always install the universal core.
    for (const slug of DEFAULT_INSTALLED_SLUGS) slugsToInstall.add(slug);
    // Map legacy moduleKeys → product slugs.
    if (enabledModules) {
      for (const key of enabledModules) {
        const product = byLegacy.get(key);
        if (product) slugsToInstall.add(product.slug);
      }
    } else {
      // No legacy enabledModules → assume open install (existing
      // behavior was "show everything unless settings restricted it").
      for (const p of products) slugsToInstall.add(p.slug);
    }

    for (const slug of slugsToInstall) {
      const product = bySlug.get(slug);
      if (!product) continue;
      const installed = await prisma.productInstallation.findUnique({
        where: {
          organizationId_productId: {
            organizationId: org.id,
            productId: product.id,
          },
        },
      });
      if (installed) continue;
      await prisma.productInstallation.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          status: "ACTIVE",
        },
      });
      totalInstalls++;
    }
  }

  console.log(`  ✓ ${totalInstalls} ProductInstallation rows created`);
}

async function main() {
  await upsertProducts();
  await backfillExistingOrgs();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
