// One-off: re-mirror SOP.category/subcategory strings from the SOPFolder
// chain for every foldered SOP (and null them for unfoldered SOPs whose
// strings are stale). The folder tree is the ONE taxonomy; this fixes rows
// written before the API started mirroring. Dry-run by default; --apply to
// write. --env <path> selects the env file (default .env.local).
import { readFileSync } from "node:fs";
import pg from "pg";

const envPath = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]
  : ".env.local";
const url = readFileSync(envPath, "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL=")).replace(/^DATABASE_URL=/, "").trim().replace(/^["']|["']$/g, "");
const apply = process.argv.includes("--apply");

const c = new pg.Client({ connectionString: url });
await c.connect();
console.log("Env file:", envPath, apply ? "(APPLY)" : "(dry run)");

const folders = (await c.query('SELECT id, name, "parentId", "organizationId" FROM "SOPFolder"')).rows;
const byId = new Map(folders.map((f) => [f.id, f]));
const chainOf = (fid) => {
  const node = byId.get(fid);
  if (!node) return { category: null, subcategory: null };
  let top = node;
  while (top.parentId && byId.has(top.parentId)) top = byId.get(top.parentId);
  return { category: top.name, subcategory: top.id === node.id ? null : node.name };
};

const sops = (await c.query('SELECT id, title, category, subcategory, "folderId" FROM "SOP"')).rows;
const fixes = [];
for (const s of sops) {
  const want = s.folderId ? chainOf(s.folderId) : { category: null, subcategory: null };
  if (s.category !== want.category || s.subcategory !== want.subcategory) {
    fixes.push({ id: s.id, title: s.title, from: `${s.category ?? "-"}/${s.subcategory ?? "-"}`, to: `${want.category ?? "-"}/${want.subcategory ?? "-"}`, ...want });
  }
}
console.log(`SOPs scanned: ${sops.length}; mirrors out of sync: ${fixes.length}`);
for (const f of fixes.slice(0, 40)) console.log(`  ${f.id}  ${f.from}  ->  ${f.to}   ${f.title.slice(0, 50)}`);
if (apply) {
  for (const f of fixes) {
    await c.query('UPDATE "SOP" SET category=$1, subcategory=$2 WHERE id=$3', [f.category, f.subcategory, f.id]);
  }
  console.log(`Updated ${fixes.length} row(s).`);
} else if (fixes.length) {
  console.log("Re-run with --apply to write.");
}
await c.end();
