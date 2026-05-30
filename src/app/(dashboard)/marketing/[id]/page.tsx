"use client";

/* Marketing · Campaign detail — bespoke metrics scoreboard.
 *
 *  GET   /api/marketing/campaigns          (no GET-by-id; find in list)
 *  PATCH /api/marketing/campaigns          { id, status?, name?, ... }
 *
 * Layout:
 *   OsTitleBar with back-to-Marketing + copy + more in actions.
 *   Hero card: status accent strip, channel chip, inline-editable name + description, date range.
 *   Lifecycle stepper: Planning → Approved → Active → Completed.
 *   Scoreboard: 4 KPI tiles (Days, Goal %, Spend %, Goal-vs-Spend ratio).
 *   Goal + Budget cards: progress rings with sparkline-style breakdown.
 *   Properties sidebar with quick actions (Pause / Resume / Mark complete).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Megaphone, ArrowLeft, Share2, MoreHorizontal, Calendar as CalendarIcon,
  Target, DollarSign, Activity, Clock, Play, Pause, CheckCircle2,
  Loader2, Flag, ChevronRight, TrendingUp,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsPickerPopover, type PickerOption } from "@/components/layout/os/picker-popover";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type CampaignStatus = "PLANNING" | "APPROVED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

type Campaign = {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  channel?: string | null;
  budget?: number | string | null;
  spent?: number | string | null;
  currency?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  goalMetric?: string | null;
  goalTarget?: number | null;
  goalActual?: number | null;
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  PLANNING: "Planning", APPROVED: "Approved", ACTIVE: "Active",
  PAUSED: "Paused", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<CampaignStatus, string> = {
  PLANNING: C.indigo, APPROVED: C.yellow, ACTIVE: C.orange,
  PAUSED: C.brown, COMPLETED: C.green, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as CampaignStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const LIFECYCLE: CampaignStatus[] = ["PLANNING", "APPROVED", "ACTIVE", "COMPLETED"];

const CHANNEL_COLORS: Record<string, string> = {
  email: C.blue, paid: C.orange, social: C.pink, outbound: C.indigo,
  event: C.purple, content: C.teal, seo: C.green, ads: C.red, webinar: C.purple,
};
function channelColor(ch?: string | null): string {
  if (!ch) return C.gray;
  const k = ch.toLowerCase();
  for (const key of Object.keys(CHANNEL_COLORS)) {
    if (k.includes(key)) return CHANNEL_COLORS[key];
  }
  return C.indigo;
}

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const x = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(x) ? x : 0;
}
function fmtMoney(n: number, currency = "₹"): string {
  return `${currency}${Math.round(n).toLocaleString()}`;
}
function fmtShortDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function dayDiff(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

export default function MarketingDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { toast } = useOsToast();
  const { bumpRowVersion } = useOsShell();

  const [c, setC] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [picker, setPicker] = useState<{ rect: DOMRect } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/marketing/campaigns");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: Campaign[] = data.campaigns ?? data.data ?? (Array.isArray(data) ? data : []);
      const found = list.find((x) => x.id === id);
      if (!found) { setNotFound(true); setC(null); }
      else {
        setC(found);
        setTitle(found.name);
        setDescription(found.description ?? "");
        setNotFound(false);
      }
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        toast("Couldn't save");
        return false;
      }
      bumpRowVersion("marketing");
      void load();
      return true;
    } catch {
      toast("Couldn't save");
      return false;
    }
  }

  function copyLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy"),
    );
  }

  // ─── Derivations ────────────────────────────────────────────
  const budget = useMemo(() => num(c?.budget), [c]);
  const spent = useMemo(() => num(c?.spent), [c]);
  const cur = c?.currency ?? "₹";
  const spentPct = budget === 0 ? 0 : Math.min(100, Math.round((spent / budget) * 100));
  const goalPct = c?.goalTarget
    ? Math.min(100, Math.round(((c.goalActual ?? 0) / (c.goalTarget ?? 1)) * 100))
    : null;
  const daysLeft = dayDiff(c?.endDate);
  const daysElapsed = useMemo(() => {
    if (!c?.startDate) return null;
    const t = new Date(c.startDate).getTime();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today.getTime() - t) / 86_400_000));
  }, [c]);
  const totalDays = useMemo(() => {
    if (!c?.startDate || !c?.endDate) return null;
    return Math.max(1, Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86_400_000));
  }, [c]);
  const timePct = totalDays && daysElapsed !== null ? Math.min(100, Math.round((daysElapsed / totalDays) * 100)) : null;

  // efficiency: goal % vs spend %  > 1 means hitting goal faster than burn
  const efficiency = useMemo(() => {
    if (goalPct === null || budget === 0) return null;
    const ratio = spentPct === 0 ? (goalPct > 0 ? Infinity : 0) : goalPct / spentPct;
    return ratio;
  }, [goalPct, spentPct, budget]);

  // ─── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading campaign…" Icon={Megaphone} iconGradient={GRAD.orangePink} showInvite={false} />
        <div className="camp__loading">Loading campaign…</div>
      </>
    );
  }
  if (notFound || !c) {
    return (
      <>
        <OsTitleBar title="Campaign not found" Icon={Megaphone} iconGradient={GRAD.redPink} showInvite={false} />
        <OsEmptyView Icon={Megaphone} iconGradient={GRAD.redPink} title="We couldn't find that campaign" subtitle="It may have been deleted, archived, or you don't have access." cta="Back to Marketing" />
      </>
    );
  }

  const accent = STATUS_COLORS[c.status];
  const chColor = channelColor(c.channel);
  const StatusIcon = c.status === "ACTIVE" ? Play : c.status === "PAUSED" ? Pause : c.status === "COMPLETED" ? CheckCircle2 : Loader2;

  return (
    <>
      <OsTitleBar
        title={title || "(untitled campaign)"}
        Icon={Megaphone}
        iconGradient={GRAD.orangePink}
        description={`${STATUS_LABELS[c.status]} · ${c.channel ?? "no channel"}`}
        actions={
          <div className="camp__head-actions">
            <button type="button" className="camp__back" onClick={() => router.push("/marketing")}>
              <ArrowLeft /> Marketing
            </button>
            <button type="button" className="camp__btn" onClick={copyLink}>
              <Share2 /> Copy link
            </button>
            <button type="button" className="camp__btn camp__btn--icon" aria-label="More"><MoreHorizontal /></button>
          </div>
        }
      />

      <div className="camp">
        {/* Hero card */}
        <section className="camp__hero" style={{ ["--camp-c" as unknown as string]: accent }}>
          <span className="camp__hero-accent" aria-hidden="true" />
          <div className="camp__hero-meta">
            <span className="camp__hero-status">
              <StatusIcon /> {STATUS_LABELS[c.status]}
            </span>
            {c.channel && (
              <span className="camp__hero-channel" style={{ ["--ch-c" as unknown as string]: chColor }}>
                {c.channel}
              </span>
            )}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={async () => {
              const t = title.trim();
              if (!t || t === c.name) return;
              const ok = await patch({ name: t });
              if (ok) toast("Renamed");
              else setTitle(c.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Escape") { setTitle(c.name); (e.target as HTMLInputElement).blur(); }
            }}
            aria-label="Campaign name"
            className="camp__hero-title"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={async () => {
              const d = description.trim();
              if (d === (c.description ?? "").trim()) return;
              const ok = await patch({ description: d });
              if (ok) toast("Description saved");
            }}
            placeholder="Add a description, brief, or goal copy…"
            aria-label="Campaign description"
            className="camp__hero-desc"
            rows={2}
          />
          <div className="camp__hero-foot">
            <span className="camp__hero-dates">
              <CalendarIcon />
              {fmtShortDate(c.startDate)} → {fmtShortDate(c.endDate)}
            </span>
          </div>
        </section>

        {/* Lifecycle stepper */}
        <section className="camp__lifecycle">
          {LIFECYCLE.map((stage, i) => {
            const currentIdx = LIFECYCLE.indexOf(c.status);
            const isCurrent = stage === c.status;
            const isPast = currentIdx >= 0 && i < currentIdx;
            const tone: "past" | "current" | "future" = isCurrent ? "current" : isPast ? "past" : "future";
            const color = STATUS_COLORS[stage];
            return (
              <button
                key={stage}
                type="button"
                className={`camp__step camp__step--${tone}`}
                style={{ ["--step-c" as unknown as string]: color }}
                onClick={() => void patch({ status: stage })}
                title={`Move to ${STATUS_LABELS[stage]}`}
              >
                <span className="camp__step-dot">{i + 1}</span>
                <span className="camp__step-label">{STATUS_LABELS[stage]}</span>
                {i < LIFECYCLE.length - 1 && <ChevronRight className="camp__step-sep" />}
              </button>
            );
          })}
        </section>

        {/* Scoreboard */}
        <div className="camp__score">
          <ScoreTile
            accent="var(--os-c-orange)"
            Icon={Clock}
            label="Timeline"
            value={daysLeft === null ? "—" : daysLeft < 0 ? `${-daysLeft}d over` : daysLeft === 0 ? "Today" : `${daysLeft}d left`}
            sub={timePct !== null ? `${timePct}% elapsed` : "no end date"}
            progress={timePct ?? undefined}
          />
          <ScoreTile
            accent="var(--os-c-green)"
            Icon={Target}
            label="Goal"
            value={goalPct === null ? "—" : `${goalPct}%`}
            sub={c.goalMetric ? `${c.goalActual ?? 0} / ${c.goalTarget} ${c.goalMetric}` : "no goal set"}
            progress={goalPct ?? undefined}
            hero
          />
          <ScoreTile
            accent={spentPct > 90 ? "var(--os-c-red)" : "var(--os-c-blue)"}
            Icon={DollarSign}
            label="Spend"
            value={budget > 0 ? `${spentPct}%` : "—"}
            sub={budget > 0 ? `${fmtMoney(spent, cur)} / ${fmtMoney(budget, cur)}` : "no budget set"}
            progress={budget > 0 ? spentPct : undefined}
          />
          <ScoreTile
            accent="var(--os-c-purple)"
            Icon={TrendingUp}
            label="Efficiency"
            value={efficiency === null ? "—" : !isFinite(efficiency) ? "Free" : `${efficiency.toFixed(2)}×`}
            sub="goal % ÷ spend %"
          />
        </div>

        {/* 2-col body */}
        <div className="camp__body">
          <section className="camp__panel">
            <div className="camp__panel-head"><Activity /> Properties</div>
            <div className="camp__props">
              <Prop label="Status" Icon={Flag}>
                <button
                  type="button"
                  className="camp__pill"
                  style={{ background: accent, color: "white" }}
                  onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                >
                  {STATUS_LABELS[c.status]}
                </button>
              </Prop>
              <Prop label="Channel" Icon={Megaphone}>
                {c.channel ? (
                  <span className="camp__pill camp__pill--chan" style={{ ["--ch-c" as unknown as string]: chColor }}>
                    {c.channel}
                  </span>
                ) : <span className="camp__muted">—</span>}
              </Prop>
              <Prop label="Budget" Icon={DollarSign}>
                <span className="camp__value camp__value--strong">{budget > 0 ? fmtMoney(budget, cur) : "—"}</span>
              </Prop>
              <Prop label="Spent" Icon={DollarSign}>
                <span className="camp__value">{fmtMoney(spent, cur)}{budget > 0 ? ` · ${spentPct}%` : ""}</span>
              </Prop>
              <Prop label="Goal" Icon={Target}>
                {c.goalMetric ? (
                  <span className="camp__value">{c.goalActual ?? 0} / {c.goalTarget} {c.goalMetric}{goalPct !== null ? ` · ${goalPct}%` : ""}</span>
                ) : <span className="camp__muted">No goal set</span>}
              </Prop>
              <Prop label="Starts" Icon={CalendarIcon}>
                <span className="camp__value">{fmtShortDate(c.startDate)}</span>
              </Prop>
              <Prop label="Ends" Icon={CalendarIcon}>
                <span className="camp__value">{fmtShortDate(c.endDate)}</span>
              </Prop>
            </div>
          </section>

          <aside className="camp__side">
            <div className="camp__panel">
              <div className="camp__panel-head"><CheckCircle2 /> Quick actions</div>
              <div className="camp__quick">
                {c.status === "PLANNING" && (
                  <button type="button" className="camp__quick-btn" onClick={() => patch({ status: "APPROVED" })}>
                    <CheckCircle2 /> Approve
                  </button>
                )}
                {(c.status === "APPROVED" || c.status === "PAUSED") && (
                  <button type="button" className="camp__quick-btn camp__quick-btn--win" onClick={() => patch({ status: "ACTIVE" })}>
                    <Play /> {c.status === "PAUSED" ? "Resume" : "Launch"}
                  </button>
                )}
                {c.status === "ACTIVE" && (
                  <button type="button" className="camp__quick-btn" onClick={() => patch({ status: "PAUSED" })}>
                    <Pause /> Pause
                  </button>
                )}
                {c.status !== "COMPLETED" && c.status !== "CANCELLED" && (
                  <button type="button" className="camp__quick-btn camp__quick-btn--win" onClick={() => patch({ status: "COMPLETED" })}>
                    <CheckCircle2 /> Mark complete
                  </button>
                )}
                <button type="button" className="camp__quick-btn" onClick={copyLink}>
                  <Share2 /> Copy share link
                </button>
              </div>
            </div>

            <div className="camp__panel">
              <div className="camp__panel-head"><Activity /> Activity</div>
              <div className="camp__activity-empty">
                Campaign activity log coming soon. For now, edits update the hub live.
              </div>
            </div>
          </aside>
        </div>
      </div>

      {picker ? (
        <OsPickerPopover
          anchorRect={picker.rect}
          title="Set status"
          options={STATUS_OPTIONS}
          activeValue={c.status}
          onSelect={async (v) => {
            const ok = await patch({ status: v });
            if (ok) toast(`Moved to ${STATUS_LABELS[v as CampaignStatus]}`);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

function ScoreTile({ accent, Icon, label, value, sub, progress, hero }: { accent: string; Icon: typeof Target; label: string; value: string; sub: string; progress?: number; hero?: boolean }) {
  return (
    <div className={`camp__tile${hero ? " camp__tile--hero" : ""}`} style={{ ["--tile-c" as unknown as string]: accent }}>
      <span className="camp__tile-accent" aria-hidden="true" />
      <div className="camp__tile-row">
        <div className="camp__tile-icon"><Icon /></div>
        <div className="camp__tile-label">{label}</div>
      </div>
      <div className="camp__tile-value">{value}</div>
      <div className="camp__tile-sub">{sub}</div>
      {progress !== undefined && (
        <div className="camp__tile-bar"><div className="camp__tile-bar-fill" style={{ width: `${Math.min(100, progress)}%` }} /></div>
      )}
    </div>
  );
}

function Prop({ label, Icon, children }: { label: string; Icon: typeof Flag; children: React.ReactNode }) {
  return (
    <div className="camp__prop">
      <div className="camp__prop-label"><Icon /> {label}</div>
      <div className="camp__prop-value">{children}</div>
    </div>
  );
}
