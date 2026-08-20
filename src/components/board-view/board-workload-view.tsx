"use client";

// BoardWorkloadView — WORKLOAD renderer, two variants driven by
// View.config.variant:
//   "workload" (default) — ClickUp-parity capacity grid: people rows ×
//     day columns via the shared WorkloadGrid (workload-grid.tsx).
//     Capacity settings persist in View.config as flat wl* keys through
//     the same PATCH the canvas uses (Object.assign into the SHARED
//     viewConfig blob first so filters/hiddenFields/groupBy never get
//     clobbered — see board-canvas.tsx persistViewConfig).
//   "team" — per-person kanban: one column per assignee, cards open
//     the task drawer (the Space Team tab pattern, board-scoped).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Users } from "lucide-react";
import {
  isDoneStatus,
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";
import { useOsToast } from "@/components/layout/os/toast";
import { PersonAvatar } from "./assignee-picker";
import { PriorityFlag } from "./priority-picker";
import {
  WorkloadGrid,
  sanitizeWorkloadSettings,
  type WorkloadPerson,
  type WorkloadSettings,
} from "./workload-grid";

interface BoardWorkloadViewProps {
  boardId: string;
  /** Active view + its config — used to persist the capacity settings.
   *  Null viewId (no view row yet) → settings are session-local only. */
  viewId: string | null;
  viewConfig?: Record<string, unknown>;
  initialItems: BoardItemRow[];
  statuses: StatusOption[];
  canEdit: boolean;
  variant?: "workload" | "team";
  onOpenItem?: (itemId: string) => void;
}

interface PersonBucket {
  key: string;
  owner: NonNullable<BoardItemRow["owner"]> | null;
  rows: BoardItemRow[];
}

/** View.config flat keys → WorkloadSettings (garbage-tolerant). */
function parseSettings(cfg: Record<string, unknown> | undefined): WorkloadSettings {
  return sanitizeWorkloadSettings({
    mode: cfg?.wlMode,
    windowDays: cfg?.wlWindow,
    dailyHours: cfg?.wlDailyHours,
    dailyTasks: cfg?.wlDailyTasks,
    perPersonHours: cfg?.wlPerPerson,
    countWeekends: cfg?.wlWeekends,
    showAllPeople: cfg?.wlShowAll,
  });
}

export function BoardWorkloadView({ boardId, viewId, viewConfig, initialItems, statuses, canEdit, variant = "workload", onOpenItem }: BoardWorkloadViewProps) {
  const { toast } = useOsToast();

  const buckets = useMemo<PersonBucket[]>(() => {
    const map = new Map<string, PersonBucket>();
    for (const it of initialItems) {
      const key = it.ownerId ?? "__unassigned__";
      const entry = map.get(key) ?? { key, owner: it.owner ?? null, rows: [] };
      if (!entry.owner && it.owner) entry.owner = it.owner;
      entry.rows.push(it);
      map.set(key, entry);
    }
    const list = Array.from(map.values());
    // Most-loaded first; Unassigned always last.
    list.sort((a, b) => {
      if (a.key === "__unassigned__") return 1;
      if (b.key === "__unassigned__") return -1;
      return b.rows.length - a.rows.length;
    });
    return list;
  }, [initialItems]);

  // ── Capacity settings (View.config wl* keys) ──────────────────────
  const [settings, setSettings] = useState<WorkloadSettings>(() => parseSettings(viewConfig));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist the whole shared blob (the PATCH replaces config wholesale);
  // debounce 750ms + one retry + failure toast, flush on unmount — the
  // dashboards-page persistence discipline.
  const push = useCallback(async (attempt = 0) => {
    if (!viewId) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/views/${viewId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { ...(viewConfig ?? {}) } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      if (attempt === 0) {
        toast("Couldn't save workload settings, retrying…");
        setTimeout(() => { void push(1); }, 1500);
      } else {
        toast("Couldn't save workload settings. Check your connection.");
      }
    }
  }, [boardId, viewId, viewConfig, toast]);

  const handleSettingsChange = useMemo(() => {
    if (!viewId || !canEdit) return undefined;
    return (patch: Partial<WorkloadSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        if (viewConfig) {
          // Mutate the SHARED viewConfig object BEFORE the debounced PATCH
          // spreads it, so concurrent filter/column saves keep our keys and
          // we keep theirs (board-canvas.tsx clobber discipline). Idempotent
          // on StrictMode double-invoke.
          Object.assign(viewConfig, {
            wlMode: next.mode,
            wlWindow: next.windowDays,
            wlDailyHours: next.dailyHours,
            wlDailyTasks: next.dailyTasks,
            wlPerPerson: next.perPersonHours,
            wlWeekends: next.countWeekends,
            wlShowAll: next.showAllPeople,
          });
        }
        return next;
      });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void push(); }, 750);
    };
  }, [viewId, canEdit, viewConfig, push]);

  // Flush a pending debounce on unmount so the last change isn't lost.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void push();
      }
    };
  }, [push]);

  // ── Board members (so zero-task people can render) ────────────────
  const [members, setMembers] = useState<WorkloadPerson[]>([]);
  useEffect(() => {
    if (variant === "team") return;
    let alive = true;
    fetch(`/api/boards/${boardId}/members`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data?.members) ? data.members : [];
        const users: WorkloadPerson[] = [];
        for (const m of list as Array<{ user?: WorkloadPerson | null }>) {
          const u = m?.user;
          if (u && typeof u.id === "string") {
            users.push({ id: u.id, firstName: u.firstName ?? null, lastName: u.lastName ?? null, avatar: u.avatar ?? null });
          }
        }
        setMembers(users);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [boardId, variant]);

  // Members ∪ owners on live items, so ex-members with open tasks render.
  const people = useMemo(() => {
    const map = new Map<string, WorkloadPerson>();
    for (const m of members) map.set(m.id, m);
    for (const it of initialItems) {
      if (it.owner && !map.has(it.owner.id)) {
        map.set(it.owner.id, {
          id: it.owner.id,
          firstName: it.owner.firstName,
          lastName: it.owner.lastName,
          avatar: it.owner.avatar,
        });
      }
    }
    return Array.from(map.values());
  }, [members, initialItems]);

  if (initialItems.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <Users className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[13.5px] text-zinc-500">No items yet — assign work to see {variant === "team" ? "the team board" : "workload"}.</p>
      </div>
    );
  }

  if (variant === "team") {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {buckets.map((b) => (
          <div key={b.key} className="flex flex-col w-[300px] flex-shrink-0 rounded-lg bg-zinc-50/80 p-2">
            <PersonHeader bucket={b} statuses={statuses} />
            <div className="flex-1 space-y-2 min-h-[40px] mt-2">
              {b.rows.map((it) => {
                const opt = it.status ? statuses.find((o) => o.value === it.status) : null;
                const overdue = !!it.dueAt && new Date(it.dueAt) < new Date() && !isDoneStatus(statuses, it.status);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onOpenItem?.(it.id)}
                    className="block w-full text-left rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm hover:shadow-sm transition-shadow"
                  >
                    <div className="break-words">{it.title}</div>
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      {opt ? (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-medium"
                          style={{ background: `${opt.color}22`, color: opt.color }}
                        >
                          {opt.label}
                        </span>
                      ) : null}
                      {it.priority ? <PriorityFlag value={it.priority} /> : null}
                      {overdue ? (
                        <span className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-red-600">
                          <AlertTriangle className="w-3 h-3" /> overdue
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <WorkloadGrid
      items={initialItems}
      people={people}
      statuses={statuses}
      settings={settings}
      canEdit={canEdit}
      onSettingsChange={handleSettingsChange}
      onOpenItem={onOpenItem}
    />
  );
}

function PersonHeader({ bucket, statuses }: { bucket: PersonBucket; statuses: StatusOption[] }) {
  return (
    <div className="px-1">
      <div className="flex items-center gap-2">
        {bucket.owner ? (
          <>
            <PersonAvatar person={{ ...bucket.owner, email: null }} size={22} />
            <span className="text-[13.5px] font-medium text-zinc-800 truncate">
              {`${bucket.owner.firstName ?? ""} ${bucket.owner.lastName ?? ""}`.trim()}
            </span>
          </>
        ) : (
          <span className="text-[13.5px] text-zinc-500">Unassigned</span>
        )}
        <span className="text-[12px] text-zinc-400 tabular-nums">{bucket.rows.length}</span>
      </div>
      <div className="mt-1.5">
        <StatusBar rows={bucket.rows} statuses={statuses} />
      </div>
    </div>
  );
}

function StatusBar({ rows, statuses }: { rows: BoardItemRow[]; statuses: StatusOption[] }) {
  const segs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status ?? "__unset__", (counts.get(r.status ?? "__unset__") ?? 0) + 1);
    const out: { key: string; label: string; color: string; count: number }[] = [];
    for (const o of statuses) {
      const n = counts.get(o.value);
      if (n) { out.push({ key: o.value, label: o.label, color: o.color, count: n }); counts.delete(o.value); }
    }
    for (const [k, n] of counts) out.push({ key: k, label: k === "__unset__" ? "Unset" : k, color: "#A1A1AA", count: n });
    return out;
  }, [rows, statuses]);
  const total = rows.length;
  if (total === 0) return <span className="text-[12px] text-zinc-300">—</span>;
  return (
    <div
      className="flex h-3.5 w-full max-w-[420px] rounded-sm overflow-hidden ring-1 ring-black/5"
      title={segs.map((s) => `${s.label}: ${s.count}`).join("  ·  ")}
    >
      {segs.map((s) => (
        <span key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} aria-hidden />
      ))}
    </div>
  );
}
