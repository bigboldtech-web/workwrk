"use client";

/* ITSM · Tickets — unified queue with multi-axis filtering.
 *
 *  GET   /api/itsm/tickets
 *  POST  /api/itsm/tickets   { title, priority? }
 *  PATCH /api/itsm/tickets   { id, status?, priority? }
 *
 * Layout:
 *   OsTitleBar with nav + New ticket in actions.
 *   Filter toolbar: search + status chips + priority chips + category chips + sort.
 *   Bespoke compact rows: priority pill + title/status/category/source +
 *     assignee avatar + due chip (color-coded) + age + hover-reveal actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Ticket, Plus, Search, ArrowLeft, CheckCircle2, UserCheck,
  Flag, Activity, Tag, ChevronDown,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ItsmStatus = "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED";
type ItsmPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL";

type ApiTicket = {
  id: string;
  title: string;
  status: ItsmStatus;
  priority: ItsmPrio;
  category?: string | null;
  source?: string | null;
  assigneeId?: string | null;
  slaTier?: string | null;
  dueAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABELS: Record<ItsmStatus, string> = {
  OPEN: "Open", TRIAGED: "Triaged", IN_PROGRESS: "In progress",
  WAITING_ON_USER: "Waiting · user", WAITING_ON_VENDOR: "Waiting · vendor",
  RESOLVED: "Resolved", CLOSED: "Closed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<ItsmStatus, string> = {
  OPEN: C.indigo, TRIAGED: C.yellow, IN_PROGRESS: C.orange,
  WAITING_ON_USER: C.purple, WAITING_ON_VENDOR: C.brown,
  RESOLVED: C.sage, CLOSED: C.green, CANCELLED: C.gray,
};
const STATUS_ORDER: ItsmStatus[] = ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ON_USER", "WAITING_ON_VENDOR", "RESOLVED"];

const PRIO_LABELS: Record<ItsmPrio, string> = {
  CRITICAL: "P0 · Critical", URGENT: "P1 · Urgent", HIGH: "P2 · High",
  NORMAL: "P3 · Normal", LOW: "P4 · Low",
};
const PRIO_SHORT: Record<ItsmPrio, string> = {
  CRITICAL: "P0", URGENT: "P1", HIGH: "P2", NORMAL: "P3", LOW: "P4",
};
const PRIO_COLORS: Record<ItsmPrio, string> = {
  CRITICAL: C.pink, URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.sage,
};
const PRIO_ORDER: ItsmPrio[] = ["CRITICAL", "URGENT", "HIGH", "NORMAL", "LOW"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function avInitials(s: string) { return s.slice(0, 2).toUpperCase(); }

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
function dueChip(iso?: string | null): { label: string; tone: "good" | "warn" | "bad" | "muted" } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const h = ms / 3_600_000;
  if (h < 0) return { label: `${Math.ceil(-h)}h late`, tone: "bad" };
  if (h < 1) return { label: `${Math.ceil(h * 60)}m left`, tone: "bad" };
  if (h < 4) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  if (h < 24) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  const d = Math.floor(h / 24);
  return { label: `${d}d left`, tone: d < 3 ? "good" : "muted" };
}

function isOpen(t: ApiTicket): boolean {
  return t.status !== "RESOLVED" && t.status !== "CLOSED" && t.status !== "CANCELLED";
}

type SortKey = "urgency" | "due" | "recent" | "created";

export default function ItsmTicketsPage() {
  const [tickets, setTickets] = useState<ApiTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Multi-select filters
  const [statusFilter, setStatusFilter] = useState<Set<ItsmStatus>>(new Set());
  const [prioFilter, setPrioFilter] = useState<Set<ItsmPrio>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/tickets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTickets(data.tickets ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("itsm");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setTickets((prev) => prev?.map((t) => t.id === id ? { ...t, ...body } as ApiTicket : t) ?? prev);
    try {
      const res = await fetch("/api/itsm/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch {
      toast("Couldn't update");
      void load();
    }
  }

  async function newTicket() {
    try {
      const res = await fetch("/api/itsm/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled ticket", priority: "NORMAL" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Ticket created");
      void load();
    } catch { toast("Couldn't create ticket"); }
  }

  async function bulkAction(action: "resolve" | "claim") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => {
      if (action === "resolve") return patch(id, { status: "RESOLVED", resolvedAt: new Date().toISOString() });
      if (action === "claim") return patch(id, { assigneeId: "me" });
      return Promise.resolve();
    }));
    setSelected(new Set());
    toast(`${ids.length} ticket${ids.length === 1 ? "" : "s"} ${action === "resolve" ? "resolved" : "claimed"}`);
  }

  // ─── Derive filter axes ────────────────────────────────────
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of tickets ?? []) if (t.category) set.add(t.category);
    return Array.from(set).sort();
  }, [tickets]);

  // ─── Filter + sort ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = tickets ?? [];
    if (!showResolved) list = list.filter(isOpen);
    if (statusFilter.size > 0) list = list.filter((t) => statusFilter.has(t.status));
    if (prioFilter.size > 0) list = list.filter((t) => prioFilter.has(t.priority));
    if (categoryFilter.size > 0) list = list.filter((t) => t.category && categoryFilter.has(t.category));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.category ?? "").toLowerCase().includes(q) ||
        (t.assigneeId ?? "").toLowerCase().includes(q));
    }
    const sorted = list.slice();
    if (sortKey === "urgency") {
      sorted.sort((a, b) => {
        const pa = PRIO_ORDER.indexOf(a.priority);
        const pb = PRIO_ORDER.indexOf(b.priority);
        if (pa !== pb) return pa - pb;
        const due = (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity);
        return due;
      });
    } else if (sortKey === "due") {
      sorted.sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity));
    } else if (sortKey === "recent") {
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else if (sortKey === "created") {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [tickets, statusFilter, prioFilter, categoryFilter, query, sortKey, showResolved]);

  const counts = useMemo(() => {
    const list = tickets ?? [];
    const openList = list.filter(isOpen);
    const byStatus: Record<ItsmStatus, number> = {
      OPEN: 0, TRIAGED: 0, IN_PROGRESS: 0, WAITING_ON_USER: 0, WAITING_ON_VENDOR: 0,
      RESOLVED: 0, CLOSED: 0, CANCELLED: 0,
    };
    const byPrio: Record<ItsmPrio, number> = { CRITICAL: 0, URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
    const byCategory = new Map<string, number>();
    for (const t of openList) {
      byStatus[t.status]++;
      byPrio[t.priority]++;
      if (t.category) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
    }
    return { total: list.length, open: openList.length, byStatus, byPrio, byCategory };
  }, [tickets]);

  function toggleStatusFilter(s: ItsmStatus) {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next);
  }
  function togglePrioFilter(p: ItsmPrio) {
    const next = new Set(prioFilter);
    next.has(p) ? next.delete(p) : next.add(p);
    setPrioFilter(next);
  }
  function toggleCategoryFilter(c: string) {
    const next = new Set(categoryFilter);
    next.has(c) ? next.delete(c) : next.add(c);
    setCategoryFilter(next);
  }
  function clearAllFilters() {
    setStatusFilter(new Set()); setPrioFilter(new Set()); setCategoryFilter(new Set()); setQuery(""); setShowResolved(false);
  }
  const hasActiveFilter = statusFilter.size > 0 || prioFilter.size > 0 || categoryFilter.size > 0 || query.trim() !== "" || showResolved;

  function toggleSelected(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }
  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((t) => t.id)));
  }

  return (
    <>
      <OsTitleBar
        title="Tickets"
        Icon={Ticket}
        iconGradient={GRAD.bluePurple}
        description={tickets === null
          ? "Loading tickets…"
          : `${counts.open} open · ${counts.total} total · ${counts.byPrio.CRITICAL + counts.byPrio.URGENT} P0/P1`}
        people={[PEOPLE.ak, PEOPLE.vn, PEOPLE.rj]}
        morePeople={4}
        actions={
          <div className="tckl__head-actions">
            <button type="button" className="tckl__back" onClick={() => history.back()}>
              <ArrowLeft /> Service desk
            </button>
            <Link href="/itsm/incidents" className="tckl__nav-link">Incidents</Link>
            <Link href="/itsm/kb" className="tckl__nav-link">KB</Link>
            <button type="button" className="tckl__btn-primary" onClick={newTicket}>
              <Plus /> New ticket
            </button>
          </div>
        }
      />

      <div className="tckl">
        {/* Filter toolbar */}
        <div className="tckl__toolbar">
          <div className="tckl__search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, category, assignee…"
              aria-label="Search tickets"
            />
          </div>

          <div className="tckl__filter-group">
            <span className="tckl__filter-label"><Flag /> Priority</span>
            <div className="tckl__chips">
              {PRIO_ORDER.map((p) => (
                <FilterChip
                  key={p}
                  label={PRIO_SHORT[p]}
                  count={counts.byPrio[p]}
                  color={PRIO_COLORS[p]}
                  active={prioFilter.has(p)}
                  onClick={() => togglePrioFilter(p)}
                />
              ))}
            </div>
          </div>

          <div className="tckl__filter-group">
            <span className="tckl__filter-label"><Activity /> Status</span>
            <div className="tckl__chips">
              {STATUS_ORDER.map((s) => (
                <FilterChip
                  key={s}
                  label={STATUS_LABELS[s]}
                  count={counts.byStatus[s]}
                  color={STATUS_COLORS[s]}
                  active={statusFilter.has(s)}
                  onClick={() => toggleStatusFilter(s)}
                />
              ))}
            </div>
          </div>

          {allCategories.length > 0 && (
            <div className="tckl__filter-group">
              <span className="tckl__filter-label"><Tag /> Category</span>
              <div className="tckl__chips">
                {allCategories.slice(0, 8).map((cat) => (
                  <FilterChip
                    key={cat}
                    label={cat}
                    count={counts.byCategory.get(cat) ?? 0}
                    color={C.indigo}
                    active={categoryFilter.has(cat)}
                    onClick={() => toggleCategoryFilter(cat)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="tckl__toolbar-right">
            <label className="tckl__resolved-toggle">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              <span>Show resolved</span>
            </label>
            <div className="tckl__sort">
              <span>Sort</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="tckl__sort-select">
                <option value="urgency">Urgency</option>
                <option value="due">Due date</option>
                <option value="recent">Recently updated</option>
                <option value="created">Newest</option>
              </select>
              <ChevronDown />
            </div>
            {hasActiveFilter && (
              <button type="button" className="tckl__clear" onClick={clearAllFilters}>Clear</button>
            )}
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="tckl__bulk">
            <span className="tckl__bulk-count">{selected.size} selected</span>
            <button type="button" onClick={() => bulkAction("claim")}>
              <UserCheck /> Claim
            </button>
            <button type="button" className="tckl__bulk-win" onClick={() => bulkAction("resolve")}>
              <CheckCircle2 /> Resolve
            </button>
            <button type="button" className="tckl__bulk-clear" onClick={() => setSelected(new Set())}>Cancel</button>
          </div>
        )}

        {/* List */}
        {loadError ? (
          <OsEmptyView Icon={Ticket} iconGradient={GRAD.redPink} title="Couldn't load tickets" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : tickets === null ? (
          <div className="tckl__loading">Loading tickets…</div>
        ) : counts.total === 0 ? (
          <OsEmptyView
            Icon={Ticket}
            iconGradient={GRAD.bluePurple}
            title="No tickets yet"
            subtitle="Tickets cover requests, incidents, and changes. File the first one to start the queue."
            cta="New ticket"
          />
        ) : filtered.length === 0 ? (
          <div className="tckl__empty">
            <Search />
            <div>No tickets match these filters.</div>
            <button type="button" className="tckl__empty-reset" onClick={clearAllFilters}>Clear filters</button>
          </div>
        ) : (
          <>
            <div className="tckl__head-row">
              <label className="tckl__check-all">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length; }}
                  onChange={toggleSelectAll}
                />
                <span>{filtered.length} ticket{filtered.length === 1 ? "" : "s"}</span>
              </label>
            </div>
            <div className="tckl__list">
              {filtered.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  selected={selected.has(t.id)}
                  onToggleSelect={() => toggleSelected(t.id)}
                  onResolve={() => patch(t.id, { status: "RESOLVED", resolvedAt: new Date().toISOString() })}
                  onClaim={() => patch(t.id, { assigneeId: "me" })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function TicketRow({ ticket: t, selected, onToggleSelect, onResolve, onClaim }: { ticket: ApiTicket; selected: boolean; onToggleSelect: () => void; onResolve: () => void; onClaim: () => void }) {
  const prioColor = PRIO_COLORS[t.priority];
  const statusColor = STATUS_COLORS[t.status];
  const due = dueChip(t.dueAt);
  const av = t.assigneeId ? { initials: avInitials(t.assigneeId), color: avColor(t.assigneeId) } : null;

  return (
    <article className={`tckl__row${selected ? " is-selected" : ""}${due?.tone === "bad" ? " is-breached" : ""}`}>
      <label className="tckl__row-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </label>

      <span
        className="tckl__row-prio"
        style={{ ["--p-c" as unknown as string]: prioColor }}
        title={PRIO_LABELS[t.priority]}
      >
        {PRIO_SHORT[t.priority]}
      </span>

      <Link href={`/itsm/${t.id}`} className="tckl__row-main">
        <div className="tckl__row-title">{t.title}</div>
        <div className="tckl__row-meta">
          <span
            className="tckl__row-status"
            style={{ ["--s-c" as unknown as string]: statusColor }}
          >
            {STATUS_LABELS[t.status]}
          </span>
          {t.category && <span className="tckl__row-cat">{t.category}</span>}
          {t.source && <span className="tckl__row-source">via {t.source.toLowerCase()}</span>}
        </div>
      </Link>

      {due && <span className={`tckl__row-due tckl__row-due--${due.tone}`}>{due.label}</span>}

      <span className="tckl__row-age" title={new Date(t.createdAt).toLocaleString()}>
        {fmtRelative(t.createdAt)}
      </span>

      {av ? (
        <span className="tckl__row-av" style={{ background: av.color }}>{av.initials}</span>
      ) : (
        <span className="tckl__row-unassigned" title="Unassigned">—</span>
      )}

      <div className="tckl__row-actions">
        {!t.assigneeId && (
          <button type="button" className="tckl__row-act" onClick={onClaim} title="Claim">
            <UserCheck />
          </button>
        )}
        {t.status !== "RESOLVED" && t.status !== "CLOSED" && (
          <button type="button" className="tckl__row-act tckl__row-act--win" onClick={onResolve} title="Resolve">
            <CheckCircle2 />
          </button>
        )}
      </div>
    </article>
  );
}

function FilterChip({ label, count, color, active, onClick }: { label: string; count: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`tckl__chip${active ? " is-active" : ""}`}
      style={{ ["--chip-c" as unknown as string]: color }}
      onClick={onClick}
    >
      <span className="tckl__chip-dot" />
      {label}
      <span className="tckl__chip-count">{count}</span>
    </button>
  );
}
