"use client";

// The SOP page's People tab (spec-process section 2 `/sops/[id]`): one
// TableCard that replaces the overlapping Compliance and Assignments tabs.
// Columns Person, Department, Assigned on, Due, Mandatory, Status,
// Progress, Acknowledged on, Score (a Display option, off by default, and
// only when the SOP has scored rows), row "…" (Remind, Change due date,
// Remove assignment). Above the card a one-line summary "12 assigned ·
// 9 done · 2 overdue". Rows are scoped by the API (own row for a Member,
// the report tree for a manager, everyone for the org-wide roles). Refetches
// on window focus and every 30s while visible.

import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal, UserPlus } from "lucide-react";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { Picker } from "@/components/ui/picker";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { DueDateDialog } from "@/components/process/due-date-dialog";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";

export interface PeopleRow {
  id: string;
  user: PersonRef;
  department: { id: string; name: string } | null;
  assignedAt: string;
  dueDate: string | null;
  mandatory: boolean;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
  stepsTotal: number;
  stepsCompleted: number;
  completedAt: string | null;
  score: number | null;
  run: { id: string; progress: number; status: string; shareToken: string | null; doneSteps: number } | null;
}
interface PeoplePayload { data: PeopleRow[]; summary: { assigned: number; done: number; overdue: number }; sectionCount: number; hasScores: boolean }

const STATUS_COLOR: Record<PeopleRow["status"], string> = { ASSIGNED: "#6B7280", IN_PROGRESS: "#B45309", COMPLETED: "#1F8F4E", OVERDUE: "#B42318" };
const STATUS_LABEL: Record<PeopleRow["status"], string> = { ASSIGNED: "Assigned", IN_PROGRESS: "In progress", COMPLETED: "Completed", OVERDUE: "Overdue" };

function personName(p: PersonRef): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown";
}

/** ≤ 4 units: the quad-steps glyph (design-system 5.16); else "3 of 7 steps". */
function Progress({ done, total, noun }: { done: number; total: number; noun: string }) {
  if (total === 0) return <span className="text-ink-3">{noun === "steps" ? "No steps" : ""}</span>;
  if (total <= 4) return <Dots variant="quad-steps" done={done} total={total} label={`${done} of ${total} ${noun}`} />;
  return <span className="tabular-nums text-ink-2">{done} of {total} {noun}</span>;
}

/** The Display options of the card: the columns that are off until asked for, so nine columns never fight for 720px. */
const DISPLAY_OPTIONS = [
  { value: "department", label: "Show department" },
  { value: "assigned", label: "Show assigned on" },
  { value: "score", label: "Show score" },
] as const;
type DisplayKey = (typeof DISPLAY_OPTIONS)[number]["value"];

export function SopPeopleTab({ sopId, isChecklist, canAssign, canManageRows, onAssign, refreshKey }: {
  sopId: string;
  isChecklist: boolean;
  canAssign: boolean;
  canManageRows: boolean;
  onAssign: () => void;
  refreshKey: number;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const [payload, setPayload] = useState<PeoplePayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [menu, setMenu] = useState<{ row: PeopleRow; anchor: React.RefObject<HTMLButtonElement | null> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dueFor, setDueFor] = useState<PeopleRow | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [display, setDisplay] = useState<Set<DisplayKey>>(() => new Set());
  const toggleDisplay = (key: string) => setDisplay((prev) => { const n = new Set(prev); if (n.has(key as DisplayKey)) n.delete(key as DisplayKey); else n.add(key as DisplayKey); return n; });

  const load = useCallback(async () => {
    const r = await apiFetch<PeoplePayload>(`/api/sops/${sopId}/people`, { cache: "no-store" });
    if (!r.ok) { setFailed(true); return; }
    setFailed(false);
    setPayload(r.data);
  }, [sopId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, refreshKey]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(id); };
  }, [load]);

  const rows = payload?.data ?? null;

  async function remind(row: PeopleRow) {
    setBusy(row.id);
    const r = await apiFetch(`/api/sop-assignments/${row.id}/remind`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { toast(r.error || "Couldn't send the reminder", { tone: "danger" }); return; }
    toast(`Reminded ${personName(row.user)}`);
  }
  async function saveDue(row: PeopleRow, next: string | null): Promise<boolean> {
    const r = await apiFetch(`/api/sop-assignments/${row.id}`, { method: "PUT", json: { dueDate: next } });
    if (!r.ok) { toast(r.error || "Couldn't change the due date", { tone: "danger" }); return false; }
    toast("Due date changed");
    void load();
    return true;
  }
  async function remove(row: PeopleRow) {
    const ok = await confirm({ title: `Remove ${personName(row.user)} from this SOP?`, description: "They stop seeing it in My SOPs. Their history stays.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/sop-assignments/${row.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't remove the assignment", { tone: "danger" }); return; }
    toast("Assignment removed");
    void load();
  }

  const columns: TableColumn<PeopleRow>[] = [
    { key: "person", label: "Person", title: true, width: "minmax(150px,1fr)", render: (r) => <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={r.user} size={24} /><span className="truncate">{personName(r.user)}</span></span> },
  ];
  if (display.has("department")) columns.push({ key: "department", label: "Department", width: "minmax(100px,1fr)", render: (r) => r.department ? <span className="truncate">{r.department.name}</span> : <span className="text-ink-3">None</span> });
  if (display.has("assigned")) columns.push({ key: "assigned", label: "Assigned on", width: "104px", render: (r) => <span className="tabular-nums text-ink-2" title={fmt.title(r.assignedAt)}>{fmt.date(r.assignedAt, "date")}</span> });
  columns.push(
    { key: "due", label: "Due", width: "96px", render: (r) => r.dueDate ? <span className={`tabular-nums ${r.status === "OVERDUE" ? "text-danger-text" : "text-ink-2"}`} title={fmt.title(r.dueDate)}>{fmt.date(r.dueDate, "date")}</span> : <span className="text-ink-3">None</span> },
    { key: "mandatory", label: "Mandatory", width: "84px", render: (r) => (r.mandatory ? "Yes" : "No") },
    { key: "status", label: "Status", width: "108px", render: (r) => <StatusChip color={STATUS_COLOR[r.status]} label={STATUS_LABEL[r.status]} disabled /> },
    {
      key: "progress", label: "Progress", width: "100px",
      render: (r) => isChecklist
        ? (r.run ? <Progress done={r.run.doneSteps} total={r.stepsTotal || (payload?.sectionCount ?? 0)} noun="steps" /> : <span className="text-ink-3">Not started</span>)
        : <Progress done={r.status === "COMPLETED" ? 3 : r.status === "IN_PROGRESS" ? 2 : 1} total={3} noun="of Assigned, Opened, Acknowledged" />,
    },
    { key: "ack", label: "Acknowledged", width: "110px", render: (r) => r.completedAt ? <span className="tabular-nums text-ink-2" title={fmt.title(r.completedAt)}>{fmt.date(r.completedAt, "date")}</span> : <span className="text-ink-3">Not yet</span> },
  );
  if (display.has("score") && payload?.hasScores) {
    columns.push({ key: "score", label: "Score", width: "80px", numeric: true, render: (r) => (r.score !== null ? r.score.toFixed(1) : "") });
  }
  // Score is offered only when a row carries one, so a SOP with no scoring
  // never shows an empty column and never offers a switch that does nothing.
  const displayOptions = DISPLAY_OPTIONS.filter((o) => o.value !== "score" || payload?.hasScores);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink-2">
          {payload ? `${payload.summary.assigned} assigned · ${payload.summary.done} done · ${payload.summary.overdue} overdue` : " "}
        </p>
        <span className="relative shrink-0">
          <button type="button" onClick={() => setDisplayOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={displayOpen} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Display
          </button>
          <Picker open={displayOpen} onClose={() => setDisplayOpen(false)} ariaLabel="Display" multi align="end" width={220} selected={Array.from(display)} onSelect={toggleDisplay} sections={[{ label: "Columns", options: displayOptions.map((o) => ({ value: o.value, label: o.label })) }]} />
        </span>
        {canAssign ? (
          <button type="button" onClick={onAssign} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover">
            <UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Assign…
          </button>
        ) : null}
      </div>
      {failed ? (
        <OsEmptyView compact variant="error" title="Couldn't load the people on this SOP" action={{ label: "Retry", onClick: () => void load() }} />
      ) : (
        <TableCard<PeopleRow>
          ariaLabel="People"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          skeletonRows={4}
          empty={canAssign ? <span className="inline-flex items-center gap-2">Nobody assigned yet · <button type="button" onClick={onAssign} className="font-medium text-brand-deep hover:underline">Assign…</button></span> : "Nobody assigned yet"}
          rowMenu={canManageRows ? (r) => <PeopleRowMenu row={r} open={menu?.row.id === r.id} onOpen={(anchor) => setMenu({ row: r, anchor })} /> : undefined}
        />
      )}
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            {menu.row.status !== "COMPLETED" ? <MenuItem label="Remind" busy={busy === menu.row.id} onClick={() => void remind(menu.row)} /> : null}
            <MenuItem label="Change due date" onClick={() => setDueFor(menu.row)} />
            <MenuSeparator />
            <MenuItem label="Remove assignment" destructive onClick={() => void remove(menu.row)} />
          </MenuList>
        </MorePortal>
      ) : null}
      {dueFor ? (
        <DueDateDialog open value={dueFor.dueDate} description={personName(dueFor.user)} onClose={() => setDueFor(null)} onSave={(next) => saveDue(dueFor, next)} />
      ) : null}
    </div>
  );
}

function PeopleRowMenu({ row, open, onOpen }: { row: PeopleRow; open: boolean; onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label={`Actions for ${personName(row.user)}`} />;
}
