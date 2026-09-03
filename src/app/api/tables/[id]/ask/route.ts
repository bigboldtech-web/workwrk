// POST /api/tables/[id]/ask — ask a natural-language question about the sheet.
//
// The formula engine is client-side, so the CLIENT resolves the visible rows
// into plain records and sends them with the question; this route builds a
// compact markdown table and asks the org's model for a concise answer. Same
// gate + BYOK model resolution as the other AI features. The data never leaves
// the org's configured AI — the user is querying their own table.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";

const MAX_ROWS = 300;
const MAX_COLS = 40;
const MAX_CELL = 200;

async function resolveTable(id: string, orgId: string, userId: string, accessLevel: string | null | undefined) {
  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true, organizationId: true, spaceId: true },
  });
  if (!table) return null;
  if (table.spaceId) {
    const space = await getSpaceForReader(table.spaceId, userId, accessLevel ?? "EMPLOYEE");
    if (!space) return null;
  }
  return table;
}

/** One cell as a table string: trims, collapses newlines, caps length. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.replace(/\s*\n\s*/g, " ").slice(0, MAX_CELL).replace(/\|/g, "\\|");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
  const headers: string[] = Array.isArray(body?.columns)
    ? (body.columns as unknown[]).filter((x): x is string => typeof x === "string").slice(0, MAX_COLS)
    : [];
  const rawRows: unknown[][] = Array.isArray(body?.rows) ? (body.rows as unknown[][]) : [];
  if (!question) return jsonError("A question is required", 400);
  if (headers.length === 0 || rawRows.length === 0) {
    return jsonSuccess({ answer: "This sheet has no data to analyse yet." });
  }

  const truncated = rawRows.length > MAX_ROWS;
  const rows = rawRows.slice(0, MAX_ROWS);

  // Build a markdown table: header, separator, then rows (cells aligned to
  // headers; a short row pads, a long one is clipped).
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const lines = rows.map((r) => `| ${headers.map((_, i) => cell(r[i])).join(" | ")} |`);
  const tableMd = [head, sep, ...lines].join("\n");

  const ai = await getAnthropicForOrg(orgId);
  try {
    const message = await ai.client.messages.create({
      model: modelFor(ai, "claude-haiku-4-5-20251001"),
      max_tokens: 900,
      system:
        "You are a precise data analyst answering questions about a single spreadsheet. " +
        "Answer ONLY from the data provided. Be concise and direct: lead with the answer " +
        "(a number, a short list, or one or two sentences). Do calculations exactly. If the " +
        "data can't answer the question, say so plainly rather than guessing. Never invent rows " +
        "or values. Format any table you return as GitHub-flavoured markdown.",
      messages: [
        {
          role: "user",
          content:
            `Sheet: "${table.name}"` +
            (truncated ? ` (showing the first ${MAX_ROWS} of ${rawRows.length} rows)` : "") +
            `\n\n${tableMd}\n\nQuestion: ${question}`,
        },
      ],
    });
    const answer = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
    return jsonSuccess({ answer: answer || "I couldn't produce an answer for that.", truncated });
  } catch (err) {
    console.error("[tables/ask] AI call failed:", err);
    return jsonError("The AI request failed. Check the workspace AI settings and try again.", 502);
  }
}
