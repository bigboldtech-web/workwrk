"use client";

/* Real CRM Activities page.
 *
 *  GET /api/activity?scope=team&limit=300
 *
 *  CRM doesn't have a dedicated "activities" model (calls/emails/meetings are
 *  scattered). The pragmatic surface here is the org's ActivityLog filtered to
 *  CRM-relevant entity types (lead, opportunity, account) — the same signal
 *  the per-item drawer shows, rolled up by target type.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListTree, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiActivity = {
  id: string;
  type: string;
  description: string;
  targetType?: string | null;
  targetId?: string | null;
  createdAt: string;
  actor?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

const TARGET_LABELS: Record<string, string> = {
  lead: "Leads", LEAD: "Leads",
  opportunity: "Opportunities", OPPORTUNITY: "Opportunities",
  account: "Accounts", ACCOUNT: "Accounts",
  contact: "Contacts", CONTACT: "Contacts",
};
const TARGET_COLORS: Record<string, string> = {
  lead: C.orange, opportunity: C.green, account: C.indigo, contact: C.purple,
};

function isCrmEntity(t?: string | null): boolean {
  if (!t) return false;
  const low = t.toLowerCase();
  return low === "lead" || low === "opportunity" || low === "account" || low === "contact";
}

function actToRow(a: ApiActivity): Row {
  return {
    id: a.id,
    name: a.description,
    cells: {
      actor: a.actor ? [{ initials: initials(a.actor.firstName, a.actor.lastName), color: avColor(a.actor.id) }] : [],
      type: a.type.replace(/_/g, " "),
      target: a.targetType ? (TARGET_LABELS[a.targetType] ?? a.targetType) : "—",
      when: { iso: a.createdAt },
    },
  };
}

function buildGroups(rows: ApiActivity[]): TableGroup[] {
  const buckets = new Map<string, ApiActivity[]>();
  for (const a of rows) {
    const key = a.targetType?.toLowerCase() ?? "other";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (TARGET_LABELS[a] ?? a).localeCompare(TARGET_LABELS[b] ?? b))
    .map(([key, items]) => ({
      id: key,
      title: TARGET_LABELS[key] ?? key,
      color: TARGET_COLORS[key] ?? C.gray,
      rows: items.map(actToRow),
    }));
}

const COLUMNS: Column[] = [
  { id: "actor",  label: "Actor",  type: "person" },
  { id: "type",   label: "Action", type: "text" },
  { id: "target", label: "Target", type: "text" },
  { id: "when",   label: "When",   type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function CrmActivitiesPage() {
  const [rows, setRows] = useState<ApiActivity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?scope=team&limit=300");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiActivity[] = data?.data?.data ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list.filter((a) => isCrmEntity(a.targetType)));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/activities");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("CRM activities are written automatically as you edit leads / deals / accounts");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).slice(0, 300).map((a): CalendarEvent => ({
      id: a.id,
      title: a.description.length > 60 ? a.description.slice(0, 60) + "…" : a.description,
      date: a.createdAt,
      color: TARGET_COLORS[a.targetType?.toLowerCase() ?? ""] ?? C.gray,
      payload: actToRow(a).cells,
    })),
    [rows],
  );

  return (
    <>
      <OsTitleBar
        title="CRM · Activities"
        Icon={ListTree}
        iconGradient={GRAD.greenTeal}
        description={rows === null ? "Loading activity…" : `${rows.length} CRM event${rows.length === 1 ? "" : "s"} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={ListTree} iconGradient={GRAD.redPink} title="Couldn't load activity" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={ListTree} iconGradient={GRAD.greenTeal} title="No CRM activity yet" subtitle="Every lead, deal, and account change is logged automatically — start working on a deal to see this fill up." chips={["Leads", "Deals", "Accounts"]} cta="Go to pipeline" />
          ) : (
            <OsMainTable moduleId="crm/activities" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="crm/activities" events={calendarEvents} newLabel="" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={ListTree} iconGradient={GRAD.greenTeal} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
