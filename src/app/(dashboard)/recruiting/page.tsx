"use client";

/* Real, persistent Recruiting page.
 *
 *  GET   /api/recruiting/applications     (with job + candidate joins)
 *  PATCH /api/recruiting/applications/[id]  { stage?, notes?, recruiterId? }
 *
 *  Stage enum: APPLIED | SCREENING | INTERVIEW | OFFER | HIRED | REJECTED | WITHDRAWN
 *
 *  Adding a new application needs an existing candidate + job — we don't
 *  support that from the board (would need a multi-step modal). The
 *  "+ Add" button surfaces a friendly toast instead.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus, ClipboardList, Boxes, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsKanban, type KColumn } from "@/components/layout/os/kanban";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type Stage = "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED" | "WITHDRAWN";

type ApiApplication = {
  id: string;
  stage: Stage;
  rejectionReason?: string | null;
  source?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  job?: { id: string; title: string } | null;
  candidate?: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  recruiter?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STAGE_TO_OS: Record<Stage, StatusValue> = {
  APPLIED: "planning", SCREENING: "pending", INTERVIEW: "working",
  OFFER: "review", HIRED: "done", REJECTED: "stuck", WITHDRAWN: "empty",
};
const STAGE_LABELS: Record<Stage, string> = {
  APPLIED: "Applied", SCREENING: "Screening", INTERVIEW: "Interview",
  OFFER: "Offer", HIRED: "Hired", REJECTED: "Rejected", WITHDRAWN: "Withdrawn",
};
const STAGE_COLORS: Record<Stage, string> = {
  APPLIED: C.indigo, SCREENING: C.blue, INTERVIEW: C.orange,
  OFFER: C.purple, HIRED: C.green, REJECTED: C.red, WITHDRAWN: C.gray,
};

const STAGE_OPTIONS: PickerOption[] = (["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"] as Stage[]).map((s) => ({
  value: s, label: STAGE_LABELS[s], color: STAGE_COLORS[s],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
function candidateName(c?: ApiApplication["candidate"]) {
  if (!c) return "Unknown";
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Unknown";
}
function candidateInitials(c?: ApiApplication["candidate"]) {
  if (!c) return "?";
  const f = (c.firstName ?? "")[0] ?? "";
  const l = (c.lastName ?? "")[0] ?? "";
  return ((f + l) || (c.email?.[0] ?? "?")).toUpperCase();
}

const GROUP_ORDER: Stage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];

function appToRow(a: ApiApplication): Row {
  return {
    id: a.id,
    name: candidateName(a.candidate),
    done: a.stage === "HIRED",
    cells: {
      stage: { value: STAGE_TO_OS[a.stage], label: STAGE_LABELS[a.stage] },
      job: a.job?.title ?? "—",
      owner: a.candidate ? [{ initials: candidateInitials(a.candidate), color: avatarFor(a.candidate.id) }] : [],
      recruiter: a.recruiter ? [{
        initials: (((a.recruiter.firstName?.[0] ?? "") + (a.recruiter.lastName?.[0] ?? "")) || "?").toUpperCase(),
        color: avatarFor(a.recruiter.id),
      }] : [],
      source: a.source ?? "—",
      applied: { iso: a.createdAt },
    },
  };
}

function buildGroups(apps: ApiApplication[]): TableGroup[] {
  const buckets = new Map<Stage, ApiApplication[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const a of apps) {
    if (a.stage === "WITHDRAWN") continue;
    const b = buckets.get(a.stage);
    if (b) b.push(a);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STAGE_LABELS[s], color: STAGE_COLORS[s],
      rows: (buckets.get(s) ?? []).map(appToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "APPLIED" || g.id === "SCREENING");
}

const COLUMNS: Column[] = [
  { id: "stage",     label: "Stage",     type: "status" },
  { id: "job",       label: "Job",       type: "text" },
  { id: "owner",     label: "Candidate", type: "person" },
  { id: "recruiter", label: "Recruiter", type: "person" },
  { id: "source",    label: "Source",    type: "text" },
  { id: "applied",   label: "Applied",   type: "date" },
];

const TABS: TabDef[] = [
  { id: "kanban",    label: "Pipeline",   Icon: Boxes },
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function RecruitingPage() {
  const [apps, setApps] = useState<ApiApplication[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("kanban");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recruiting/applications?scope=all");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApps(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("recruiting");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(apps ?? []), [apps]);

  async function patchApp(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/recruiting/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${res.status}`);
    return res.json();
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      await patchApp(rowId, { stage: value });
      void load();
    },
    onAdd: async (_g: string) => {
      toast("To add a candidate to a job, use the Candidates or Jobs pages — applications need both.");
      throw new Error("not supported");
    },
  };

  const kanbanColumns: KColumn[] = useMemo(() => {
    if (!apps) return [];
    const byStage = new Map<Stage, ApiApplication[]>();
    for (const s of GROUP_ORDER) byStage.set(s, []);
    for (const a of apps) {
      if (a.stage === "WITHDRAWN") continue;
      const b = byStage.get(a.stage);
      if (b) b.push(a);
    }
    return GROUP_ORDER.map((s) => ({
      id: s,
      title: STAGE_LABELS[s],
      color: STAGE_COLORS[s],
      cards: (byStage.get(s) ?? []).map((a) => ({
        id: a.id,
        title: candidateName(a.candidate),
        refId: a.job?.title,
        labels: a.source ? [{ label: a.source, color: "purple" as const }] : [],
        people: a.candidate ? [{ initials: candidateInitials(a.candidate), color: avatarFor(a.candidate.id) }] : [],
      })),
    }));
  }, [apps]);

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (apps ?? []).map((a) => ({
      id: a.id,
      title: `${candidateName(a.candidate)}${a.job?.title ? ` · ${a.job.title}` : ""}`,
      date: a.createdAt,
      color: STAGE_COLORS[a.stage],
      done: a.stage === "HIRED",
      payload: appToRow(a).cells,
    })),
    [apps],
  );

  const openCount = (apps ?? []).filter((a) => a.stage !== "HIRED" && a.stage !== "REJECTED" && a.stage !== "WITHDRAWN").length;

  return (
    <>
      <OsTitleBar
        title="Recruiting"
        Icon={UserPlus}
        iconGradient={GRAD.orangePink}
        description={apps === null ? "Loading applications…" : `${apps.length} application${apps.length === 1 ? "" : "s"} · ${openCount} active · live-synced`}
        people={[PEOPLE.mk, PEOPLE.bb]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "kanban" && (
        <>
          <OsFilterBar newLabel="New application" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={UserPlus} iconGradient={GRAD.redPink} title="Couldn't load pipeline" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : apps === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading pipeline…</div>
          ) : kanbanColumns.every((c) => c.cards.length === 0) ? (
            <OsEmptyView Icon={UserPlus} iconGradient={GRAD.orangePink} title="No applications yet" subtitle="Open a job and add candidates to start seeing them flow through Applied → Hired here." chips={["Inbound", "Outbound", "Referral", "Event"]} cta="Open Jobs" />
          ) : (
            <OsKanban moduleId="recruiting" columns={kanbanColumns} />
          )}
        </>
      )}

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New application" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={UserPlus} iconGradient={GRAD.redPink} title="Couldn't load pipeline" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : apps === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : (
            <OsMainTable moduleId="recruiting" columns={COLUMNS} groups={groups} statusOptions={STAGE_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="recruiting" events={calendarEvents} newLabel="New application" />
      )}

      {activeTab !== "kanban" && activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={UserPlus} iconGradient={GRAD.orangePink} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="This view shares the same live data as the pipeline." chips={["Live data", "Persistent edits"]} cta="Back to Pipeline" />
      )}
    </>
  );
}
