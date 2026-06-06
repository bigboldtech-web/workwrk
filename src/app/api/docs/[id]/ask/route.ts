// POST /api/docs/[id]/ask
//
// Chat-with-the-doc: takes a free-form question + optional conversation
// history and answers it grounded in the doc's content. Used by the
// "Ask this note" slide-over on /docs/[id].

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { docAccessible } from "@/lib/doc-access";

const MAX_DOC_CHARS = 200_000;

const schema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000),
  })).max(20).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = (session as { user: { id: string; accessLevel: string } }).user.id;
  const accessLevel = (session as { user: { id: string; accessLevel: string } }).user.accessLevel;
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, content: true, entityType: true, entityId: true },
  });
  if (!doc) return jsonError("not found", 404);
  if (!(await docAccessible(doc, userId, accessLevel))) {
    return jsonError("not found", 404);
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("invalid body", 400);
  const { question, history = [] } = parsed.data;

  const text = extractDocText(doc.content);
  const trimmed = text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) : text;

  const resolved = await getAnthropicForOrg(orgId);
  const model = modelFor(resolved, "claude-haiku-4-5");

  try {
    const msg = await resolved.client.messages.create({
      model,
      max_tokens: 1000,
      system:
        "You are an AI assistant inside WorkwrK's notes app. Answer the user's question " +
        "strictly using the note's content. If the note doesn't contain the answer, say so " +
        "in one sentence and offer the closest related point instead. Be terse: 1–4 short " +
        "paragraphs. No headings, no markdown unless the user asks for a list.\n\n" +
        `Note title: ${doc.title}\n\nNote content:\n\n${trimmed}`,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: question },
      ],
    });
    const answer = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim();
    return jsonSuccess({ answer, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return jsonError(`AI request failed: ${message}`, 502);
  }
}

// Reused from /summarize — keep behaviour consistent across AI features.
function extractDocText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (Array.isArray(c.blocks)) {
    return c.blocks
      .map((b) => {
        if (!b || typeof b !== "object") return "";
        const bl = b as Record<string, unknown>;
        const kind = String(bl.kind ?? "");
        if (kind === "h1" || kind === "h2" || kind === "h3") return `\n# ${String(bl.text ?? "")}`;
        if (kind === "paragraph" || kind === "callout" || kind === "quote") return String(bl.text ?? "");
        if (kind === "bullet") return `- ${String(bl.text ?? "")}`;
        if (kind === "numbered") return `1. ${String(bl.text ?? "")}`;
        if (kind === "todo") return `[${bl.done ? "x" : " "}] ${String(bl.text ?? "")}`;
        if (kind === "toggle") {
          const t = String(bl.text ?? "");
          const body = String(bl.body ?? "");
          return body ? `${t}\n  ${body}` : t;
        }
        if (kind === "code") return `\`\`\`${bl.lang ?? ""}\n${String(bl.text ?? "")}\n\`\`\``;
        if (kind === "embed") return `[link: ${String(bl.url ?? "")}]`;
        if (kind === "file") return `[file: ${String(bl.name ?? "")}]`;
        if (kind === "image") return `[image: ${String(bl.alt ?? bl.url ?? "")}]`;
        if (kind === "entity_link") return `@${String(bl.label ?? "")}`;
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
