"use client";

/* Announcements — broadcast feed grouped by priority with KPI strip + ack tracking.
 *
 *  GET   /api/announcements
 *  POST  /api/announcements
 *  PATCH /api/announcements/[id]
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Megaphone, Plus, Search, Hash, ChevronRight, Pin, AlertTriangle, CheckCircle2,
  Info, PartyPopper, ShieldCheck, CalendarRange, Bell, Clock,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type AnnType = "INFO" | "WARNING" | "CELEBRATION" | "POLICY" | "EVENT";
type AnnPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type ApiAnn = {
  id: string;
  title: string;
  content: string;
  type: AnnType;
  priority: AnnPrio;
  pinned: boolean;
  mustAcknowledge: boolean;
  publishedAt?: string | null;
  expiresAt?: string | null;
  authorId: string;
  createdAt: string;
  ackedByMe?: boolean;
};

const TYPE_LABEL: Record<AnnType, string> = {
  INFO: "Info", WARNING: "Warning", CELEBRATION: "Celebration",
  POLICY: "Policy", EVENT: "Event",
};
const TYPE_HUE: Record<AnnType, string> = {
  INFO: C.blue, WARNING: C.red, CELEBRATION: C.pink, POLICY: C.purple, EVENT: C.orange,
};
const TYPE_ICON: Record<AnnType, typeof Info> = {
  INFO: Info, WARNING: AlertTriangle, CELEBRATION: PartyPopper,
  POLICY: ShieldCheck, EVENT: CalendarRange,
};

const PRIO_LABEL: Record<AnnPrio, string> = {
  LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent",
};
const PRIO_HUE: Record<AnnPrio, string> = {
  URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.teal,
};
const PRIO_ORDER: AnnPrio[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AnnouncementsPage() {
  const [rows, setRows] = useState<ApiAnn[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | AnnType>("ALL");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : (data.data ?? []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("announcements");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    try {
      const res = await fetch("/api/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled announcement",
          content: "Write the announcement…",
          type: "INFO",
          priority: "NORMAL",
        }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't post"); return; }
      toast("Announcement posted");
      void load();
    } catch { toast("Couldn't post"); }
  }

  async function ack(id: string) {
    try {
      const res = await fetch(`/api/announcements/${id}/ack`, {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) { toast("Couldn't acknowledge"); return; }
      toast("Acknowledged");
      void load();
    } catch { toast("Couldn't acknowledge"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<AnnType, number> = { INFO: 0, WARNING: 0, CELEBRATION: 0, POLICY: 0, EVENT: 0 };
    for (const a of list) counts[a.type] = (counts[a.type] ?? 0) + 1;
    const pinned = list.filter((a) => a.pinned).length;
    const ackPending = list.filter((a) => a.mustAcknowledge && !a.ackedByMe).length;
    const urgent = list.filter((a) => a.priority === "URGENT").length;
    return { total: list.length, counts, pinned, ackPending, urgent };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (typeFilter !== "ALL") list = list.filter((a) => a.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) =>
      a.title.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q));
    return list;
  }, [rows, search, typeFilter]);

  const pinned = filtered.filter((a) => a.pinned);
  const others = filtered.filter((a) => !a.pinned);

  const byPriority = useMemo(() => {
    const m = new Map<AnnPrio, ApiAnn[]>();
    for (const p of PRIO_ORDER) m.set(p, []);
    for (const a of others) m.get(a.priority)?.push(a);
    return PRIO_ORDER.map((p) => ({ prio: p, items: m.get(p) ?? [] })).filter((g) => g.items.length > 0);
  }, [others]);

  return (
    <>
      <OsTitleBar
        title="Announcements"
        Icon={Megaphone}
        iconGradient={GRAD.orangePink}
        description={rows === null ? "Loading…" : `${stats.total} announcement${stats.total === 1 ? "" : "s"}${stats.ackPending > 0 ? ` · ${stats.ackPending} need your ack` : ""}${stats.urgent > 0 ? ` · ${stats.urgent} urgent` : ""}`}
        actions={
          <div className="ann__head-actions">
            <Link href="/policies" className="ann__nav-link"><ShieldCheck /> Policies</Link>
            <button type="button" className="ann__btn-primary" onClick={quickAdd}>
              <Plus /> New announcement
            </button>
          </div>
        }
      />

      <div className="ann">
        <div className="ann__kpis">
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="Urgent"      value={`${stats.urgent}`}    sub="needs attention" />
          <KpiTile accent="var(--os-c-orange)" Icon={Bell}          label="Ack pending" value={`${stats.ackPending}`} sub="from you" />
          <KpiTile accent="var(--os-c-purple)" Icon={Pin}           label="Pinned"      value={`${stats.pinned}`}    sub="always on top" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Megaphone}     label="Total"       value={`${stats.total}`}     sub="org-wide" />
        </div>

        {stats.ackPending > 0 && (
          <div className="ann__banner">
            <Bell />
            <span><strong>{stats.ackPending} announcement{stats.ackPending === 1 ? "" : "s"}</strong> require your acknowledgment.</span>
          </div>
        )}

        <div className="ann__toolbar">
          <div className="ann__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, content…" />
          </div>
          <div className="ann__filters">
            {(["ALL", "INFO", "WARNING", "POLICY", "EVENT", "CELEBRATION"] as const).map((t) => {
              const Icon = t === "ALL" ? Hash : TYPE_ICON[t as AnnType];
              return (
                <button
                  key={t}
                  type="button"
                  className={`ann__filter${typeFilter === t ? " is-active" : ""}`}
                  style={t !== "ALL" ? { ["--f-c" as unknown as string]: TYPE_HUE[t as AnnType] } : undefined}
                  onClick={() => setTypeFilter(t)}
                >
                  <Icon /> {t === "ALL" ? "All" : TYPE_LABEL[t as AnnType]}
                  <span>{t === "ALL" ? stats.total : stats.counts[t as AnnType]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={Megaphone} iconGradient={GRAD.redPink} title="Couldn't load" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="ann__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Megaphone}
            iconGradient={GRAD.orangePink}
            title="No announcements yet"
            subtitle="Broadcast org-wide updates. Use Urgent for outages, Policy for rule changes, Celebration for wins."
            chips={["Info", "Warning", "Policy", "Event", "Celebration"]}
            cta="New announcement"
          />
        ) : filtered.length === 0 ? (
          <div className="ann__no-match"><Search /> No announcements match the filter.</div>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="ann__section">
                <header className="ann__section-head">
                  <span className="ann__section-tag"><Pin /> Pinned</span>
                  <span className="ann__section-count">{pinned.length}</span>
                  <span className="ann__section-line" />
                </header>
                <div className="ann__list">
                  {pinned.map((a) => <AnnCard key={a.id} a={a} onAck={() => ack(a.id)} />)}
                </div>
              </section>
            )}

            {byPriority.map((g) => (
              <section key={g.prio} className="ann__section" style={{ ["--s-c" as unknown as string]: PRIO_HUE[g.prio] }}>
                <header className="ann__section-head">
                  <span className="ann__section-tag ann__section-tag--prio">{PRIO_LABEL[g.prio]}</span>
                  <span className="ann__section-count">{g.items.length}</span>
                  <span className="ann__section-line" />
                </header>
                <div className="ann__list">
                  {g.items.map((a) => <AnnCard key={a.id} a={a} onAck={() => ack(a.id)} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function AnnCard({ a, onAck }: { a: ApiAnn; onAck: () => void }) {
  const TypeIcon = TYPE_ICON[a.type];
  return (
    <article className={`ann__card ann__card--${a.type.toLowerCase()}`} style={{ ["--c-c" as unknown as string]: TYPE_HUE[a.type], ["--p-c" as unknown as string]: PRIO_HUE[a.priority] }}>
      <header className="ann__card-head">
        <span className="ann__card-type"><TypeIcon /> {TYPE_LABEL[a.type]}</span>
        <span className="ann__card-prio">{PRIO_LABEL[a.priority]}</span>
        {a.pinned && <span className="ann__card-pin"><Pin /> Pinned</span>}
        <span className="ann__card-time"><Clock /> {relativeDate(a.publishedAt ?? a.createdAt)}</span>
      </header>
      <h3 className="ann__card-title">{a.title}</h3>
      <p className="ann__card-content">{a.content}</p>
      <footer className="ann__card-foot">
        {a.expiresAt && (
          <span className="ann__card-expires">Expires {new Date(a.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        )}
        {a.mustAcknowledge && (
          a.ackedByMe ? (
            <span className="ann__card-acked"><CheckCircle2 /> You've acked</span>
          ) : (
            <button type="button" className="ann__card-ack-btn" onClick={onAck}>
              <Bell /> Acknowledge
            </button>
          )
        )}
        <ChevronRight className="ann__card-arrow" />
      </footer>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Megaphone; label: string; value: string; sub: string }) {
  return (
    <div className="ann__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="ann__kpi-accent" aria-hidden="true" />
      <div className="ann__kpi-row">
        <div className="ann__kpi-icon"><Icon /></div>
        <div className="ann__kpi-label">{label}</div>
      </div>
      <div className="ann__kpi-value">{value}</div>
      <div className="ann__kpi-sub">{sub}</div>
    </div>
  );
}
