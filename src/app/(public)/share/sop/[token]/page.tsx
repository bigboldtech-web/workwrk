/* /share/sop/[token] (spec-process section 2): read a published SOP from a
 * link without signing in.
 *
 * Server-gated: the SOP resolves by its unique `shareToken`, and renders only
 * when it is PUBLISHED and the org's Public links toggle (access toggle 10,
 * `settings.access.publicLinks`) is "view". Anything else is notFound(): a
 * public link never surfaces a draft, a revoked share, or an org that turned
 * public links off. Existing links were carried over the toggle by
 * scripts/migrate-public-sop-links.ts, so no live link died with this fold.
 *
 * Zero writes except the sampled `access.public_link.used` audit row
 * (invariant 19; one in twenty hits). Never exposes org members, emails,
 * assignments, compliance or settings: only the SOP's presentation payload,
 * rendered by the same SopReadView the app page uses.
 */

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { presignBlocksImagesAndFiles } from "@/lib/doc-block-enrich";
import { enrichScribeScreenshots } from "@/lib/scribe-enrich";
import { parseAccessSettings } from "@/lib/access/settings";
import { publicLinkRole } from "@/lib/access/guards";
import { auditPublicLinkUse } from "@/lib/public-link-audit";
import { getSopKind, SOP_KIND_LABEL } from "@/lib/sop-kind";
import { formatDate } from "@/lib/format/date";
import { PublicPageFrame } from "@/components/process/public-page-frame";
import { SopReadView, type SopReadContent } from "@/components/sops/sop-read-view";

export const dynamic = "force-dynamic";

export default async function PublicSopPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  const sop = await prisma.sOP.findUnique({
    where: { shareToken: token },
    select: {
      id: true, title: true, description: true, sopType: true, version: true, status: true, content: true, updatedAt: true, organizationId: true,
      organization: { select: { name: true, logo: true, settings: true } },
    },
  });
  if (!sop || sop.status !== "PUBLISHED") notFound();

  // Toggle 10: the link answers only while public links are "View only".
  const access = parseAccessSettings((sop.organization.settings as { access?: unknown } | null)?.access);
  if (!publicLinkRole(access)) notFound();

  // A sampled audit row (one in twenty) so the org can see its links are used
  // without a write per hit.
  await auditPublicLinkUse({ organizationId: sop.organizationId, targetType: "sop", targetId: sop.id, title: sop.title });

  // Re-sign S3-backed image/file blocks and recorded screenshots so they
  // render for an anonymous viewer, exactly like the authed page.
  let content: unknown = sop.content;
  try {
    const enriched = await enrichScribeScreenshots({ content } as Parameters<typeof enrichScribeScreenshots>[0]);
    content = enriched.content ?? content;
  } catch { /* fall back to raw content */ }
  try { content = await presignBlocksImagesAndFiles(content); } catch { /* fall back to prior content */ }

  const kind = getSopKind(sop.sopType, content);
  const org = { name: sop.organization.name, logo: sop.organization.logo };

  return (
    <PublicPageFrame org={org} label="Shared SOP">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-ink">{sop.title || "Untitled SOP"}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <span className="inline-flex h-6 items-center rounded-md bg-active px-2 text-xs font-medium text-ink">{SOP_KIND_LABEL[kind]}</span>
          <span className="tabular-nums">v{sop.version}</span>
          <span>Updated {formatDate(sop.updatedAt, null, "date")}</span>
        </p>
        {sop.description ? <p className="text-prose text-ink-2">{sop.description}</p> : null}
      </div>
      <div className="mt-6">
        <SopReadView sop={{ id: sop.id, sopType: sop.sopType, content: (content ?? null) as SopReadContent }} mode="public" />
      </div>
    </PublicPageFrame>
  );
}
