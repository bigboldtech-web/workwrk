// /ideas: the retired Ideas app, kept readable for one release.
//
// Spec: ui-refresh-master-plan.md Phase 2, issue S3 ("the /ideas and
// /marketing duplicates"). An idea is a task: a title, a description, a
// status, an owner and votes. It had its own model, its own six-member
// status enum and no sidebar row anywhere, so scripts/migrate-ideas.ts
// copies every `Idea` onto an Item on a real List named "Ideas", marked with
// `Board.settings.legacyIdeasList` so it can be found again from here.
//
// WHY THIS IS NOT A REDIRECT. The destination is a different List in every
// workspace, so there is no static target a next.config row could carry, and
// a page-level `permanentRedirect` is not a real 308: it paints the shell
// first and delivers the redirect as an RSC instruction, so curl, a link
// unfurler and a crawler all get a 200 with no Location header
// (src/app/(dashboard)/tasks/[id]/route.ts has the long version of this).
//
// WHAT IT DOES INSTEAD, which is the treatment /me/mentions already gets:
// once the migrated List exists, the page says so on itself and links to it,
// and the "Share an idea" composer is not rendered, so the retired model
// gains no new rows that would be stranded until somebody re-ran the script.
// POST /api/ideas answers 410 with the same pointer, so the door is shut at
// the API too, not only in the UI.
//
// Before the migration has run for a workspace there is no marker, no List
// and nothing to point at, so the page is exactly what it always was. That is
// the "tolerate the new thing being absent" rule: a workspace mid-deploy
// keeps a working Ideas page rather than an empty promise.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findMigratedIdeasList } from "@/lib/work/ideas-destination";
import IdeasClient from "./ideas-client";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const session = await getServerSession(authOptions);
  const organizationId = (session?.user as { organizationId?: string } | undefined)?.organizationId ?? null;
  const list = await findMigratedIdeasList(organizationId);
  return <IdeasClient migratedListHref={list ? `/boards/${list.slug}` : null} />;
}
