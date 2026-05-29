"use client";

/* CRM · Activities — bespoke activity stream.
 *
 *  GET /api/activity?scope=team&limit=300
 *
 * Layout:
 *   OsTitleBar with entity-type chips + nav links in actions.
 *   KPI strip: Today · This week · Top actor · Top entity.
 *   Stream: vertical timeline grouped by day with sticky day headers,
 *     colored action dots, actor avatars, target entity tags.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ListTree, Plus, Pencil, Trash2, ArrowRight, Search,
  CheckCircle2, MessageCircle, FileText, Activity,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiActivity = {
  id: string;
  type: string;
  description: string;
  targetType?: string | null;
  targetId?: string | null;
  createdAt: string;
  actor?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

type Entity = "lead" | "opportunity" | "account" | "contact";

const ENTITY_META: Record<Entity, { label: string; color: string }> = {
  lead:        { label: "Lead",        color: C.orange },
  opportunity: { label: "Deal",        color: C.green  },
  account:     { label: "Account",     color: C.indigo },
  contact:     { label: "Contact",     color: C.purple },
};

function entityKey(t?: string | null): Entity | null {
  if (!t) return null;
  const low = t.toLowerCase();
  if (low === "lead" || low === "opportunity" || low === "account" || low === "contact") return low;
  return null;
}

type ActionTone = "create" | "update" | "delete" | "convert" | "comment" | "complete" | "other";
function actionTone(type: string): ActionTone {
  const t = type.toLowerCase();
  if (t.includes("create") || t.includes("add")) return "create";
  if (t.includes("delete") || t.includes("remove")) return "delete";
  if (t.includes("convert")) return "convert";
  if (t.includes("comment") || t.includes("note")) return "comment";
  if (t.includes("complete") || t.includes("done") || t.includes("won")) return "complete";
  if (t.includes("update") || t.includes("edit") || t.includes("change")) return "update";
  return "other";
}
const ACTION_ICON: Record<ActionTone, typeof Plus> = {
  create: Plus, update: Pencil, delete: Trash2, convert: ArrowRight,
  comment: MessageCircle, complete: CheckCircle2, other: Activity,
};
const ACTION_COLOR: Record<ActionTone, string> = {
  create: C.green, update: C.blue, delete: C.red, convert: C.purple,
  comment: C.teal, complete: C.green, other: C.gray,
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtRelative(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayBucket(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - t.getTime()) / 86_400_000);
  if (diff === 0) return { key: t.toISOString().slice(0, 10), label: "Today" };
  if (diff === 1) return { key: t.toISOString().slice(0, 10), label: "Yesterday" };
  if (diff < 7) return { key: t.toISOString().slice(0, 10), label: t.toLocaleDateString("en-US", { weekday: "long" }) };
  return { key: t.toISOString().slice(0, 10), label: t.toLocaleDateString("en-US", { month: "long", day: "numeric" }) };
}

type EntityFilter = "all" | Entity;

export default function CrmActivitiesPage() {
  const [rows, setRows] = useState<ApiActivity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EntityFilter>("all");
  const [query, setQuery] = useState("");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?scope=team&limit=300");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiActivity[] = data?.data?.data ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list.filter((a) => entityKey(a.targetType) !== null));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/activities");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);
  // Re-load when any CRM module changes
  const vCrm = rowVersion("crm");
  useEffect(() => { if (vCrm > 0) void load(); }, [vCrm, load]);

  // ─── Filter ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((a) => {
      if (filter !== "all") {
        const ek = entityKey(a.targetType);
        if (ek !== filter) return false;
      }
      if (q) {
        const hay = `${a.description} ${a.type} ${a.actor?.firstName ?? ""} ${a.actor?.lastName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, query]);

  // ─── Group by day ─────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: ApiActivity[] }>();
    for (const a of filtered) {
      const b = dayBucket(a.createdAt);
      if (!map.has(b.key)) map.set(b.key, { label: b.label, items: [] });
      map.get(b.key)!.items.push(a);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, v]) => ({ key, label: v.label, items: v.items }));
  }, [filtered]);

  // ─── KPIs ─────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const list = rows ?? [];
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const weekStart = new Date(today0); weekStart.setDate(weekStart.getDate() - 6);
    let today = 0, week = 0;
    const byActor = new Map<string, { name: string; count: number; color: string }>();
    const byEntity = new Map<Entity, number>();
    for (const a of list) {
      const t = new Date(a.createdAt).getTime();
      if (t >= today0.getTime()) today++;
      if (t >= weekStart.getTime()) week++;
      if (a.actor) {
        const k = a.actor.id;
        const cur = byActor.get(k) ?? { name: `${a.actor.firstName ?? ""} ${a.actor.lastName ?? ""}`.trim() || "Unknown", count: 0, color: avColor(k) };
        cur.count++;
        byActor.set(k, cur);
      }
      const ek = entityKey(a.targetType);
      if (ek) byEntity.set(ek, (byEntity.get(ek) ?? 0) + 1);
    }
    const topActor = Array.from(byActor.values()).sort((a, b) => b.count - a.count)[0];
    const topEntityEntry = Array.from(byEntity.entries()).sort((a, b) => b[1] - a[1])[0];
    return { today, week, topActor, topEntity: topEntityEntry ? { name: ENTITY_META[topEntityEntry[0]].label, color: ENTITY_META[topEntityEntry[0]].color, count: topEntityEntry[1] } : null };
  }, [rows]);

  const counts = useMemo(() => {
    const byEntity: Record<Entity, number> = { lead: 0, opportunity: 0, account: 0, contact: 0 };
    for (const a of rows ?? []) {
      const ek = entityKey(a.targetType);
      if (ek) byEntity[ek]++;
    }
    return { total: rows?.length ?? 0, byEntity };
  }, [rows]);

  return (
    <>
      <OsTitleBar
        title="Activity"
        Icon={ListTree}
        iconGradient={GRAD.greenTeal}
        description={rows === null
          ? "Loading activity…"
          : `${counts.total} event${counts.total === 1 ? "" : "s"} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
        actions={
          <div className="actv__head-actions">
            <Link href="/crm" className="actv__nav-link">Pipeline</Link>
            <Link href="/crm/leads" className="actv__nav-link">Leads</Link>
            <Link href="/crm/accounts" className="actv__nav-link">Accounts</Link>
          </div>
        }
      />

      <div className="actv">
        {/* KPIs */}
        <div className="actv__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Activity}    label="Today"     value={`${kpis.today}`}  sub={`${kpis.week} this week`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Activity}    label="This week" value={`${kpis.week}`}   sub={kpis.today > 0 ? `${kpis.today} today` : "no events today"} />
          <ActorTile actor={kpis.topActor} />
          <EntityTile top={kpis.topEntity} />
        </div>

        {/* Filter bar */}
        <div className="actv__toolbar">
          <div className="actv__search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events, actors, descriptions…"
              aria-label="Search activity"
            />
          </div>
          <div className="actv__chips">
            <FilterChip label="All"      count={counts.total}                 active={filter === "all"}         onClick={() => setFilter("all")} />
            <FilterChip label="Leads"    count={counts.byEntity.lead}        color={ENTITY_META.lead.color}        active={filter === "lead"}        onClick={() => setFilter("lead")} />
            <FilterChip label="Deals"    count={counts.byEntity.opportunity} color={ENTITY_META.opportunity.color} active={filter === "opportunity"} onClick={() => setFilter("opportunity")} />
            <FilterChip label="Accounts" count={counts.byEntity.account}     color={ENTITY_META.account.color}     active={filter === "account"}     onClick={() => setFilter("account")} />
            <FilterChip label="Contacts" count={counts.byEntity.contact}     color={ENTITY_META.contact.color}     active={filter === "contact"}     onClick={() => setFilter("contact")} />
          </div>
        </div>

        {/* Stream */}
        {loadError ? (
          <OsEmptyView Icon={ListTree} iconGradient={GRAD.redPink} title="Couldn't load activity" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : rows === null ? (
          <div className="actv__loading">Loading activity…</div>
        ) : counts.total === 0 ? (
          <OsEmptyView
            Icon={ListTree}
            iconGradient={GRAD.greenTeal}
            title="No CRM activity yet"
            subtitle="Every lead, deal, and account change is logged automatically — start working on a deal to see this fill up."
            chips={["Leads", "Deals", "Accounts"]}
            cta="Go to pipeline"
          />
        ) : grouped.length === 0 ? (
          <div className="actv__empty">
            <Search />
            <div>No events match your filters.</div>
            <button type="button" className="actv__empty-reset" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>
          </div>
        ) : (
          <div className="actv__stream">
            {grouped.map((g) => (
              <section key={g.key} className="actv__day">
                <header className="actv__day-head">
                  <span className="actv__day-label">{g.label}</span>
                  <span className="actv__day-count">{g.items.length} event{g.items.length === 1 ? "" : "s"}</span>
                  <span className="actv__day-line" aria-hidden="true" />
                </header>
                <ul className="actv__events">
                  {g.items.map((a) => {
                    const tone = actionTone(a.type);
                    const Icon = ACTION_ICON[tone];
                    const ek = entityKey(a.targetType);
                    const entityMeta = ek ? ENTITY_META[ek] : null;
                    const actorName = a.actor
                      ? `${a.actor.firstName ?? ""} ${a.actor.lastName ?? ""}`.trim() || "Unknown"
                      : "System";
                    return (
                      <li key={a.id} className="actv__event">
                        <div
                          className={`actv__dot actv__dot--${tone}`}
                          style={{ ["--dot-c" as unknown as string]: ACTION_COLOR[tone] }}
                          aria-hidden="true"
                        >
                          <Icon />
                        </div>
                        <div className="actv__event-body">
                          <div className="actv__event-head">
                            {a.actor && (
                              <span className="actv__actor-av" style={{ background: avColor(a.actor.id) }}>
                                {initials(a.actor.firstName, a.actor.lastName)}
                              </span>
                            )}
                            <span className="actv__actor">{actorName}</span>
                            <span
                              className="actv__action-tag"
                              style={{ ["--act-c" as unknown as string]: ACTION_COLOR[tone] }}
                            >
                              {a.type.replace(/_/g, " ").toLowerCase()}
                            </span>
                            {entityMeta && (
                              <span
                                className="actv__entity-tag"
                                style={{ ["--ent-c" as unknown as string]: entityMeta.color }}
                              >
                                {entityMeta.label}
                              </span>
                            )}
                            <span className="actv__time" title={new Date(a.createdAt).toLocaleString()}>
                              {fmtTime(a.createdAt)} · {fmtRelative(a.createdAt)}
                            </span>
                          </div>
                          {a.description && (
                            <div className="actv__event-text">{a.description}</div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Activity; label: string; value: string; sub: string }) {
  return (
    <div className="actv__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="actv__kpi-accent" aria-hidden="true" />
      <div className="actv__kpi-row">
        <div className="actv__kpi-icon"><Icon /></div>
        <div className="actv__kpi-label">{label}</div>
      </div>
      <div className="actv__kpi-value">{value}</div>
      <div className="actv__kpi-sub">{sub}</div>
    </div>
  );
}

function ActorTile({ actor }: { actor?: { name: string; count: number; color: string } }) {
  return (
    <div className="actv__kpi actv__kpi--actor" style={{ ["--kpi-accent" as unknown as string]: actor?.color ?? "var(--os-c-purple)" }}>
      <span className="actv__kpi-accent" aria-hidden="true" />
      <div className="actv__kpi-row">
        {actor ? (
          <span className="actv__kpi-avatar" style={{ background: actor.color }}>
            {actor.name.split(" ").slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?"}
          </span>
        ) : (
          <div className="actv__kpi-icon"><Activity /></div>
        )}
        <div className="actv__kpi-label">Top actor</div>
      </div>
      <div className="actv__kpi-value">{actor?.name ?? "—"}</div>
      <div className="actv__kpi-sub">{actor ? `${actor.count} event${actor.count === 1 ? "" : "s"}` : "no actors yet"}</div>
    </div>
  );
}

function EntityTile({ top }: { top: { name: string; color: string; count: number } | null }) {
  return (
    <div className="actv__kpi" style={{ ["--kpi-accent" as unknown as string]: top?.color ?? "var(--os-c-teal)" }}>
      <span className="actv__kpi-accent" aria-hidden="true" />
      <div className="actv__kpi-row">
        <div className="actv__kpi-icon"><FileText /></div>
        <div className="actv__kpi-label">Most active</div>
      </div>
      <div className="actv__kpi-value">{top?.name ?? "—"}</div>
      <div className="actv__kpi-sub">{top ? `${top.count} event${top.count === 1 ? "" : "s"}` : "no events yet"}</div>
    </div>
  );
}

function FilterChip({ label, count, color, active, onClick }: { label: string; count: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`actv__chip${active ? " is-active" : ""}`}
      style={color ? { ["--chip-c" as unknown as string]: color } : undefined}
      onClick={onClick}
    >
      {color && <span className="actv__chip-dot" />}
      {label}
      <span className="actv__chip-count">{count}</span>
    </button>
  );
}
