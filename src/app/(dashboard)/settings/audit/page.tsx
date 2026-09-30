"use client";

// Workspace settings > Audit log (spec-settings-workspace `/settings/audit`,
// settings-architecture 5.12): what happened, who did it, what changed.
//
//   Tabs          All, Access, Security, Data, Settings: server-side type
//                 families (src/lib/audit-families.ts), never client state
//   Toolbar       a search field sent to the server as ?q= (debounced 300ms),
//                 Filter (Type from GET /api/audit/types, the whole set;
//                 Actor; Severity; Date range) and Sort (Newest, Oldest);
//                 the "..." square holds Export (CSV) and Retention settings
//   Table         Time, Actor ("WorkwrK Support", "API key", "System" when the
//                 actor is not a person), Event (the sentence), Target,
//                 Severity; server cursor pagination
//   Drawer        520px: the sentence, time, actor and acting-for, IP and
//                 user agent, the target, and the before and after values
//
// Export honours EVERY active filter, the actor included (?format=csv).
// No blue button: nothing is created here. The retention window is on
// Data > Retention & privacy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { OsToolbar } from "@/components/layout/os/page-header";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { ErrorState } from "@/components/ui/error-state";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";
import { Drawer } from "@/components/ui/drawer";
import { formatRelative } from "@/lib/format/date";
import { AUDIT_FAMILIES, AUDIT_FAMILY_LABELS, type AuditFamily } from "@/lib/audit-families";

type AuditRow = {
  id: string;
  type: string;
  description: string;
  summary: string | null;
  targetType: string | null;
  targetId: string | null;
  severity: "info" | "warning" | "critical" | string;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actorType: string;
  actorLabel: string | null;
  actingForId: string | null;
  actorName: string;
  actor: { id: string; firstName: string | null; lastName: string | null; email: string | null; avatar?: string | null } | null;
};

const TABS: SettingsTab[] = AUDIT_FAMILIES.map((f) => ({ key: f, label: AUDIT_FAMILY_LABELS[f] }));
const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];
const SEVERITIES = ["info", "warning", "critical"] as const;
const SEVERITY_LABEL: Record<string, string> = { info: "Info", warning: "Warning", critical: "Critical" };
const PAGE = 50;

export default function AuditLogPage() {
  return (
    <SettingsPage pageKey="audit" tabs={TABS} width="list">
      {(tab) => <AuditBody family={(tab as AuditFamily) ?? "all"} />}
    </SettingsPage>
  );
}

function AuditBody({ family }: { family: AuditFamily }) {
  const { toast } = useOsToast();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [allTypes, setAllTypes] = useState<{ type: string; count: number }[] | null>(null);
  const [actor, setActor] = useState<PickPerson | null>(null);
  const [actorOn, setActorOn] = useState(false);
  const [severity, setSeverity] = useState<string | null>(null);
  const [range, setRange] = useState<string | null>(null);
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = useCallback((cursor: string | null) => {
    const p = new URLSearchParams({ family, limit: String(PAGE), order });
    if (debounced) p.set("q", debounced);
    if (types.length) p.set("type", types.join(","));
    if (actorOn && actor) p.set("actor", actor.id);
    if (severity) p.set("severity", severity);
    if (range) p.set("range", range);
    if (cursor) p.set("cursor", cursor);
    return p;
  }, [family, order, debounced, types, actor, actorOn, severity, range]);

  const load = useCallback(async (cursor: string | null) => {
    const id = ++reqId.current;
    setRows(null);
    setError(null);
    const r = await apiFetch<{ items: AuditRow[]; total: number | null; nextCursor: string | null }>(`/api/audit?${params(cursor).toString()}`, { cache: "no-store" });
    if (id !== reqId.current) return;
    if (!r.ok) { setError(r.error); return; }
    setRows(r.data.items);
    if (typeof r.data.total === "number") setTotal(r.data.total);
    setNext(r.data.nextCursor);
  }, [params]);

  // Any filter change goes back to the first page.
  useEffect(() => {
    const t = setTimeout(() => { setPages([null]); setPageIdx(0); void load(null); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!filterOpen || allTypes) return;
    void apiFetch<{ types: { type: string; count: number }[] }>("/api/audit/types").then((r) => setAllTypes(r.ok ? r.data.types : []));
  }, [filterOpen, allTypes]);

  const activeCount = (types.length ? 1 : 0) + (actorOn && actor ? 1 : 0) + (severity ? 1 : 0) + (range ? 1 : 0);
  const clearAll = () => { setTypes([]); setActor(null); setActorOn(false); setSeverity(null); setRange(null); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const p = params(null);
      p.set("format", "csv");
      p.delete("limit");
      p.delete("cursor");
      const res = await fetch(`/api/audit?${p.toString()}`, { cache: "no-store" });
      if (!res.ok) { toast(res.status === 403 ? "You can't export the audit log." : "Couldn't export. Try again."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Audit log exported");
    } finally {
      setExporting(false);
    }
  };

  const columns: TableColumn<AuditRow>[] = useMemo(() => [
    { key: "time", label: "Time", width: "140px", render: (r) => <span className="tabular-nums" title={new Date(r.createdAt).toLocaleString()}>{formatRelative(r.createdAt)}</span> },
    { key: "actor", label: "Actor", width: "minmax(160px,0.8fr)", render: (r) => <ActorCell row={r} /> },
    { key: "event", label: "Event", title: true, width: "minmax(260px,2fr)", render: (r) => <span className="line-clamp-2">{r.summary ?? r.description}</span> },
    { key: "target", label: "Target", width: "minmax(120px,0.7fr)", hideBelow: 900, render: (r) => (r.targetType ? <span className="text-ink-2">{r.targetType}</span> : "·") },
    { key: "severity", label: "Severity", width: "110px", render: (r) => <SeverityChip severity={r.severity} /> },
  ], []);

  const from = rows && rows.length ? pageIdx * PAGE + 1 : 0;
  const to = rows ? pageIdx * PAGE + rows.length : 0;

  return (
    <div className="flex flex-col gap-2">
      <OsToolbar
        className="!px-0"
        left={
          <label className="flex h-9 w-[320px] max-w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
            <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" aria-label="Search events" className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none" />
            {q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" /></button> : null}
          </label>
        }
        filter={{ open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeCount }}
        sort={{ onClick: () => setOrder((o) => (o === "desc" ? "asc" : "desc")), label: order === "desc" ? "Newest first" : "Oldest first", active: order === "asc" }}
        menu={[
          { label: exporting ? "Exporting" : "Export (CSV)", onClick: () => { void exportCsv(); }, disabled: exporting },
          { label: "Retention settings", href: "/settings/data?tab=retention" },
        ]}
      />
      <div className="flex items-start gap-4">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="events" activeCount={activeCount} onClearAll={clearAll}>
          <ul className="flex flex-col">
            <FilterGroup label="Date range">
              {RANGES.map((r) => (
                <FilterRow key={r.value} label={r.label} checked={range === r.value} onCheckedChange={(on) => setRange(on ? r.value : null)} />
              ))}
            </FilterGroup>
            <FilterGroup label="Severity">
              {SEVERITIES.map((s) => (
                <FilterRow key={s} label={SEVERITY_LABEL[s]} checked={severity === s} onCheckedChange={(on) => setSeverity(on ? s : null)} />
              ))}
            </FilterGroup>
            <FilterGroup label="Actor">
              <FilterRow label="One person" checked={actorOn} onCheckedChange={(on) => { setActorOn(on); if (!on) setActor(null); }}>
                <PeoplePickerField ariaLabel="Actor" value={actor ? [actor.id] : []} people={actor ? [actor] : []} placeholder="Pick a person" onChange={(_i, picked) => setActor(picked[0] ?? null)} />
              </FilterRow>
            </FilterGroup>
            <FilterGroup label="Type">
              {allTypes === null ? (
                <li className="px-2 py-1 text-sm text-ink-2">Reading the event types</li>
              ) : allTypes.length === 0 ? (
                <li className="px-2 py-1 text-sm text-ink-2">No events yet</li>
              ) : (
                allTypes.map((t) => (
                  <FilterRow key={t.type} label={t.type} count={t.count} checked={types.includes(t.type)}
                    onCheckedChange={(on) => setTypes((cur) => (on ? [...cur, t.type] : cur.filter((x) => x !== t.type)))} />
                ))
              )}
            </FilterGroup>
          </ul>
        </FilterPanel>
        <div className="min-w-0 flex-1">
          {error ? (
            <ErrorState what="the audit log" hint={error} onRetry={() => { void load(pages[pageIdx]); }} />
          ) : (
            <TableCard
              ariaLabel="Audit log"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOpen(r)}
              empty={
                activeCount || debounced ? (
                  <span>No results · <button type="button" className="text-brand-deep hover:underline" onClick={() => { clearAll(); setQ(""); }}>Clear filters</button></span>
                ) : (
                  <span>No events yet</span>
                )
              }
              footer={{
                total,
                noun: "events",
                from,
                to,
                onPrev: pageIdx > 0 ? () => { const i = pageIdx - 1; setPageIdx(i); void load(pages[i]); } : undefined,
                onNext: next ? () => { const i = pageIdx + 1; setPages((p) => { const n = [...p]; n[i] = next; return n; }); setPageIdx(i); void load(next); } : undefined,
              }}
            />
          )}
        </div>
      </div>
      <p className="text-sm text-ink-2">
        Entries are kept as long as <Link href="/settings/data?tab=retention" className="font-medium text-brand-deep hover:underline">Retention &amp; privacy</Link> says.
      </p>
      <EventDrawer row={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function ActorCell({ row }: { row: AuditRow }) {
  const person = row.actor;
  const initials = person ? `${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase() || "?" : "";
  return (
    <span className="flex min-w-0 items-center gap-2">
      {person ? (
        person.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hover text-[10px] font-semibold text-ink-2" aria-hidden>{initials}</span>
        )
      ) : (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] font-semibold text-ink-2" aria-hidden>W</span>
      )}
      <span className="truncate">{row.actorName}</span>
    </span>
  );
}

/** The pale StatusChip shape on the semantic tokens (design-system 5.9). */
function SeverityChip({ severity }: { severity: string }) {
  const cls =
    severity === "critical"
      ? "bg-[var(--os-danger-bg)] text-danger-text"
      : severity === "warning"
        ? "bg-[var(--os-warning-bg)] text-warning-text"
        : "bg-hover text-ink-2";
  return (
    <span className={`inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium ${cls}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

function Diff({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const o = oldValue && typeof oldValue === "object" ? (oldValue as Record<string, unknown>) : {};
  const n = newValue && typeof newValue === "object" ? (newValue as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
  if (keys.length === 0) return null;
  const show = (v: unknown) => (v === undefined ? "·" : typeof v === "string" ? v : JSON.stringify(v));
  return (
    <div className="rounded-lg border border-line">
      <div className="grid grid-cols-3 gap-2 border-b border-line bg-hover px-3 py-2 text-sm font-medium text-ink-2">
        <span>Setting</span><span>Before</span><span>After</span>
      </div>
      {keys.map((k) => {
        const changed = JSON.stringify(o[k]) !== JSON.stringify(n[k]);
        return (
          <div key={k} className="grid grid-cols-3 gap-2 border-b border-line-soft px-3 py-2 text-sm last:border-b-0">
            <span className={changed ? "font-medium text-ink" : "text-ink-2"}>{k}</span>
            <span className="break-words text-ink-2">{show(o[k])}</span>
            <span className={`break-words ${changed ? "font-medium text-ink" : "text-ink-2"}`}>{show(n[k])}</span>
          </div>
        );
      })}
    </div>
  );
}

function EventDrawer({ row, onClose }: { row: AuditRow | null; onClose: () => void }) {
  const { toast } = useOsToast();
  if (!row) return null;
  const facts: [string, React.ReactNode][] = [
    ["Time", new Date(row.createdAt).toLocaleString()],
    ["Actor", `${row.actorName}${row.actor ? "" : row.actorType !== "user" ? ` (${row.actorType.replace(/_/g, " ")})` : ""}`],
    ...(row.actingForId ? ([["Acting for", row.actingForId]] as [string, string][]) : []),
    ["Event", row.type],
    ["Severity", SEVERITY_LABEL[row.severity] ?? row.severity],
    ...(row.targetType ? ([["Target", `${row.targetType}${row.targetId ? ` ${row.targetId}` : ""}`]] as [string, string][]) : []),
    ...(row.ipAddress ? ([["IP", row.ipAddress]] as [string, string][]) : []),
    ...(row.userAgent ? ([["Browser", row.userAgent]] as [string, string][]) : []),
  ];
  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      layerId="audit-drawer"
      ariaLabel="Audit event"
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">Event</span>
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </>
      }
      footer={
        <div className="flex justify-end px-4 py-3">
          <button type="button" className="inline-flex h-8 items-center rounded-lg px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink"
            onClick={() => { void navigator.clipboard?.writeText(row.id).then(() => toast("Event ID copied")); }}>
            Copy event ID
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-lg font-semibold text-ink">{row.summary ?? row.description}</h2>
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-base">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-2">{k}</dt>
              <dd className="min-w-0 break-words text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <Diff oldValue={row.oldValue} newValue={row.newValue} />
      </div>
    </Drawer>
  );
}
