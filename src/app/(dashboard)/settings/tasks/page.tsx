"use client";

// Task system (spec-settings-workspace section 2 `/settings/tasks`): what a
// task can be. Tabs Task types, Tags and Templates (a link into the Template
// Center plus the org's default task type). The old /settings/task-types and
// /settings/tags 308 here with their tab.
//
// One primary per tab: "New type" on Task types, in the toolbar from the
// first paint so nothing below it moves when the list arrives (settings-
// cleanup Phase 6). It turns grey (B8, a disabled primary) only once the list
// says every custom type is in use, and its title and the table's footer say
// why; before that answer it opens the dialog, and the server refuses a type
// past the limit in words (newTypePrimary). The Tags tab draws its own
// toolbar (its search and Show archived drive state that lives in the
// manager), so the header holds that row for it; Templates has none.

import { useState } from "react";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SETTINGS_TAB_LABELS } from "@/lib/settings-registry";
import { TaskTypesTab } from "./task-types-tab";
import { TagsTab } from "./tags-tab";
import { TemplatesTab } from "./templates-tab";
import { TAGS_TOOLBAR_ROW, newTypePrimary } from "./task-system-ui";

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
    { key: "types", label: TASK_TAB_LABEL.types, primary: newTypePrimary(usage, () => setCreateOpen(true)) },
    { key: "tags", label: TASK_TAB_LABEL.tags, ownToolbar: true, toolbarRow: TAGS_TOOLBAR_ROW },
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
