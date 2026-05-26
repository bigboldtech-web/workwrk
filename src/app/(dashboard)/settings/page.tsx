"use client";

/* Real Settings hub page.
 *
 *  GET /api/settings   → org profile, enabled modules, scoring weights,
 *                        notification toggles, security policy, usage counts
 *
 *  Editing routes to dedicated sub-pages (/settings/identity, /api, /audit,
 *  /tags, /calendar). The board surface here is a directory of every
 *  configurable bucket with current value snapshots.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiSettings = {
  organization?: { id: string; name: string; slug?: string | null; plan?: string | null; status?: string | null; domain?: string | null };
  settings?: {
    enabledModules?: string[];
    businessType?: string; industry?: string; teamSize?: string;
    timezone?: string; currency?: string; fiscalYearStart?: number;
    reviewFrequency?: string;
    scoreWeights?: Record<string, number>;
    scoringBands?: Array<{ label: string; min: number; max: number; color: string }>;
    notifications?: Record<string, unknown>;
    security?: { minPasswordLength?: number; requireUppercase?: boolean; requireNumbers?: boolean; sessionTimeout?: number; twoFactorEnabled?: boolean };
  };
  usage?: { users?: number; sops?: number; aiQueries?: number };
};

function buildGroups(s: ApiSettings | null): TableGroup[] {
  if (!s) return [];
  const org = s.organization;
  const set = s.settings ?? {};
  const sec = set.security ?? {};
  const usage = s.usage ?? {};

  const profileRows: Row[] = [
    { id: "name",     name: "Organization name", cells: { value: org?.name ?? "—", area: "Identity", subpage: "/settings/identity" } },
    { id: "slug",     name: "Workspace slug",    cells: { value: org?.slug ?? "—", area: "Identity", subpage: "/settings/identity" } },
    { id: "domain",   name: "Primary domain",    cells: { value: org?.domain ?? "—", area: "Identity", subpage: "/settings/identity" } },
    { id: "plan",     name: "Plan",              cells: { value: org?.plan ?? "—", area: "Billing", subpage: "/settings" } },
    { id: "industry", name: "Industry",          cells: { value: set.industry || "—", area: "Profile", subpage: "/settings" } },
    { id: "tz",       name: "Timezone",          cells: { value: set.timezone ?? "—", area: "Profile", subpage: "/settings" } },
    { id: "ccy",      name: "Currency",          cells: { value: set.currency ?? "—", area: "Profile", subpage: "/settings" } },
    { id: "fyStart",  name: "Fiscal year start", cells: { value: set.fiscalYearStart ? `Month ${set.fiscalYearStart}` : "—", area: "Profile", subpage: "/settings" } },
  ];

  const productRows: Row[] = [
    { id: "modules", name: "Enabled modules", cells: { value: `${set.enabledModules?.length ?? 0} on`, area: "Product", subpage: "/settings" } },
    { id: "tags",    name: "Tags & labels",   cells: { value: "Manage", area: "Taxonomy", subpage: "/settings/tags" } },
    { id: "audit",   name: "Audit log",       cells: { value: "Open", area: "Compliance", subpage: "/settings/audit" } },
    { id: "api",     name: "API keys",        cells: { value: "Manage", area: "Integrations", subpage: "/settings/api" } },
    { id: "cal",     name: "Calendar feeds",  cells: { value: "Manage", area: "Integrations", subpage: "/settings/calendar" } },
  ];

  const scoringRows: Row[] = [
    { id: "reviewFreq", name: "Review frequency", cells: { value: set.reviewFrequency ?? "QUARTERLY", area: "Cadence", subpage: "/settings" } },
    { id: "weights",    name: "Score weights",
      cells: {
        value: set.scoreWeights
          ? Object.entries(set.scoreWeights).map(([k, v]) => `${k} ${v}%`).join(" · ")
          : "—",
        area: "Scoring", subpage: "/settings",
      },
    },
    { id: "bands", name: "Performance bands", cells: { value: `${set.scoringBands?.length ?? 0} bands`, area: "Scoring", subpage: "/settings" } },
  ];

  const policyRows: Row[] = [
    { id: "minPw",     name: "Min password length",   cells: { value: `${sec.minPasswordLength ?? 8} chars`, area: "Security", subpage: "/account/security" } },
    { id: "reqUpper",  name: "Require uppercase",     cells: { value: sec.requireUppercase ? "Yes" : "No",  area: "Security", subpage: "/account/security" } },
    { id: "reqNum",    name: "Require numbers",       cells: { value: sec.requireNumbers ? "Yes" : "No",    area: "Security", subpage: "/account/security" } },
    { id: "session",   name: "Session timeout (min)", cells: { value: `${sec.sessionTimeout ?? 30}`,        area: "Security", subpage: "/account/security" } },
    { id: "twofa",     name: "Two-factor (org)",      cells: { value: sec.twoFactorEnabled ? "Required" : "Optional", area: "Security", subpage: "/account/security" } },
  ];

  const usageRows: Row[] = [
    { id: "users",   name: "Active users",  cells: { value: `${usage.users ?? 0}`,    area: "Usage", subpage: "/people" } },
    { id: "sops",    name: "Total SOPs",    cells: { value: `${usage.sops ?? 0}`,     area: "Usage", subpage: "/sops" } },
    { id: "ai",      name: "AI queries",    cells: { value: `${usage.aiQueries ?? 0}`, area: "Usage", subpage: "/analytics" } },
  ];

  return [
    { id: "profile",  title: "Organization profile", color: C.blue,   rows: profileRows },
    { id: "product",  title: "Product & modules",    color: C.indigo, rows: productRows },
    { id: "scoring",  title: "Scoring & reviews",    color: C.purple, rows: scoringRows },
    { id: "policies", title: "Policies",             color: C.orange, rows: policyRows },
    { id: "usage",    title: "Usage",                color: C.green,  rows: usageRows },
  ];
}

const COLUMNS: Column[] = [
  { id: "area",    label: "Area",     type: "text" },
  { id: "value",   label: "Current",  type: "text" },
  { id: "subpage", label: "Sub-page", type: "text" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function SettingsPage() {
  const [data, setData] = useState<ApiSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("settings");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(data), [data]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Settings are managed via dedicated sub-pages — pick an area from the table");
      throw new Error("not supported");
    },
  };

  const moduleCount = data?.settings?.enabledModules?.length ?? 0;

  return (
    <>
      <OsTitleBar
        title="Settings"
        Icon={SlidersHorizontal}
        iconGradient={GRAD.bluePurple}
        description={data === null ? "Loading workspace…" : `${data.organization?.name ?? "Workspace"} · ${moduleCount} modules on · plan ${data.organization?.plan ?? "—"}`}
        people={[PEOPLE.bb]}
        morePeople={0}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={SlidersHorizontal} iconGradient={GRAD.redPink} title="Couldn't load settings" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : data === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : (
            <OsMainTable moduleId="settings" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="settings" events={[] as CalendarEvent[]} newLabel="" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={SlidersHorizontal} iconGradient={GRAD.bluePurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
