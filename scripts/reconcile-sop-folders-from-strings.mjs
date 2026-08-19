// One-off reconciliation: prod SOPs predate folder adoption — their
// category/subcategory STRINGS are the curated taxonomy, while folderId is
// null or a coarse bulk bucket. This makes the tree follow the strings:
// match (or create) the top-level category folder and subcategory child the
// strings name, and point SOP.folderId at it. Strings are NEVER modified,
// nothing is nulled, no SOP is touched whose folder already agrees with its
// strings. After this, the forward mirror (folder chain -> strings) is
// coherent for every row. Dry-run by default; --apply to write.
import { readFileSync } from "node:fs";
import pg from "pg";

const envPath = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
const url = readFileSync(envPath, "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL=")).replace(/^DATABASE_URL=/, "").trim().replace(/^["']|["']$/g, "");
const apply = process.argv.includes("--apply");
const c = new pg.Client({ connectionString: url });
await c.connect();
console.log("Env:", envPath, apply ? "(APPLY)" : "(dry run)");

const cuid = (p) => p + Math.abs(Date.now()).toString(36) + Math.floor(Math.random() * 1e9).toString(36);
const folders = (await c.query('SELECT id, name, "parentId", "organizationId" FROM "SOPFolder"')).rows;
const sops = (await c.query('SELECT id, title, category, subcategory, "folderId", "organizationId" FROM "SOP" WHERE category IS NOT NULL')).rows;

const byId = new Map(folders.map((f) => [f.id, f]));
const chainOf = (fid) => {
  const n = byId.get(fid); if (!n) return { category: null, subcategory: null };
  let top = n; while (top.parentId && byId.has(top.parentId)) top = byId.get(top.parentId);
  return { category: top.name, subcategory: top.id === n.id ? null : n.name };
};
const findFolder = (org, name, parentId) =>
  folders.find((f) => f.organizationId === org && f.parentId === parentId && f.name.trim().toLowerCase() === name.trim().toLowerCase());

const toCreate = [];  // {id, name, parentId, org}
const toLink = [];    // {sopId, folderId, label, title}
const ensureFolder = (org, name, parentId) => {
  let f = findFolder(org, name, parentId);
  if (!f) {
    f = { id: cuid("sfld_"), name: name.trim(), parentId, organizationId: org };
    folders.push(f); byId.set(f.id, f);
    toCreate.push(f);
  }
  return f;
};

let already = 0;
for (const s of sops) {
  const want = { category: s.category, subcategory: s.subcategory };
  const have = s.folderId ? chainOf(s.folderId) : { category: null, subcategory: null };
  if (have.category === want.category && have.subcategory === want.subcategory) { already++; continue; }
  const cat = ensureFolder(s.organizationId, s.category, null);
  const node = s.subcategory ? ensureFolder(s.organizationId, s.subcategory, cat.id) : cat;
  toLink.push({ sopId: s.id, folderId: node.id, label: `${s.category}${s.subcategory ? " / " + s.subcategory : ""}`, title: s.title });
}

console.log(`SOPs with category strings: ${sops.length}; already coherent: ${already}; to link: ${toLink.length}; folders to create: ${toCreate.length}`);
for (const f of toCreate) console.log(`  NEW ${f.parentId ? "subcategory" : "category"}: ${f.name}${f.parentId ? ` (under ${byId.get(f.parentId).name})` : ""}`);
for (const l of toLink.slice(0, 80)) console.log(`  LINK ${l.sopId}  -> ${l.label}   ${l.title.slice(0, 48)}`);

if (apply) {
  for (const f of toCreate) {
    await c.query('INSERT INTO "SOPFolder"(id, name, "parentId", "organizationId", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,now(),now())',
      [f.id, f.name, f.parentId, f.organizationId]);
  }
  for (const l of toLink) {
    await c.query('UPDATE "SOP" SET "folderId"=$1 WHERE id=$2', [l.folderId, l.sopId]);
  }
  console.log(`Created ${toCreate.length} folder(s), linked ${toLink.length} SOP(s). Strings untouched.`);
} else if (toLink.length) {
  console.log("Re-run with --apply to write.");
}
await c.end();
