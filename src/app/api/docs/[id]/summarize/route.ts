// POST /api/docs/[id]/summarize
//
// Extract text from the doc's blocks/TipTap content and ask Claude
// for a short summary. Stores result on Doc.summary + summarizedAt.
// Mirrors /api/files/[id]/summarize.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";

const MAX_INPUT_CHARS = 200_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, content: true },
  });
  if (!doc) return jsonError("not found", 404);

  const text = extractDocText(doc.content);
  const trimmed = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  if (!trimmed.trim()) return jsonError("doc has no text content yet", 422);

  const { client, preferredModel } = await getAnthropicForOrg(orgId);
  const model = modelFor({ client, source: "shared", preferredModel }, "claude-haiku-4-5");

  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    system: "You summarize internal company docs for a workspace tool. Output a tight 3-6 sentence summary capturing: what the doc is about, the most important points, any action items. Plain prose, no headings, no bullet points.",
    messages: [{ role: "user", content: `Doc title: ${doc.title}\n\nContent:\n\n${trimmed}` }],
  });

  const summary = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  await prisma.doc.update({
    where: { id: doc.id },
    data: { summary, summarizedAt: new Date() },
  });

  return jsonSuccess({ summary });
}

// Best-effort text extraction. Handles both shapes used in this repo:
//   1. { blocks: Block[] }  — the custom block editor (preferred new shape)
//   2. TipTap JSON          — legacy { type: "doc", content: [...] }
function extractDocText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;

  if (Array.isArray(c.blocks)) {
    return c.blocks
      .map((b) => {
        if (!b || typeof b !== "object") return "";
        const bl = b as Record<string, unknown>;
        const kind = String(bl.kind ?? "");
        if (kind === "h1" || kind === "h2" || kind === "h3" || kind === "paragraph" || kind === "callout") {
          return String(bl.text ?? "");
        }
        if (kind === "todo") return `[ ] ${String(bl.text ?? "")}`;
        if (kind === "embed") return `[link: ${String(bl.url ?? "")}]`;
        if (kind === "file") return `[file: ${String(bl.name ?? "")}]`;
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
    if (n.type === "text" && typeof n.text === "string") {
      out.push(n.text);
    } else if (Array.isArray(n.content)) {
      out.push(...walkTipTap(n.content as unknown[]));
    }
  }
  return out;
}
