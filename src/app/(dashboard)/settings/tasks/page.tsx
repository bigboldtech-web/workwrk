"use client";

// Task system (spec-settings-workspace section 2 `/settings/tasks`): what a
// task can be. Two tabs today, Task types and Tags; the Templates tab (a
// link into the Template Center) joins them with S3. The old
// /settings/task-types and /settings/tags 308 here with their tab.
//
// One primary per tab: "New type" on Task types; the Tags manager carries
// its own per-dimension create rows, so the Tags tab has none.

import { useState } from "react";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SETTINGS_TAB_LABELS } from "@/lib/settings-registry";
import { TaskTypesTab } from "./task-types-tab";
import { TagsTab } from "./tags-tab";

// Labels from the registry (the one place they are written).
const TASK_TAB_LABEL = { types: SETTINGS_TAB_LABELS.tasks?.types ?? "types", tags: SETTINGS_TAB_LABELS.tasks?.tags ?? "tags" };

export default function TaskSystemPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  const tabs: SettingsTab[] = [
    {
      key: "types",
      label: TASK_TAB_LABEL.types,
      primary: {
        label: "New type",
        onClick: () => setCreateOpen(true),
        disabled: !usage || usage.used >= usage.limit,
        title: usage && usage.used >= usage.limit ? `This workspace has reached ${usage.limit} task types` : undefined,
      },
    },
    { key: "tags", label: TASK_TAB_LABEL.tags },
  ];

  return (
    <SettingsPage pageKey="tasks" tabs={tabs} width="list">
      {(tab) =>
        tab === "tags" ? (
          <TagsTab />
        ) : (
          <TaskTypesTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} onUsage={setUsage} />
        )
      }
    </SettingsPage>
  );
}
