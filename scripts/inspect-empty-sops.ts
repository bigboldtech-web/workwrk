/**
 * Read-only: dump everything about the empty-title / empty-content SOPs
 * so we can decide whether to fix or delete them.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const IDS = [
  "cmoh5e9qv003yo0s6bsa8956g", // Lead Reallocation Rules — no content
  "cmocmedq6000svas6cjv6yz6k", // Referral Management — no title + no content
  "cmobf9f5h000dvas6af2ql6ci", // Community Management — no title + no content
  "cmo9ptobu000ieis6nq0ep85w", // Marketing Generalist Daily Rhytm — no content
];

async function main() {
  for (const id of IDS) {
    const sop = await prisma.sOP.findUnique({
      where: { id },
      include: {
        folder: { include: { parent: true } },
        compliance: { take: 1, orderBy: { createdAt: "desc" } },
        versions: { orderBy: { version: "desc" }, take: 3 },
        assignments: { take: 1 },
      },
    });
    if (!sop) {
      console.log(`\n${id} → not found`);
      continue;
    }
    console.log("\n──────────────────────────────────────");
    console.log(`id:           ${sop.id}`);
    console.log(`title:        "${sop.title}"`);
    console.log(`category/sub: "${sop.category ?? "—"}" / "${sop.subcategory ?? "—"}"`);
    console.log(`folder:       ${sop.folder?.parent?.name ? sop.folder.parent.name + " / " : ""}${sop.folder?.name ?? "(none)"}`);
    console.log(`type:         ${sop.sopType}`);
    console.log(`status:       ${sop.status}`);
    console.log(`version:      v${sop.version}`);
    console.log(`description:  ${sop.description ? `"${sop.description}"` : "(none)"}`);
    console.log(`created:      ${sop.createdAt.toISOString()}`);
    console.log(`updated:      ${sop.updatedAt.toISOString()}`);
    console.log(`published:    ${sop.publishedAt ? sop.publishedAt.toISOString() : "(never)"}`);
    console.log(`compliance:   ${sop.compliance.length > 0 ? "has records" : "none"}`);
    console.log(`assignments:  ${sop.assignments.length > 0 ? "yes" : "none"}`);
    console.log(`prior versions: ${sop.versions.length} (${sop.versions.map((v) => `v${v.version}: "${v.title?.slice(0, 40) ?? ""}"`).join(", ") || "none"})`);
    console.log(`content keys: ${JSON.stringify(Object.keys(sop.content as object || {}))}`);
    const c = sop.content as any;
    if (c?.html) console.log(`html bytes:   ${c.html.length} (sample: "${c.html.slice(0, 80)}")`);
    if (Array.isArray(c?.steps)) console.log(`steps count:  ${c.steps.length}`);
    if (Array.isArray(c?.sections)) console.log(`sections:     ${c.sections.length}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
