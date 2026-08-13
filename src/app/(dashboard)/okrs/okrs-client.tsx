"use client";

/* Goals — objectives + key results, organized by level. Client body of
 * /okrs; the server gate lives in page.tsx (requireGoalsPage), and the
 * rows themselves arrive three-door-filtered from GET /api/okrs.
 *
 *  GET   /api/okrs              list with keyResults (+ ?mine=1 narrowing)
 *  POST  /api/okrs              via CreateGoalModal
 *  PATCH /api/okrs              via CreateGoalModal (edit mode)
 *
 * Layout — ClickUp Goals translated to the house design system (brand
 * blue #0073EA, flat Monday-clean, zinc neutrals):
 *   - Stats strip (avg progress, on track, needs attention, completed)
 *   - One white card per level (Company → Department → Individual);
 *     each goal is a compact ROW linking to /okrs/[id]: name, level chip,
 *     quarter/due date, contributors stack, owner avatar, thin blue
 *     progress bar + % ("—" when nothing is measured), hover "…" menu
 *     + right-click (GoalRowMoreMenu).
 *   - ?new=1 auto-opens the create modal; ?mine=1 shows only goals the
 *     viewer carries (owner or resolved member — filtered server-side).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Target, Plus, TrendingUp, AlertTriangle, CheckCircle2, Trophy,
  Building2, Users, User as UserIcon, X,
  type LucideIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { CreateGoalModal } from "@/components/okrs/create-goal-modal";
import { MemberAvatarStack, type AudienceMember } from "@/components/okrs/goal-audience-picker";
import { GoalRowMoreMenu } from "@/components/okrs/goal-row-more-menu";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";

type OkrStatus = "ON_TRACK" | "AT_RISK" | "BEHIND" | "COMPLETED";
type OkrLevel = "COMPANY" | "DEPARTMENT" | "INDIVIDUAL";

/** Brand blue — the ONE accent; ClickUp's purple translates to this. */
const BRAND = "#0073EA";

type ApiOkr = {
  id: string;
  title: string;
  description?: string | null;
  level: OkrLevel;
  status: OkrStatus;
  progress: number;
  startDate?: string | null;
  endDate?: string | null;
  quarter?: string | null;
  checkInCadence?: string | null;
  ownerId?: string | null;
  owner?: { id?: string; firstName?: string | null; lastName?: string | null; avatar?: string | null; email?: string | null } | null;
  keyResults?: { id: string; title: string; progress?: number; targetValue?: number; currentValue?: number }[];
  /** Where the number came from: ROLLUP (KRs/children), MANUAL (hand-set),
   *  NONE (nothing measurable — render an honest "—", not a fake 0%). */
  progressSource?: "ROLLUP" | "MANUAL" | "NONE";
  /** Resolved audience summary — avatars + overflow count (read-time). */
  audience?: { members: AudienceMember[]; totalMembers: number; assigneeCount: number };
  /** Whether THIS viewer may delete the goal (owner / tree-manager / org
   *  admin). Set server-side by GET /api/okrs; gates the "…"/right-click
   *  Delete so it only appears when DELETE /api/okrs/[id] will honor it. */
  canDelete?: boolean;
  /** Whether THIS viewer may edit (owner / tree-manager / org-wide) —
   *  the exact PATCH /api/okrs gate; drives Edit + Assign owner. */
  canEdit?: boolean;
};

const LEVEL_META: Record<OkrLevel, { label: string; chip: string; sub: string; Icon: LucideIcon }> = {
  COMPANY:    { label: "Company Goals",    chip: "Company",    sub: "What the whole company is pushing toward",       Icon: Building2 },
  DEPARTMENT: { label: "Department Goals", chip: "Department", sub: "How each department supports the company goals", Icon: Users },
  INDIVIDUAL: { label: "Individual Goals", chip: "Individual", sub: "What each person commits to this cycle",         Icon: UserIcon },
};

const LEVEL_ORDER: OkrLevel[] = ["COMPANY", "DEPARTMENT", "INDIVIDUAL"];

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function OkrsClient({ initialNew = false, mine = false }: {
  /** ?new=1 — open the create modal on load (profile hero / sidebar link). */
  initialNew?: boolean;
  /** ?mine=1 — only goals the viewer carries (owner or resolved member). */
  mine?: boolean;
}) {
  const router = useRouter();
  const [okrs, setOkrs] = useState<ApiOkr[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState<OkrLevel | null>(initialNew ? "INDIVIDUAL" : null);
  // ?new=1 opened the modal — closing it cleans the param off the URL so a
  // refresh doesn't resurrect the modal the user just dismissed.
  const [fromQuery, setFromQuery] = useState(initialNew);
  // Edit mode of the SAME modal (ClickUp reuses one surface; so do we).
  // focusOwner lands the user straight in the Owner picker ("Assign owner").
  const [editing, setEditing] = useState<{ goal: ApiOkr; focusOwner?: boolean } | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/okrs${mine ? "?mine=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOkrs(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [mine]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("okrs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Opens the create-goal modal preset to the section's level — creation
  // itself happens inside CreateGoalModal via POST /api/okrs.
  function newGoal(level: OkrLevel) {
    setCreating(level);
  }

  function closeCreate() {
    setCreating(null);
    if (fromQuery) {
      setFromQuery(false);
      router.replace(mine ? "/okrs?mine=1" : "/okrs", { scroll: false });
    }
  }

  // Drop the deleted goal from the list in place — the DELETE already
  // succeeded, so we own this removal locally (a refetch could clobber it
  // or briefly flash the row back while it round-trips). No reload.
  const handleDeleted = useCallback((id: string) => {
    setOkrs((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
  }, []);

  // ── Stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = okrs ?? [];
    const active = all.filter((o) => o.status !== "COMPLETED");
    const onTrack = active.filter((o) => o.status === "ON_TRACK").length;
    const atRisk = active.filter((o) => o.status === "AT_RISK" || o.status === "BEHIND").length;
    const completed = all.filter((o) => o.status === "COMPLETED").length;
    // Average only what is actually measured — an unmeasured goal
    // (progressSource NONE) must not drag the org average toward zero.
    const measured = active.filter((o) => o.progressSource !== "NONE");
    const avgProgress = measured.length > 0
      ? Math.round(measured.reduce((acc, o) => acc + Math.max(0, Math.min(100, o.progress)), 0) / measured.length)
      : 0;
    return { total: all.length, active: active.length, onTrack, atRisk, completed, avgProgress, measured: measured.length };
  }, [okrs]);

  // ── Group by level ──────────────────────────────────────
  const grouped = useMemo(() => {
    const m = new Map<OkrLevel, ApiOkr[]>();
    for (const l of LEVEL_ORDER) m.set(l, []);
    for (const o of okrs ?? []) m.get(o.level)?.push(o);
    return m;
  }, [okrs]);

  return (
    <>
      <OsTitleBar
        title="Goals"
        Icon={Target}
        iconGradient=""
        description={okrs === null ? "Loading…" : `${stats.total} goal${stats.total === 1 ? "" : "s"} · ${stats.active} active · ${stats.completed} completed`}
        actions={
          <button type="button" className="okrs__new" onClick={() => newGoal("INDIVIDUAL")} disabled={creating !== null}>
            <Plus /> New goal
          </button>
        }
      />

      {loadError ? (
        <OsEmptyView Icon={Target} iconGradient="#E2445C" title="Couldn't load goals" subtitle={`API error: ${loadError}.`} cta="Retry" onCta={() => { setLoadError(null); void load(); }} />
      ) : okrs === null ? (
        <div className="okrs__loading">Loading goals…</div>
      ) : stats.total === 0 ? (
        mine ? (
          <OsEmptyView Icon={Trophy} iconGradient={BRAND} title="No goals assigned to you" subtitle="Goals you own or contribute to show up here. Create one, or clear the filter to browse the whole org." cta="New goal" onCta={() => newGoal("INDIVIDUAL")} />
        ) : (
          <OsEmptyView Icon={Target} iconGradient={BRAND} title="No goals yet" subtitle="Set your first goal. Pick Company / Department / Individual to anchor it on the cascade." chips={["Company", "Department", "Individual"]} cta="New goal" onCta={() => newGoal("INDIVIDUAL")} />
        )
      ) : (
        <div className="okrs">
          {mine && (
            <div className="okrs__filter">
              <span className="okrs__filter-chip">
                <Trophy /> My Goals — owner or member
                <Link href="/okrs" aria-label="Show all goals" title="Show all goals"><X /></Link>
              </span>
            </div>
          )}

          {/* Stats strip */}
          <section className="okrs__stats">
            <StatTile
              label="Average progress"
              value={stats.measured > 0 ? `${stats.avgProgress}%` : "—"}
              accent={BRAND}
              Icon={TrendingUp}
              hint={stats.measured > 0 ? `across ${stats.measured} measured` : "nothing measured yet"}
              bar={stats.measured > 0 ? stats.avgProgress : undefined}
            />
            <StatTile
              label="On track"
              value={`${stats.onTrack}`}
              accent="#16a34a"
              Icon={CheckCircle2}
              hint={stats.active > 0 ? `${Math.round((stats.onTrack / stats.active) * 100)}% of active` : "no active"}
            />
            <StatTile
              label="Need attention"
              value={`${stats.atRisk}`}
              accent="#f59e0b"
              Icon={AlertTriangle}
              hint={stats.atRisk > 0 ? "at risk or behind" : "all clear"}
            />
            <StatTile
              label="Completed"
              value={`${stats.completed}`}
              accent={BRAND}
              Icon={Trophy}
              hint="wins this cycle"
            />
          </section>

          {/* One card per level */}
          {LEVEL_ORDER.map((level) => {
            const meta = LEVEL_META[level];
            const items = grouped.get(level) ?? [];
            // In "mine" view a level you carry nothing in is noise — hide it.
            if (mine && items.length === 0) return null;
            return (
              <section key={level} className="okrs__level">
                <header className="okrs__level-head" title={meta.sub}>
                  <meta.Icon />
                  <h2>{meta.label}</h2>
                  <span className="okrs__level-count">{items.length}</span>
                  <span className="okrs__level-spacer" />
                  {/* Preset to THIS section's level — never hardcoded. */}
                  <button type="button" className="okrs__level-add" onClick={() => newGoal(level)} disabled={creating !== null}>
                    <Plus /> New goal
                  </button>
                </header>

                {items.length === 0 ? (
                  <div className="okrs__group okrs__group--empty">
                    No {meta.chip.toLowerCase()} goals yet.{" "}
                    <button type="button" onClick={() => newGoal(level)}>Add one →</button>
                  </div>
                ) : (
                  <div className="okrs__group">
                    {items.map((o) => (
                      <GoalRow
                        key={o.id}
                        okr={o}
                        showLevelChip={mine}
                        onDeleted={() => handleDeleted(o.id)}
                        onEdit={(opts) => setEditing({ goal: o, focusOwner: opts?.focusOwner })}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {creating !== null && (
        <CreateGoalModal
          key={creating}
          open
          level={creating}
          onClose={closeCreate}
          onSaved={() => {
            closeCreate();
            toast("Goal created");
            void load();
          }}
        />
      )}

      {editing !== null && (
        <CreateGoalModal
          key={editing.goal.id}
          open
          level={editing.goal.level}
          focusOwner={editing.focusOwner}
          goal={{
            id: editing.goal.id,
            title: editing.goal.title,
            description: editing.goal.description,
            level: editing.goal.level,
            ownerId: editing.goal.ownerId,
            owner: editing.goal.owner?.id
              ? {
                  id: editing.goal.owner.id,
                  firstName: editing.goal.owner.firstName ?? null,
                  lastName: editing.goal.owner.lastName ?? null,
                  avatar: editing.goal.owner.avatar ?? null,
                  email: editing.goal.owner.email ?? null,
                }
              : null,
            quarter: editing.goal.quarter,
            startDate: editing.goal.startDate,
            endDate: editing.goal.endDate,
            checkInCadence: editing.goal.checkInCadence,
          }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast("Goal updated");
            void load();
          }}
        />
      )}
    </>
  );
}

function StatTile({ label, value, accent, Icon, hint, bar }: { label: string; value: string; accent: string; Icon: LucideIcon; hint: string; bar?: number }) {
  return (
    <div className="okrs-stat" style={{ ["--stat-color" as string]: accent }}>
      <div className="okrs-stat__head">
        <span className="okrs-stat__label">{label}</span>
        <Icon />
      </div>
      <div className="okrs-stat__value">{value}</div>
      <div className="okrs-stat__hint">{hint}</div>
      {bar !== undefined && (
        <div className="okrs-stat__bar">
          <span style={{ width: `${Math.max(2, Math.min(100, bar))}%` }} />
        </div>
      )}
    </div>
  );
}

/* One goal as a compact ClickUp-style row. The whole row links to the
 * detail page; the "…" + right-click menu floats on top (Open / Edit /
 * Assign owner / Copy link / Delete, gated per-row by API flags). */
function GoalRow({ okr, showLevelChip, onDeleted, onEdit }: {
  okr: ApiOkr;
  /** In the mixed "mine" view the level chip disambiguates; grouped
   *  sections already say it in the header. */
  showLevelChip: boolean;
  onDeleted: () => void;
  onEdit: (opts?: { focusOwner?: boolean }) => void;
}) {
  const pct = Math.max(0, Math.min(100, okr.progress));
  const unmeasured = okr.progressSource === "NONE";
  const moreRef = useRef<ContextMenuHandle>(null);
  const owner = okr.owner?.id
    ? {
        id: okr.owner.id,
        firstName: okr.owner.firstName ?? null,
        lastName: okr.owner.lastName ?? null,
        avatar: okr.owner.avatar ?? null,
        email: okr.owner.email ?? null,
      }
    : null;
  const ownerName = owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() : "";
  const due = okr.endDate ? `Ends ${fmtDate(okr.endDate)}` : okr.quarter || null;

  return (
    <div
      className="okr-row"
      onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
    >
      <Link href={`/okrs/${okr.id}`} className="okr-row__main">
        <Trophy className="okr-row__icon" />
        <span className="okr-row__name">{okr.title}</span>
        <span className="okr-row__spacer" />
        {showLevelChip && <span className="okr-row__chip">{LEVEL_META[okr.level].chip}</span>}
        {due && <span className="okr-row__date">{due}</span>}
        {/* Resolved audience — one shared goal, many contributors. */}
        {okr.audience && okr.audience.assigneeCount > 0 && okr.audience.totalMembers > 0 && (
          <MemberAvatarStack members={okr.audience.members} total={okr.audience.totalMembers} size={20} />
        )}
        {owner ? (
          <span className="okr-row__owner" title={`Owner: ${ownerName || "—"}`}>
            <PersonAvatar person={owner} size={22} />
          </span>
        ) : (
          <span className="okr-row__owner okr-row__owner--none" title="No owner yet">
            <UserIcon />
          </span>
        )}
        <span className="okr-row__prog">
          <span className="okr-row__track">
            {/* Unmeasured goals get a NEUTRAL empty track — no colored
                fill under a "—" pretending something was measured. */}
            {!unmeasured && <span className="okr-row__fill" style={{ width: `${pct}%` }} />}
          </span>
          <span className="okr-row__pct" title={unmeasured ? "No targets yet — add one to start measuring" : undefined}>
            {unmeasured ? "—" : `${pct}%`}
          </span>
        </span>
      </Link>
      {/* Open + Copy link are viewer actions, so the menu always renders;
          Edit / Assign owner / Delete stay gated per-row by the API flags. */}
      <GoalRowMoreMenu
        ref={moreRef}
        goal={{ id: okr.id, title: okr.title }}
        canDelete={okr.canDelete ?? false}
        canEdit={okr.canEdit ?? false}
        onEdit={onEdit}
        onDeleted={onDeleted}
        wrapperClassName="okr-row__menu"
        triggerClassName="okr-row__menu-btn"
      />
    </div>
  );
}
