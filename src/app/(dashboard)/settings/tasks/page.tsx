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
import { TaskTypesTab } from "./task-types-tab";
import { TagsTab } from "./tags-tab";

export default function TaskSystemPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  const tabs: SettingsTab[] = [
    {
      key: "types",
      label: "Task types",
      primary: {
        label: "New type",
        onClick: () => setCreateOpen(true),
        disabled: !usage || usage.used >= usage.limit,
        title: usage && usage.used >= usage.limit ? `This workspace has reached ${usage.limit} task types` : undefined,
      },
    },
    { key: "tags", label: "Tags" },
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
