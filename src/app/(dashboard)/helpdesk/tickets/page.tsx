"use client";

/* Helpdesk · Tickets — agent queue list (companion to /helpdesk/[id]).
 *
 *  GET   /api/helpdesk/tickets
 *  PATCH /api/helpdesk/tickets   { id, status?, priority?, assigneeId? }
 *  GET   /api/me                 (for "Mine" filter)
 *
 * Layout:
 *   OsTitleBar with back-to-Helpdesk + nav.
 *   View tabs (All / Mine / Unassigned) + status chips + channel chips + sort.
 *   Bulk action bar when rows selected.
 *   Bespoke rows: priority pill + channel icon + subject + customer + status + due + assignee.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LifeBuoy, ArrowLeft, Search, ChevronDown, UserCheck, CheckCircle2,
  Mail, MessageCircle, Globe, Phone, Bot, Flag, Activity,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "NEW" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_INTERNAL" | "RESOLVED" | "CLOSED" | "SPAM";
type Prio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type ApiCustomer = { id: string; name?: string | null; email: string; companyName?: string | null };
type ApiTicket = {
  id: string;
  subject: string;
  body?: string | null;
  status: Status;
  priority: Prio;
  channel?: string | null;
  category?: string | null;
  assigneeId?: string | null;
  slaTier?: string | null;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  customer?: ApiCustomer | null;
};

const STATUS_LABELS: Record<Status, string> = {
  NEW: "New", OPEN: "Open", PENDING_CUSTOMER: "Pending · customer",
  PENDING_INTERNAL: "Pending · internal", RESOLVED: "Resolved", CLOSED: "Closed", SPAM: "Spam",
};
const STATUS_COLORS: Record<Status, string> = {
  NEW: C.indigo, OPEN: C.orange, PENDING_CUSTOMER: C.purple,
  PENDING_INTERNAL: C.brown, RESOLVED: C.sage, CLOSED: C.green, SPAM: C.gray,
};
const STATUS_ORDER: Status[] = ["NEW", "OPEN", "PENDING_CUSTOMER", "PENDING_INTERNAL", "RESOLVED"];

const PRIO_LABELS: Record<Prio, string> = { URGENT: "Urgent", HIGH: "High", NORMAL: "Normal", LOW: "Low" };
const PRIO_SHORT: Record<Prio, string> = { URGENT: "P1", HIGH: "P2", NORMAL: "P3", LOW: "P4" };
const PRIO_COLORS: Record<Prio, string> = { URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.sage };
const PRIO_ORDER: Prio[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

const CHANNEL_META: Record<string, { Icon: typeof Mail; color: string }> = {
  email: { Icon: Mail, color: C.blue },
  chat: { Icon: MessageCircle, color: C.purple },
  portal: { Icon: Globe, color: C.green },
  phone: { Icon: Phone, color: C.orange },
  api: { Icon: Bot, color: C.gray },
};
function channelMeta(ch?: string | null): { Icon: typeof Mail; color: string; key: string } {
  const k = (ch ?? "email").toLowerCase();
  for (const key of Object.keys(CHANNEL_META)) {
    if (k.includes(key)) return { ...CHANNEL_META[key], key };
  }
  return { Icon: Mail, color: C.indigo, key: "other" };
}

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
function dueChip(iso?: string | null, answered?: boolean): { label: string; tone: "good" | "warn" | "bad" | "muted" } | null {
  if (!iso) return null;
  if (answered) return { label: "Answered", tone: "good" };
  const ms = new Date(iso).getTime() - Date.now();
  const h = ms / 3_600_000;
  if (h < 0) return { label: `${Math.ceil(-h)}h late`, tone: "bad" };
  if (h < 1) return { label: `${Math.ceil(h * 60)}m left`, tone: "bad" };
  if (h < 4) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  if (h < 24) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  const d = Math.floor(h / 24);
  return { label: `${d}d left`, tone: d < 3 ? "good" : "muted" };
}

function isActive(t: ApiTicket): boolean {
  return t.status !== "CLOSED" && t.status !== "SPAM";
}

type ViewKey = "all" | "mine" | "unassigned";
type SortKey = "urgency" | "due" | "recent" | "created";

export default function HelpdeskTicketsPage() {
  const [tickets, setTickets] = useState<ApiTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  const [view, setView] = useState<ViewKey>("all");
  const [statusFilter, setStatusFilter] = useState<Set<Status>>(new Set());
  const [prioFilter, setPrioFilter] = useState<Set<Prio>>(new Set());
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [tRes, meRes] = await Promise.all([fetch("/api/helpdesk/tickets"), fetch("/api/me")]);
      if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
      const data = await tRes.json();
      setTickets(data.tickets ?? data.data ?? (Array.isArray(data) ? data : []));
      if (meRes.ok) { const me = await meRes.json(); setMeId(me?.user?.id ?? null); }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("helpdesk");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setTickets((prev) => prev?.map((t) => t.id === id ? { ...t, ...body } as ApiTicket : t) ?? prev);
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't save"); void load(); }
  }

  async function bulkAction(action: "claim" | "resolve") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => {
      if (action === "claim") return patch(id, { assigneeId: meId });
      if (action === "resolve") return patch(id, { status: "RESOLVED", resolvedAt: new Date().toISOString() });
      return Promise.resolve();
    }));
    setSelected(new Set());
    toast(`${ids.length} ticket${ids.length === 1 ? "" : "s"} ${action === "claim" ? "claimed" : "resolved"}`);
  }

  // ─── Derived ───────────────────────────────────────────────
  const allChannels = useMemo(() => {
    const set = new Set<string>();
    for (const t of tickets ?? []) {
      const k = channelMeta(t.channel).key;
      set.add(k);
    }
    return Array.from(set);
  }, [tickets]);

  // ─── Filter + sort ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = tickets ?? [];
    if (!showResolved) list = list.filter(isActive);
    if (view === "mine") list = list.filter((t) => meId && t.assigneeId === meId);
    if (view === "unassigned") list = list.filter((t) => !t.assigneeId);
    if (statusFilter.size > 0) list = list.filter((t) => statusFilter.has(t.status));
    if (prioFilter.size > 0) list = list.filter((t) => prioFilter.has(t.priority));
    if (channelFilter.size > 0) list = list.filter((t) => channelFilter.has(channelMeta(t.channel).key));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        t.subject.toLowerCase().includes(q) ||
        (t.customer?.name ?? "").toLowerCase().includes(q) ||
        (t.customer?.email ?? "").toLowerCase().includes(q) ||
        (t.customer?.companyName ?? "").toLowerCase().includes(q));
    }
    const sorted = list.slice();
    if (sortKey === "urgency") {
      sorted.sort((a, b) => {
        const pa = PRIO_ORDER.indexOf(a.priority);
        const pb = PRIO_ORDER.indexOf(b.priority);
        if (pa !== pb) return pa - pb;
        const ad = a.firstResponseDueAt ? new Date(a.firstResponseDueAt).getTime() : Infinity;
        const bd = b.firstResponseDueAt ? new Date(b.firstResponseDueAt).getTime() : Infinity;
        return ad - bd;
      });
    } else if (sortKey === "due") {
      sorted.sort((a, b) => (a.firstResponseDueAt ? new Date(a.firstResponseDueAt).getTime() : Infinity) - (b.firstResponseDueAt ? new Date(b.firstResponseDueAt).getTime() : Infinity));
    } else if (sortKey === "recent") {
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else if (sortKey === "created") {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [tickets, view, statusFilter, prioFilter, channelFilter, query, sortKey, showResolved, meId]);

  // ─── Counts ────────────────────────────────────────────────
  const counts = useMemo(() => {
    const list = tickets ?? [];
    const activeList = list.filter(isActive);
    const byStatus: Record<Status, number> = {
      NEW: 0, OPEN: 0, PENDING_CUSTOMER: 0, PENDING_INTERNAL: 0,
      RESOLVED: 0, CLOSED: 0, SPAM: 0,
    };
    const byPrio: Record<Prio, number> = { URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
    const byChan = new Map<string, number>();
    for (const t of activeList) {
      byStatus[t.status]++;
      byPrio[t.priority]++;
      const ch = channelMeta(t.channel).key;
      byChan.set(ch, (byChan.get(ch) ?? 0) + 1);
    }
    return {
      total: list.length,
      active: activeList.length,
      mine: meId ? activeList.filter((t) => t.assigneeId === meId).length : 0,
      unassigned: activeList.filter((t) => !t.assigneeId).length,
      byStatus, byPrio, byChan,
    };
  }, [tickets, meId]);

  function toggleStatusFilter(s: Status) {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next);
  }
  function togglePrioFilter(p: Prio) {
    const next = new Set(prioFilter);
    next.has(p) ? next.delete(p) : next.add(p);
    setPrioFilter(next);
  }
  function toggleChannelFilter(c: string) {
    const next = new Set(channelFilter);
    next.has(c) ? next.delete(c) : next.add(c);
    setChannelFilter(next);
  }
  function clearAllFilters() {
    setStatusFilter(new Set()); setPrioFilter(new Set()); setChannelFilter(new Set());
    setQuery(""); setShowResolved(false); setView("all");
  }
  const hasActiveFilter = statusFilter.size > 0 || prioFilter.size > 0 || channelFilter.size > 0 || query.trim() !== "" || showResolved || view !== "all";

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
        title="Helpdesk · Tickets"
        Icon={LifeBuoy}
        iconGradient={GRAD.orangePink}
        description={tickets === null
          ? "Loading queue…"
          : `${counts.active} active · ${counts.unassigned} unassigned · ${counts.byPrio.URGENT} P1`}
        people={[PEOPLE.pr, PEOPLE.mk, PEOPLE.sc]}
        morePeople={5}
        actions={
          <div className="hdq__head-actions">
            <button type="button" className="hdq__back" onClick={() => history.back()}>
              <ArrowLeft /> Inbox
            </button>
            <Link href="/helpdesk/customers" className="hdq__nav-link">Customers</Link>
            <Link href="/helpdesk/macros" className="hdq__nav-link">Macros</Link>
          </div>
        }
      />

      <div className="hdq">
        {/* View tabs */}
        <div className="hdq__views">
          <button type="button" className={view === "all" ? "is-active" : ""} onClick={() => setView("all")}>
            All active <span>{counts.active}</span>
          </button>
          <button type="button" className={view === "mine" ? "is-active" : ""} onClick={() => setView("mine")} disabled={!meId}>
            Assigned to me <span>{counts.mine}</span>
          </button>
          <button type="button" className={`${view === "unassigned" ? "is-active" : ""} ${counts.unassigned > 0 ? "is-warn" : ""}`} onClick={() => setView("unassigned")}>
            Unassigned <span>{counts.unassigned}</span>
          </button>
        </div>

        {/* Toolbar */}
        <div className="hdq__toolbar">
          <div className="hdq__search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject, customer, email…"
              aria-label="Search tickets"
            />
          </div>

          <div className="hdq__filter-group">
            <span className="hdq__filter-label"><Flag /> Priority</span>
            <div className="hdq__chips">
              {PRIO_ORDER.map((p) => (
                <FilterChip key={p} label={PRIO_SHORT[p]} count={counts.byPrio[p]} color={PRIO_COLORS[p]} active={prioFilter.has(p)} onClick={() => togglePrioFilter(p)} />
              ))}
            </div>
          </div>

          <div className="hdq__filter-group">
            <span className="hdq__filter-label"><Activity /> Status</span>
            <div className="hdq__chips">
              {STATUS_ORDER.map((s) => (
                <FilterChip key={s} label={STATUS_LABELS[s]} count={counts.byStatus[s]} color={STATUS_COLORS[s]} active={statusFilter.has(s)} onClick={() => toggleStatusFilter(s)} />
              ))}
            </div>
          </div>

          {allChannels.length > 0 && (
            <div className="hdq__filter-group">
              <span className="hdq__filter-label"><Mail /> Channel</span>
              <div className="hdq__chips">
                {allChannels.map((ch) => {
                  const meta = channelMeta(ch);
                  return (
                    <FilterChip
                      key={ch}
                      label={ch}
                      count={counts.byChan.get(ch) ?? 0}
                      color={meta.color}
                      active={channelFilter.has(ch)}
                      onClick={() => toggleChannelFilter(ch)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="hdq__toolbar-right">
            <label className="hdq__resolved-toggle">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              <span>Show resolved/closed</span>
            </label>
            <div className="hdq__sort">
              <span>Sort</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="hdq__sort-select">
                <option value="urgency">Urgency</option>
                <option value="due">1st reply due</option>
                <option value="recent">Recently updated</option>
                <option value="created">Newest</option>
              </select>
              <ChevronDown />
            </div>
            {hasActiveFilter && (
              <button type="button" className="hdq__clear" onClick={clearAllFilters}>Clear</button>
            )}
          </div>
        </div>

        {/* Bulk bar */}
        {selected.size > 0 && (
          <div className="hdq__bulk">
            <span className="hdq__bulk-count">{selected.size} selected</span>
            <button type="button" onClick={() => bulkAction("claim")} disabled={!meId}>
              <UserCheck /> Claim
            </button>
            <button type="button" className="hdq__bulk-win" onClick={() => bulkAction("resolve")}>
              <CheckCircle2 /> Resolve
            </button>
            <button type="button" className="hdq__bulk-clear" onClick={() => setSelected(new Set())}>Cancel</button>
          </div>
        )}

        {/* List */}
        {loadError ? (
          <OsEmptyView Icon={LifeBuoy} iconGradient={GRAD.redPink} title="Couldn't load tickets" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : tickets === null ? (
          <div className="hdq__loading">Loading queue…</div>
        ) : counts.total === 0 ? (
          <OsEmptyView
            Icon={LifeBuoy}
            iconGradient={GRAD.orangePink}
            title="Inbox zero"
            subtitle="Helpdesk tickets arrive automatically from email forwarding, customer portal, chat widget, or API."
            chips={["Email", "Portal", "Chat", "Phone"]}
            cta="Set up email forwarding"
          />
        ) : filtered.length === 0 ? (
          <div className="hdq__empty">
            <Search />
            <div>No tickets match these filters.</div>
            <button type="button" className="hdq__empty-reset" onClick={clearAllFilters}>Clear filters</button>
          </div>
        ) : (
          <>
            <div className="hdq__head-row">
              <label className="hdq__check-all">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length; }}
                  onChange={toggleSelectAll}
                />
                <span>{filtered.length} ticket{filtered.length === 1 ? "" : "s"}</span>
              </label>
            </div>
            <div className="hdq__list">
              {filtered.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  selected={selected.has(t.id)}
                  canClaim={!!meId && !t.assigneeId}
                  onToggleSelect={() => toggleSelected(t.id)}
                  onClaim={() => meId && patch(t.id, { assigneeId: meId })}
                  onResolve={() => patch(t.id, { status: "RESOLVED", resolvedAt: new Date().toISOString() })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function TicketRow({ ticket: t, selected, canClaim, onToggleSelect, onClaim, onResolve }: { ticket: ApiTicket; selected: boolean; canClaim: boolean; onToggleSelect: () => void; onClaim: () => void; onResolve: () => void }) {
  const prioColor = PRIO_COLORS[t.priority];
  const statusColor = STATUS_COLORS[t.status];
  const ch = channelMeta(t.channel);
  const ChIcon = ch.Icon;
  const due = dueChip(t.firstResponseDueAt, !!t.firstResponseAt);
  const av = t.assigneeId ? { initials: avInitials(t.assigneeId), color: avColor(t.assigneeId) } : null;
  const breached = !!due && due.tone === "bad" && !t.firstResponseAt;
  const custLabel = t.customer?.companyName || t.customer?.name || t.customer?.email || "—";

  return (
    <article className={`hdq__row${selected ? " is-selected" : ""}${breached ? " is-breached" : ""}`}>
      <label className="hdq__row-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </label>

      <span
        className="hdq__row-prio"
        style={{ ["--p-c" as unknown as string]: prioColor }}
        title={PRIO_LABELS[t.priority]}
      >
        {PRIO_SHORT[t.priority]}
      </span>

      <span className="hdq__row-chan" style={{ ["--ch-c" as unknown as string]: ch.color }} title={ch.key}>
        <ChIcon />
      </span>

      <Link href={`/helpdesk/${t.id}`} className="hdq__row-main">
        <div className="hdq__row-subject">{t.subject}</div>
        <div className="hdq__row-meta">
          <span className="hdq__row-cust">{custLabel}</span>
          <span
            className="hdq__row-status"
            style={{ ["--s-c" as unknown as string]: statusColor }}
          >
            {STATUS_LABELS[t.status]}
          </span>
          {t.category && <span className="hdq__row-cat">{t.category}</span>}
        </div>
      </Link>

      {due && <span className={`hdq__row-due hdq__row-due--${due.tone}`}>{due.label}</span>}

      <span className="hdq__row-age" title={new Date(t.createdAt).toLocaleString()}>
        {fmtRelative(t.updatedAt)}
      </span>

      {av ? (
        <span className="hdq__row-av" style={{ background: av.color }}>{av.initials}</span>
      ) : (
        <span className="hdq__row-unassigned" title="Unassigned">—</span>
      )}

      <div className="hdq__row-actions">
        {canClaim && (
          <button type="button" className="hdq__row-act" onClick={onClaim} title="Claim">
            <UserCheck />
          </button>
        )}
        {t.status !== "RESOLVED" && t.status !== "CLOSED" && (
          <button type="button" className="hdq__row-act hdq__row-act--win" onClick={onResolve} title="Resolve">
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
      className={`hdq__chip${active ? " is-active" : ""}`}
      style={{ ["--chip-c" as unknown as string]: color }}
      onClick={onClick}
    >
      <span className="hdq__chip-dot" />
      {label}
      <span className="hdq__chip-count">{count}</span>
    </button>
  );
}
