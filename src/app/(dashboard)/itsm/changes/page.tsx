"use client";

/* ITSM · Changes — CAB-style change calendar + approval queue.
 *
 * "Changes" in ITIL = controlled production modifications (deploys,
 * config changes, maintenance windows). We surface ITSM tickets where
 * category === "Change" (or customFields.type === "CHANGE") in two
 * views joined on one page:
 *
 *   Left rail   — Awaiting CAB approval (status=OPEN/TRIAGED, with action buttons)
 *   Right pane  — Scheduled change window (next 14 days) on a vertical timeline,
 *                  each change pill on its planned day
 *
 * Reads:  GET /api/itsm/tickets
 * Writes: PATCH /api/itsm/tickets   (approve = status → IN_PROGRESS; reject = CANCELLED)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Repeat, Check, X, ShieldCheck, Calendar as CalendarIcon } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED";
type Prio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type ApiTicket = {
  id: string;
  title: string;
  description?: string | null;
  status: Status;
  priority: Prio;
  category?: string | null;
  dueAt?: string | null;
  requesterId?: string | null;
  assigneeId?: string | null;
  customFields?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

const MS_DAY = 86_400_000;
const PRIO_COLOR: Record<Prio, string> = {
  URGENT: "var(--os-c-red)", HIGH: "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)", LOW: "var(--os-c-darkgray)",
};

function isChange(t: ApiTicket): boolean {
  if ((t.category ?? "").toLowerCase().includes("change")) return true;
  const cf = t.customFields ?? {};
  const type = typeof cf.type === "string" ? cf.type.toLowerCase() : "";
  return type.includes("change");
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function ChangesPage() {
  const [tickets, setTickets] = useState<ApiTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/tickets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiTicket[] = data.tickets ?? data.data ?? (Array.isArray(data) ? data : []);
      setTickets(list.filter(isChange));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("itsm");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const pending = useMemo(() => (tickets ?? []).filter((t) => t.status === "OPEN" || t.status === "TRIAGED"), [tickets]);
  const scheduled = useMemo(() => (tickets ?? []).filter((t) => (t.status === "IN_PROGRESS" || t.status === "TRIAGED") && t.dueAt), [tickets]);

  const next14Days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return d;
  }), []);

  const byDay = useMemo(() => {
    const m = new Map<string, ApiTicket[]>();
    for (const t of scheduled) {
      if (!t.dueAt) continue;
      const k = new Date(t.dueAt).toISOString().slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [scheduled]);

  async function decide(id: string, decision: "approve" | "reject") {
    const newStatus: Status = decision === "approve" ? "IN_PROGRESS" : "CANCELLED";
    setTickets((prev) => prev?.map((t) => t.id === id ? { ...t, status: newStatus } : t) ?? prev);
    try {
      const res = await fetch("/api/itsm/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast(decision === "approve" ? "Change approved" : "Change rejected");
    } catch {
      toast("Couldn't save"); void load();
    }
  }

  const inProgressCount = (tickets ?? []).filter((t) => t.status === "IN_PROGRESS").length;
  const completedThisMonth = (tickets ?? []).filter((t) => (t.status === "RESOLVED" || t.status === "CLOSED") && new Date(t.updatedAt).getTime() > Date.now() - 30 * MS_DAY).length;

  return (
    <div className="changes">
      <header className="changes__head">
        <div className="changes__head-l">
          <div className="changes__icon"><Repeat /></div>
          <div>
            <h1 className="changes__title">Change requests</h1>
            <div className="changes__sub">
              {tickets === null ? "Loading…" : (
                <>{pending.length} awaiting CAB · {inProgressCount} in flight · {completedThisMonth} completed (30d)</>
              )}
            </div>
          </div>
        </div>
        <p className="changes__caption">
          Changes are ITSM tickets tagged with category &quot;Change&quot;. Approve from the left to schedule into the change window.
        </p>
      </header>

      {loadError ? (
        <div className="changes__error">Couldn&apos;t load: {loadError}</div>
      ) : tickets === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="changes__grid">
          {/* Approval queue */}
          <aside className="changes__col">
            <div className="changes__col-head">
              <ShieldCheck /> Awaiting CAB approval
              <span>{pending.length}</span>
            </div>
            {pending.length === 0 ? (
              <div className="changes__empty">No changes waiting on you. Inbox zero.</div>
            ) : (
              <div className="changes__queue">
                {pending.map((t) => (
                  <article key={t.id} className="change">
                    <header className="change__head">
                      <span className="change__prio" style={{ background: PRIO_COLOR[t.priority] }}>{t.priority[0]}</span>
                      <h4 className="change__title">{t.title}</h4>
                    </header>
                    {t.description ? (
                      <p className="change__desc">{t.description.slice(0, 140)}{t.description.length > 140 ? "…" : ""}</p>
                    ) : null}
                    <div className="change__meta">
                      <span>Filed {fmtDay(t.createdAt)}</span>
                      {t.dueAt ? <span>Window: {fmtDay(t.dueAt)}</span> : <span style={{ color: "var(--os-c-orange)" }}>No window set</span>}
                    </div>
                    <div className="change__actions">
                      <button type="button" className="change__btn change__btn--approve" onClick={() => decide(t.id, "approve")}>
                        <Check /> Approve
                      </button>
                      <button type="button" className="change__btn change__btn--reject" onClick={() => decide(t.id, "reject")}>
                        <X /> Reject
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>

          {/* Change window */}
          <section className="changes__col changes__col--wide">
            <div className="changes__col-head">
              <CalendarIcon /> Change window · next 14 days
              <span>{scheduled.length}</span>
            </div>
            <div className="changes__timeline">
              {next14Days.map((d) => {
                const k = d.toISOString().slice(0, 10);
                const items = byDay.get(k) ?? [];
                const dow = d.getDay();
                const isWeekend = dow === 0 || dow === 6;
                const isToday = d.getTime() === new Date(new Date().setHours(0, 0, 0, 0)).getTime();
                return (
                  <div key={k} className={`changes__day ${isWeekend ? "is-weekend" : ""} ${isToday ? "is-today" : ""}`}>
                    <div className="changes__day-label">
                      <span className="changes__day-dow">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                      <span className="changes__day-num">{d.getDate()}</span>
                      {isToday && <span className="changes__day-today">today</span>}
                    </div>
                    <div className="changes__day-items">
                      {items.length === 0 ? (
                        <span className="changes__day-empty">{isWeekend ? "weekend — change freeze" : "—"}</span>
                      ) : items.map((t) => (
                        <div key={t.id} className="changes__day-item" style={{ borderLeftColor: PRIO_COLOR[t.priority] }}>
                          <span className="changes__day-item-title">{t.title}</span>
                          <span className="changes__day-item-meta">{t.status.replace(/_/g, " ").toLowerCase()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
