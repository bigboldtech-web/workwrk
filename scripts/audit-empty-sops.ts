/**
 * Read-only audit: find SOPs with empty/missing title or content.
 * Used to investigate "some titles are missing, some have no content".
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const sops = await prisma.sOP.findMany({
    select: {
      id: true,
      title: true,
      sopType: true,
      status: true,
      version: true,
      folder: { select: { name: true, parent: { select: { name: true } } } },
      content: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total SOPs: ${sops.length}\n`);

  const issues: { id: string; title: string; problem: string; folder: string }[] = [];

  for (const sop of sops) {
    const titleEmpty = !sop.title || sop.title.trim() === "";

    // Each SOP type has a different content shape. We check broadly:
    let contentEmpty = false;
    const c = sop.content as any;
    if (!c || typeof c !== "object") contentEmpty = true;
    else if (sop.sopType === "WRITTEN") {
      // RichText shape: { type: "richtext", html: "..." } or fallback { steps: [] }
      if (c.type === "richtext") {
        contentEmpty = !c.html || c.html.trim() === "" || c.html === "<p></p>";
      } else if (Array.isArray(c.steps)) {
        contentEmpty = c.steps.length === 0;
      }
    } else if (sop.sopType === "CHECKLIST") {
      contentEmpty = !Array.isArray(c.sections) || c.sections.length === 0;
    } else if (sop.sopType === "RECORDED") {
      contentEmpty = !Array.isArray(c.steps) || c.steps.length === 0;
    }

    const folder =
      sop.folder?.parent?.name && sop.folder?.name
        ? `${sop.folder.parent.name} / ${sop.folder.name}`
        : sop.folder?.name ?? "(unfoldered)";

    if (titleEmpty || contentEmpty) {
      issues.push({
        id: sop.id,
        title: sop.title || "(empty)",
        folder,
        problem: [
          titleEmpty ? "no title" : null,
          contentEmpty ? "no content" : null,
        ].filter(Boolean).join(" + "),
      });
    }
  }

  if (issues.length === 0) {
    console.log("✅ No SOPs with empty title or content.");
    return;
  }

  console.log(`Found ${issues.length} SOPs with issues:\n`);
  for (const i of issues) {
    console.log(`  · [${i.problem}]  ${i.folder}  ·  ${i.title}  (${i.id})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
