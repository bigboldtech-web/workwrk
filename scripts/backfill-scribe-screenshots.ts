/**
 * Migrates existing RECORDED SOPs from inline base64 screenshots to
 * S3-hosted objects. Idempotent — rerunnable; steps that already have
 * a `screenshotKey` are skipped.
 *
 * Run once after provisioning the S3 bucket:
 *   DATABASE_URL=... S3_*=... npx tsx scripts/backfill-scribe-screenshots.ts
 *
 * Flags:
 *   --dry-run    Report what would migrate, without writing anything.
 *   --org=<id>   Limit to one organization (useful for pilot rollouts).
 *
 * Design notes:
 *   · Uploads are sequential per-SOP so a bad image in one SOP doesn't
 *     block the next. SOPs themselves are processed one at a time —
 *     keeps Postgres row updates small and easy to reason about.
 *   · Base64 decoding is unbounded in memory per image. A 20-step SOP
 *     with 100KB screenshots is ~2MB — fine. If you ever find a SOP
 *     with 1000+ massive screenshots, consider streaming.
 */
import { PrismaClient } from "../src/generated/prisma";
import { isS3Configured, presignPutUrl, scribeScreenshotKey } from "../src/lib/s3";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const orgArg = argv.find((a) => a.startsWith("--org="));
const orgFilter = orgArg ? orgArg.split("=")[1] : null;

async function main() {
  if (!isS3Configured()) {
    console.error("S3 is not configured. Set S3_* env vars before running.");
    process.exit(1);
  }

  const where: any = { sopType: "RECORDED" };
  if (orgFilter) where.organizationId = orgFilter;

  const sops = await prisma.sOP.findMany({
    where,
    select: { id: true, organizationId: true, title: true, content: true },
  });

  console.log(`Found ${sops.length} RECORDED SOPs${orgFilter ? ` in org ${orgFilter}` : ""}${dryRun ? " (dry run)" : ""}`);

  let migratedSops = 0;
  let migratedSteps = 0;
  let skippedSteps = 0;
  let failedSteps = 0;

  for (const sop of sops) {
    const content: any = sop.content;
    if (!content || !Array.isArray(content.steps)) continue;

    let changed = false;
    const newSteps = [] as any[];
    for (const step of content.steps) {
      if (step?.screenshotKey) {
        skippedSteps++;
        newSteps.push(step);
        continue;
      }
      const dataUrl: string | null = step?.screenshot ?? null;
      if (!dataUrl || !dataUrl.startsWith("data:image/")) {
        newSteps.push(step);
        continue;
      }

      const m = /^data:(image\/(jpeg|png));base64,(.+)$/.exec(dataUrl);
      if (!m) { newSteps.push(step); continue; }
      const contentType = m[1];
      const bytes = Buffer.from(m[3], "base64");
      const key = scribeScreenshotKey(sop.organizationId);

      if (dryRun) {
        console.log(`  [dry] would upload ${key} (${bytes.byteLength} bytes)`);
        newSteps.push({ ...step, screenshotKey: key, screenshot: null });
        changed = true;
        migratedSteps++;
        continue;
      }

      try {
        const url = await presignPutUrl({ key, contentType, expiresInSeconds: 120 });
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: bytes,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        newSteps.push({ ...step, screenshotKey: key, screenshot: null });
        changed = true;
        migratedSteps++;
      } catch (err: any) {
        console.error(`  ! failed ${sop.id} step ${step?.order ?? "?"}: ${err?.message ?? err}`);
        failedSteps++;
        // Leave the step untouched so a re-run can retry.
        newSteps.push(step);
      }
    }

    if (changed && !dryRun) {
      await prisma.sOP.update({
        where: { id: sop.id },
        data: { content: { ...content, steps: newSteps } as any },
      });
    }
    if (changed) {
      migratedSops++;
      console.log(`✓ ${sop.title} (${sop.id})`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  SOPs updated: ${migratedSops}`);
  console.log(`  Steps migrated: ${migratedSteps}`);
  console.log(`  Steps skipped (already on S3): ${skippedSteps}`);
  console.log(`  Steps failed: ${failedSteps}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
