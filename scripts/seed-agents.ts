// Idempotent agent seed. For every org × every installed Product, upserts
// the prebuilt Agent rows from src/lib/agents/catalog.ts.
//
// Strategy: per org, look at which Products are installed (ACTIVE), then
// for each agent in AGENTS_BY_PRODUCT for those products, upsert the
// Agent row by (organizationId, slug). Existing prompts/personas get
// updated — so if we improve a system prompt in catalog.ts, every org's
// copy refreshes on the next run.
//
// Usage:  npx tsx scripts/seed-agents.ts

import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import { AGENT_CATALOG } from "../src/lib/agents/catalog";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      productInstallations: {
        where: { status: "ACTIVE" },
        select: { product: { select: { slug: true } } },
      },
    },
  });

  console.log(`Seeding agents for ${orgs.length} organizations...`);
  let totalUpserts = 0;

  for (const org of orgs) {
    const installedProductSlugs = new Set(org.productInstallations.map((pi) => pi.product.slug));
    const agentsToSeed = AGENT_CATALOG.filter((a) => installedProductSlugs.has(a.productSlug));

    for (const a of agentsToSeed) {
      await prisma.agent.upsert({
        where: {
          organizationId_slug: { organizationId: org.id, slug: a.slug },
        },
        create: {
          organizationId: org.id,
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
        },
        update: {
          // Refresh fields that might have improved in catalog.ts. Don't
          // touch status (admin may have DISABLED an agent) or tools
          // (user may have customized them).
          name: a.name,
          persona: a.persona,
          description: a.description,
          systemPrompt: a.systemPrompt,
          productSlug: a.productSlug,
        },
      });
      totalUpserts++;
    }
  }

  console.log(`  ✓ ${totalUpserts} agent rows upserted`);

  const totalAgents = await prisma.agent.count();
  const enabledAgents = await prisma.agent.count({ where: { status: "ENABLED" } });
  console.log(`\nTotal Agent rows in DB: ${totalAgents} (${enabledAgents} enabled)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
