import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find any SOP whose title (loosely) matches.
  const sops = await prisma.sOP.findMany({
    where: { title: { contains: "Lead Reallocation", mode: "insensitive" } },
    include: {
      versions: { orderBy: { version: "asc" } },
    },
  });

  for (const sop of sops) {
    console.log("──────────────");
    console.log(`id:    ${sop.id}`);
    console.log(`title: "${sop.title}"`);
    console.log(`type:  ${sop.sopType}, status: ${sop.status}, v: ${sop.version}`);
    console.log(`created: ${sop.createdAt.toISOString()}`);
    console.log(`updated: ${sop.updatedAt.toISOString()}`);
    console.log(`description: ${sop.description ? `"${sop.description}"` : "(none)"}`);
    console.log(`content keys: ${JSON.stringify(Object.keys((sop.content as any) ?? {}))}`);
    const c = sop.content as any;
    if (c?.html !== undefined) console.log(`  html bytes: ${(c.html ?? "").length}, sample: "${(c.html ?? "").slice(0, 200)}"`);
    if (Array.isArray(c?.steps)) console.log(`  steps: ${c.steps.length}`);
    if (Array.isArray(c?.sections)) console.log(`  sections: ${c.sections.length}`);
    console.log(`prior versions: ${sop.versions.length}`);
    for (const v of sop.versions) {
      console.log(`  v${v.version} — title: "${v.title}", title bytes: ${(v.title ?? "").length}`);
      const vc = v.content as any;
      if (vc?.html !== undefined) console.log(`    html bytes: ${(vc.html ?? "").length}, sample: "${(vc.html ?? "").slice(0, 200)}"`);
    }
  }

  // Also check the activity log for this SOP id, if we can find it.
  if (sops.length > 0) {
    const ids = sops.map((s) => s.id);
    const acts = await prisma.activityLog.findMany({
      where: { targetId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { type: true, description: true, createdAt: true },
    });
    console.log(`\nActivity log entries (most recent first): ${acts.length}`);
    for (const a of acts) {
      console.log(`  ${a.createdAt.toISOString()}  ${a.type}  ·  ${a.description}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
