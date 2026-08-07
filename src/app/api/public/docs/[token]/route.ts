// GET /api/public/docs/[token] — public read-only doc payload, no auth.
//
// Modeled on /api/public/sign/[token]. Token format is `${docId}.${secret}`:
// docId is a cuid (never contains a dot) so we split on the FIRST dot and
// resolve the doc with one findUnique — no settings scan. The secret half
// is compared timing-safe against settings.docSharing[docId].publicSecret;
// deleting that key (toggle off in the share modal) is revocation → 404.
//
// GET only — no other method exports, so writes 405. The payload NEVER
// includes members, emails, org settings, or the sharing entry.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDocSharingMap, publicSecretMatches } from "@/lib/doc-sharing";
import { presignBlocksImagesAndFiles } from "@/lib/doc-block-enrich";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const i = token.indexOf(".");
  if (i <= 0 || i >= token.length - 1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const docId = token.slice(0, i);
  const secret = token.slice(i + 1);

  const doc = await prisma.doc.findUnique({
    where: { id: docId },
    select: {
      id: true,
      title: true,
      content: true,
      archivedAt: true,
      updatedAt: true,
      organizationId: true,
      organization: { select: { settings: true } },
    },
  });
  if (!doc || doc.archivedAt) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const entry = getDocSharingMap(doc.organization?.settings)[docId];
  if (!entry?.publicSecret || !publicSecretMatches(entry.publicSecret, secret)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Re-sign S3-backed image/file blocks so they render publicly, exactly
  // like the authed GET /api/docs/[id] does.
  const content = await presignBlocksImagesAndFiles(doc.content);

  return NextResponse.json(
    { title: doc.title, content, updatedAt: doc.updatedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
