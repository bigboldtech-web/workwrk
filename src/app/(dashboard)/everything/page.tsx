// /everything: every task in every Space you can see, as one list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/everything).
//
// WHAT IT WAS. A thin SSR wrapper over the shared BoardTableView in read-only
// mode, capped at 500 rows with no pagination, whose header printed "500+" and
// whose access check loaded every board in the org and asked `getBoardForReader`
// about each one before reading a single task. No filters, no sort, no group,
// no saved views, and no per-row role, so a row from a List you can only read
// rendered exactly like one you own.
//
// THE URL CONTRACT. `?space=<slug>` and `?folder=<id>` scope the page, and
// `?view=`, `?group=`, `?sort=`, `?done=` and `?cursor=` mirror My work's. The
// five Space-wide and Folder-wide views spec-spaces-lists retires land here
// through those parameters, which is why they are a contract and not a
// convenience: `view=gantt` resolves to `list` (a Gantt is a List view, never
// a cross-List one) and `view=team` resolves to `list&group=assignee`, which
// is what the old Space "team" view showed.

import { gatePage } from "@/lib/access/gate";
import { notFound } from "next/navigation";
import { getEffectivePreferences } from "@/lib/preferences";
import { readSavedFilters } from "@/lib/home-prefs";
import { EverythingClient } from "./everything-view";

export const dynamic = "force-dynamic";

export default async function EverythingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/everything" });
  // A Guest's `home` row grants My work and Inbox and nothing else, so this is
  // the in-shell 404 for them and their sidebar carries no Everything row.
  if (viewer.orgRole === "GUEST") notFound();

  const sp = await searchParams;
  const one = (k: string): string | null => {
    const v = sp[k];
    return typeof v === "string" && v ? v : null;
  };

  const prefs = await getEffectivePreferences(viewer.userId, viewer.organizationId).catch(() => null);
  const work = (prefs?.home?.work ?? {}) as { surface?: Record<string, unknown>; everythingFilters?: unknown };
  const surface = (work.surface?.everything ?? {}) as {
    viewOptions?: { fields?: unknown; done?: unknown };
    collapsedGroups?: unknown;
  };

  return (
    <EverythingClient
      initialSpace={one("space")}
      initialFolder={one("folder")}
      initialView={one("view")}
      initialGroup={one("group")}
      initialSort={one("sort")}
      initialShowDone={surface.viewOptions?.done === true || one("done") === "1"}
      initialFields={Array.isArray(surface.viewOptions?.fields) ? (surface.viewOptions!.fields as string[]) : null}
      initialSubtasks={one("subtasks") !== "0"}
      // /everything keeps its OWN saved views: a view saved over "tasks
      // assigned to me" describes a set this page does not have.
      initialViews={readSavedFilters(work.everythingFilters)}
      initialFilterId={one("filter")}
      // A stored value from an older shape degrades to "nothing collapsed",
      // never to a crash: the surface store is deliberately loose.
      initialCollapsed={
        Array.isArray(surface.collapsedGroups)
          ? surface.collapsedGroups.filter((v): v is string => typeof v === "string")
          : []
      }
    />
  );
}
