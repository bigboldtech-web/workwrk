"use client";

/* Helpdesk · Tickets — agent support queue.
 *
 * Three-pane layout designed for an agent working a queue:
 *   Left   — Filter rail: All / Mine / Unassigned + status filters
 *            with live counts; warn-tone for unassigned > 0.
 *   Middle — Ticket list with priority bar, subject, customer, age,
 *            status pill, channel icon.
 *   Right  — Selected-ticket detail with customer panel, original
 *            message body, take-ticket button + status/priority pickers.
 *
 * GET   /api/helpdesk/tickets
 * PATCH /api/helpdesk/tickets   { id, status?, priority?, assigneeId? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LifeBuoy, Mail, MessageSquare, Phone, Globe, Smartphone, User } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "NEW" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_INTERNAL" | "RESOLVED" | "CLOSED" | "SPAM";
type Prio = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type Channel = "EMAIL" | "CHAT" | "PHONE" | "PORTAL" | "SOCIAL" | "IN_APP";

type ApiCustomer = { id: string; name?: string | null; email: string; companyName?: string | null };
type ApiTicket = {
  id: string; subject: string; body?: string | null;
  status: Status; priority: Prio; channel: Channel;
  category?: string | null; assigneeId?: string | null; slaTier?: string | null;
  createdAt: string; updatedAt: string; resolvedAt?: string | null;
  customer?: ApiCustomer | null;
};

const STATUS_LABEL: Record<Status, string> = {
  NEW: "New", OPEN: "Open", PENDING_CUSTOMER: "Waiting on customer",
  PENDING_INTERNAL: "Waiting on us", RESOLVED: "Resolved", CLOSED: "Closed", SPAM: "Spam",
};
const STATUS_HUE: Record<Status, string> = {
  NEW: "var(--os-c-red)", OPEN: "var(--os-c-orange)",
  PENDING_CUSTOMER: "var(--os-c-blue)", PENDING_INTERNAL: "var(--os-c-purple)",
  RESOLVED: "var(--os-c-green)", CLOSED: "var(--os-c-darkgray)", SPAM: "var(--os-c-gray)",
};
const PRIO_HUE: Record<Prio, string> = {
  URGENT: "var(--os-c-red)", HIGH: "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)", LOW: "var(--os-c-darkgray)",
};
const CHANNEL_ICON: Record<Channel, React.ComponentType<{ className?: string }>> = {
  EMAIL: Mail, CHAT: MessageSquare, PHONE: Phone, PORTAL: Globe, SOCIAL: MessageSquare, IN_APP: Smartphone,
};

const MS_HOUR = 3_600_000;
function ageOf(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / MS_HOUR);
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return `${d}d`;
}

type FilterKey = "all" | "mine" | "unassigned" | Status;

export default function HelpdeskTicketsPage() {
  const [tickets, setTickets] = useState<ApiTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [tRes, meRes] = await Promise.all([fetch("/api/helpdesk/tickets"), fetch("/api/me")]);
      if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
      const data = await tRes.json();
      const list: ApiTicket[] = data.tickets ?? data.data ?? (Array.isArray(data) ? data : []);
      setTickets(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      if (meRes.ok) { const me = await meRes.json(); setMeId(me?.user?.id ?? null); }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("helpdesk");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const counts = useMemo(() => {
    const list = tickets ?? [];
    return {
      all: list.length,
      mine: meId ? list.filter((t) => t.assigneeId === meId).length : 0,
      unassigned: list.filter((t) => !t.assigneeId).length,
      NEW: list.filter((t) => t.status === "NEW").length,
      OPEN: list.filter((t) => t.status === "OPEN").length,
      PENDING_CUSTOMER: list.filter((t) => t.status === "PENDING_CUSTOMER").length,
      PENDING_INTERNAL: list.filter((t) => t.status === "PENDING_INTERNAL").length,
      RESOLVED: list.filter((t) => t.status === "RESOLVED").length,
    };
  }, [tickets, meId]);

  const filtered = useMemo(() => {
    const list = tickets ?? [];
    if (filter === "all") return list.filter((t) => t.status !== "CLOSED" && t.status !== "SPAM");
    if (filter === "mine") return list.filter((t) => t.assigneeId === meId);
    if (filter === "unassigned") return list.filter((t) => !t.assigneeId);
    return list.filter((t) => t.status === filter);
  }, [tickets, filter, meId]);

  const selected = (tickets ?? []).find((t) => t.id === selectedId) ?? null;

  async function patch(id: string, body: Record<string, unknown>) {
    setTickets((prev) => prev?.map((t) => t.id === id ? { ...t, ...body } as ApiTicket : t) ?? prev);
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't save"); void load(); }
  }
  async function takeTicket(id: string) { if (meId) await patch(id, { assigneeId: meId }); }

  return (
    <div className="hd">
      <header className="hd__head">
        <div className="hd__head-l">
          <div className="hd__icon"><LifeBuoy /></div>
          <div>
            <h1 className="hd__title">Helpdesk · Tickets</h1>
            <div className="hd__sub">
              {tickets === null ? "Loading…" : `${counts.all - counts.RESOLVED} open · ${counts.unassigned} unassigned · ${counts.NEW} new`}
            </div>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="hd__error">{loadError}</div>
      ) : tickets === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="hd__grid">
          <aside className="hd__rail">
            <nav className="hd__rail-section">
              <h3>Views</h3>
              <FilterBtn label="All active" count={counts.all - counts.RESOLVED} active={filter === "all"} onClick={() => setFilter("all")} />
              <FilterBtn label="Assigned to me" count={counts.mine} active={filter === "mine"} onClick={() => setFilter("mine")} />
              <FilterBtn label="Unassigned" count={counts.unassigned} active={filter === "unassigned"} onClick={() => setFilter("unassigned")} tone="warn" />
            </nav>
            <nav className="hd__rail-section">
              <h3>By status</h3>
              <FilterBtn label="New" count={counts.NEW} active={filter === "NEW"} onClick={() => setFilter("NEW")} dot={STATUS_HUE.NEW} />
              <FilterBtn label="Open" count={counts.OPEN} active={filter === "OPEN"} onClick={() => setFilter("OPEN")} dot={STATUS_HUE.OPEN} />
              <FilterBtn label="Waiting on customer" count={counts.PENDING_CUSTOMER} active={filter === "PENDING_CUSTOMER"} onClick={() => setFilter("PENDING_CUSTOMER")} dot={STATUS_HUE.PENDING_CUSTOMER} />
              <FilterBtn label="Waiting on us" count={counts.PENDING_INTERNAL} active={filter === "PENDING_INTERNAL"} onClick={() => setFilter("PENDING_INTERNAL")} dot={STATUS_HUE.PENDING_INTERNAL} />
              <FilterBtn label="Resolved" count={counts.RESOLVED} active={filter === "RESOLVED"} onClick={() => setFilter("RESOLVED")} dot={STATUS_HUE.RESOLVED} />
            </nav>
          </aside>

          <section className="hd__list">
            {filtered.length === 0 ? (
              <div className="hd__list-empty">No tickets match this view.</div>
            ) : filtered.map((t) => {
              const Channel = CHANNEL_ICON[t.channel] ?? Mail;
              const isSel = t.id === selectedId;
              return (
                <button
                  key={t.id} type="button"
                  className={`hd-item ${isSel ? "is-active" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="hd-item__bar" style={{ background: PRIO_HUE[t.priority] }} />
                  <div className="hd-item__main">
                    <div className="hd-item__subject">
                      <Channel className="hd-item__chan" />
                      <span>{t.subject}</span>
                    </div>
                    <div className="hd-item__meta">
                      <span>{t.customer?.name ?? t.customer?.email ?? "—"}</span>
                      {t.customer?.companyName && <span>· {t.customer.companyName}</span>}
                    </div>
                  </div>
                  <div className="hd-item__right">
                    <span className="hd-item__age">{ageOf(t.updatedAt)}</span>
                    <span className="hd-item__status" style={{ background: STATUS_HUE[t.status] }}>{STATUS_LABEL[t.status]}</span>
                  </div>
                </button>
              );
            })}
          </section>

          <section className="hd__detail">
            {!selected ? (
              <div className="hd__detail-empty">Select a ticket to view it.</div>
            ) : (
              <>
                <header className="hd-detail__head">
                  <div className="hd-detail__title-row">
                    {(() => { const Ch = CHANNEL_ICON[selected.channel] ?? Mail; return <Ch className="hd-detail__chan" />; })()}
                    <h2>{selected.subject}</h2>
                  </div>
                  <div className="hd-detail__pills">
                    <span className="hd-detail__pill" style={{ background: STATUS_HUE[selected.status] }}>{STATUS_LABEL[selected.status]}</span>
                    <span className="hd-detail__pill" style={{ background: PRIO_HUE[selected.priority] }}>{selected.priority}</span>
                    {selected.slaTier && <span className="hd-detail__pill hd-detail__pill--ghost">SLA {selected.slaTier}</span>}
                    {selected.category && <span className="hd-detail__pill hd-detail__pill--ghost">{selected.category}</span>}
                  </div>
                </header>

                <section className="hd-detail__customer">
                  <h3><User /> Customer</h3>
                  <div className="hd-detail__customer-name">{selected.customer?.name ?? "Unknown"}</div>
                  {selected.customer?.email && <a href={`mailto:${selected.customer.email}`}>{selected.customer.email}</a>}
                  {selected.customer?.companyName && <div className="hd-detail__customer-co">{selected.customer.companyName}</div>}
                </section>

                <section className="hd-detail__body">
                  <h3>Original message</h3>
                  <pre>{selected.body ?? <em style={{ color: "var(--os-ink-3)" }}>No body. (Created via UI / phone.)</em>}</pre>
                </section>

                <footer className="hd-detail__actions">
                  {!selected.assigneeId && (
                    <button type="button" className="hd-detail__btn hd-detail__btn--primary" onClick={() => takeTicket(selected.id)}>
                      Take this ticket
                    </button>
                  )}
                  <label className="hd-detail__field">
                    <span>Status</span>
                    <select value={selected.status} onChange={(e) => patch(selected.id, { status: e.target.value })}>
                      {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className="hd-detail__field">
                    <span>Priority</span>
                    <select value={selected.priority} onChange={(e) => patch(selected.id, { priority: e.target.value })}>
                      <option value="LOW">Low</option>
                      <option value="NORMAL">Normal</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </label>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function FilterBtn({ label, count, active, onClick, dot, tone }: { label: string; count: number; active: boolean; onClick: () => void; dot?: string; tone?: "warn" }) {
  return (
    <button type="button" className={`hd-flt ${active ? "is-active" : ""} ${tone === "warn" && count > 0 ? "is-warn" : ""}`} onClick={onClick}>
      {dot && <span className="hd-flt__dot" style={{ background: dot }} />}
      <span className="hd-flt__lbl">{label}</span>
      <span className="hd-flt__count">{count}</span>
    </button>
  );
}
