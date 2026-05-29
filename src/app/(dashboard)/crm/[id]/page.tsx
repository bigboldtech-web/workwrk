"use client";

/* CRM · Opportunity detail — bespoke deal scoreboard.
 *
 * Layout:
 *   OsTitleBar with back-to-CRM in actions slot.
 *   Hero card: status accent strip + account subhead + inline-editable deal name + hero amount.
 *   Pipeline stepper: horizontal progression of all stages, current highlighted.
 *   Scoreboard: 4 KPI tiles (Probability, Weighted, Days to close, Stage progress).
 *   2-col body: Properties (status / amount / owner / close / account / description) + Quick actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BarChart3, Calendar as CalendarIcon, ArrowLeft, Share2, MoreHorizontal,
  DollarSign, TrendingUp, Clock, Flag, Building2, User as UserIcon,
  CheckCircle2, XCircle, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsPickerPopover, type PickerOption } from "@/components/layout/os/picker-popover";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Stage = {
  id: string;
  name: string;
  position?: number;
  color?: string | null;
  isWon?: boolean | null;
  isLost?: boolean | null;
};

type Deal = {
  id: string;
  name: string;
  amount?: number | string | null;
  currency?: string | null;
  expectedCloseDate?: string | null;
  description?: string | null;
  pipelineStageId?: string | null;
  pipelineStage?: Stage | null;
  account?: { id: string; name: string } | null;
  ownerId?: string | null;
};

const PALETTE_BUCKETS = [
  { hex: "#10b981", color: C.green },
  { hex: "#f59e0b", color: C.orange },
  { hex: "#ef4444", color: C.red },
  { hex: "#60a5fa", color: C.blue },
  { hex: "#a78bfa", color: C.purple },
  { hex: "#ec4899", color: C.pink },
  { hex: "#6366f1", color: C.indigo },
  { hex: "#14b8a6", color: C.teal },
  { hex: "#eab308", color: C.yellow },
  { hex: "#94a3b8", color: C.gray },
];
function stageColor(s?: Stage | null): string {
  if (!s) return C.gray;
  if (s.isWon) return C.green;
  if (s.isLost) return C.red;
  if (!s.color) return C.indigo;
  const t = parseInt(s.color.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(t)) return C.indigo;
  const tr = (t >> 16) & 0xff, tg = (t >> 8) & 0xff, tb = t & 0xff;
  let best = PALETTE_BUCKETS[0]; let bestDist = Infinity;
  for (const p of PALETTE_BUCKETS) {
    const v = parseInt(p.hex.replace("#", ""), 16);
    const dr = ((v >> 16) & 0xff) - tr;
    const dg = ((v >> 8) & 0xff) - tg;
    const db = (v & 0xff) - tb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best.color;
}

function fmtFullAmount(n: number, currency = "₹"): string {
  return `${currency}${n.toLocaleString()}`;
}

function dayDiff(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

export default function CrmDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { toast } = useOsToast();
  const { bumpRowVersion } = useOsShell();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [picker, setPicker] = useState<{ rect: DOMRect } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        fetch("/api/crm/opportunities").then((r) => r.ok ? r.json() : null),
        fetch("/api/crm/pipeline-stages").then((r) => r.ok ? r.json() : null),
      ]);
      const list: Deal[] = d?.opportunities ?? d?.data ?? (Array.isArray(d) ? d : []);
      const found = list.find((x) => x.id === id);
      if (!found) { setNotFound(true); setDeal(null); }
      else {
        setDeal(found);
        setTitle(found.name);
        setDescription(found.description ?? "");
        setNotFound(false);
      }
      const stageList: Stage[] = s?.stages ?? s?.data ?? (Array.isArray(s) ? s : []);
      // sort by position so the stepper renders in pipeline order
      stageList.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      setStages(stageList);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(String(res.status));
      bumpRowVersion("crm");
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
  const stage = deal?.pipelineStage ?? null;
  const stageIdx = useMemo(() => stages.findIndex((s) => s.id === stage?.id), [stages, stage]);
  const totalStages = stages.length || 1;
  const probability = useMemo(() => {
    if (!stage) return 0;
    if (stage.isWon) return 100;
    if (stage.isLost) return 0;
    if (stageIdx < 0) return 50;
    return Math.round(Math.min(95, ((stageIdx + 1) / totalStages) * 100));
  }, [stage, stageIdx, totalStages]);

  const amountNum = useMemo(() => {
    if (!deal) return 0;
    if (typeof deal.amount === "string") {
      const n = parseFloat(deal.amount);
      return isFinite(n) ? n : 0;
    }
    return deal.amount ?? 0;
  }, [deal]);

  const weighted = Math.round((amountNum * probability) / 100);
  const closeDays = dayDiff(deal?.expectedCloseDate);

  // ─── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading deal…" Icon={BarChart3} iconGradient={GRAD.greenTeal} showInvite={false} />
        <div className="crmd__loading">Loading deal…</div>
      </>
    );
  }
  if (notFound || !deal) {
    return (
      <>
        <OsTitleBar title="Deal not found" Icon={BarChart3} iconGradient={GRAD.redPink} showInvite={false} />
        <OsEmptyView Icon={BarChart3} iconGradient={GRAD.redPink} title="We couldn't find that deal" subtitle="It may have been deleted, archived, or you don't have access." cta="Back to CRM" />
      </>
    );
  }

  const accent = stageColor(stage);
  const stageOptions: PickerOption[] = stages.map((s) => ({ value: s.id, label: s.name, color: stageColor(s) }));
  const currency = deal.currency ?? "₹";

  return (
    <>
      <OsTitleBar
        title={title || "(untitled deal)"}
        Icon={BarChart3}
        iconGradient={GRAD.greenTeal}
        description={deal.account?.name ? `${deal.account.name} · ${stage?.name ?? "No stage"}` : (stage?.name ?? "No stage")}
        actions={
          <div className="crmd__head-actions">
            <button type="button" className="crmd__back" onClick={() => router.push("/crm")}>
              <ArrowLeft /> CRM
            </button>
            <button type="button" className="crmd__btn" onClick={copyLink}>
              <Share2 /> Copy link
            </button>
            <button type="button" className="crmd__btn crmd__btn--icon" aria-label="More"><MoreHorizontal /></button>
          </div>
        }
      />

      <div className="crmd">
        {/* Hero card */}
        <section className="crmd__hero" style={{ ["--crmd-accent" as unknown as string]: accent }}>
          <span className="crmd__hero-accent" aria-hidden="true" />
          {deal.account?.name && (
            <div className="crmd__hero-acct"><Building2 /> {deal.account.name}</div>
          )}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={async () => {
              const t = title.trim();
              if (!t || t === deal.name) return;
              const ok = await patch({ name: t });
              if (ok) toast("Renamed");
              else setTitle(deal.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Escape") { setTitle(deal.name); (e.target as HTMLInputElement).blur(); }
            }}
            aria-label="Deal name"
            className="crmd__hero-title"
          />
          <div className="crmd__hero-amount">
            <span className="crmd__hero-currency">{currency}</span>
            <span className="crmd__hero-num">{amountNum.toLocaleString()}</span>
            {stage?.isWon && <span className="crmd__hero-tag crmd__hero-tag--won"><CheckCircle2 /> Won</span>}
            {stage?.isLost && <span className="crmd__hero-tag crmd__hero-tag--lost"><XCircle /> Lost</span>}
          </div>
        </section>

        {/* Pipeline stepper */}
        {stages.length > 0 && (
          <section className="crmd__stepper" aria-label="Pipeline stage">
            {stages.map((s, i) => {
              const isCurrent = s.id === stage?.id;
              const isPast = stageIdx >= 0 && i < stageIdx;
              const color = stageColor(s);
              const tone: "past" | "current" | "future" = isCurrent ? "current" : isPast ? "past" : "future";
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`crmd__step crmd__step--${tone}`}
                  style={{ ["--step-c" as unknown as string]: color }}
                  onClick={() => void patch({ pipelineStageId: s.id })}
                  title={`Move to ${s.name}`}
                >
                  <span className="crmd__step-dot" aria-hidden="true">
                    {s.isWon ? <CheckCircle2 /> : s.isLost ? <XCircle /> : (i + 1)}
                  </span>
                  <span className="crmd__step-label">{s.name}</span>
                  {i < stages.length - 1 && <ChevronRight className="crmd__step-sep" />}
                </button>
              );
            })}
          </section>
        )}

        {/* Scoreboard KPIs */}
        <div className="crmd__score">
          <KpiTile
            accent="var(--os-c-green)"
            Icon={DollarSign}
            label="Value"
            value={fmtFullAmount(amountNum, currency)}
            sub="deal amount"
          />
          <KpiTile
            accent="var(--os-c-blue)"
            Icon={TrendingUp}
            label="Probability"
            value={`${probability}%`}
            sub={stage?.isWon ? "closed-won" : stage?.isLost ? "closed-lost" : "stage-derived"}
            progress={probability}
          />
          <KpiTile
            accent="var(--os-c-purple)"
            Icon={TrendingUp}
            label="Weighted"
            value={fmtFullAmount(weighted, currency)}
            sub="value × probability"
          />
          <KpiTile
            accent="var(--os-c-orange)"
            Icon={Clock}
            label="Close"
            value={closeDays === null ? "—" : closeDays < 0 ? `${-closeDays}d ago` : closeDays === 0 ? "Today" : `in ${closeDays}d`}
            sub={deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "no close date"}
          />
        </div>

        {/* 2-col body */}
        <div className="crmd__body">
          <section className="crmd__panel">
            <div className="crmd__panel-head"><Flag /> Properties</div>
            <div className="crmd__props">
              <Prop label="Stage" Icon={Flag}>
                <button
                  type="button"
                  className="crmd__pill"
                  style={{ background: accent, color: "white" }}
                  onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                >
                  {stage?.name ?? "Set stage"}
                </button>
              </Prop>
              <Prop label="Account" Icon={Building2}>
                <span className="crmd__value">{deal.account?.name ?? "—"}</span>
              </Prop>
              <Prop label="Owner" Icon={UserIcon}>
                <span className={deal.ownerId ? "crmd__value" : "crmd__muted"}>{deal.ownerId ?? "Unassigned"}</span>
              </Prop>
              <Prop label="Close date" Icon={CalendarIcon}>
                {deal.expectedCloseDate ? (
                  <span className="crmd__value">{new Date(deal.expectedCloseDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                ) : <span className="crmd__muted">No close date</span>}
              </Prop>
              <Prop label="Amount" Icon={DollarSign}>
                <span className="crmd__value crmd__value--strong">{fmtFullAmount(amountNum, currency)}</span>
              </Prop>
              <Prop label="Description" Icon={Flag} stacked>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={async () => {
                    const d = description.trim();
                    if (d === (deal.description ?? "").trim()) return;
                    const ok = await patch({ description: d });
                    if (ok) toast("Description saved");
                  }}
                  placeholder="Add notes about this deal…"
                  className="crmd__textarea"
                  rows={4}
                />
              </Prop>
            </div>
          </section>

          <aside className="crmd__side">
            <div className="crmd__panel">
              <div className="crmd__panel-head"><CheckCircle2 /> Quick actions</div>
              <div className="crmd__quick">
                {stages.filter((s) => s.isWon).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="crmd__quick-btn crmd__quick-btn--win"
                    onClick={() => void patch({ pipelineStageId: s.id })}
                  >
                    <CheckCircle2 /> Mark as won
                  </button>
                ))}
                {stages.filter((s) => s.isLost).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="crmd__quick-btn crmd__quick-btn--lose"
                    onClick={() => void patch({ pipelineStageId: s.id })}
                  >
                    <XCircle /> Mark as lost
                  </button>
                ))}
                <button type="button" className="crmd__quick-btn" onClick={copyLink}>
                  <Share2 /> Copy share link
                </button>
              </div>
            </div>

            <div className="crmd__panel">
              <div className="crmd__panel-head"><Clock /> Activity</div>
              <div className="crmd__activity-empty">
                Activity log coming soon. For now, your changes update the pipeline live.
              </div>
            </div>
          </aside>
        </div>
      </div>

      {picker ? (
        <OsPickerPopover
          anchorRect={picker.rect}
          title="Set stage"
          options={stageOptions}
          activeValue={deal.pipelineStageId ?? undefined}
          onSelect={async (v) => {
            const ok = await patch({ pipelineStageId: v });
            if (ok) toast(`Moved to ${stages.find((s) => s.id === v)?.name ?? "stage"}`);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub, progress }: { accent: string; Icon: typeof DollarSign; label: string; value: string; sub: string; progress?: number }) {
  return (
    <div className="crmd__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="crmd__kpi-accent" aria-hidden="true" />
      <div className="crmd__kpi-row">
        <div className="crmd__kpi-icon"><Icon /></div>
        <div className="crmd__kpi-label">{label}</div>
      </div>
      <div className="crmd__kpi-value">{value}</div>
      <div className="crmd__kpi-sub">{sub}</div>
      {progress !== undefined && (
        <div className="crmd__kpi-bar">
          <div className="crmd__kpi-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

function Prop({ label, Icon, stacked, children }: { label: string; Icon: typeof Flag; stacked?: boolean; children: React.ReactNode }) {
  return (
    <div className={`crmd__prop${stacked ? " crmd__prop--stacked" : ""}`}>
      <div className="crmd__prop-label"><Icon /> {label}</div>
      <div className="crmd__prop-value">{children}</div>
    </div>
  );
}
