"use client";

/* Activity feed — chronological stream of everything happening in the org.
 *
 * Replaces the previous "generic table" view. Each entry is a card with:
 *   avatar | actor name + action sentence + relative time | target chip
 *
 * Grouped by day (Today / Yesterday / weekday / older). Scope pills
 * filter to My/Team/Whole org. Auto-refreshes when other modules
 * bump the activity row-version.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, FormInput, Table as TableIcon, LayoutGrid, FileText, HardDrive,
  CheckSquare, Users, Sparkles, Target, BookOpen, ClipboardList,
  type LucideIcon,
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
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  actor?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}
function actorName(a: ApiActivity["actor"]): string {
  if (!a) return "Someone";
  const f = a.firstName ?? "";
  const l = a.lastName ?? "";
  const joined = `${f} ${l}`.trim();
  return joined || "Someone";
}

// Group entries into "Today / Yesterday / weekday / ISO" buckets in
// reverse-chrono order. Doing this here (not via Map) keeps insertion
// order matching the array order.
function dayKey(iso: string): string {
  const now = new Date();
  const d = new Date(iso);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, y)) return "Yesterday";
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Per-target visual: tinted background pill + Lucide icon + label.
const TARGET_VISUAL: Record<string, { Icon: LucideIcon; label: string; color: string; href?: (id: string) => string }> = {
  FormDefinition: { Icon: FormInput,  label: "Form",   color: C.purple, href: (id) => `/forms/${id}` },
  DataTable:      { Icon: TableIcon,  label: "Table",  color: C.teal,   href: (id) => `/tables/${id}` },
  StudioBoard:    { Icon: LayoutGrid, label: "Board",  color: C.indigo },
  Doc:            { Icon: FileText,   label: "Doc",    color: C.blue,   href: (id) => `/docs/${id}` },
  FileEntry:      { Icon: HardDrive,  label: "File",   color: C.brown },
  Task:           { Icon: CheckSquare,label: "Task",   color: C.green,  href: (id) => `/tasks?id=${id}` },
  User:           { Icon: Users,      label: "Person", color: C.pink },
  Kra:            { Icon: Target,     label: "KRA",    color: C.orange },
  Kpi:            { Icon: Target,     label: "KPI",    color: C.red },
  Sop:            { Icon: BookOpen,   label: "SOP",    color: C.indigo },
};

// Verb tinting derived from the activity type string — green/red/blue/teal
// for create/delete/update/done, plus pink for "submission" and amber for
// AI-generated entries (Sidekick produced this).
function actionTone(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("delete") || t.includes("cancel") || t.includes("remove")) return C.red;
  if (t.includes("submission") || t.includes("invite") || t.includes("send")) return C.pink;
  if (t.includes("applied") || t.includes("complete") || t.includes("publish") || t.includes("extracted")) return C.teal;
  if (t.includes("update") || t.includes("edit") || t.includes("rename") || t.includes("change")) return C.blue;
  if (t.includes("create") || t.includes("add") || t.includes("start")) return C.green;
  return C.indigo;
}

type Scope = "my" | "team" | "all";

export default function ActivityPage() {
  const [rows, setRows] = useState<ApiActivity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("team");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity?scope=${scope}&limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiActivity[] = data?.data?.data ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("activity");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Build day-grouped list, preserving the upstream order (already
  // reverse-chronological from the API).
  const grouped = useMemo(() => {
    const out: Array<{ day: string; items: ApiActivity[] }> = [];
    let current: { day: string; items: ApiActivity[] } | null = null;
    for (const a of rows ?? []) {
      const d = dayKey(a.createdAt);
      if (!current || current.day !== d) {
        current = { day: d, items: [] };
        out.push(current);
      }
      current.items.push(a);
    }
    return out;
  }, [rows]);

  const todayCount = useMemo(() => (rows ?? []).filter((a) => dayKey(a.createdAt) === "Today").length, [rows]);

  return (
    <>
      <OsTitleBar
        title="Activity feed"
        Icon={Activity}
        iconGradient={GRAD.orangePink}
        description={rows === null ? "Loading…" : `${rows.length} event${rows.length === 1 ? "" : "s"}${todayCount > 0 ? ` · ${todayCount} today` : ""} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={8}
      />

      <div className="actfeed__scope">
        <div className="actfeed__scope-pills" role="tablist" aria-label="Activity scope">
          {(["my", "team", "all"] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              className={scope === s ? "is-active" : ""}
              onClick={() => setScope(s)}
            >
              {s === "my" ? "Just me" : s === "team" ? "My team" : "Whole org"}
            </button>
          ))}
        </div>
        <div className="actfeed__live"><span className="actfeed__live-dot" /> Live</div>
      </div>

      {loadError ? (
        <OsEmptyView Icon={Activity} iconGradient={GRAD.redPink} title="Couldn't load activity" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : rows === null ? (
        <div className="actfeed__loading">Loading activity…</div>
      ) : rows.length === 0 ? (
        <OsEmptyView Icon={Activity} iconGradient={GRAD.orangePink} title="No activity yet" subtitle="As your team uses WorkwrK — creating tasks, posting updates, moving deals — every action shows up here in real time." chips={["Tasks", "Deals", "Tickets", "Onboarding"]} cta="Explore modules" />
      ) : (
        <div className="actfeed">
          {grouped.map((bucket) => (
            <section key={bucket.day} className="actfeed__day">
              <header className="actfeed__day-head">
                <span className="actfeed__day-name">{bucket.day}</span>
                <span className="actfeed__day-count">{bucket.items.length} {bucket.items.length === 1 ? "event" : "events"}</span>
                <span className="actfeed__day-line" />
              </header>
              <ol className="actfeed__list">
                {bucket.items.map((a) => <FeedEntry key={a.id} activity={a} />)}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function FeedEntry({ activity }: { activity: ApiActivity }) {
  const name = actorName(activity.actor);
  const initialsStr = activity.actor ? initials(activity.actor.firstName, activity.actor.lastName) : "?";
  const aColor = activity.actor ? avColor(activity.actor.id) : C.gray;
  const tone = actionTone(activity.type);

  const target = activity.targetType ? TARGET_VISUAL[activity.targetType] : undefined;
  const targetHref = target?.href && activity.targetId ? target.href(activity.targetId) : undefined;

  // Cheap AI-touched signal — entries where Claude/Sidekick was actor or
  // helper. Lets us pin a small sparkle so users see what their agents did.
  const metaActor = activity.metadata && typeof activity.metadata === "object" ? (activity.metadata as Record<string, unknown>) : null;
  const isAi = activity.type.startsWith("ai.") || metaActor?.viaAgent === true || metaActor?.viaSidekick === true;

  return (
    <li className="actfeed__entry">
      <div className="actfeed__avatar" style={{ background: activity.actor?.avatar ? "transparent" : aColor }}>
        {activity.actor?.avatar
          ? <img src={activity.actor.avatar} alt={name} />
          : <span>{initialsStr}</span>}
      </div>
      <div className="actfeed__body">
        <div className="actfeed__line">
          <span className="actfeed__actor">{name}</span>
          <span className="actfeed__verb" style={{ color: tone }}>{activity.description}</span>
          {isAi && <span className="actfeed__ai" title="AI-driven"><Sparkles /></span>}
        </div>
        <div className="actfeed__meta">
          <time dateTime={activity.createdAt}>{relTime(activity.createdAt)}</time>
          {target && (
            targetHref ? (
              <Link href={targetHref} className="actfeed__chip" style={{ background: `color-mix(in srgb, ${target.color} 12%, transparent)`, color: target.color }}>
                <target.Icon /> {target.label}
              </Link>
            ) : (
              <span className="actfeed__chip" style={{ background: `color-mix(in srgb, ${target.color} 12%, transparent)`, color: target.color }}>
                <target.Icon /> {target.label}
              </span>
            )
          )}
          <span className="actfeed__type"><ClipboardList /> {activity.type.replace(/[._]/g, " ")}</span>
        </div>
      </div>
    </li>
  );
}
