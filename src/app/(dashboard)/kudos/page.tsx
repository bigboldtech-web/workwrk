"use client";

/* Kudos — peer-recognition feed with KPI strip + reaction chips.
 *
 *  GET  /api/kudos
 *  POST /api/kudos
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Heart, Plus, Hash, ChevronRight, Trophy, Sparkles, Users, Calendar as CalendarIcon,
  Search, TrendingUp,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiKudos = {
  id: string;
  message: string;
  companyValue?: string | null;
  createdAt: string;
  totalReactions: number;
  reactionCounts: { emoji: string; count: number }[];
  myReactions: string[];
  giver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  receiver?: { id: string; firstName?: string | null; lastName?: string | null; department?: { name?: string | null } | null } | null;
};

const AV = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV[h % AV.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }
function fullName(u?: { firstName?: string | null; lastName?: string | null } | null) {
  if (!u) return "Unknown";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unknown";
}

const MS_DAY = 86400_000;

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60 * 1000) return "just now";
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / (60 * 60 * 1000))}h ago`;
  if (ms < 7 * MS_DAY) return `${Math.floor(ms / MS_DAY)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const VALUE_HUE: Record<string, string> = {
  "Customer First": C.pink,
  "Ownership": C.indigo,
  "Teamwork": C.green,
  "Boldness": C.orange,
  "Excellence": C.purple,
  "Innovation": C.teal,
};
function valueColor(v: string): string {
  if (VALUE_HUE[v]) return VALUE_HUE[v];
  let h = 0; for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
}

export default function KudosPage() {
  const [rows, setRows] = useState<ApiKudos[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kudos?limit=50");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiKudos[] = data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("kudos");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const week = list.filter((k) => Date.now() - new Date(k.createdAt).getTime() <= 7 * MS_DAY).length;
    const month = list.filter((k) => Date.now() - new Date(k.createdAt).getTime() <= 30 * MS_DAY).length;
    const totalReactions = list.reduce((a, k) => a + k.totalReactions, 0);
    const receiverCounts = new Map<string, { id: string; name: string; n: number }>();
    for (const k of list) {
      if (!k.receiver?.id) continue;
      const cur = receiverCounts.get(k.receiver.id);
      const name = fullName(k.receiver);
      if (cur) cur.n += 1;
      else receiverCounts.set(k.receiver.id, { id: k.receiver.id, name, n: 1 });
    }
    const topReceivers = Array.from(receiverCounts.values()).sort((a, b) => b.n - a.n).slice(0, 5);
    return { total: list.length, week, month, totalReactions, topReceivers };
  }, [rows]);

  const values = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of rows ?? []) {
      if (!k.companyValue) continue;
      m.set(k.companyValue, (m.get(k.companyValue) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (activeValue) list = list.filter((k) => k.companyValue === activeValue);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((k) =>
      k.message.toLowerCase().includes(q) ||
      fullName(k.giver).toLowerCase().includes(q) ||
      fullName(k.receiver).toLowerCase().includes(q) ||
      (k.companyValue ?? "").toLowerCase().includes(q));
    return list;
  }, [rows, search, activeValue]);

  const recent = filtered.filter((k) => Date.now() - new Date(k.createdAt).getTime() <= 7 * MS_DAY);
  const older = filtered.filter((k) => Date.now() - new Date(k.createdAt).getTime() > 7 * MS_DAY);

  return (
    <>
      <OsTitleBar
        title="Kudos"
        Icon={Heart}
        iconGradient={GRAD.redPink}
        description={rows === null ? "Loading…" : `${stats.total} kudos · ${stats.week} this week · ${stats.totalReactions} reactions`}
        actions={
          <div className="kud__head-actions">
            <Link href="/people" className="kud__nav-link"><Users /> People</Link>
            <button type="button" className="kud__btn-primary" onClick={() => toast("Send kudos from any person's profile page")}>
              <Plus /> Send kudos
            </button>
          </div>
        }
      />

      <div className="kud">
        <div className="kud__kpis">
          <KpiTile accent="var(--os-c-pink)"   Icon={Heart}      label="Kudos given"  value={`${stats.total}`}    sub="all time" />
          <KpiTile accent="var(--os-c-orange)" Icon={Sparkles}   label="This week"    value={`${stats.week}`}      sub={`${stats.month} this month`} />
          <KpiTile accent="var(--os-c-purple)" Icon={TrendingUp} label="Reactions"    value={`${stats.totalReactions}`} sub="cumulative" />
          <KpiTile accent="var(--os-c-green)"  Icon={Trophy}     label="Top receiver" value={stats.topReceivers[0]?.name.split(" ")[0] ?? "—"} sub={`${stats.topReceivers[0]?.n ?? 0} kudos`} />
        </div>

        <div className="kud__toolbar">
          <div className="kud__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search message, giver, receiver, value…" />
          </div>
          {(search.trim() || activeValue) && (
            <button type="button" className="kud__clear" onClick={() => { setSearch(""); setActiveValue(null); }}>Clear</button>
          )}
        </div>

        {values.length > 0 && (
          <div className="kud__values">
            <button type="button" className={`kud__value${activeValue === null ? " is-active" : ""}`} onClick={() => setActiveValue(null)}>
              <Hash /> All values
            </button>
            {values.map(([v, n]) => (
              <button
                key={v}
                type="button"
                className={`kud__value${activeValue === v ? " is-active" : ""}`}
                style={{ ["--v-c" as unknown as string]: valueColor(v) }}
                onClick={() => setActiveValue(activeValue === v ? null : v)}
              >
                <span className="kud__value-dot" />
                {v}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={Heart} iconGradient={GRAD.redPink} title="Couldn't load kudos" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="kud__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Heart}
            iconGradient={GRAD.redPink}
            title="No kudos yet"
            subtitle="Recognize a teammate's work. Pick a company value to reinforce the behavior you want to celebrate."
            chips={["Customer First", "Ownership", "Teamwork", "Boldness"]}
            cta="Send kudos"
          />
        ) : filtered.length === 0 ? (
          <div className="kud__no-match"><Search /> No kudos match the current filter.</div>
        ) : (
          <>
            {recent.length > 0 && (
              <section className="kud__section">
                <header className="kud__section-head">
                  <span className="kud__section-tag"><Sparkles /> Recent (last 7 days)</span>
                  <span className="kud__section-count">{recent.length}</span>
                  <span className="kud__section-line" />
                </header>
                <div className="kud__feed">
                  {recent.map((k) => <KudosCard key={k.id} k={k} />)}
                </div>
              </section>
            )}
            {older.length > 0 && (
              <section className="kud__section">
                <header className="kud__section-head">
                  <span className="kud__section-tag"><CalendarIcon /> Earlier</span>
                  <span className="kud__section-count">{older.length}</span>
                  <span className="kud__section-line" />
                </header>
                <div className="kud__feed">
                  {older.map((k) => <KudosCard key={k.id} k={k} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function KudosCard({ k }: { k: ApiKudos }) {
  const giverColor = k.giver ? avColor(k.giver.id) : "var(--os-ink-3)";
  const receiverColor = k.receiver ? avColor(k.receiver.id) : "var(--os-ink-3)";
  const vColor = k.companyValue ? valueColor(k.companyValue) : "var(--os-c-pink)";
  return (
    <article className="kud__card" style={{ ["--c-c" as unknown as string]: vColor }}>
      <header className="kud__card-head">
        <span className="kud__card-av" style={{ background: giverColor }}>{initials(k.giver?.firstName, k.giver?.lastName)}</span>
        <div className="kud__card-flow">
          <span className="kud__card-from">{fullName(k.giver)}</span>
          <Heart />
          <span className="kud__card-to">{fullName(k.receiver)}</span>
          {k.receiver?.department?.name && <span className="kud__card-dept">· {k.receiver.department.name}</span>}
        </div>
        <span className="kud__card-av" style={{ background: receiverColor }}>{initials(k.receiver?.firstName, k.receiver?.lastName)}</span>
      </header>
      <p className="kud__card-msg">{k.message}</p>
      <footer className="kud__card-foot">
        {k.companyValue && (
          <span className="kud__card-value"><Trophy /> {k.companyValue}</span>
        )}
        {k.reactionCounts.length > 0 && (
          <div className="kud__card-reactions">
            {k.reactionCounts.slice(0, 5).map((r) => (
              <span key={r.emoji} className={`kud__card-reaction${k.myReactions.includes(r.emoji) ? " is-mine" : ""}`}>
                {r.emoji} {r.count}
              </span>
            ))}
            {k.reactionCounts.length > 5 && <span className="kud__card-reaction">+{k.reactionCounts.length - 5}</span>}
          </div>
        )}
        <span className="kud__card-time">{relativeDate(k.createdAt)}</span>
        <ChevronRight className="kud__card-arrow" />
      </footer>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Heart; label: string; value: string; sub: string }) {
  return (
    <div className="kud__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="kud__kpi-accent" aria-hidden="true" />
      <div className="kud__kpi-row">
        <div className="kud__kpi-icon"><Icon /></div>
        <div className="kud__kpi-label">{label}</div>
      </div>
      <div className="kud__kpi-value">{value}</div>
      <div className="kud__kpi-sub">{sub}</div>
    </div>
  );
}
