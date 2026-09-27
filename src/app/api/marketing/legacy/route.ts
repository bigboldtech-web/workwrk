// The legacy Marketing import, for the Settings > Data > Import row
// "Marketing (legacy)" (spec-tools-misc section 2.7; the page is Phase 8's,
// the minimal entry is on /settings/data today).
//
//   GET   the counts, whether the import has run, the migrated Space, and
//         what a write would still do (rows never moved, or whose task was
//         deleted for good, and moved tasks whose dates still need
//         anchoring), so the page keeps offering Import while there is
//         something left for it to do
//   POST  { write: false } a dry-run report; { write: true } the import
//
// Owner and Admin only, through the one Data gate (requireCan "manage"
// settings/data). Guests and Members get the same 403 the Data page's other
// exports give. A blocked run answers with the reason in plain words: 503
// while the template is not seeded, 409 while another import holds the
// per-org lock or the Marketing Space sits in Trash. A write that stopped
// part-way is still a 200 with its report, so the page can show what moved,
// what did not, and that running it again resumes; only the report's own
// `error` says it stopped.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { countLegacyMarketing, findMigratedMarketing, hasLegacyMarketing, importLegacyMarketing, pendingLegacyMarketing, resolveImportZone } from "@/lib/marketing/legacy-import";
import { MARKETING_KINDS } from "@/lib/marketing/legacy-map";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const DATA_PAGE = { type: "settings", page: "data" } as const;

export async function GET() {
  try {
    const { viewer } = await requireCan("manage", DATA_PAGE);
    const [counts, migrated, zone] = await Promise.all([
      countLegacyMarketing(viewer.organizationId),
      findMigratedMarketing(viewer.organizationId),
      resolveImportZone(viewer.organizationId, viewer.userId),
    ]);
    // What is left to do is read only once the Space exists: before that,
    // everything is pending and the page already shows Import.
    const pending = migrated ? await pendingLegacyMarketing(viewer.organizationId, zone) : null;
    const moved = { ...counts };
    if (pending) for (const k of MARKETING_KINDS) moved[k] = counts[k] - pending.toWrite[k];
    return jsonSuccess({
      counts,
      hasRows: hasLegacyMarketing(counts),
      migrated: migrated ? { spaceSlug: migrated.spaceSlug, lists: migrated.lists, archived: migrated.archived } : null,
      /** Rows that have a task today, per kind (equals `counts` once everything is over). */
      moved,
      pending,
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { viewer } = await requireCan("manage", DATA_PAGE);
    const body = (await req.json().catch(() => ({}))) as { write?: unknown };
    const write = body?.write === true;
    const report = await importLegacyMarketing({ organizationId: viewer.organizationId, actorId: viewer.userId, write });
    if (report.blocked) return jsonError(report.blocked, report.blockedCode === "template" ? 503 : 409);
    if (write) {
      const moved = report.kinds.campaigns.written + report.kinds.content.written + report.kinds.events.written;
      logActivity({
        type: "legacy_marketing_imported",
        actorId: viewer.userId,
        organizationId: viewer.organizationId,
        description: `Imported the legacy Marketing module into a Space (${moved} task${moved === 1 ? "" : "s"}${report.error ? ", stopped part-way" : ""})`,
        targetType: "space",
        severity: report.error ? "warning" : "info",
      });
    }
    return jsonSuccess({ report });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
