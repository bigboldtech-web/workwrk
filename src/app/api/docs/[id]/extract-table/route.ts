// POST /api/docs/[id]/extract-table
//
// Ask Claude to look at a doc and propose a DataTable structure +
// initial rows extracted from its content. Then create the table in
// the org. Returns { tableId, name, columnsAdded, rowsCreated }.
//
// Designed for docs that are basically a list of things (e.g. a doc
// containing meeting notes that mention 5 vendors, or a planning doc
// with a list of features and owners). Best results when the doc has
// structured content; bails with 422 if extraction yields nothing.

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { logActivity } from "@/lib/activity";

const COL_TYPES = ["short_text", "long_text", "number", "select", "date", "checkbox", "url", "email"] as const;
const MAX_INPUT_CHARS = 100_000;

interface ProposedCol { type: typeof COL_TYPES[number]; label: string; options?: string[] }
interface Proposed { name: string; columns: ProposedCol[]; rows: Record<string, string | number | boolean>[] }

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, content: true },
  });
  if (!doc) return jsonError("not found", 404);

  const text = extractDocText(doc.content);
  if (!text.trim()) return jsonError("doc is empty", 422);
  const trimmed = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

  const { client, preferredModel } = await getAnthropicForOrg(orgId);
  const model = modelFor({ client, source: "shared", preferredModel }, "claude-haiku-4-5");

  const system = `Look at a doc and decide whether its content can be represented as a table (a list of items with shared attributes). If yes, output ONLY a JSON object — no prose, no markdown fences — matching:

{
  "name": "string (≤80 chars, e.g. 'Vendors mentioned')",
  "columns": [
    { "type": "short_text" | "long_text" | "number" | "select" | "date" | "checkbox" | "url" | "email",
      "label": "string (≤40 chars)",
      "options": ["string"] }
  ],
  "rows": [
    { "<label1>": "value", "<label2>": "value", ... }
  ]
}

Rules:
- 2-6 columns. First column should be a "short_text" name/title for each row.
- "options" only for type "select" (3-6 realistic values).
- 1-50 rows. Use values that actually appear in the doc — don't invent.
- Row keys MUST match column labels exactly.
- If the doc isn't list-like, output: {"name":"","columns":[],"rows":[]}`;

  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: `Doc title: ${doc.title}\n\nContent:\n\n${trimmed}` }],
  });

  const raw = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  let parsed: Proposed;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return jsonError("AI returned malformed JSON", 502);
  }

  if (!parsed.name || !Array.isArray(parsed.columns) || parsed.columns.length === 0) {
    return jsonError("nothing table-like in this doc", 422);
  }

  // Sanitise columns + create stable IDs.
  type Col = { id: string; type: typeof COL_TYPES[number]; label: string; options?: string[] };
  const columns: Col[] = parsed.columns
    .filter((c): c is ProposedCol => c && typeof c === "object" && COL_TYPES.includes(c.type))
    .slice(0, 10)
    .map((c) => ({
      id: Math.random().toString(36).slice(2, 10),
      type: c.type,
      label: String(c.label ?? "Untitled").slice(0, 60),
      ...(c.type === "select" ? { options: Array.isArray(c.options) ? c.options.map(String).slice(0, 12) : ["Option 1"] } : {}),
    }));

  if (columns.length === 0) return jsonError("AI proposed no valid columns", 502);

  // Map row data — match keys by case-insensitive label.
  const labelToId = new Map<string, string>();
  for (const c of columns) labelToId.set(c.label.trim().toLowerCase(), c.id);

  const rowData = (Array.isArray(parsed.rows) ? parsed.rows : [])
    .slice(0, 100)
    .map((row): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        const colId = labelToId.get(k.trim().toLowerCase());
        if (colId && v !== undefined && v !== null && v !== "") out[colId] = v;
      }
      return out;
    })
    .filter((r) => Object.keys(r).length > 0);

  const table = await prisma.dataTable.create({
    data: {
      organizationId: orgId,
      name: String(parsed.name).slice(0, 80),
      description: `Extracted from doc: ${doc.title}`,
      columns: columns as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
    select: { id: true, name: true },
  });

  if (rowData.length > 0) {
    await prisma.dataTableRow.createMany({
      data: rowData.map((values, i) => ({
        organizationId: orgId,
        tableId: table.id,
        values: values as Prisma.InputJsonValue,
        position: i + 1,
        createdById: userId,
      })),
    });
  }

  void logActivity({
    type: "table.extracted",
    actorId: userId,
    organizationId: orgId,
    description: `Extracted "${table.name}" table from doc "${doc.title}"`,
    targetId: table.id,
    targetType: "DataTable",
    metadata: { sourceDocId: doc.id, columnsAdded: columns.length, rowsCreated: rowData.length },
  });

  return jsonSuccess({ tableId: table.id, name: table.name, columnsAdded: columns.length, rowsCreated: rowData.length });
}

function extractDocText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (Array.isArray(c.blocks)) {
    return c.blocks
      .map((b) => {
        if (!b || typeof b !== "object") return "";
        const bl = b as Record<string, unknown>;
        const kind = String(bl.kind ?? "");
        if (kind === "h1" || kind === "h2" || kind === "h3" || kind === "paragraph" || kind === "callout") return String(bl.text ?? "");
        if (kind === "todo") return `[ ] ${String(bl.text ?? "")}`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (c.type === "doc" && Array.isArray(c.content)) {
    return walkTipTap(c.content as unknown[]).join("\n");
  }
  return "";
}

function walkTipTap(nodes: unknown[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    else if (Array.isArray(n.content)) out.push(...walkTipTap(n.content as unknown[]));
  }
  return out;
}
