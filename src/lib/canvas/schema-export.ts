// schema-export — turn the ER tables on a canvas into real, runnable schema.
//
// Reads TableElements + the relationships between them (foreign-key fields,
// disambiguated by the connectors drawn between tables) and emits Postgres
// DDL and a Prisma schema. Pure + dependency-free so it's unit-tested and
// safe to run on the client.

import type { CanvasScene, CanvasElement, TableElement, TableField } from "./scene";

export interface SchemaExport {
  sql: string;
  prisma: string;
  tableCount: number;
}

const SQL_TYPE: Record<string, string> = {
  uuid: "uuid", text: "text", string: "text", varchar: "varchar",
  int: "integer", integer: "integer", bigint: "bigint", serial: "serial",
  numeric: "numeric", decimal: "numeric", money: "numeric", float: "double precision",
  bool: "boolean", boolean: "boolean",
  timestamp: "timestamptz", timestamptz: "timestamptz", datetime: "timestamptz",
  date: "date", time: "time", json: "jsonb", jsonb: "jsonb",
};
function sqlType(t?: string): string {
  return SQL_TYPE[(t || "").trim().toLowerCase()] ?? "text";
}

const PRISMA_TYPE: Record<string, { t: string; attr?: string }> = {
  uuid: { t: "String", attr: "@db.Uuid" }, text: { t: "String" }, string: { t: "String" }, varchar: { t: "String" },
  int: { t: "Int" }, integer: { t: "Int" }, bigint: { t: "BigInt" }, serial: { t: "Int" },
  numeric: { t: "Decimal" }, decimal: { t: "Decimal" }, money: { t: "Decimal" }, float: { t: "Float" },
  bool: { t: "Boolean" }, boolean: { t: "Boolean" },
  timestamp: { t: "DateTime", attr: "@db.Timestamptz" }, timestamptz: { t: "DateTime", attr: "@db.Timestamptz" }, datetime: { t: "DateTime" },
  date: { t: "DateTime", attr: "@db.Date" }, time: { t: "DateTime", attr: "@db.Time" },
  json: { t: "Json" }, jsonb: { t: "Json" },
};
function prismaType(t?: string): { t: string; attr?: string } {
  return PRISMA_TYPE[(t || "").trim().toLowerCase()] ?? { t: "String" };
}

// ── naming ────────────────────────────────────────────────────────────────
function singular(name: string): string {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, "y");
  if (/ses$/i.test(name)) return name.replace(/es$/i, "");
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.replace(/s$/i, "");
  return name;
}
function words(name: string): string[] {
  return name.trim().replace(/[^A-Za-z0-9]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
}
function pascal(name: string): string {
  return words(name).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("") || "Model";
}
function camel(name: string): string {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}
function modelName(tableName: string): string {
  return pascal(singular(tableName));
}
function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, "")}"`;
}

interface Resolved { targetTable: string; targetPk: string }

/** Resolve which table+column a foreign-key field points at. Prefers a table
 *  the field is actually connected to on the board; falls back to matching the
 *  field-name stem ("order_id" → table "orders"/"order"). */
function resolveFk(field: TableField, table: TableElement, tables: TableElement[], neighborNames: Set<string>): Resolved | null {
  const pkOf = (t: TableElement) => (t.fields.find((f) => f.key === "pk")?.name ?? "id");
  const stem = field.name.replace(/[_-]?id$/i, "");
  const matchesStem = (t: TableElement) => {
    if (t.name === table.name) return false;
    const a = singular(t.name).toLowerCase(), b = singular(stem).toLowerCase();
    return a === b || t.name.toLowerCase() === stem.toLowerCase();
  };
  // 1) a connected table whose name matches the stem
  const connectedMatch = tables.find((t) => neighborNames.has(t.name) && matchesStem(t));
  if (connectedMatch) return { targetTable: connectedMatch.name, targetPk: pkOf(connectedMatch) };
  // 2) any table whose name matches the stem
  const nameMatch = tables.find(matchesStem);
  if (nameMatch) return { targetTable: nameMatch.name, targetPk: pkOf(nameMatch) };
  // 3) exactly one connected OTHER table
  const neighbors = tables.filter((t) => t.name !== table.name && neighborNames.has(t.name));
  if (neighbors.length === 1) return { targetTable: neighbors[0].name, targetPk: pkOf(neighbors[0]) };
  return null;
}

/** Which other tables each table is connected to via a connector on the board. */
function neighborMap(scene: CanvasScene, tables: TableElement[]): Map<string, Set<string>> {
  const byId = new Map<string, CanvasElement>(scene.elements.map((e) => [e.id, e]));
  const nameOf = (el: CanvasElement | undefined) => (el && el.type === "table" ? el.name : undefined);
  const map = new Map<string, Set<string>>(tables.map((t) => [t.name, new Set<string>()]));
  for (const el of scene.elements) {
    if (el.type !== "arrow") continue;
    const a = nameOf(el.fromId ? byId.get(el.fromId) : undefined);
    const b = nameOf(el.toId ? byId.get(el.toId) : undefined);
    if (a && b && a !== b) { map.get(a)?.add(b); map.get(b)?.add(a); }
  }
  return map;
}

export function schemaFromScene(scene: CanvasScene): SchemaExport {
  const tables = scene.elements.filter((e): e is TableElement => e.type === "table");
  if (tables.length === 0) {
    return { sql: "-- Add ER tables to the canvas to export a schema.", prisma: "// Add ER tables to the canvas to export a schema.", tableCount: 0 };
  }
  const neighbors = neighborMap(scene, tables);

  // Resolve every FK once, up front (used by both emitters + back-relations).
  const fkResolved = new Map<string, Map<string, Resolved>>(); // table.name → field.name → target
  for (const t of tables) {
    const m = new Map<string, Resolved>();
    for (const f of t.fields) {
      if (f.key !== "fk") continue;
      const r = resolveFk(f, t, tables, neighbors.get(t.name) ?? new Set());
      if (r) m.set(f.name, r);
    }
    fkResolved.set(t.name, m);
  }

  // ── SQL DDL ──────────────────────────────────────────────────────────────
  const sqlBlocks: string[] = [];
  for (const t of tables) {
    const lines: string[] = [];
    const pk = t.fields.find((f) => f.key === "pk");
    for (const f of t.fields) {
      const col = `  ${quoteIdent(f.name)} ${sqlType(f.type)}`;
      lines.push(f.key === "pk" ? `${col} PRIMARY KEY` : col);
    }
    const fks = fkResolved.get(t.name)!;
    for (const [fkCol, r] of fks) {
      lines.push(`  FOREIGN KEY (${quoteIdent(fkCol)}) REFERENCES ${quoteIdent(r.targetTable)} (${quoteIdent(r.targetPk)})`);
    }
    void pk;
    sqlBlocks.push(`CREATE TABLE ${quoteIdent(t.name)} (\n${lines.join(",\n")}\n);`);
  }
  const sql = sqlBlocks.join("\n\n");

  // ── Prisma schema ────────────────────────────────────────────────────────
  // Pre-compute back-relations: for each parent table, the children pointing at it.
  const backRel = new Map<string, { childModel: string; childField: string }[]>();
  for (const t of tables) {
    for (const [, r] of fkResolved.get(t.name)!) {
      const arr = backRel.get(r.targetTable) ?? [];
      arr.push({ childModel: modelName(t.name), childField: camel(t.name) + "s" });
      backRel.set(r.targetTable, arr);
    }
  }
  const prismaBlocks: string[] = [];
  for (const t of tables) {
    const fks = fkResolved.get(t.name)!;
    const rows: string[] = [];
    for (const f of t.fields) {
      const pt = prismaType(f.type);
      const attrs: string[] = [];
      if (f.key === "pk") attrs.push("@id");
      if (pt.attr) attrs.push(pt.attr);
      rows.push(`  ${f.name} ${pt.t}${attrs.length ? " " + attrs.join(" ") : ""}`);
      // a relation field beside the scalar FK column
      const r = fks.get(f.name);
      if (r) {
        const relField = camel(singular(r.targetTable));
        rows.push(`  ${relField} ${modelName(r.targetTable)} @relation(fields: [${f.name}], references: [${r.targetPk}])`);
      }
    }
    for (const b of backRel.get(t.name) ?? []) {
      rows.push(`  ${b.childField} ${b.childModel}[]`);
    }
    prismaBlocks.push(`model ${modelName(t.name)} {\n${rows.join("\n")}\n}`);
  }
  const prisma = prismaBlocks.join("\n\n");

  return { sql, prisma, tableCount: tables.length };
}
