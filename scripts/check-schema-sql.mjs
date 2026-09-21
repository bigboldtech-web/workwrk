// Fail the build when prisma/schema.prisma declares a table or scalar column
// that NO migration creates: neither prisma/migrations (what `prisma migrate
// deploy` applies) nor a file in the deploy manifest of scripts/deploy-migrations.mjs,
// unless it is in the recorded baseline of things production already carries.
//
// WHY THIS EXISTS. The Prisma client is generated from schema.prisma, so every
// column in the schema is SELECTED on every read of that model. If production's
// database does not have the column, the read throws, and the product shows
// "could not load" with no hint of why. That is exactly what shipped on
// 2026-09-19: Phase 2 added `archivedById` to six models and wrote
// prisma/sql/2026-09-19-archived-by.sql for it, but the file never went into
// the deploy manifest. Every task open in production 500'd until it was found
// by reading the code, days later. Nothing in CI compared the schema to what
// the deploy actually applies. This does.
//
// THE BASELINE. This database was `db push`ed for a long time, so production
// carries 51 tables and dozens of columns that no migration file creates
// (Subscription, ActivityLog, Reminder, ...). Those are recorded once in
// scripts/schema-sql-baseline.json and are NOT drift: they are what production
// is known to have as of the date in that file. Anything the schema declares
// that is neither in a migration, nor in the manifest, nor in the baseline, is
// new and unshipped, and fails the build. Regenerate the baseline ONLY when you
// have confirmed production has the columns: `node scripts/check-schema-sql.mjs --write-baseline`.
//
// Run: node scripts/check-schema-sql.mjs   (exit 1 on drift)

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const SCHEMA = "prisma/schema.prisma";
const MIGRATIONS = "prisma/migrations";
const DEPLOY = "scripts/deploy-migrations.mjs";
const BASELINE = "scripts/schema-sql-baseline.json";
const writeBaseline = process.argv.includes("--write-baseline");

// ── 1. What the schema declares: model -> scalar column names ────────────────
const schema = readFileSync(SCHEMA, "utf8");
const modelNames = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
const models = new Map();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m;
  const cols = new Set();
  for (const raw of body.split("\n")) {
    const t = raw.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const f = /^(\w+)\s+(\w+)(\[\])?\??/.exec(t);
    if (!f) continue;
    const [, col, type] = f;
    // A field whose type is another model is a relation: it has no column of
    // its own (the foreign key beside it does). Everything else is a column.
    if (modelNames.has(type)) continue;
    cols.add(col);
  }
  models.set(name, cols);
}

// ── 2. What the migrations create ────────────────────────────────────────────
function sqlFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...sqlFiles(p));
    else if (d.name.endsWith(".sql")) out.push(readFileSync(p, "utf8"));
  }
  return out;
}
const deploy = readFileSync(DEPLOY, "utf8");
const manifest = [...(/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(deploy)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const manifestSql = manifest.map((f) => {
  const p = join("prisma/sql", f);
  if (!existsSync(p)) { console.error(`check-schema-sql: manifest names ${p} but it does not exist`); process.exit(1); }
  return readFileSync(p, "utf8");
});
const all = [...sqlFiles(MIGRATIONS), ...manifestSql].join("\n");

const created = new Set(); // "Table" and "Table.column"
// Statement by statement, so a multi-column ALTER is read in full:
//   ALTER TABLE "Agent" ADD COLUMN "a" ..., ADD COLUMN "b" ...;
for (const stmt of all.split(";")) {
  const s = stmt.replace(/--[^\n]*/g, "");
  let m;
  if ((m = /CREATE TABLE(?: IF NOT EXISTS)?\s+"(\w+)"\s*\(([\s\S]*)\)\s*$/.exec(s))) {
    created.add(m[1]);
    for (const c of m[2].matchAll(/(?:^|,)\s*"(\w+)"\s/g)) created.add(`${m[1]}.${c[1]}`);
    continue;
  }
  if ((m = /ALTER TABLE(?: ONLY)?\s+"(\w+)"/.exec(s))) {
    const table = m[1];
    for (const c of s.matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+"(\w+)"/g)) created.add(`${table}.${c[1]}`);
    for (const c of s.matchAll(/RENAME COLUMN\s+"\w+"\s+TO\s+"(\w+)"/g)) created.add(`${table}.${c[1]}`);
    if (/RENAME TO\s+"(\w+)"/.test(s)) created.add(/RENAME TO\s+"(\w+)"/.exec(s)[1]);
  }
}

// ── 3. Compare, minus the recorded baseline ──────────────────────────────────
const baseline = existsSync(BASELINE) ? new Set(JSON.parse(readFileSync(BASELINE, "utf8")).known) : new Set();
const missing = [];
for (const [model, cols] of models) {
  if (!created.has(model)) { if (!baseline.has(model)) missing.push(model); continue; }
  for (const c of cols) {
    const key = `${model}.${c}`;
    if (!created.has(key) && !baseline.has(key)) missing.push(key);
  }
}

if (writeBaseline) {
  const known = [];
  for (const [model, cols] of models) {
    if (!created.has(model)) { known.push(model); continue; }
    for (const c of cols) if (!created.has(`${model}.${c}`)) known.push(`${model}.${c}`);
  }
  writeFileSync(BASELINE, JSON.stringify({
    note: "Tables and columns the schema declares that no migration file creates, which PRODUCTION ALREADY HAS from the db-push era. Recorded, not drift. Add to this list only after confirming production has the object. Anything outside it must ship through a prisma/sql file in SQL_MANIFEST.",
    recordedAt: new Date().toISOString().slice(0, 10),
    known: known.sort(),
  }, null, 2) + "\n");
  console.log(`check-schema-sql: baseline written with ${known.length} known entries to ${BASELINE}`);
  process.exit(0);
}

if (missing.length) {
  console.error("check-schema-sql: the schema declares things NO migration creates and the baseline does not know.");
  console.error("Every column in schema.prisma is selected on every read of its model; a database without it throws on read.\n");
  for (const k of missing.sort()) console.error(`  ${k}`);
  console.error(`\nShip them: add an idempotent file under prisma/sql and list it in SQL_MANIFEST in ${DEPLOY}.`);
  process.exit(1);
}
console.log(`check-schema-sql: ok, ${models.size} models checked against ${manifest.length} manifest files, ${sqlFiles(MIGRATIONS).length} migrations and a baseline of ${baseline.size}`);
