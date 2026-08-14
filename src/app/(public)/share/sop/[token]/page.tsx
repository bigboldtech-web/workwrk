/* Public read-only SOP viewer (no auth).
 *
 * Server-gated: resolves the SOP by its unique `shareToken` and only
 * renders when a token matches AND the SOP is PUBLISHED. Any miss —
 * unknown token, unpublished/archived SOP — falls through to notFound()
 * (404). A public link must never surface a draft or a revoked share.
 *
 * This route issues zero writes and never exposes org members, emails,
 * assignments, compliance, or settings — only the SOP's presentation
 * payload. Modeled on the /(public)/share/doc pattern.
 */

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { presignBlocksImagesAndFiles } from "@/lib/doc-block-enrich";
import { enrichScribeScreenshots } from "@/lib/scribe-enrich";
import { PublicSopView, type PublicSop } from "./public-sop-view";

export const dynamic = "force-dynamic";

export default async function PublicSopPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  const sop = await prisma.sOP.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      title: true,
      description: true,
      sopType: true,
      version: true,
      status: true,
      content: true,
      updatedAt: true,
    },
  });

  // Only a matched, still-published SOP renders. Everything else 404s.
  if (!sop || sop.status !== "PUBLISHED") notFound();

  // Re-sign S3-backed image/file blocks + recorded screenshots so they
  // render for an anonymous viewer, exactly like the authed detail page.
  let content: unknown = sop.content;
  try {
    const enriched = await enrichScribeScreenshots(
      { content } as Parameters<typeof enrichScribeScreenshots>[0],
    );
    content = enriched.content ?? content;
  } catch {
    /* fall back to raw content */
  }
  try {
    content = await presignBlocksImagesAndFiles(content);
  } catch {
    /* fall back to prior content */
  }

  const payload: PublicSop = {
    title: sop.title,
    description: sop.description,
    sopType: sop.sopType as PublicSop["sopType"],
    version: sop.version,
    updatedAt: sop.updatedAt.toISOString(),
    content: (content ?? null) as PublicSop["content"],
  };

  return <PublicSopView sop={payload} />;
}
