"use client";

/* Marketing · Events — flexible event library.
 *
 * Type + format are both free-form strings on the EventBrief schema, so
 * teams can call them whatever they want (Conference / Webinar / Field /
 * "Customer dinner — Mumbai"). Cards group by type with format chip,
 * date range, location, registration progress bar, budget bar.
 *
 * GET  /api/marketing/events
 * POST /api/marketing/events  { name, type? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Search, MapPin, Users as UsersIcon, ExternalLink } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "PLANNING" | "PROMOTING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
type ApiEvent = {
  id: string; name: string; description?: string | null;
  type?: string | null; format?: string | null;
  startDate?: string | null; endDate?: string | null;
  location?: string | null;
  capacity?: number | null; registeredCount?: number | null; attendedCount?: number | null;
  budget?: number | string | null; spent?: number | string | null;
  status: Status; url?: string | null;
};

const STATUS_HUE: Record<Status, string> = {
  PLANNING: "var(--os-c-indigo)", PROMOTING: "var(--os-c-orange)",
  ACTIVE: "var(--os-c-green)", COMPLETED: "var(--os-c-teal)", CANCELLED: "var(--os-c-darkgray)",
};
const STATUS_LABEL: Record<Status, string> = {
  PLANNING: "Planning", PROMOTING: "Promoting", ACTIVE: "Active", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const FORMAT_HUE: Record<string, string> = {
  "In-person": "var(--os-c-orange)", "Virtual": "var(--os-c-blue)", "Hybrid": "var(--os-c-purple)",
};

function num(v?: number | string | null): number { if (v == null) return 0; return typeof v === "string" ? parseFloat(v) : v; }
function money(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n.toFixed(0)}`;
}
function fmtSpan(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const s = new Date(start);
  const sStr = s.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (!end) return sStr;
  const e = new Date(end);
  if (s.toDateString() === e.toDateString()) return sStr;
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function EventsLibrary() {
  const [items, setItems] = useState<ApiEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/events");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.events ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("marketing");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = window.prompt("Event name?")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/marketing/events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't add event"); }
  }

  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items ?? []) {
      const k = i.type ?? "Uncategorised";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (activeType) list = list.filter((i) => (i.type ?? "Uncategorised") === activeType);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        i.name.toLowerCase().includes(q) ||
        (i.location ?? "").toLowerCase().includes(q) ||
        (i.type ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, activeType, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiEvent[]>();
    for (const i of filtered) {
      const k = i.type ?? "Uncategorised";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const total = items?.length ?? 0;
  const upcoming = (items ?? []).filter((i) => i.startDate && new Date(i.startDate).getTime() >= Date.now() && i.status !== "CANCELLED").length;
  const totalSpend = (items ?? []).reduce((acc, i) => acc + num(i.spent), 0);

  return (
    <div className="lib">
      <header className="lib__head">
        <div className="lib__head-l">
          <div className="lib__icon" style={{ background: "linear-gradient(135deg, var(--os-c-orange), var(--os-c-pink))" }}><CalendarDays /></div>
          <div>
            <h1 className="lib__title">Events</h1>
            <div className="lib__sub">
              {items === null ? "Loading…" : `${total} event${total === 1 ? "" : "s"} · ${upcoming} upcoming · $${money(totalSpend)} spent YTD`}
            </div>
          </div>
        </div>
        <div className="lib__actions">
          <div className="lib__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search event, location, type…" />
          </div>
          <button type="button" className="lib__new" onClick={quickAdd}><Plus /> New event</button>
        </div>
      </header>

      {types.length > 0 && (
        <nav className="lib__types">
          <button type="button" className={!activeType ? "is-active" : ""} onClick={() => setActiveType(null)}>All <em>{total}</em></button>
          {types.map(([t, n]) => (
            <button key={t} type="button" className={activeType === t ? "is-active" : ""} onClick={() => setActiveType(t)}>
              {t} <em>{n}</em>
            </button>
          ))}
        </nav>
      )}

      {loadError ? (
        <div className="lib__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="lib__empty">
          <CalendarDays />
          <div>
            <h3>{search ? "Nothing matches that search." : "No events yet"}</h3>
            <p>Track conferences, webinars, customer dinners — any event your team runs. Type is free-text so call it whatever fits.</p>
          </div>
        </div>
      ) : (
        <div className="lib__sections">
          {grouped.map(([type, items]) => (
            <section key={type} className="lib__section">
              <header><h2>{type}</h2><span>{items.length}</span></header>
              <div className="lib__grid">
                {items.map((e) => {
                  const regPct = e.capacity && e.capacity > 0 ? Math.min(100, Math.round(((e.registeredCount ?? 0) / e.capacity) * 100)) : 0;
                  const spendPct = num(e.budget) > 0 ? Math.min(100, Math.round((num(e.spent) / num(e.budget)) * 100)) : 0;
                  return (
                    <article key={e.id} className="lib-card">
                      <header className="lib-card__head">
                        <h3>{e.name}</h3>
                        <span className="lib-card__status" style={{ background: STATUS_HUE[e.status] }}>{STATUS_LABEL[e.status]}</span>
                      </header>
                      <div className="lib-card__sub">
                        {e.format && <span className="lib-card__chip" style={{ background: FORMAT_HUE[e.format] ?? "var(--os-c-darkgray)", color: "white" }}>{e.format}</span>}
                        <span>· {fmtSpan(e.startDate, e.endDate)}</span>
                      </div>
                      {e.location && <div className="lib-card__loc"><MapPin /> {e.location}</div>}
                      {e.capacity != null && (
                        <div className="lib-card__bar-row">
                          <div className="lib-card__bar-label"><UsersIcon /> Registration</div>
                          <div className="lib-card__bar"><div className="lib-card__bar-fill" style={{ width: `${regPct}%` }} /></div>
                          <span>{e.registeredCount ?? 0} / {e.capacity}</span>
                        </div>
                      )}
                      {num(e.budget) > 0 && (
                        <div className="lib-card__bar-row">
                          <div className="lib-card__bar-label">Budget</div>
                          <div className="lib-card__bar"><div className={`lib-card__bar-fill ${spendPct >= 100 ? "is-over" : spendPct >= 80 ? "is-warn" : ""}`} style={{ width: `${spendPct}%` }} /></div>
                          <span>${money(num(e.spent))} / ${money(num(e.budget))}</span>
                        </div>
                      )}
                      {e.url && (
                        <footer className="lib-card__foot">
                          <a href={e.url} target="_blank" rel="noopener" className="lib-card__link"><ExternalLink /> Event page</a>
                        </footer>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
