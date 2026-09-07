// schema-import — the reverse of schema-export. Parse pasted SQL DDL or a
// Prisma schema into a semantic DiagramSpec (tables with typed fields +
// relationships), which specToScene then lays out as ER tables on the canvas.
//
// Pure + dependency-free so it runs on the client and is unit-tested. It aims
// at the common shapes (what our own exporter emits + typical hand-written
// Postgres DDL / Prisma), not at being a full SQL grammar.

import type { DiagramSpec, NodeSpec, EdgeSpec } from "./from-spec";
import type { TableField } from "./scene";

interface RawFk { from: string; toTable: string }

// ── shared helpers ──────────────────────────────────────────────────────────
function unquoteIdent(s: string): string {
  const cleaned = s.trim().replace(/[`"[\]]/g, "");
  const parts = cleaned.split("."); // drop a schema qualifier
  return parts[parts.length - 1].trim();
}

// Normalise a SQL type to the short label the ER table displays.
function normalizeSqlType(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (/uuid/.test(t)) return "uuid";
  if (/timestamp|timestamptz/.test(t)) return "timestamp";
  if (/\bdate\b/.test(t)) return "date";
  if (/\btime\b/.test(t)) return "time";
  if (/serial/.test(t)) return "int";
  if (/bigint|int8/.test(t)) return "bigint";
  if (/smallint|integer|int4|int2|\bint\b/.test(t)) return "int";
  if (/numeric|decimal|money/.test(t)) return "numeric";
  if (/double|real|float/.test(t)) return "float";
  if (/bool/.test(t)) return "boolean";
  if (/jsonb|json/.test(t)) return "json";
  if (/char|text|varchar|character|string/.test(t)) return "text";
  return t.split(/\s|\(/)[0] || "text";
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ── SQL DDL ─────────────────────────────────────────────────────────────────
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function extractCreateTables(sql: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const name = unquoteIdent(m[1]);
    let depth = 0, start = -1, i = re.lastIndex - 1; // points at the opening "("
    for (; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === "(") { if (depth === 0) start = i + 1; depth++; }
      else if (ch === ")") { depth--; if (depth === 0) { out.push({ name, body: sql.slice(start, i) }); re.lastIndex = i + 1; break; } }
    }
    if (depth !== 0) break; // unbalanced — stop
  }
  return out;
}

const COL_STOP = /\b(primary|references|not|null|default|unique|check|generated|collate|constraint|auto_increment|comment)\b/i;

function parseSqlDdl(sql: string): DiagramSpec | null {
  const clean = stripSqlComments(sql);
  const tables = extractCreateTables(clean);
  if (tables.length === 0) return null;

  const nodes: NodeSpec[] = [];
  const fks: RawFk[] = [];

  for (const t of tables) {
    const fields: TableField[] = [];
    const pkCols = new Set<string>();
    const fieldByName = new Map<string, TableField>();

    for (const defRaw of splitTopLevel(t.body)) {
      const def = defRaw.trim();
      const head = def.toLowerCase();

      // table-level PRIMARY KEY (...)
      let mm = head.match(/^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]+)\)/i);
      if (mm) { for (const c of mm[1].split(",")) pkCols.add(unquoteIdent(c)); continue; }

      // table-level FOREIGN KEY (col) REFERENCES table (refcol)
      mm = def.match(/^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+([^\s(]+)/i);
      if (mm) {
        const col = unquoteIdent(mm[1].split(",")[0]);
        fks.push({ from: col, toTable: unquoteIdent(mm[2]) });
        const f = fieldByName.get(col); if (f) f.key = "fk";
        continue;
      }

      // a standalone constraint we don't model
      if (/^(constraint|unique|check|key|index|exclude|foreign\s+key|primary\s+key)\b/i.test(def)) continue;

      // otherwise: a column definition (collapse any inner whitespace first so
      // a single-line regex handles multi-line defs without the /s flag)
      const flat = def.replace(/\s+/g, " ").trim();
      const nameMatch = flat.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s*(.*)$/);
      if (!nameMatch) continue;
      const name = unquoteIdent(nameMatch[1]);
      const rest = nameMatch[2] ?? "";
      const stop = rest.search(COL_STOP);
      const typeStr = (stop >= 0 ? rest.slice(0, stop) : rest).trim() || "text";
      const field: TableField = { name, type: normalizeSqlType(typeStr) };
      if (/\bprimary\s+key\b/i.test(rest)) pkCols.add(name);
      const refM = rest.match(/\breferences\s+([^\s(]+)/i);
      if (refM) { field.key = "fk"; fks.push({ from: name, toTable: unquoteIdent(refM[1]) }); }
      fields.push(field);
      fieldByName.set(name, field);
    }

    for (const f of fields) if (pkCols.has(f.name) && f.key !== "fk") f.key = "pk";
    nodes.push({ id: t.name, label: t.name, fields });
  }

  return buildSpec(nodes, tables.map((t) => t.name), fks);
}

// ── Prisma ───────────────────────────────────────────────────────────────────
const PRISMA_SCALARS = new Set(["string", "int", "bigint", "float", "decimal", "boolean", "datetime", "json", "bytes"]);
function normalizePrismaType(base: string, attrs: string): string {
  const b = base.toLowerCase();
  if (/@db\.uuid/i.test(attrs)) return "uuid";
  if (/@db\.timestamptz|@db\.timestamp/i.test(attrs)) return "timestamp";
  if (/@db\.date/i.test(attrs)) return "date";
  switch (b) {
    case "string": return "text";
    case "int": return "int";
    case "bigint": return "bigint";
    case "float": return "float";
    case "decimal": return "numeric";
    case "boolean": return "boolean";
    case "datetime": return "timestamp";
    case "json": return "json";
    case "bytes": return "bytes";
    default: return "text";
  }
}

function extractModels(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /model\s+(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0, start = -1, i = re.lastIndex - 1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") { if (depth === 0) start = i + 1; depth++; }
      else if (ch === "}") { depth--; if (depth === 0) { out.push({ name: m[1], body: src.slice(start, i) }); re.lastIndex = i + 1; break; } }
    }
  }
  return out;
}

function parsePrisma(src: string): DiagramSpec | null {
  const clean = src.replace(/\/\/[^\n]*/g, " ");
  const models = extractModels(clean);
  if (models.length === 0) return null;

  // model name → the table name it maps to (@@map wins, else the model name)
  const tableNameOf = new Map<string, string>();
  for (const mdl of models) {
    const map = mdl.body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    tableNameOf.set(mdl.name, map ? map[1] : mdl.name);
  }

  const nodes: NodeSpec[] = [];
  const fks: RawFk[] = [];

  for (const mdl of models) {
    const fields: TableField[] = [];
    const pkCols = new Set<string>();
    const fkCols = new Set<string>();
    const table = tableNameOf.get(mdl.name)!;
    const lines = mdl.body.split("\n").map((l) => l.trim()).filter(Boolean);

    // Pass 1 — scalar columns + primary keys (order-independent from relations).
    for (const line of lines) {
      if (line.startsWith("@@")) {
        const cid = line.match(/@@id\(\s*\[([^\]]+)\]/);
        if (cid) for (const c of cid[1].split(",")) pkCols.add(c.trim());
        continue;
      }
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const [fieldName, typeToken] = parts;
      const attrs = line.slice(line.indexOf(typeToken) + typeToken.length);
      const baseType = typeToken.replace(/[?[\]]/g, "");
      if (!PRISMA_SCALARS.has(baseType.toLowerCase())) continue;
      const field: TableField = { name: fieldName, type: normalizePrismaType(baseType, attrs) };
      if (/@id\b/.test(attrs)) pkCols.add(fieldName);
      fields.push(field);
    }

    // Pass 2 — to-one relation fields name the local scalar FK column(s).
    for (const line of lines) {
      if (line.startsWith("@@")) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const typeToken = parts[1];
      const baseType = typeToken.replace(/[?[\]]/g, "");
      if (PRISMA_SCALARS.has(baseType.toLowerCase()) || /\[\]$/.test(typeToken)) continue; // scalar or back-relation list
      const attrs = line.slice(line.indexOf(typeToken) + typeToken.length);
      const rel = attrs.match(/@relation\([^)]*fields:\s*\[([^\]]+)\]/);
      if (!rel) continue;
      const fkCol = rel[1].split(",")[0].trim();
      fkCols.add(fkCol);
      fks.push({ from: fkCol, toTable: tableNameOf.get(baseType) ?? baseType });
    }

    for (const f of fields) {
      if (fkCols.has(f.name)) f.key = "fk";
      else if (pkCols.has(f.name)) f.key = "pk";
    }
    nodes.push({ id: table, label: table, fields });
  }

  const names = models.map((m) => tableNameOf.get(m.name)!);
  return buildSpec(nodes, names, fks);
}

// ── assembly ─────────────────────────────────────────────────────────────────
function buildSpec(nodes: NodeSpec[], tableNames: string[], fks: RawFk[]): DiagramSpec {
  const known = new Set(tableNames);
  // fk column lives on the node whose fields include it → child table
  const childOf = (col: string): string | null => {
    for (const n of nodes) if ((n.fields ?? []).some((f) => f.name === col && f.key === "fk")) return n.id;
    return null;
  };
  const seen = new Set<string>();
  const edges: EdgeSpec[] = [];
  for (const fk of fks) {
    if (!known.has(fk.toTable)) continue;
    const from = childOf(fk.from);
    if (!from || from === fk.toTable) continue;
    const k = `${from}->${fk.toTable}:${fk.from}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ from, to: fk.toTable, label: "N:1" });
  }
  return { title: "Imported schema", nodes, edges };
}

/** Parse pasted SQL DDL or a Prisma schema into a DiagramSpec. Auto-detects the
 *  format; returns null if nothing table-like is found. */
export function parseSchema(text: string): DiagramSpec | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const looksPrisma = /\bmodel\s+\w+\s*\{/.test(t) && !/\bcreate\s+table\b/i.test(t);
  const spec = looksPrisma ? parsePrisma(t) : parseSqlDdl(t) ?? parsePrisma(t);
  if (!spec || spec.nodes.length === 0) return null;
  return spec;
}
