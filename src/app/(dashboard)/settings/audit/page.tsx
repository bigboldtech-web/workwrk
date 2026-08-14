"use client";

/* Settings · Audit log — org-wide activity feed.
 *
 *  Reads the real ActivityLog engine:
 *    GET /api/audit         — cursor-paginated, filter by type/actor/date
 *    GET /api/audit-log/export — admin-only signed JSONL export
 *
 *  No sample/demo data: every row shown is a persisted ActivityLog row
 *  scoped to the caller's organization.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, Search, Hash, ChevronRight, User as UserIcon, Edit3, Trash2,
  Plus, Eye, ShieldAlert, Key, FileText, Calendar as CalendarIcon, Download, X,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type AuditActor = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

type AuditRow = {
  id: string;
  type: string;
  description: string;
  targetType?: string | null;
  targetId?: string | null;
  severity: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  actor?: AuditActor | null;
};

type AuditResponse = { items?: AuditRow[]; nextCursor?: string | null };

const RANGES = [
  { key: "all", label: "All time", ms: 0 },
  { key: "24h", label: "24h", ms: 86_400_000 },
  { key: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 days", ms: 30 * 86_400_000 },
  { key: "90d", label: "90 days", ms: 90 * 86_400_000 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];
const RANGE_MS: Record<RangeKey, number> = {
  all: 0, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000,
};

// Icon derived from the activity type verb. Types are free-form strings
// (e.g. "okr_created", "review_cycle.create", "user_removed"), so we
// match on the verb rather than an exact key.
function typeIcon(type: string): typeof Activity {
  const t = type.toLowerCase();
  if (/(delete|remov|revok|archiv)/.test(t)) return Trash2;
  if (/(create|add|insert|restor|invit)/.test(t)) return Plus;
  if (/(update|edit|change|check.?in|assign|submit)/.test(t)) return Edit3;
  if (/(login|logout|auth|session|mfa)/.test(t)) return Key;
  if (/(export|download|report)/.test(t)) return FileText;
  if (/(role|permission|access|grant)/.test(t)) return ShieldAlert;
  if (/(view|read|open)/.test(t)) return Eye;
  return Activity;
}

// Row accent is keyed to the real `severity` column, not a guessed hue.
function severityHue(severity: string): string {
  if (severity === "critical") return "var(--os-c-red)";
  if (severity === "warning") return "var(--os-c-orange)";
  return "var(--os-brand)";
}

function humanType(type: string): string {
  return type.replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function actorName(r: AuditRow): string {
  const a = r.actor;
  if (!a) return "System";
  const n = [a.firstName, a.lastName].filter(Boolean).join(" ").trim();
  return n || a.email || "Unknown";
}

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Reference point for the "last 24h" stat tile. Captured once at module
// load so the stats memo stays pure (react-hooks/purity forbids
// Date.now() during render).
const PAGE_LOADED_AT = Date.now();

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [actorFilter, setActorFilter] = useState<{ id: string; name: string } | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  // Types seen on the most recent *unfiltered* load, so the chip bar
  // stays stable while a single type is selected.
  const [knownTypes, setKnownTypes] = useState<string[]>([]);

  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const buildQuery = useCallback((cursor: string | null): string => {
    const p = new URLSearchParams();
    p.set("limit", "100");
    if (typeFilter) p.set("type", typeFilter);
    if (actorFilter) p.set("actorId", actorFilter.id);
    const ms = RANGE_MS[range];
    if (ms) p.set("startDate", new Date(Date.now() - ms).toISOString());
    if (cursor) p.set("cursor", cursor);
    return `/api/audit?${p.toString()}`;
  }, [typeFilter, actorFilter, range]);

  const load = useCallback(async () => {
    setErrorMsg(null);
    try {
      const res = await fetch(buildQuery(null), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: AuditResponse = await res.json();
      const items = Array.isArray(d.items) ? d.items : [];
      setRows(items);
      setNextCursor(d.nextCursor ?? null);
      if (!typeFilter) {
        setKnownTypes(Array.from(new Set(items.map((i) => i.type))).sort());
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
      setNextCursor(null);
    }
  }, [buildQuery, typeFilter]);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("settings");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildQuery(nextCursor), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: AuditResponse = await res.json();
      const items = Array.isArray(d.items) ? d.items : [];
      setRows((prev) => [...(prev ?? []), ...items]);
      setNextCursor(d.nextCursor ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't load more");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, buildQuery, toast]);

  const exportLog = useCallback(async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams();
      if (typeFilter) p.set("type", typeFilter);
      const ms = RANGE_MS[range];
      if (ms) p.set("from", new Date(Date.now() - ms).toISOString());
      const res = await fetch(`/api/audit-log/export?${p.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const filename = m?.[1] ?? "audit-log.jsonl";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const count = res.headers.get("X-Audit-Row-Count");
      toast(count ? `Exported ${count} audit row${count === "1" ? "" : "s"}` : "Audit log exported");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [typeFilter, range, toast]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      r.type.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q) ||
      (r.targetType ?? "").toLowerCase().includes(q) ||
      actorName(r).toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const day = 86_400_000;
    const today = list.filter((l) => PAGE_LOADED_AT - new Date(l.createdAt).getTime() < day).length;
    const warnings = list.filter((l) => l.severity === "warning").length;
    const critical = list.filter((l) => l.severity === "critical").length;
    return { inView: list.length, today, warnings, critical };
  }, [rows]);

  return (
    <>
      <OsTitleBar
        title="Audit log"
        Icon={Activity}
        iconGradient={GRAD.orangePink}
        description={`${stats.inView} in view · ${stats.today} today${nextCursor ? " · more available" : ""}`}
        actions={
          <div className="adt__head-actions">
            <button type="button" className="adt__nav-link" onClick={exportLog} disabled={exporting}>
              <Download /> {exporting ? "Exporting…" : "Export"}
            </button>
            <Link href="/settings" className="adt__nav-link"><Hash /> Settings</Link>
            <Link href="/settings/api" className="adt__nav-link"><Key /> API keys</Link>
          </div>
        }
      />

      <div className="adt">
        <div className="adt__kpis">
          <KpiTile accent="var(--os-brand)"     Icon={CalendarIcon} label="Today"    value={`${stats.today}`}    sub="last 24h · in view" />
          <KpiTile accent="var(--os-c-orange)"  Icon={ShieldAlert}  label="Warnings" value={`${stats.warnings}`} sub="severity · in view" />
          <KpiTile accent="var(--os-c-red)"     Icon={ShieldAlert}  label="Critical" value={`${stats.critical}`} sub="severity · in view" />
          <KpiTile accent="var(--os-c-blue)"    Icon={Hash}         label="In view"  value={`${stats.inView}`}   sub={nextCursor ? "more available" : "all matches"} />
        </div>

        <div className="adt__toolbar">
          <div className="adt__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actor, action, entity…" />
          </div>
        </div>

        <div className="adt__cats">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`adt__cat${range === r.key ? " is-active" : ""}`}
              onClick={() => setRange(r.key)}
            >
              <CalendarIcon /> {r.label}
            </button>
          ))}
        </div>

        {(knownTypes.length > 0 || actorFilter) && (
          <div className="adt__cats">
            <button
              type="button"
              className={`adt__cat${typeFilter === null ? " is-active" : ""}`}
              onClick={() => setTypeFilter(null)}
            >
              <Hash /> All types
            </button>
            {knownTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`adt__cat${typeFilter === t ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: severityHue("info") }}
                onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              >
                <span className="adt__cat-dot" />
                {humanType(t)}
              </button>
            ))}
            {actorFilter && (
              <button
                type="button"
                className="adt__cat is-active"
                onClick={() => setActorFilter(null)}
                title="Clear actor filter"
              >
                <UserIcon /> {actorFilter.name} <X />
              </button>
            )}
          </div>
        )}

        {rows === null ? (
          <div className="adt__loading">Loading…</div>
        ) : errorMsg ? (
          <OsEmptyView
            Icon={Activity}
            iconGradient={GRAD.orangePink}
            title="Couldn't load the audit log"
            subtitle={errorMsg}
          />
        ) : filtered.length === 0 ? (
          <OsEmptyView
            Icon={Activity}
            iconGradient={GRAD.orangePink}
            title="No audit events"
            subtitle="Events appear here as soon as someone takes action in this organization."
            chips={["create", "update", "delete", "check-in"]}
          />
        ) : (
          <>
            <div className="adt__list">
              {filtered.map((l) => {
                const Icon = typeIcon(l.type);
                return (
                  <article key={l.id} className="adt__row" style={{ ["--r-c" as unknown as string]: severityHue(l.severity) }}>
                    <span className="adt__row-icon"><Icon /></span>
                    <div className="adt__row-main">
                      <div className="adt__row-title">
                        <strong>{humanType(l.type)}</strong>
                        {l.description && <span>· {l.description}</span>}
                      </div>
                      <div className="adt__row-meta">
                        <button
                          type="button"
                          onClick={() => l.actor && setActorFilter({ id: l.actor.id, name: actorName(l) })}
                          title={l.actor ? "Filter by this person" : undefined}
                          disabled={!l.actor}
                        >
                          <UserIcon /> {actorName(l)}
                        </button>
                        <span><CalendarIcon /> {relativeDate(l.createdAt)}</span>
                        {l.targetType && <span>{l.targetType}</span>}
                        {l.severity && l.severity !== "info" && <span>{l.severity}</span>}
                        {l.ipAddress && <span>IP {l.ipAddress}</span>}
                      </div>
                    </div>
                    <ChevronRight className="adt__row-arrow" />
                  </article>
                );
              })}
            </div>

            {nextCursor && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <button type="button" className="adt__nav-link" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Activity; label: string; value: string; sub: string }) {
  return (
    <div className="adt__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="adt__kpi-accent" aria-hidden="true" />
      <div className="adt__kpi-row">
        <div className="adt__kpi-icon"><Icon /></div>
        <div className="adt__kpi-label">{label}</div>
      </div>
      <div className="adt__kpi-value">{value}</div>
      <div className="adt__kpi-sub">{sub}</div>
    </div>
  );
}
