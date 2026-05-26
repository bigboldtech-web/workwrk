"use client";

import { useState } from "react";
import { OsTitleBar, type Person } from "./title-bar";
import { OsTabs, type TabDef } from "./tabs";
import { OsFilterBar } from "./filter-bar";
import { OsMainTable } from "./main-table";
import { OsKanban } from "./kanban";
import { OsEmptyView } from "./empty-view";
import { getModule, C, GRAD } from "./catalog";
import { Sparkles, Calendar as CalendarIcon, BarChart, Boxes } from "lucide-react";

const SAMPLE_PEOPLE: Person[] = [
  { initials: "BB", color: C.purple },
  { initials: "SC", color: C.green },
  { initials: "AK", color: C.orange },
];

export function OsModuleView({ moduleId }: { moduleId: string }) {
  const mod = getModule(moduleId);
  const [activeTab, setActiveTab] = useState<string>(mod?.defaultView ?? "table");

  if (!mod) {
    return (
      <>
        <OsTitleBar
          title={moduleId}
          Icon={Sparkles}
          iconGradient={GRAD.bluePurple}
          description="Module not found in catalog"
        />
        <OsEmptyView
          Icon={Sparkles}
          iconGradient={GRAD.bluePurple}
          title="Not in the catalog"
          subtitle={`There's no module registered for "${moduleId}" yet. Add one in src/components/layout/os/catalog.ts.`}
        />
      </>
    );
  }

  const hasData =
    (activeTab === "table" && mod.groups && mod.groups.length > 0) ||
    (activeTab === "kanban" && mod.kanban && mod.kanban.length > 0);

  return (
    <>
      <OsTitleBar
        title={mod.name}
        Icon={mod.Icon}
        iconGradient={mod.gradient}
        description={mod.description}
        people={SAMPLE_PEOPLE}
        morePeople={9}
      />
      <OsTabs tabs={mod.tabs as TabDef[]} active={activeTab} onSelect={setActiveTab} />
      {hasData ? <OsFilterBar newLabel={mod.newLabel} activeFilters={1} /> : null}

      {hasData && activeTab === "table" && mod.columns && mod.groups ? (
        <OsMainTable columns={mod.columns} groups={mod.groups} moduleId={mod.id} />
      ) : null}

      {hasData && activeTab === "kanban" && mod.kanban ? (
        <OsKanban columns={mod.kanban} moduleId={mod.id} />
      ) : null}

      {!hasData && activeTab === "dashboard" ? (
        <OsEmptyView
          Icon={BarChart}
          iconGradient={GRAD.bluePurple}
          title="Dashboard coming soon"
          subtitle={`${mod.name} dashboard widgets are being wired up. In the meantime, Sidekick can answer any question about ${mod.name.toLowerCase()}.`}
          chips={["Battery", "KPI tiles", "Status donut", "Live feed"]}
          cta="Configure dashboard"
        />
      ) : null}

      {!hasData && activeTab === "calendar" ? (
        <OsEmptyView
          Icon={CalendarIcon}
          iconGradient={GRAD.pinkPurple}
          title="Calendar view"
          subtitle={`Schedule items in ${mod.name.toLowerCase()} on a month / week / day grid. Drag-to-reschedule and color-code by status.`}
          chips={["Month", "Week", "Day", "Agenda"]}
          cta="Set up calendar"
        />
      ) : null}

      {!hasData && activeTab === "gantt" ? (
        <OsEmptyView
          Icon={BarChart}
          iconGradient={GRAD.indigoBlue}
          title="Gantt view"
          subtitle={`Time-line view of items with dependencies, milestones, and critical path. Roll up by group or owner.`}
          chips={["Dependencies", "Milestones", "Critical path"]}
          cta="Open Gantt"
        />
      ) : null}

      {!hasData && activeTab === "kanban" ? (
        <OsEmptyView
          Icon={Boxes}
          iconGradient={GRAD.orangePink}
          title="Kanban view"
          subtitle={`Visual board grouped by status. Drag-and-drop items between columns to update their state.`}
          chips={["Drag-and-drop", "WIP limits", "Swim lanes"]}
          cta="Set up kanban"
        />
      ) : null}

      {!hasData && activeTab === "table" ? (
        <OsEmptyView
          Icon={mod.Icon}
          iconGradient={mod.gradient}
          title={`${mod.name} is ready for content`}
          subtitle={`${mod.description}. Start by creating your first item, importing data, or letting Sidekick set up a starter board for you.`}
          chips={["Import CSV", "From template", "Sidekick auto-setup"]}
          cta={mod.newLabel}
        />
      ) : null}

      {!hasData && activeTab !== "table" && activeTab !== "dashboard" && activeTab !== "calendar" && activeTab !== "gantt" && activeTab !== "kanban" ? (
        <OsEmptyView
          Icon={mod.Icon}
          iconGradient={mod.gradient}
          title="View coming soon"
          subtitle={`This view is being wired up for ${mod.name}. Use the Main table for now.`}
          cta="Switch to Main table"
        />
      ) : null}
    </>
  );
}
