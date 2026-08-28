// One-time backfill for the premium-module system (Talk + Tables).
//
// Ships the module toggle safely: existing orgs keep Talk + Tables visible,
// while NEW orgs start with them OFF (they're premium). Run ONCE, against a DB,
// BEFORE the rail/route gates go live — otherwise the gate would hide the
// modules from current users until this runs.
//
//   npx tsx scripts/backfill-modules.ts
//
// What it does:
//   1. Upserts the module Products (workwrk-talk, workwrk-tables) by slug.
//   2. For every existing org, CREATES an ACTIVE ProductInstallation for each
//      module — but only if no row exists yet, so re-running never reactivates
//      a module an admin later turned off.
//
// Idempotent. Safe to re-run.

import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { PRODUCT_CATALOG } from "../src/lib/products/catalog";
import { MODULE_SLUGS } from "../src/lib/modules";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const moduleSlugs = new Set(MODULE_SLUGS);
  const moduleProducts = PRODUCT_CATALOG.filter((p) => moduleSlugs.has(p.slug));
  if (moduleProducts.length !== moduleSlugs.size) {
    throw new Error(
      `Catalog is missing a module product. Expected ${[...moduleSlugs].join(", ")}, ` +
        `found ${moduleProducts.map((p) => p.slug).join(", ")}.`,
    );
  }

  console.log(`Upserting ${moduleProducts.length} module products...`);
  for (const p of moduleProducts) {
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
        pathPrefix: p.pathPrefix,
      },
    });
    console.log(`  ✓ ${p.slug}`);
  }

  const products = await prisma.product.findMany({
    where: { slug: { in: [...moduleSlugs] } },
    select: { id: true, slug: true },
  });
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\nActivating modules for ${orgs.length} existing org(s)...`);

  let created = 0;
  let skipped = 0;
  for (const org of orgs) {
    for (const product of products) {
      const existing = await prisma.productInstallation.findUnique({
        where: { organizationId_productId: { organizationId: org.id, productId: product.id } },
        select: { id: true, status: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.productInstallation.create({
        data: { organizationId: org.id, productId: product.id, status: "ACTIVE" },
      });
      created++;
      console.log(`  + ${org.name}: ${product.slug} ACTIVE`);
    }
  }

  console.log(`\n✓ Done. ${created} installation(s) created, ${skipped} left untouched.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
