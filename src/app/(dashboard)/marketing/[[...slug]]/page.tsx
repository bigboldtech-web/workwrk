/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb -- this route never paints: it redirects or 404s before any page code renders */
// /marketing and every path under it: one resolver, no page of its own
// (spec-tools-misc section 2.7 to 2.11). The Marketing module left the
// product scope on 2026-06-03; its campaigns, content and events become
// tasks on the three Lists of a Marketing Space once an Owner or Admin runs
// the import (Settings > Data > Import, "Marketing (legacy)").
//
//   migrated                   308 to the Space, the List or the task (a
//                              Space in Trash still resolves: it is the
//                              Space, and it says so when it opens)
//   not migrated, Owner/Admin  307 to the import row (which, for a workspace
//                              that never held a row, explains that and
//                              points at the Marketing Space template)
//   not migrated, anyone else  the in-shell 404
//   a Guest                    the in-shell 404, always
//
// ON A HARD LOAD THE 308 AND 307 ARE NOT HTTP STATUSES. The page sits under
// the dashboard's streaming boundary, so the redirect ships inside a 200
// body as the RSC redirect (curl sees 200 with no Location header; a browser
// lands on the target, which the harness proves by finalUrl). Anything that
// is not a browser (a link unfurler, an uptime check) reads 200. That is the
// price of the in-shell 404 below, which needs the shell; do not read a curl
// 200 on /marketing as a broken redirect.
//
// A page and not a route handler, although the handler would answer with a
// Location header before anything paints: `notFound()` inside a route
// handler is an empty 404 with no shell, and the "anyone else" branch has to
// be the same in-shell 404 as a misspelled URL (spec-shell 2.4). Inside the
// dashboard's streaming boundary a redirect thrown here reaches the browser
// as the RSC redirect (a client navigation) or the meta refresh on a hard
// load, and the person lands where the header would have sent them.

import { notFound, permanentRedirect, redirect } from "next/navigation";
import { viewerFromSession } from "@/lib/access/viewer";
import { findMigratedMarketing, migratedCampaignItem } from "@/lib/marketing/legacy-import";
import { LEGACY_IMPORT_HREF, legacyMarketingTarget } from "@/lib/marketing/legacy-map";

export const dynamic = "force-dynamic";

const KNOWN = new Set(["campaigns", "content", "events"]);

export default async function LegacyMarketingResolver({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const segments = (slug ?? []).filter(Boolean);

  const viewer = await viewerFromSession();
  if (!viewer) {
    const path = `/marketing${segments.length ? `/${segments.map(encodeURIComponent).join("/")}` : ""}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  }
  if (viewer.orgRole === "GUEST") notFound();
  // Only the five paths the module ever had resolve: a deeper or unknown path
  // is a misspelled URL like any other.
  if (segments.length > 1) notFound();

  const migrated = await findMigratedMarketing(viewer.organizationId);
  if (migrated) {
    const head = segments[0];
    let campaignItemId: string | null = null;
    let campaignTrashed = false;
    if (head && !KNOWN.has(head)) {
      // /marketing/{id}: a campaign that exists lands on its task, or on the
      // Campaigns List with a notice when it was never moved or its task is
      // in Trash; an id no campaign ever had is a misspelled URL.
      const campaign = await migratedCampaignItem(viewer.organizationId, head);
      if (!campaign.exists) notFound();
      campaignItemId = campaign.itemId;
      campaignTrashed = campaign.trashed;
    }
    permanentRedirect(legacyMarketingTarget(segments, migrated, campaignItemId, campaignTrashed));
  }

  if (viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN") redirect(LEGACY_IMPORT_HREF);
  notFound();
}
