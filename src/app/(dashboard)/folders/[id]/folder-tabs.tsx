"use client";

// The Folder's two pills: Contents · Tasks.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, `/folders/[id]`,
// Views row: "two text-tab pills, Contents · Tasks, following `?tab=` (default
// `contents`)".
//
// What this replaces: `folder-view-tabs.tsx`, whose two pills were "Overview"
// and "List" (the retired words) and whose per-tab `tile` hex colours had been
// dead props since `ViewTab` stopped reading them. The destinations are the
// same two; only the vocabulary and the parameter name change, and `?view=`
// still resolves on the server for one release.

import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";

export function FolderTabs({
  tab,
  folderId,
  taskCount,
}: {
  tab: "contents" | "tasks";
  folderId: string;
  /** Lists in this folder and below; 0 still renders the pill, with an empty body. */
  taskCount: number;
}) {
  return (
    <ViewTabStrip className="px-6">
      <ViewTab
        label="Contents"
        active={tab === "contents"}
        href={`/folders/${folderId}`}
      />
      <ViewTab
        label="Tasks"
        active={tab === "tasks"}
        href={`/folders/${folderId}?tab=tasks`}
      />
      {taskCount === 0 && tab === "tasks" ? (
        <span className="ms-2 self-center text-xs text-ink-3">
          No lists on this shelf yet
        </span>
      ) : null}
    </ViewTabStrip>
  );
}

export const FOLDER_TABS = ["contents", "tasks"] as const;
