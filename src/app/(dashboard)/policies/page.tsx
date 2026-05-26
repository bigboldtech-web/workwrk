"use client";

/* Real Policies page.
 *
 *  GET   /api/policies            list PUBLISHED policies (with my-ack state)
 *  POST  /api/policies            { title, content, status? }
 *  PATCH /api/policies/[id]       { title?, status?, requiresAck?, ... }
 *
 *  Status (string): DRAFT | PUBLISHED | ARCHIVED
 *  GET only returns PUBLISHED, so the board shows published policies.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type PolStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type ApiPolicy = {
  id: string;
  title: string;
  category?: string | null;
  version: number;
  status: PolStatus;
  requiresAck: boolean;
  effectiveDate?: string | null;
  createdAt: string;
  updatedAt: string;
  acknowledged?: boolean;
  ackRate?: number;
  totalAcks?: number;
  totalUsers?: number;
};

const STATUS_TO_OS: Record<PolStatus, StatusValue> = {
  DRAFT: "planning", PUBLISHED: "done", ARCHIVED: "empty",
};
const STATUS_LABELS: Record<PolStatus, string> = {
  DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived",
};
const STATUS_COLORS: Record<PolStatus, string> = {
  DRAFT: C.indigo, PUBLISHED: C.green, ARCHIVED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as PolStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

// Categories per the schema comment: HR / Security / Compliance / Operations / Code of Conduct / Leave / Expense
const CATEGORY_COLORS: Record<string, string> = {
  HR: C.pink, Security: C.red, Compliance: C.purple, Operations: C.orange,
  "Code of Conduct": C.blue, Leave: C.teal, Expense: C.brown,
  default: C.indigo,
};

function policyToRow(p: ApiPolicy): Row {
  return {
    id: p.id,
    name: p.title,
    done: p.status === "ARCHIVED",
    cells: {
      status: { value: STATUS_TO_OS[p.status], label: STATUS_LABELS[p.status] },
      category: p.category ?? "—",
      version: `v${p.version}`,
      ack: p.acknowledged ? "✓ You've acked" : (p.requiresAck ? "Required" : "—"),
      ackRate: p.ackRate !== undefined ? { pct: p.ackRate, color: p.ackRate >= 90 ? "green" : p.ackRate >= 50 ? "blue" : "warning" } : undefined,
      effective: p.effectiveDate ? { iso: p.effectiveDate } : undefined,
      updated: { iso: p.updatedAt },
    },
  };
}

function buildGroups(rows: ApiPolicy[]): TableGroup[] {
  const byCategory = new Map<string, ApiPolicy[]>();
  for (const p of rows) {
    const k = p.category ?? "Uncategorized";
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k)!.push(p);
  }
  return Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, items]) => ({
      id: cat, title: cat,
      color: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default,
      rows: items.map(policyToRow),
    }));
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",      type: "status" },
  { id: "category",  label: "Category",    type: "text" },
  { id: "version",   label: "Version",     type: "text" },
  { id: "ack",       label: "Your ack",    type: "text" },
  { id: "ackRate",   label: "Org ack rate", type: "progress" },
  { id: "effective", label: "Effective",   type: "date" },
  { id: "updated",   label: "Updated",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function PoliciesPage() {
  const [rows, setRows] = useState<ApiPolicy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/policies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("policies");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/policies/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can edit policies");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const ok = await patch(rowId, { status: value });
      if (!ok) throw new Error("save failed");
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const ok = await patch(rowId, { title: name });
      if (!ok) throw new Error("save failed");
    },
    onAdd: async (_g: string) => {
      const res = await fetch("/api/policies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled policy",
          content: "Write the policy text here…",
          status: "PUBLISHED",
        }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can create policies");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const p: ApiPolicy = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: p.id, name: p.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? [])
      .filter((p) => p.effectiveDate)
      .map((p): CalendarEvent => ({
        id: p.id,
        title: `${p.title} effective`,
        date: p.effectiveDate as string,
        color: STATUS_COLORS[p.status],
        payload: policyToRow(p).cells,
      })),
    [rows],
  );

  const ackPending = (rows ?? []).filter((p) => p.requiresAck && !p.acknowledged).length;

  return (
    <>
      <OsTitleBar
        title="Policies"
        Icon={ShieldCheck}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading policies…" : `${rows.length} policy${rows.length === 1 ? "" : "ies"}${ackPending > 0 ? ` · ${ackPending} need your ack` : ""} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New policy" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.redPink} title="Couldn't load policies" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.indigoBlue} title="No published policies yet" subtitle="Document the rules. Policies require employee acknowledgment by default." chips={["HR", "Security", "Compliance", "Code of Conduct"]} cta="New policy" />
          ) : (
            <OsMainTable moduleId="policies" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="policies" events={calendarEvents} newLabel="New policy" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.indigoBlue} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
