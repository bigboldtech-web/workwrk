#!/usr/bin/env node
// backfill-notepad.mjs — one-off, idempotent re-anchor of EXISTING personal
// Notepad notes onto the NOTEPAD/<owner> anchor.
//
//   node scripts/backfill-notepad.mjs               # dry run (default), reads .env.local
//   node scripts/backfill-notepad.mjs --apply       # perform the update
//   node scripts/backfill-notepad.mjs --env .env    # point at another env file
//
// WHAT MATCHES (all conditions required):
//   - Doc."entityType" IS NULL, "createdById" IS NOT NULL,
//     "isFolder" = false, "parentId" IS NULL   (SQL pre-filter)
//   - content is the minimal TipTap shape ONLY the old Notepad textarea and
//     the voice-capture popover ever wrote (checked in JS, not SQL):
//       { type: "doc", content: [ paragraphs... ] }  and nothing else —
//       top-level keys ⊆ {type, content}; every item is a paragraph whose
//       keys ⊆ {type, content}; paragraph children are plain
//       {type:"text", text} nodes only (no marks/attrs).
//
// DISCRIMINATOR vs real /docs documents (must NOT match, and cannot):
//   - Docs-page v1 (custom block editor) stores { blocks: [...] }  → has a
//     top-level "blocks" key → rejected.
//   - Docs-page v2 (BlockNote) stores { bnDoc, blocks, version: 2, meta? }
//     → "bnDoc"/"version"/"meta" keys → rejected.
//   - Freshly created docs store {} (POST default) → no "type" → rejected.
//   - Any doc with an icon/cover stores content.meta → rejected.
//   - Rich TipTap content (headings, lists, marks, attrs) → non-paragraph
//     items or extra keys on text nodes → rejected.
//   Title is NOT part of the discriminator (notes are often "Untitled note",
//   but the content shape alone is decisive); it is printed for review.
//
// Idempotent: matched rows get entityType='NOTEPAD', entityId="createdById";
// re-running then matches nothing (entityType IS NULL pre-filter).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const envIdx = args.indexOf("--env");
const envPath = resolve(process.cwd(), envIdx !== -1 ? args[envIdx + 1] : ".env.local");

function readDatabaseUrl(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch { console.error(`Cannot read env file: ${path}`); process.exit(1); }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)\s*$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  console.error(`No DATABASE_URL in ${path}`);
  process.exit(1);
}

// The minimal TipTap Notepad shape — see file header for the discriminator.
function isNotepadShape(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (!Object.keys(c).every((k) => k === "type" || k === "content")) return false;
  if (c.type !== "doc" || !Array.isArray(c.content)) return false;
  return c.content.every((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) return false;
    if (!Object.keys(p).every((k) => k === "type" || k === "content")) return false;
    if (p.type !== "paragraph") return false;
    if (p.content === undefined) return true; // empty line — textToContent omits content
    if (!Array.isArray(p.content)) return false;
    return p.content.every(
      (n) =>
        n && typeof n === "object" && !Array.isArray(n) &&
        Object.keys(n).every((k) => k === "type" || k === "text") &&
        n.type === "text" && typeof n.text === "string",
    );
  });
}

const client = new pg.Client({ connectionString: readDatabaseUrl(envPath) });
await client.connect();

try {
  const { rows } = await client.query(
    `SELECT id, title, "createdById", content, "updatedAt"
       FROM "Doc"
      WHERE "entityType" IS NULL
        AND "createdById" IS NOT NULL
        AND "isFolder" = false
        AND "parentId" IS NULL
      ORDER BY "updatedAt" DESC`,
  );

  const matches = rows.filter((r) => isNotepadShape(r.content));

  console.log(`Env file:   ${envPath}`);
  console.log(`Candidates: ${rows.length} (entityType NULL, has creator, not folder, no parent)`);
  console.log(`Matches:    ${matches.length} (minimal TipTap Notepad shape)\n`);

  if (matches.length) {
    const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
    console.log(`${pad("id", 27)} ${pad("createdById", 27)} ${pad("updatedAt", 20)} title`);
    console.log("-".repeat(110));
    for (const m of matches) {
      const ts = m.updatedAt instanceof Date ? m.updatedAt.toISOString().slice(0, 19) : String(m.updatedAt);
      console.log(`${pad(m.id, 27)} ${pad(m.createdById, 27)} ${pad(ts, 20)} ${String(m.title).slice(0, 60)}`);
    }
    console.log("");
  }

  if (!apply) {
    console.log("Dry run only — re-run with --apply to re-anchor these rows to NOTEPAD/<creator>.");
  } else if (matches.length === 0) {
    console.log("Nothing to update.");
  } else {
    // entityType IS NULL re-checked in the WHERE so a concurrent/apply race
    // can never re-anchor a row something else already claimed.
    const res = await client.query(
      `UPDATE "Doc"
          SET "entityType" = 'NOTEPAD', "entityId" = "createdById"
        WHERE id = ANY($1::text[])
          AND "entityType" IS NULL
          AND "createdById" IS NOT NULL`,
      [matches.map((m) => m.id)],
    );
    console.log(`Updated ${res.rowCount} row(s).`);
  }
} finally {
  await client.end();
}
