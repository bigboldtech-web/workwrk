/**
 * Merge the duplicated "Lead Reallocation Rules" SOP. The original
 * (no leading space) has the description but an empty body; the
 * accidental duplicate (leading-space title) has the full body and
 * no description. Copy content into the original and delete the
 * duplicate.
 *
 * Idempotent: re-running after success is a no-op.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const ORIGINAL_ID = "cmoh5e9qv003yo0s6bsa8956g";
const DUPLICATE_ID = "cmosit6xs0006g1s6a7xv7y4l";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  const original = await prisma.sOP.findUnique({ where: { id: ORIGINAL_ID } });
  const duplicate = await prisma.sOP.findUnique({ where: { id: DUPLICATE_ID } });

  if (!original) {
    console.log("Original is gone — nothing to do.");
    return;
  }
  if (!duplicate) {
    console.log("Duplicate already deleted — nothing to do.");
    return;
  }

  const originalHtml = (original.content as any)?.html ?? "";
  const duplicateHtml = (duplicate.content as any)?.html ?? "";

  console.log(`original id:  ${original.id}`);
  console.log(`  title: "${original.title}"`);
  console.log(`  description: ${original.description ? `"${original.description}"` : "(none)"}`);
  console.log(`  body bytes: ${originalHtml.length}`);
  console.log();
  console.log(`duplicate id: ${duplicate.id}`);
  console.log(`  title: "${duplicate.title}"`);
  console.log(`  description: ${duplicate.description ? `"${duplicate.description}"` : "(none)"}`);
  console.log(`  body bytes: ${duplicateHtml.length}`);
  console.log();

  if (duplicateHtml.length === 0) {
    console.log("Duplicate has no body — refusing to merge.");
    return;
  }
  if (originalHtml.replace(/<[^>]+>/g, "").trim() !== "") {
    console.log("Original body is non-empty — refusing to overwrite without explicit confirmation.");
    return;
  }

  console.log(`→ would copy duplicate body (${duplicateHtml.length} bytes) into original`);
  console.log(`→ would delete duplicate (${duplicate.id})`);

  if (dryRun) {
    console.log("\nDRY RUN — nothing written.");
    return;
  }

  await prisma.$transaction([
    prisma.sOP.update({
      where: { id: ORIGINAL_ID },
      data: {
        content: duplicate.content as any,
        // Keep the original description; if it's missing, take the duplicate's.
        description: original.description ?? duplicate.description ?? null,
        updatedAt: new Date(),
      },
    }),
    prisma.sOP.delete({ where: { id: DUPLICATE_ID } }),
  ]);

  console.log("✓ merged + duplicate deleted");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
