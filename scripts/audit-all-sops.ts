/**
 * Read-only: dump every SOP with its current title, category,
 * subcategory, folder, status, and (if different) its v1 title from
 * the SOPVersion snapshots. Used to verify nothing's drifted.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const sops = await prisma.sOP.findMany({
    select: {
      id: true,
      title: true,
      category: true,
      subcategory: true,
      tags: true,
      status: true,
      version: true,
      folder: { select: { name: true, parent: { select: { name: true } } } },
      versions: {
        orderBy: { version: "asc" },
        take: 1,
        select: { title: true, version: true },
      },
    },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { title: "asc" }],
  });

  console.log(`${sops.length} SOPs total\n`);

  let mismatches = 0;
  for (const s of sops) {
    const folderPath = s.folder
      ? `${s.folder.parent?.name ? s.folder.parent.name + " / " : ""}${s.folder.name}`
      : "(unfoldered)";
    const v1 = s.versions[0];
    const v1Note = v1 && v1.title && v1.title !== s.title
      ? `  ⚠ v1 title was "${v1.title}"`
      : "";
    if (v1Note) mismatches++;

    console.log(
      `[${s.status.padEnd(9)}] v${s.version}  ${s.category ?? "—"} / ${s.subcategory ?? "—"}  ·  folder: ${folderPath}`,
    );
    console.log(`            "${s.title}"${v1Note}`);
    if (s.tags && s.tags.length > 0) {
      console.log(`            tags: ${s.tags.join(", ")}`);
    }
  }

  console.log(`\nDistinct categories: ${[...new Set(sops.map((s) => s.category).filter(Boolean))].length}`);
  console.log(`Distinct subcategories: ${[...new Set(sops.map((s) => s.subcategory).filter(Boolean))].length}`);
  console.log(`SOPs whose current title differs from their oldest snapshot: ${mismatches}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
