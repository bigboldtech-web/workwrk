// POST /api/files/[id]/summarize
//
// Extract text from the file and ask Claude for a short summary.
// Stores result on FileEntry.summary + .summarizedAt. PDFs use unpdf
// (pure JS, edge-compatible) for extraction; plain text/markdown/html
// are read directly. Other binary types return 415.
//
// Run synchronously — for typical SaaS docs (<50 pages) Claude haiku
// returns in 2-5s. If we ever need long-doc support, queue it via the
// existing job system.

import { NextRequest } from "next/server";
import { withFreshFileUrl } from "@/lib/file-urls";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { callOrGiveBack, claimAiAction } from "@/lib/ai-allowance";
import { canReadFile } from "@/lib/file-access";
import { aiOffResponse } from "@/lib/ai/ai-off-gate";

const MAX_INPUT_CHARS = 200_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const file = await prisma.fileEntry.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true, mimeType: true, url: true, s3Key: true, spaceId: true, spaceFolderId: true, organizationId: true },
  });
  if (!file) return jsonError("not found", 404);
  // The one read gate (src/lib/file-access.ts), as GET /api/files/[id]: a
  // summary is the file's content, so only someone who can open the file
  // gets one.
  const userId = getUserId(session);
  if (!(await canReadFile(file, userId, (session.user as { accessLevel?: string }).accessLevel))) return jsonError("not found", 404);

  let text: string;
  try {
    const freshFile = await withFreshFileUrl(file);
    text = await extractText(freshFile.url, freshFile.mimeType);
  } catch (err) {
    console.error(`summarize: extract failed for ${file.id}`, err);
    return jsonError(err instanceof Error ? err.message : "extraction failed", 415);
  }

  const trimmed = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  if (!trimmed.trim()) return jsonError("no extractable text in this file", 422);

  // AI features turned off for the workspace (settings.data.aiEnabled):
  // no model call, as the switch's helper says ("Off hides every AI entry point").
  const aiOff = await aiOffResponse(orgId);
  if (aiOff) return aiOff;

  const { client, preferredModel } = await getAnthropicForOrg(orgId);
  const model = modelFor({ client, source: "shared", preferredModel }, "claude-haiku-4-5");

  // One of the plan's AI questions (src/lib/ai-allowance.ts), handed back if
  // the model fails.
  const claim = await claimAiAction(orgId, userId, "Summarize a file");
  if (!claim.ok) return claim.response;
  const msg = await callOrGiveBack(claim.id, () => client.messages.create({
    model,
    max_tokens: 600,
    system: "You summarize uploaded documents for a workspace tool. Output a tight 3-6 sentence summary capturing: what the document is, who it's for, the most important takeaways. Plain prose, no headings, no bullet points. If the text looks like raw OCR, do your best with what's there.",
    messages: [{ role: "user", content: `File name: ${file.name}\n\nContent:\n\n${trimmed}` }],
  })).catch(() => null);
  if (!msg) return jsonError("Couldn't reach the AI. Try again in a moment.", 502);

  const summary = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  await prisma.fileEntry.update({
    where: { id: file.id },
    data: { summary, summarizedAt: new Date() },
  });

  return jsonSuccess({ summary });
}

async function extractText(url: string, mimeType: string): Promise<string> {
  const fetchUrl = url.startsWith("http") ? url : new URL(url, getOrigin()).toString();
  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`couldn't fetch file (${res.status})`);

  if (mimeType === "application/pdf" || url.toLowerCase().endsWith(".pdf")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const { extractText: pdfExtract } = await import("unpdf");
    const { text } = await pdfExtract(buf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }

  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/x-yaml"
  ) {
    return res.text();
  }

  throw new Error(`unsupported mime type: ${mimeType} (PDF and text only for now)`);
}

function getOrigin(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}
