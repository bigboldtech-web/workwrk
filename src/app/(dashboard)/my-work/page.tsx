// /my-work: every task assigned to you, across every Space, as one list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/my-work). It
// replaces six routes at once: /tasks/assigned-to-me, /tasks/today-overdue,
// /tasks/backlog, /tasks/board, /tasks/gantt and /tasks/sprint. Every one of
// which ran on the legacy `Task` table, which is why a task created on any of
// them never appeared on a board, in Everything, in the reminders bell or in
// anybody else's view of the work.
//
// The 5,869-line `task-list-surface.tsx` those pages shared kept every view
// option (grouping, sort, visible columns, filters) in component state, so all
// of it was lost on navigation. Here the group, sort, view and done switch
// live in the URL and the saved filters live in `home.work.savedFilters`, so a
// view is a link you can send somebody.
//
// The server half is thin: the gate, and the stored view options the first
// paint needs.

import { gatePage } from "@/lib/access/gate";
import { getEffectivePreferences } from "@/lib/preferences";
import { readSavedFilters } from "@/lib/home-prefs";
import { MyWorkClient } from "./my-work-client";

export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  // The one Work-hub app key. My work never denies: a Guest reaches it and
  // sees their assigned tasks in the Lists that were shared with them, which
  // is the "My work over shared objects" half of the access section 5.2.1
  // `home` row.
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/my-work" });

  const prefs = await getEffectivePreferences(viewer.userId, viewer.organizationId).catch(() => null);
  const work = (prefs?.home?.work ?? {}) as { savedFilters?: unknown; surface?: Record<string, unknown> };
  const surface = (work.surface?.["my-work"] ?? {}) as { viewOptions?: { fields?: unknown; done?: unknown } };

  return (
    <MyWorkClient
      savedFilters={readSavedFilters(work.savedFilters)}
      initialFields={Array.isArray(surface.viewOptions?.fields) ? (surface.viewOptions!.fields as string[]) : null}
      initialShowDone={surface.viewOptions?.done === true}
    />
  );
}
