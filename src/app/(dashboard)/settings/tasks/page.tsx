"use client";

// Task system (spec-settings-workspace section 2 `/settings/tasks`): what a
// task can be. Tabs Task types, Tags and Templates (a link into the Template
// Center plus the org's default task type). The old /settings/task-types and
// /settings/tags 308 here with their tab.
//
// One primary per tab: "New type" on Task types (rendered only while there
// is room for one more custom type: a disabled primary is never drawn); the
// Tags manager carries its own per-dimension create rows; Templates has none.

import { useState } from "react";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SETTINGS_TAB_LABELS } from "@/lib/settings-registry";
import { TaskTypesTab } from "./task-types-tab";
import { TagsTab } from "./tags-tab";
import { TemplatesTab } from "./templates-tab";

// Labels from the registry (the one place they are written).
const TASK_TAB_LABEL = {
  types: SETTINGS_TAB_LABELS.tasks?.types ?? "types",
  tags: SETTINGS_TAB_LABELS.tasks?.tags ?? "tags",
  templates: SETTINGS_TAB_LABELS.tasks?.templates ?? "templates",
};

export default function TaskSystemPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  const tabs: SettingsTab[] = [
    {
      key: "types",
      label: TASK_TAB_LABEL.types,
      primary: usage && usage.used < usage.limit ? { label: "New type", onClick: () => setCreateOpen(true) } : undefined,
    },
    { key: "tags", label: TASK_TAB_LABEL.tags },
    { key: "templates", label: TASK_TAB_LABEL.templates },
  ];

  return (
    <SettingsPage pageKey="tasks" tabs={tabs} width="list">
      {(tab) =>
        tab === "tags" ? (
          <TagsTab />
        ) : tab === "templates" ? (
          <TemplatesTab />
        ) : (
          <TaskTypesTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} onUsage={setUsage} />
        )
      }
    </SettingsPage>
  );
}
