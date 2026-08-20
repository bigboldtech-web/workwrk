"use client";

// TeamPulse — the "who's working on what right now" section of the Teams
// Overview (ClickUp Teams-app person cards). One card per visible member:
// avatar + name + not-done/done counters + completion %, a status
// distribution bar (same StatusDistribution chrome as BatteryWidget), up
// to 3 "working on" rows, and a recent-activity strip when ActivityLog
// has rows for that person (omitted otherwise — no filler).
//
// Data: GET /api/team/members-work (read-only; board-read-gated server
// side). Dark mode: zinc surfaces/text repaint via the os.css catchalls;
// borders are zinc-200/zinc-100 only (zinc-50 borders are banned); the
// status segment colors are mid-tone hex readable on both themes.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Mail, MoreHorizontal, UserRound } from "lucide-react";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { StatusDistribution, UNKNOWN_STATUS_COLOR, type StatusSeg } from "@/components/dashboard/widgets/battery-widget";
import { DEFAULT_STATUS_OPTIONS, STATUS_LOOKUP } from "@/lib/board-items-shared";
import { pctColor } from "@/components/team/ui";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuList, MenuItem } from "@/components/ui/menu";

interface PulseItem {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: string | null;
  board: { id: string; slug: string; name: string };
}

interface PulseActivity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

interface PulseMember {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatar: string | null;
  roleTitle: string | null;
  department: string | null;
  status: string;
  total: number;
  open: number;
  done: number;
  overdue: number;
  statusCounts: Record<string, number>;
  inProgress: PulseItem[];
  recent: PulseActivity[];
}

/** statusCounts → ordered segments: known statuses first (canonical
 *  order + colors), unknown keys gray (alphabetical), "No status" last.
 *  Mirrors buildStatusSegs in battery-widget.tsx, but from counts —
 *  the endpoint ships aggregates, not raw items. */
function buildSegsFromCounts(counts: Record<string, number>): StatusSeg[] {
  const rest = new Map(Object.entries(counts));
  const segs: StatusSeg[] = [];
  for (const o of DEFAULT_STATUS_OPTIONS) {
    const n = rest.get(o.value);
    if (n) {
      segs.push({ key: o.value, label: o.label, color: o.color, count: n });
      rest.delete(o.value);
    }
  }
  const unknown = Array.from(rest.entries())
    .filter(([k]) => k !== "__unset__")
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, n] of unknown) {
    segs.push({ key: k, label: k, color: UNKNOWN_STATUS_COLOR, count: n });
  }
  const unset = rest.get("__unset__");
  if (unset) segs.push({ key: "__unset__", label: "No status", color: UNKNOWN_STATUS_COLOR, count: unset });
  return segs;
}

/** Compact relative time: 5m / 3h / 2d ago (floors at "just now"). */
function relTime(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function MemberCard({ m, now }: { m: PulseMember; now: number }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
  const segs = buildSegsFromCounts(m.statusCounts);

  const go = (href: string) => {
    setMenuOpen(false);
    router.push(href);
  };

  return (
    <div className="flex flex-col rounded-lg border border-zinc-200 bg-white shadow-sm p-3 gap-2.5">
      {/* Header: avatar, name/role, not-done/done counters, %, "…" */}
      <div className="flex items-center gap-2.5">
        <PersonAvatar
          person={{ id: m.id, firstName: m.firstName, lastName: m.lastName, avatar: m.avatar, email: m.email }}
          size={32}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/people/${m.id}`}
            className="block text-[14px] font-semibold text-zinc-900 truncate hover:text-[#0073EA]"
          >
            {m.name}
          </Link>
          <div className="text-[12.5px] text-zinc-500 truncate">{m.roleTitle ?? m.department ?? "—"}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-center">
          <div>
            <div className="text-[15px] font-semibold tabular-nums text-zinc-900">{m.open}</div>
            <div className="text-[11px] text-zinc-400">Not done</div>
          </div>
          <div>
            <div className="text-[15px] font-semibold tabular-nums text-zinc-900">{m.done}</div>
            <div className="text-[11px] text-zinc-400">Done</div>
          </div>
          <span className="text-[12px] font-semibold tabular-nums" style={{ color: pctColor(pct) }}>
            {pct}%
          </span>
        </div>
        <button
          ref={moreRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 shrink-0"
          aria-label={`Actions for ${m.name}`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Workload distribution */}
      {m.total > 0 && segs.length > 0 ? (
        <StatusDistribution segs={segs} total={m.total} />
      ) : (
        <div className="text-[12.5px] text-zinc-400 py-1">No open work</div>
      )}

      {/* Working on now */}
      <div>
        <div className="text-[11.5px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Working on</div>
        {m.inProgress.length === 0 ? (
          <div className="text-[12.5px] text-zinc-400 px-1.5">Nothing in progress</div>
        ) : (
          m.inProgress.map((it) => {
            const isOverdue = it.dueAt !== null && new Date(it.dueAt).getTime() < now;
            return (
              <Link key={it.id} href={`/item/${it.id}`} className="flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-zinc-50">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: STATUS_LOOKUP[it.status ?? ""]?.color ?? UNKNOWN_STATUS_COLOR }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-700">{it.title}</span>
                <span className="max-w-[90px] truncate text-[12px] text-zinc-400">{it.board.name}</span>
                {isOverdue ? <span className="shrink-0 text-[11.5px] font-medium text-red-600">overdue</span> : null}
              </Link>
            );
          })
        )}
      </div>

      {/* Recent activity — only when ActivityLog actually has rows */}
      {m.recent.length > 0 ? (
        <div className="border-t border-zinc-100 pt-2 space-y-1">
          {m.recent.map((r) => (
            <div key={r.id} className="flex items-baseline gap-2 text-[12px] text-zinc-400">
              <span className="min-w-0 flex-1 truncate">{r.description}</span>
              <span className="shrink-0 tabular-nums">{relTime(r.createdAt, now)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Quick actions — every entry is backed (no Coming-soon filler) */}
      {menuOpen ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
          <MorePortal anchorRef={moreRef} width={200} open={menuOpen} placement="below">
            <MenuList>
              <MenuItem icon={UserRound} label="View profile" onClick={() => go(`/people/${m.id}`)} />
              {m.email ? (
                <MenuItem
                  icon={Mail}
                  label="Email"
                  onClick={() => {
                    setMenuOpen(false);
                    window.location.href = `mailto:${m.email}`;
                  }}
                />
              ) : null}
              {m.inProgress.length > 0 ? (
                <MenuItem icon={ArrowRight} label="Open their latest task" onClick={() => go(`/item/${m.inProgress[0].id}`)} />
              ) : null}
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </div>
  );
}

export function TeamPulse() {
  const [members, setMembers] = useState<PulseMember[] | null>(null);
  // Snapshot of "now" taken when the payload lands — overdue checks and
  // relative times key off it so render stays pure (react-hooks/purity).
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/members-work");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { members: PulseMember[] };
      setLoadedAt(Date.now());
      setMembers(data.members ?? []);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <div className="py-8 text-center text-[13px] text-zinc-400">Couldn&apos;t load your team</div>;
  }
  if (members === null) {
    return (
      <div className="flex min-h-[72px] items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
      </div>
    );
  }
  if (members.length === 0) {
    return <div className="py-8 text-center text-[13px] text-zinc-400">No teammates visible to you yet</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {members.map((m) => (
        <MemberCard key={m.id} m={m} now={loadedAt} />
      ))}
    </div>
  );
}
