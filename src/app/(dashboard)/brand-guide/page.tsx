"use client";

/* Real Brand Guide page.
 *
 *  GET   /api/brand-guide          { brandGuide, canEdit }
 *  PATCH /api/brand-guide          partial Brand Guide update (manager+)
 *
 *  Brand Guide is a per-org singleton stored at Organization.settings.brandGuide.
 *  The board surface here lists every brand asset with a preview cell; editing
 *  is routed to dedicated sections.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Palette, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type BrandColor = { id: string; name: string; hex: string; role?: string };
type BrandFont = { id: string; name: string; usage?: string; source?: string };
type ApiBrand = {
  data?: {
    brandGuide: {
      story?: string; positioning?: string; voiceAndTone?: string; messaging?: string;
      logoUrl?: string; logoUsage?: string;
      colors?: BrandColor[]; typography?: BrandFont[];
      imageryGuidelines?: string; updatedAt?: string;
    };
    canEdit: boolean;
  };
};

function snippet(s?: string, n = 80): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function buildGroups(b: ApiBrand["data"] | null): TableGroup[] {
  if (!b) return [];
  const g = b.brandGuide;
  const narrativeRows: Row[] = [
    { id: "story",        name: "Brand story",       cells: { value: snippet(g.story),        state: g.story ? "set" : "empty" }, done: !!g.story },
    { id: "positioning",  name: "Positioning",       cells: { value: snippet(g.positioning),  state: g.positioning ? "set" : "empty" }, done: !!g.positioning },
    { id: "voice",        name: "Voice & tone",      cells: { value: snippet(g.voiceAndTone), state: g.voiceAndTone ? "set" : "empty" }, done: !!g.voiceAndTone },
    { id: "messaging",    name: "Messaging pillars", cells: { value: snippet(g.messaging),    state: g.messaging ? "set" : "empty" }, done: !!g.messaging },
  ];
  const visualRows: Row[] = [
    { id: "logo",      name: "Logo",            cells: { value: g.logoUrl ? "✓ Set" : "Add logo URL", state: g.logoUrl ? "set" : "empty" }, done: !!g.logoUrl },
    { id: "logoUsage", name: "Logo usage rules", cells: { value: snippet(g.logoUsage), state: g.logoUsage ? "set" : "empty" }, done: !!g.logoUsage },
    { id: "imagery",   name: "Imagery guidelines", cells: { value: snippet(g.imageryGuidelines), state: g.imageryGuidelines ? "set" : "empty" }, done: !!g.imageryGuidelines },
  ];
  const colorRows: Row[] = (g.colors ?? []).map((c) => ({
    id: c.id, name: c.name,
    cells: { value: c.hex, state: c.role ?? "—" },
  }));
  const fontRows: Row[] = (g.typography ?? []).map((f) => ({
    id: f.id, name: f.name,
    cells: { value: f.usage ?? "—", state: f.source ?? "—" },
  }));

  const groups: TableGroup[] = [
    { id: "narrative", title: "Narrative", color: C.purple, rows: narrativeRows },
    { id: "visual",    title: "Visual identity", color: C.pink, rows: visualRows },
  ];
  if (colorRows.length > 0) groups.push({ id: "colors", title: `Colors (${colorRows.length})`, color: C.blue, rows: colorRows });
  if (fontRows.length > 0)  groups.push({ id: "type",   title: `Typography (${fontRows.length})`, color: C.indigo, rows: fontRows });
  return groups;
}

const COLUMNS: Column[] = [
  { id: "value", label: "Preview / value", type: "text" },
  { id: "state", label: "State / role",    type: "text" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function BrandGuidePage() {
  const [data, setData] = useState<ApiBrand["data"] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/brand-guide");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: ApiBrand = await res.json();
      setData(d.data ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("brand-guide");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(data), [data]);

  const handlers = {
    onAdd: async (groupId: string) => {
      toast(`Use the brand-guide editor to add ${groupId === "colors" ? "a color" : groupId === "type" ? "a font" : "content"}`);
      throw new Error("not supported");
    },
  };

  const updatedAt = data?.brandGuide?.updatedAt;

  return (
    <>
      <OsTitleBar
        title="Brand guide"
        Icon={Palette}
        iconGradient={GRAD.pinkPurple}
        description={data === null ? "Loading brand guide…" : `${(data?.brandGuide?.colors?.length ?? 0)} color${(data?.brandGuide?.colors?.length ?? 0) === 1 ? "" : "s"} · ${(data?.brandGuide?.typography?.length ?? 0)} font${(data?.brandGuide?.typography?.length ?? 0) === 1 ? "" : "s"}${updatedAt ? ` · updated ${new Date(updatedAt).toLocaleDateString()}` : ""}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={2}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel={data?.canEdit ? "Edit guide" : ""} activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Palette} iconGradient={GRAD.redPink} title="Couldn't load brand guide" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : data === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : (
            <OsMainTable moduleId="brand-guide" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="brand-guide" events={[] as CalendarEvent[]} newLabel={data?.canEdit ? "Edit guide" : ""} />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Palette} iconGradient={GRAD.pinkPurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
