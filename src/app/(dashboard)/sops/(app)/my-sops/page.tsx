"use client";

/* /sops/my-sops (spec-process section 2): the SOPs I have to read, run or
 * acknowledge, and the ones I've done, in ONE hop.
 *
 *   header   "My SOPs" · views To do · Done · All · toolbar Filter (search,
 *            Kind, Mandatory, Due, Status), Sort (Due, Assigned on, Name);
 *            no blue button (there is nothing for me to create here)
 *   body     one summary line "3 to do · 1 overdue · 12 done"; TableCard:
 *            Name · Kind · Due · Mandatory · Status · Progress · Action
 *            ("Acknowledge", or "Start run" / "Continue run" on a Checklist)
 *
 *   GET  /api/me/sops?view=&q=&kind=&mandatory=1&status=&dueFrom=&dueTo=&sort=&dir=
 *   POST /api/me/sops/[assignmentId]/ack, DELETE the same (the Undo toast)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, FileText, ListChecks, ListOrdered, MousePointerClick, Play, SlidersHorizontal } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { StartRunDialog } from "@/components/sops/start-run-dialog";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { SOP_KIND_LABEL, isSopKind, type SopKind } from "@/lib/sop-kind";
import { cn } from "@/lib/utils";

type View = "todo" | "done" | "all";
type Status = "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
type Row = {
  id: string;
  status: Status;
  mandatory: boolean;
  dueDate: string | null;
  assignedAt: string;
  completedAt: string | null;
  stepsTotal: number;
  stepsCompleted: number;
  sop: { id: string; title: string; kind: SopKind; sectionCount: number; status: string; version: number };
  run: { id: string; shareToken: string | null; progress: number; status: string } | null;
};
type Payload = { data: Row[]; total: number; count: number; summary: { todo: number; overdue: number; done: number } };

const VIEW_LABEL: Record<View, string> = { todo: "To do", done: "Done", all: "All" };
const SORTS = [{ key: "due", label: "Due date" }, { key: "assigned", label: "Assigned on" }, { key: "name", label: "Name" }] as const;
const STATUS_COLOR: Record<Status, string> = { ASSIGNED: "#6B7280", IN_PROGRESS: "#B45309", COMPLETED: "#1F8F4E", OVERDUE: "#B42318" };
const STATUS_LABEL: Record<Status, string> = { ASSIGNED: "Assigned", IN_PROGRESS: "In progress", COMPLETED: "Completed", OVERDUE: "Overdue" };
const KIND_ICON: Record<SopKind, typeof FileText> = { written: FileText, steps: ListOrdered, checklist: ListChecks, recording: MousePointerClick };

export default function MySopsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const fmt = useFormat();

  // To do is the default and the first pill; Done and All are the URL views.
  const view: View = params.get("view") === "all" || params.get("view") === "done" ? (params.get("view") as View) : "todo";
  const q = params.get("q") ?? "";
  const kind = isSopKind(params.get("kind")) ? (params.get("kind") as SopKind) : null;
  const mandatory = params.get("mandatory") === "1";
  const status = params.get("status");
  const dueFrom = params.get("dueFrom");
  const dueTo = params.get("dueTo");
  const sort = SORTS.some((s) => s.key === params.get("sort")) ? (params.get("sort") as (typeof SORTS)[number]["key"]) : "due";
  const dir: "asc" | "desc" = params.get("dir") === "desc" ? "desc" : "asc";
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    const s = next.toString();
    router.push(s ? `/sops/my-sops?${s}` : "/sops/my-sops");
  }, [params, router]);
  const activeFilters = [q, kind, mandatory ? "m" : null, status, dueFrom || dueTo ? "d" : null].filter(Boolean).length;

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ view, sort, dir });
    if (q) p.set("q", q);
    if (kind) p.set("kind", kind);
    if (mandatory) p.set("mandatory", "1");
    if (status) p.set("status", status);
    if (dueFrom) p.set("dueFrom", dueFrom);
    if (dueTo) p.set("dueTo", dueTo);
    return p.toString();
  }, [view, sort, dir, q, kind, mandatory, status, dueFrom, dueTo]);
  const load = useCallback(async () => {
    const r = await apiFetch<Payload>(`/api/me/sops?${qs}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setPayload(r.data);
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("sops");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !typing)) {
        e.preventDefault(); setFilterOpen(true); setTimeout(() => searchRef.current?.focus(), 50);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [acking, setAcking] = useState<string | null>(null);
  const acknowledge = async (row: Row) => {
    setAcking(row.id);
    const r = await apiFetch(`/api/me/sops/${row.id}/ack`, { method: "POST", json: {} });
    setAcking(null);
    if (!r.ok) { toast(r.error || "Couldn't acknowledge", { tone: "danger" }); return; }
    void load();
    toast("Acknowledged", { onUndo: () => { void apiFetch(`/api/me/sops/${row.id}/ack`, { method: "DELETE" }).then((u) => { if (!u.ok) toast("Couldn't undo", { tone: "danger" }); void load(); }); } });
  };
  const [runFor, setRunFor] = useState<Row | null>(null);

  const rows = payload?.data ?? null;
  const columns = useMemo<TableColumn<Row>[]>(() => [
    { key: "name", label: "Name", title: true, width: "minmax(240px,2fr)", render: (r) => { const Icon = KIND_ICON[r.sop.kind]; return <span className="flex min-w-0 items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden /><span className="truncate">{r.sop.title || "Untitled SOP"}</span></span>; } },
    { key: "kind", label: "Kind", width: "120px", render: (r) => <span className="text-ink-2">{SOP_KIND_LABEL[r.sop.kind]}</span> },
    { key: "due", label: "Due", width: "120px", render: (r) => r.dueDate ? <span className={cn("tabular-nums", r.status === "OVERDUE" ? "text-danger-text" : "text-ink-2")} title={fmt.title(r.dueDate)}>{fmt.date(r.dueDate, "date")}</span> : <span className="text-ink-3">None</span> },
    { key: "mandatory", label: "Mandatory", width: "100px", render: (r) => (r.mandatory ? "Yes" : "") },
    { key: "status", label: "Status", width: "130px", render: (r) => <StatusChip color={STATUS_COLOR[r.status]} label={STATUS_LABEL[r.status]} disabled /> },
    {
      key: "progress", label: "Progress", width: "140px",
      render: (r) => {
        if (r.sop.kind === "checklist") {
          const total = r.stepsTotal;
          const done = r.run ? Math.round((r.run.progress / 100) * total) : r.stepsCompleted;
          if (total === 0) return <span className="text-ink-3">No steps</span>;
          if (r.sop.sectionCount <= 4 && total <= 4) return <Dots variant="quad-steps" done={done} total={total} label={`${done} of ${total} steps`} />;
          return <span className="tabular-nums text-ink-2">{done} of {total}</span>;
        }
        const step = r.status === "COMPLETED" ? 3 : r.status === "IN_PROGRESS" ? 2 : 1;
        return <Dots variant="quad-steps" done={step} total={3} label={`${step} of 3: Assigned, Opened, Acknowledged`} />;
      },
    },
    {
      key: "action", label: "", width: "150px", align: "end",
      render: (r) => {
        if (r.status === "COMPLETED") return null;
        if (r.sop.kind === "checklist") {
          if (r.run?.shareToken) return <ActionButton icon={Play} label="Continue run" busy={false} onClick={() => window.open(`/run/${r.run!.shareToken}`, "_blank", "noopener")} />;
          if (r.sop.status === "PUBLISHED") return <ActionButton icon={Play} label="Start run" busy={false} onClick={() => setRunFor(r)} />;
          return null;
        }
        return <ActionButton icon={Check} label="Acknowledge" busy={acking === r.id} onClick={() => void acknowledge(r)} />;
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [fmt, acking]);

  const summary = payload ? `${payload.summary.todo} to do · ${payload.summary.overdue} overdue · ${payload.summary.done} done` : null;
  const filteredEmpty = activeFilters > 0;
  const emptyNode = filteredEmpty
    ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, kind: null, mandatory: null, status: null, dueFrom: null, dueTo: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
    : view === "done" ? "Nothing done yet" : "Nothing to do. When someone assigns you a SOP it shows up here.";

  return (
    <>
      <Breadcrumb items={[{ label: "SOPs", href: "/sops" }, { label: "My SOPs" }]} />
      <OsPageHeader
        title="My SOPs"
        views={(["todo", "done", "all"] as View[]).map((v) => (
          <ViewTab key={v} label={VIEW_LABEL[v]} active={view === v} href={v === "todo" ? "/sops/my-sops" : `/sops/my-sops?view=${v}`} />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORTS.find((s) => s.key === sort)?.label, active: true },
          left: (
            <span className="relative">
              <Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort" selected={sort} onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label })) }]} width={220} />
            </span>
          ),
          menu: [{ label: mandatory ? "Show all" : "Show mandatory only", icon: SlidersHorizontal, onClick: () => setParams({ mandatory: mandatory ? null : "1" }) }],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="my SOPs" activeCount={activeFilters} onClearAll={() => setParams({ q: null, kind: null, mandatory: null, status: null, dueFrom: null, dueTo: null })}>
          <li className="pb-2"><SearchField inputRef={searchRef} value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search my SOPs" /></li>
          <FilterGroup label="Kind">
            {(["written", "steps", "checklist", "recording"] as SopKind[]).map((k) => <FilterRow key={k} label={SOP_KIND_LABEL[k]} checked={kind === k} onCheckedChange={(on) => setParams({ kind: on ? k : null })} />)}
          </FilterGroup>
          <FilterGroup label="Mandatory">
            <FilterRow label="Mandatory only" checked={mandatory} onCheckedChange={(on) => setParams({ mandatory: on ? "1" : null })} />
          </FilterGroup>
          <FilterGroup label="Due">
            <FilterRow label="Date range" checked={!!(dueFrom || dueTo)} onCheckedChange={(on) => { if (!on) setParams({ dueFrom: null, dueTo: null }); else setParams({ dueTo: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }); }}>
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={dueFrom ? dueFrom.slice(0, 10) : null} onChange={(v) => setParams({ dueFrom: v })} placeholder="Any" ariaLabel="From" className="min-w-0 flex-1" /></span>
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={dueTo ? dueTo.slice(0, 10) : null} onChange={(v) => setParams({ dueTo: v })} placeholder="Any" ariaLabel="To" className="min-w-0 flex-1" /></span>
              </div>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Status">
            {(["ASSIGNED", "IN_PROGRESS", "COMPLETED"] as Status[]).map((s) => <FilterRow key={s} label={STATUS_LABEL[s]} checked={status === s} onCheckedChange={(on) => setParams({ status: on ? s : null })} />)}
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {summary ? <p className="text-sm text-ink-2">{summary}</p> : <p className="text-sm text-ink-2">&nbsp;</p>}
          {loadError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load your SOPs" action={{ label: "Retry", onClick: () => void load() }} />
          ) : rows && rows.length === 0 && !filteredEmpty && view !== "done" ? (
            <OsEmptyView context="docs" title="Nothing to do" hint="When someone assigns you a SOP it shows up here." />
          ) : (
            <TableCard<Row>
              ariaLabel={VIEW_LABEL[view]}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/sops/${r.sop.id}`}
              empty={emptyNode}
              footer={payload ? { total: payload.total, noun: "SOPs", from: payload.total === 0 ? 0 : 1, to: payload.total } : undefined}
            />
          )}
        </div>
      </div>

      {runFor ? (
        <StartRunDialog open onClose={() => setRunFor(null)} sop={{ id: runFor.sop.id, title: runFor.sop.title }} defaultAssigneeId={boot.viewer.id} onStarted={(run) => { if (run.shareToken) window.open(`/run/${run.shareToken}`, "_blank", "noopener"); void load(); }} />
      ) : null}
    </>
  );
}

function ActionButton({ icon: Icon, label, busy, onClick }: { icon: typeof Check; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60">
      {busy ? <Dots variant="pending" /> : <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}
      {label}
    </button>
  );
}

function SearchField({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef: React.MutableRefObject<HTMLInputElement | null> }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return <input ref={inputRef} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); (e.currentTarget as HTMLInputElement).blur(); } }} placeholder={placeholder} aria-label={placeholder} className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />;
}
