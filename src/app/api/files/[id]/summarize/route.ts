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
import { readUpload } from "@/lib/local-uploads";
import { presignGetUrl } from "@/lib/s3";
import { fetchPublic, readCapped } from "@/lib/net/public-fetch";

const MAX_INPUT_CHARS = 200_000;
/** The most of a file read for a summary (a PDF of a few hundred pages). */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** A refusal the person can act on; never a network detail. */
class Unreadable extends Error {}

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
    // The type first: an unsupported file is never downloaded.
    if (!summarizable(freshFile.url, freshFile.mimeType)) throw new Unreadable("Only PDF and text files can be summarized for now.");
    const bytes = await fileBytes(freshFile);
    text = await extractText(bytes, freshFile.url, freshFile.mimeType);
  } catch (err) {
    console.error(`summarize: extract failed for ${file.id}`, err);
    // Only this route's own words go back (pen test 2026-11-28, V-09: the
    // fetch error text told a closed port from an open one).
    return jsonError(err instanceof Unreadable ? err.message : "Couldn't read this file.", 415);
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

/**
 * The file's bytes, from where WE stored it, or for a file added by link,
 * from a public address only (pen test 2026-11-28, V-09): a bare fetch of the
 * stored address reached this server's own API, internal services and the
 * cloud metadata address, redirects followed.
 */
async function fileBytes(file: { url: string; s3Key?: string | null; organizationId: string }): Promise<Uint8Array> {
  // Our S3 object: the address is signed HERE from the stored key, and only a
  // key of this file's own workspace. Never the row's stored url: when signing
  // failed, the stored url came back unchanged, and a row could carry any url
  // beside its key (the step 2 review).
  if (file.s3Key) {
    if (!file.s3Key.startsWith(`orgs/${file.organizationId}/`)) throw new Unreadable("Couldn't read this file.");
    let signed: string;
    try {
      signed = await presignGetUrl(file.s3Key, 300);
    } catch {
      throw new Unreadable("Couldn't read this file.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(signed, { redirect: "error", signal: controller.signal });
      if (!res.ok) throw new Unreadable("Couldn't read this file.");
      const { bytes, truncated } = await readCapped(res.body, MAX_FILE_BYTES);
      if (truncated) throw new Unreadable("This file is too large to summarize.");
      return bytes;
    } finally {
      clearTimeout(timer);
      controller.abort(); // whatever is left of the answer is dropped, never left open
    }
  }
  // Our local disk: read it there, never over HTTP to ourselves.
  const local = /^\/(?:api\/)?uploads\/([^/?#]+)(?:[?#].*)?$/.exec(file.url);
  if (local) {
    const buf = await readUpload(decodeURIComponent(local[1]));
    if (!buf) throw new Unreadable("Couldn't read this file.");
    if (buf.length > MAX_FILE_BYTES) throw new Unreadable("This file is too large to summarize.");
    return new Uint8Array(buf);
  }
  // A file added by link: a public address, or nothing.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetchPublic(file.url, { signal: controller.signal, maxRedirects: 3 });
    if (!res.ok || res.status < 200 || res.status >= 300) throw new Unreadable("Couldn't read this file from its link.");
    const { bytes, truncated } = await readCapped(res.body, MAX_FILE_BYTES);
    if (truncated) throw new Unreadable("This file is too large to summarize.");
    return bytes;
  } finally {
    clearTimeout(timer);
    // Every way out (an error answer, a cap, a throw) drops the connection:
    // an answer left unread kept its socket open (the step 2 review).
    controller.abort();
  }
}

const isPdf = (url: string, mimeType: string) => mimeType === "application/pdf" || url.toLowerCase().split("?")[0].endsWith(".pdf");
const isText = (mimeType: string) =>
  mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml" || mimeType === "application/x-yaml";
function summarizable(url: string, mimeType: string): boolean {
  return isPdf(url, mimeType) || isText(mimeType);
}

async function extractText(bytes: Uint8Array, url: string, mimeType: string): Promise<string> {
  if (isPdf(url, mimeType)) {
    const { extractText: pdfExtract } = await import("unpdf");
    const { text } = await pdfExtract(bytes, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }

  if (isText(mimeType)) return new TextDecoder().decode(bytes);

  throw new Unreadable(`Only PDF and text files can be summarized for now.`);
}
