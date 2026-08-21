"use client";

/* Person career home (client body). Rendered by the server page in one
 * of three modes:
 *
 *   self    "My profile": my role and JD, my KRAs with MY KPI readings
 *           and health, record-my-numbers into the existing approval
 *           loop, my goals (KPI-linked KRs derive automatically), my
 *           reviews / growth / assets.
 *   manage  same narrative about a report, plus manager actions:
 *           edit profile (dialog + autosave kept from the old page),
 *           manage alignment, record numbers on their behalf.
 *   peer    minimal directory card only.
 *
 * Reads:
 *   GET /api/users/[id]              profile (peer gets a minimal payload)
 *   GET /api/people/[id]/alignment   KRAs + KPI gauges + OKRs (self/manage)
 * Writes go through existing endpoints only: /api/users/[id] (PATCH),
 * /api/users/[id]/avatar, and the recorder's self-report / batch routes.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { BackButton } from "@/components/ui/back-button";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Mail, Phone, Building2, Briefcase, Users,
  Target, CheckSquare, TrendingUp, Star, Smile, Zap, Heart,
  Edit3, Save, Package, Laptop, Monitor, Smartphone,
  ArrowDownRight, ArrowUpRight, MoveRight, ChevronRight, Settings2,
  ClipboardCheck, Trophy, Gauge, Clock,
  MoreHorizontal, UserMinus, RotateCcw,
  MessageCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { useAutosave } from "@/hooks/use-autosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthlyKpiRecorder } from "@/components/kpi/monthly-kpi-recorder";
import { KudosReactions } from "@/components/kudos/kudos-reactions";
import { TagPicker } from "@/components/tags/tag-picker";
import { ManageAlignmentDialog } from "./manage-alignment-dialog";
import { RemovePersonDialog } from "./remove-person-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import Link from "next/link";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { StatusChip } from "@/components/ui/chip";
import { TeamStatTile, TeamAvatar, pctColor } from "@/components/team/ui";
import { TAUPE } from "@/components/ui/accent";

type Mode = "self" | "manage" | "peer";

/* ── palette helpers (design system: blue #0073EA, red #E2445C) ───── */

function getScoreColor(score: number) {
  if (score >= 90) return "text-emerald-600";
  if (score >= 70) return "text-[#0073EA]";
  if (score >= 50) return "text-amber-500";
  return "text-red-500";
}

function getScoreBg(score: number) {
  if (score >= 90) return "bg-emerald-500";
  if (score >= 70) return "bg-[#0073EA]";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function statusColor(status: string): string {
  const s = String(status).toUpperCase();
  if (s === "ACTIVE") return "#16a34a";
  if (s === "ON_LEAVE") return "#0073EA";
  if (s === "PROBATION") return "#f59e0b";
  if (s === "PIP" || s === "NOTICE_PERIOD") return "#E2445C";
  return "#71717A";
}

const HEALTH_META: Record<string, { color: string; label: string }> = {
  healthy: { color: "#16a34a", label: "Healthy" },
  at_risk: { color: "#f59e0b", label: "At risk" },
  off_track: { color: "#E2445C", label: "Off track" },
  no_target: { color: "#A1A1AA", label: "No baseline" },
};

const RECORD_STATUS_META: Record<string, { color: string; label: string }> = {
  PENDING: { color: "#71717A", label: "Pending" },
  SUBMITTED: { color: "#0073EA", label: "Submitted" },
  APPROVED: { color: "#16a34a", label: "Approved" },
  REJECTED: { color: "#E2445C", label: "Sent back" },
};

const OKR_STATUS_META: Record<string, { color: string; label: string }> = {
  ON_TRACK: { color: "#16a34a", label: "On track" },
  AT_RISK: { color: "#f59e0b", label: "At risk" },
  BEHIND: { color: "#E2445C", label: "Behind" },
  COMPLETED: { color: "#0073EA", label: "Completed" },
};

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "LOWER") {
    return <ArrowDownRight size={12} className="text-zinc-400" aria-label="Lower is better" />;
  }
  if (direction === "MAINTAIN") {
    return <MoveRight size={12} className="text-zinc-400" aria-label="Hold the line" />;
  }
  return <ArrowUpRight size={12} className="text-zinc-400" aria-label="Higher is better" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] uppercase tracking-wide text-zinc-400 font-medium">{children}</p>
  );
}

const moodEmojis = ["", "😢", "😟", "😐", "😊", "🤩"];

/* ── alignment payload shapes (GET /api/people/[id]/alignment) ────── */

interface AlignKpi {
  id: string;
  name: string;
  description: string | null;
  unit: string | null;
  frequency?: string | null;
  targetValue: number | null;
  targetLabel?: string | null;
  direction: "HIGHER" | "LOWER" | "MAINTAIN";
  ownership: "OWNED" | "SHARED";
  isNorthStar: boolean;
  latestValue: number | null;
  latestPeriod: string | null;
  health: "healthy" | "at_risk" | "off_track" | "no_target";
  currentRecord: {
    id: string;
    status: string;
    actualValue: number | null;
    score: number | null;
    notes?: string | null;
    managerNotes?: string | null;
  } | null;
}

interface AlignKra {
  assignmentId: string;
  weightage: number;
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  roleId: string | null;
  role: { id: string; title: string } | null;
  kpis: AlignKpi[];
}

interface AlignKr {
  id: string;
  title: string;
  unit: string | null;
  progress: number;
  currentValue: number;
  targetValue: number;
  isDerived?: boolean;
  kpi?: { id: string; name: string } | null;
}

interface AlignOkr {
  id: string;
  title: string;
  status: string;
  progress: number;
  /** NONE = nothing measurable yet — render "—", not a fake 0%. */
  progressSource?: "ROLLUP" | "MANUAL" | "NONE";
  quarter: string | null;
  level: string;
  keyResults: AlignKr[];
}

interface AlignRole {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  department: { id: string; name: string } | null;
}

interface AlignmentPayload {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
    role: AlignRole | null;
    manager: { id: string; firstName: string; lastName: string } | null;
  };
  quarter: string;
  currentPeriod: string;
  kras: AlignKra[];
  okrs: AlignOkr[];
}

/* ── lookup shapes for the manage-mode edit dialog ────────────────── */

interface DeptOpt { id: string; name: string }
interface RoleOpt { id: string; title?: string }
interface OfficeOpt { id: string; name: string; city?: string | null; isHeadquarters?: boolean }
interface UserOpt { id: string; firstName?: string; lastName?: string; accessLevel?: string }
interface AssetRow {
  id: string;
  name?: string;
  type?: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  imeiNumber?: string | null;
  condition?: string | null;
  assignedAt?: string | null;
}

/* ═══════════════════ Alignment section (KRAs + KPI gauges) ═══════ */

/** Start (or reopen) a DM with this person and jump into it. */
function MessagePersonButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "DM", memberIds: [userId] }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.id) router.push(`/chat/${d.id}`);
      else setBusy(false);
    } catch { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void go()} disabled={busy} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[14px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50 shrink-0 disabled:opacity-50">
      <MessageCircle size={13} /> {busy ? "Opening…" : "Message"}
    </button>
  );
}


function AlignmentSection({
  id, mode, alignment, loading, onChanged,
}: {
  id: string;
  mode: Mode;
  alignment: AlignmentPayload | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const my = mode === "self";
  const kras = alignment?.kras ?? [];
  const totalWeight = kras.reduce((sum, k) => sum + (k.weightage || 0), 0);
  const subjectName = alignment
    ? `${alignment.user.firstName} ${alignment.user.lastName}`.trim()
    : "";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SectionLabel>{my ? "My KRAs & KPIs" : "KRAs & KPIs"}</SectionLabel>
        <div className="flex-1" />
        {kras.length > 0 ? (
          <span className="text-[12px] text-zinc-400">
            Weight {totalWeight}%{alignment ? ` · ${alignment.currentPeriod}` : ""}
          </span>
        ) : null}
        {mode === "manage" ? (
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
          >
            <Settings2 size={12} /> Manage alignment
          </button>
        ) : null}
        {kras.length > 0 ? (
          <button
            type="button"
            onClick={() => setRecorderOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] ${
              recorderOpen
                ? "text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
                : "bg-[#0073EA] text-white hover:bg-[#0060c2]"
            }`}
          >
            <TrendingUp size={12} />
            {recorderOpen ? "Hide recorder" : my ? "Record my numbers" : "Record numbers"}
          </button>
        ) : null}
      </div>

      {recorderOpen ? <MonthlyKpiRecorder userId={id} self={my} /> : null}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-white rounded-lg border border-zinc-200 animate-pulse" />
          ))}
        </div>
      ) : kras.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-8 text-center">
          <Target size={24} className="mx-auto text-zinc-300 mb-2" />
          <p className="text-[14px] text-zinc-600">
            {my ? "No KRAs assigned to you yet." : "No KRAs assigned yet."}
          </p>
          <p className="text-[13px] text-zinc-400 mt-1">
            {my
              ? "KRAs come with your job title: once your role's template is defined, they appear here."
              : "Assign the role's template with Manage alignment, or define KRAs on the role first."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {kras.map((kra) => (
            <div key={kra.assignmentId} className="rounded-lg border border-zinc-200 bg-white">
              <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
                <Target size={14} className="text-[#0073EA] shrink-0" />
                <p className="text-[14px] font-semibold text-zinc-900 truncate">{kra.name}</p>
                {kra.role ? (
                  <Link
                    href={`/people/roles/${kra.role.id}`}
                    className="text-[12px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 truncate"
                    title={`From job title: ${kra.role.title}`}
                  >
                    {kra.role.title}
                  </Link>
                ) : (
                  <span className="text-[12px] text-amber-600 px-1.5 py-0.5 rounded bg-amber-50" title="This KRA belongs to no job title yet">
                    No job title
                  </span>
                )}
                <div className="flex-1" />
                <span className="text-[12px] text-zinc-400 shrink-0">Weight {kra.weightage}%</span>
              </div>
              {kra.description ? (
                <p className="px-4 pb-2 text-[13px] text-zinc-500 leading-snug">{kra.description}</p>
              ) : null}
              <div className="border-t border-zinc-100">
                {kra.kpis.length === 0 ? (
                  <p className="px-4 py-3 text-[13px] text-zinc-400">No KPIs under this KRA yet.</p>
                ) : (
                  kra.kpis.map((kpi) => {
                    const health = HEALTH_META[kpi.health] ?? HEALTH_META.no_target;
                    const rec = kpi.currentRecord;
                    const recMeta = rec ? RECORD_STATUS_META[rec.status] : null;
                    return (
                      <div key={kpi.id} className="flex items-center gap-2 px-4 py-2 border-b border-zinc-100 last:border-b-0">
                        {kpi.isNorthStar ? (
                          <Star size={12} className="text-amber-500 shrink-0" fill="currentColor" aria-label="North-star KPI" />
                        ) : (
                          <Gauge size={12} className="text-zinc-300 shrink-0" />
                        )}
                        <span className="text-[14px] text-zinc-800 truncate" title={kpi.description ?? undefined}>
                          {kpi.name}
                        </span>
                        <DirectionIcon direction={kpi.direction} />
                        {kpi.ownership === "SHARED" ? (
                          <StatusChip color="#71717A" label="Shared" title="Shared gauge: influenced, reviewed but not graded" />
                        ) : null}
                        <div className="flex-1" />
                        <span
                          className="inline-flex h-2 w-2 rounded-full shrink-0"
                          style={{ background: health.color }}
                          title={health.label}
                        />
                        <span className="text-[13px] font-medium tabular-nums text-zinc-800 min-w-0">
                          {kpi.latestValue != null
                            ? `${kpi.latestValue}${kpi.unit ? ` ${kpi.unit}` : ""}`
                            : "No reading"}
                          {kpi.latestPeriod ? (
                            <span className="text-zinc-400 font-normal"> · {kpi.latestPeriod}</span>
                          ) : null}
                        </span>
                        <span className="text-[13px] text-zinc-400 tabular-nums">
                          {kpi.targetValue != null
                            ? `target ${kpi.targetValue}${kpi.unit ? ` ${kpi.unit}` : ""}`
                            : "no baseline yet"}
                        </span>
                        {recMeta ? (
                          <StatusChip color={recMeta.color} label={recMeta.label} />
                        ) : (
                          <span className="text-[12px] text-zinc-300">Not recorded</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {mode === "manage" ? (
        <ManageAlignmentDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          userId={id}
          userName={subjectName}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

/* ═══════════════════ Goals section (OKRs, KR→KPI derived) ════════ */

function GoalsSection({ mode, alignment, loading }: { mode: Mode; alignment: AlignmentPayload | null; loading: boolean }) {
  const my = mode === "self";
  const okrs = alignment?.okrs ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SectionLabel>{my ? "My goals" : "Goals"}</SectionLabel>
        {alignment ? <span className="text-[12px] text-zinc-400">{alignment.quarter}</span> : null}
        <div className="flex-1" />
        <Link
          href={my ? "/okrs?mine=1" : "/okrs"}
          className="text-[13px] text-[#0073EA] hover:underline"
        >
          All goals
        </Link>
      </div>

      {loading ? (
        <div className="h-20 bg-white rounded-lg border border-zinc-200 animate-pulse" />
      ) : okrs.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center">
          <Trophy size={22} className="mx-auto text-zinc-300 mb-2" />
          <p className="text-[14px] text-zinc-600">
            {my ? "No goals this quarter yet." : "No goals this quarter."}
          </p>
          {my ? (
            <Link href="/okrs?new=1" className="inline-block mt-2 text-[13px] text-[#0073EA] hover:underline">
              Set a goal
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {okrs.map((okr) => {
            const meta = OKR_STATUS_META[okr.status] ?? { color: "#71717A", label: okr.status };
            return (
              <div key={okr.id} className="rounded-lg border border-zinc-200 bg-white">
                <Link href={`/okrs/${okr.id}`} className="flex items-center gap-2.5 px-4 pt-3 pb-2 group">
                  <Trophy size={14} className="text-[#0073EA] shrink-0" />
                  <p className="text-[14px] font-semibold text-zinc-900 truncate group-hover:text-[#0073EA]">
                    {okr.title}
                  </p>
                  <StatusChip color={meta.color} label={meta.label} />
                  <div className="flex-1" />
                  <span className="text-[13px] font-semibold tabular-nums text-zinc-800" title={okr.progressSource === "NONE" ? "No key results yet" : undefined}>
                    {okr.progressSource === "NONE" ? "—" : `${okr.progress}%`}
                  </span>
                  <ChevronRight size={14} className="text-zinc-300 group-hover:text-zinc-500" />
                </Link>
                <div className="px-4 pb-1">
                  <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#0073EA] transition-all"
                      style={{ width: `${Math.min(okr.progress, 100)}%` }}
                    />
                  </div>
                </div>
                {okr.keyResults.length > 0 ? (
                  <div className="mt-1 border-t border-zinc-100">
                    {okr.keyResults.map((kr) => (
                      <div key={kr.id} className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-100 last:border-b-0">
                        <span className="text-[13px] text-zinc-700 truncate">{kr.title}</span>
                        {kr.isDerived && kr.kpi ? (
                          <span
                            className="text-[11px] text-[#0073EA] px-1.5 py-0.5 rounded bg-[#0073EA]/10 shrink-0"
                            title={`Progress derives automatically from the KPI: ${kr.kpi.name}`}
                          >
                            Auto · from KPI
                          </span>
                        ) : null}
                        <div className="flex-1" />
                        <span className="text-[12px] text-zinc-400 tabular-nums">
                          {kr.currentValue} → {kr.targetValue}{kr.unit ? ` ${kr.unit}` : ""}
                        </span>
                        <span className="text-[13px] font-medium tabular-nums text-zinc-800 w-9 text-right">
                          {kr.progress}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ Assets tab (kept from the old page) ═════════ */

function AssetsTab({ userId }: { userId: string }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/assets?assignedToId=${userId}`)
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d) => setAssets(Array.isArray(d) ? d : d?.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-16 bg-zinc-50 rounded-lg animate-pulse" />)}</div>;

  if (assets.length === 0) {
    return (
      <div className="text-center py-12">
        <Package size={32} className="mx-auto text-zinc-400 mb-3" />
        <p className="text-sm text-zinc-500">No assets assigned</p>
        <p className="text-xs text-zinc-400 mt-1">Assets can be assigned from the Assets page</p>
      </div>
    );
  }

  const typeIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = { LAPTOP: Laptop, DESKTOP: Monitor, MONITOR: Monitor, PHONE: Smartphone };

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 mb-3">{assets.length} asset{assets.length !== 1 ? "s" : ""} assigned</p>
      {assets.map((asset) => {
        const Icon = (asset.type && typeIcons[asset.type]) || Package;
        return (
          <Card key={asset.id}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-50 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-zinc-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{asset.name}</p>
                    <Badge variant="outline" className="text-[11px] px-1.5 py-0">{asset.condition}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-zinc-500 mt-0.5">
                    {asset.brand && <span>{asset.brand}</span>}
                    {asset.model && <span>· {asset.model}</span>}
                    {asset.serialNumber && <span>· S/N: {asset.serialNumber}</span>}
                    {asset.imeiNumber && <span>· IMEI: {asset.imeiNumber}</span>}
                  </div>
                </div>
                {asset.assignedAt && (
                  <p className="text-[11px] text-zinc-500 shrink-0">Since {new Date(asset.assignedAt).toLocaleDateString()}</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ═══════════════════ Score breakdown (manage mode) ═══════════════ */

function ScoreBreakdown({ breakdown }: { breakdown: Record<string, unknown> | null }) {
  if (!breakdown) return null;

  // Keys mirror performanceScoreService's stored breakdown; weights live under
  // DIFFERENT keys (kpi/manager/peer/self) — mapping them 1:1 used to render
  // every weight as 0% and dropped the Goal/Task rows entirely.
  const components = [
    { label: "KPI Achievement", key: "kpiScore", weightKey: "kpi", icon: Target },
    { label: "Manager Rating", key: "managerRating", weightKey: "manager", icon: Star },
    { label: "Peer Rating", key: "peerRating", weightKey: "peer", icon: Users },
    { label: "Self Assessment", key: "selfRating", weightKey: "self", icon: Smile },
    { label: "SOP Compliance", key: "sopCompliance", weightKey: "sopCompliance", icon: CheckSquare },
    { label: "Goal Progress", key: "okrScore", fixedWeight: 10, icon: Trophy },
    { label: "Task Delivery", key: "taskScore", fixedWeight: 5, icon: TrendingUp },
  ] as const;

  const weights = (breakdown.weights as Record<string, number>) || {};
  const hasAny = components.some(({ key }) => breakdown[key] != null);
  if (!hasAny) {
    return (
      <p className="text-xs text-zinc-400 leading-relaxed">
        No components measured yet. KPI readings, review ratings, SOP acknowledgements,
        goal check-ins and task delivery feed this score as they accumulate.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {components.map(({ label, key, icon: Icon, ...w }) => {
        const value = breakdown[key] as number | null;
        const weight = "fixedWeight" in w && w.fixedWeight != null ? w.fixedWeight : (weights[(w as { weightKey?: string }).weightKey ?? ""] ?? 0);
        if (value == null) return null;
        return (
          <div key={key} className="flex items-center gap-3">
            <Icon size={12} className="text-zinc-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-500">{label} ({weight}%)</span>
                <span className={`font-mono font-bold ${getScoreColor(value)}`}>{value}</span>
              </div>
              <Progress value={value} className="h-1" indicatorClassName={getScoreBg(value)} />
            </div>
          </div>
        );
      })}
      {(breakdown.kudosBonus as number) > 0 && (
        <div className="flex items-center gap-3">
          <Heart size={12} className="text-[#E2445C] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Kudos Bonus</span>
              <span className="font-mono font-bold text-[#E2445C]">+{breakdown.kudosBonus as number}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreTrendChart({ history }: { history: Array<{ period: string; score: number }> }) {
  if (!history || history.length === 0) {
    return <p className="text-xs text-zinc-500 text-center py-4">No score history yet</p>;
  }

  const maxScore = Math.max(...history.map((h) => h.score), 100);

  return (
    <>
    <div className="flex items-end justify-center gap-4 h-32">
      {history.map((h) => {
        const height = maxScore > 0 ? (h.score / maxScore) * 100 : 0;
        const label = h.period.length === 7
          ? new Date(h.period + "-01").toLocaleString("default", { month: "short", year: "2-digit" }).replace(" ", " \u2019")
          : h.period;
        return (
          <div key={h.period} className="flex w-full max-w-[72px] flex-col items-center gap-1">
            <span className={`text-[11px] font-mono font-bold ${getScoreColor(h.score)}`}>
              {h.score}
            </span>
            <div className="w-full bg-zinc-100 rounded-t-md relative" style={{ height: "100%" }}>
              <div
                className={`absolute bottom-0 w-full rounded-t-md transition-all ${getScoreBg(h.score)}`}
                style={{ height: `${height}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500">{label}</span>
          </div>
        );
      })}
    </div>
    {history.length === 1 ? (
      <p className="mt-2 text-center text-[11px] text-zinc-400">
        First scored month — the trend line builds as monthly scores accumulate.
      </p>
    ) : null}
    </>
  );
}

/* ═══════════════════════════ Page body ═══════════════════════════ */

export default function ProfileClient({ id, mode }: { id: string; mode: Mode }) {
  const router = useRouter();
  const { isAdmin } = useRole();
  // The /api/users/[id] payload mirrors a deep Prisma include tree; we
  // keep it untyped here (same as the old page) and type the alignment
  // payload, which this page actually reasons about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);
  const [alignment, setAlignment] = useState<AlignmentPayload | null>(null);
  const [alignLoading, setAlignLoading] = useState(mode !== "peer");
  const [tab, setTab] = useState("reviews");
  const [loading, setLoading] = useState(true);
  const { success: toastSuccess, error: toastError } = useToast();

  // Edit-profile dialog state (manage mode) — kept from the old page.
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editDepartmentId, setEditDepartmentId] = useState("");
  const [editRoleId, setEditRoleId] = useState("");
  const [editAccessLevel, setEditAccessLevel] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editOfficeId, setEditOfficeId] = useState("");
  const [editManagerId, setEditManagerId] = useState("");
  const [departments, setDepartments] = useState<DeptOpt[]>([]);
  const [roles, setRoles] = useState<RoleOpt[]>([]);
  const [offices, setOffices] = useState<OfficeOpt[]>([]);
  const [allUsers, setAllUsers] = useState<UserOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Offboarding — "…" person-actions menu + remove/restore dialogs
  // (manage mode only; never rendered for self or peers).
  const [personMenuOpen, setPersonMenuOpen] = useState(false);
  const personMenuBtnRef = useRef<HTMLButtonElement>(null);
  const personMenuPanelRef = useRef<HTMLDivElement>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!personMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (personMenuPanelRef.current?.contains(t) || personMenuBtnRef.current?.contains(t)) return;
      setPersonMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPersonMenuOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [personMenuOpen]);

  useEffect(() => {
    if (mode !== "manage") return;
    Promise.all([
      fetch("/api/departments").then((r) => r.ok ? r.json() : []),
      fetch("/api/roles").then((r) => r.ok ? r.json() : []),
      fetch("/api/offices").then((r) => r.ok ? r.json() : []),
      fetch("/api/users?limit=500").then((r) => r.ok ? r.json() : []),
    ]).then(([depts, rls, offs, usrs]) => {
      setDepartments(Array.isArray(depts) ? depts : depts?.data || []);
      setRoles(Array.isArray(rls) ? rls : rls?.data || []);
      setOffices(Array.isArray(offs) ? offs : offs?.data || []);
      setAllUsers(Array.isArray(usrs) ? usrs : usrs?.data || []);
    });
  }, [mode]);

  const loadAlignment = useCallback(() => {
    if (mode === "peer") return;
    setAlignLoading(true);
    fetch(`/api/people/${id}/alignment`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAlignment(data ? (data.data ?? data) : null))
      .catch(() => setAlignment(null))
      .finally(() => setAlignLoading(false));
  }, [id, mode]);

  useEffect(() => { loadAlignment(); }, [loadAlignment]);

  const openEditDialog = () => {
    if (!user) return;
    setEditDepartmentId(user.department?.id || "");
    setEditRoleId(user.role?.id || "");
    setEditAccessLevel(user.accessLevel || "");
    setEditStatus(user.status || "");
    setEditDob(user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split("T")[0] : "");
    setEditOfficeId(user.office?.id || user.officeId || "");
    setEditManagerId(user.manager?.id || user.managerId || "");
    setShowEditDialog(true);
    // Refetch offices in case the user just added one in another tab
    fetch("/api/offices")
      .then((r) => (r.ok ? r.json() : []))
      .then((offs) => setOffices(Array.isArray(offs) ? offs : offs?.data || []))
      .catch(() => {});
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/users/${id}/avatar`, { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        setUser({ ...user, avatar: (data.data || data).avatar });
        toastSuccess("Photo updated");
      } else {
        const err = await res.json();
        toastError(err.error || "Upload failed");
      }
    } catch { toastError("Upload failed"); } finally { setUploadingAvatar(false); }
  };

  // Shared profile-edit core. Used by both the explicit "Done" button
  // and the debounced autosave. `silent=true` suppresses toasts + the
  // post-save refetch so background saves don't disturb the cursor.
  const saveProfileCore = useCallback(
    async (snapshot: {
      departmentId: string;
      roleId: string;
      accessLevel: string;
      status: string;
      dob: string;
      officeId: string;
      managerId: string;
    }, silent: boolean) => {
      const body: Record<string, unknown> = {};
      if (snapshot.departmentId) body.departmentId = snapshot.departmentId;
      if (snapshot.roleId) body.roleId = snapshot.roleId;
      // Only include accessLevel when it actually changed AND the caller
      // is allowed to change it. The API rejects any accessLevel field
      // from non-admins, even when the value is unchanged.
      if (isAdmin && snapshot.accessLevel && snapshot.accessLevel !== user?.accessLevel) {
        body.accessLevel = snapshot.accessLevel;
      }
      if (snapshot.status) body.status = snapshot.status;
      body.dateOfBirth = snapshot.dob ? `${snapshot.dob}T12:00:00.000Z` : null;
      body.officeId = snapshot.officeId || null;
      body.managerId = snapshot.managerId || null;

      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.error || "Failed to update";
        if (!silent) toastError(message);
        throw new Error(message);
      }
      if (!silent) {
        const updated = await fetch(`/api/users/${id}`).then((r) => r.json());
        setUser(updated);
        toastSuccess("Profile updated successfully");
      }
    },
    [id, isAdmin, user?.accessLevel, toastError, toastSuccess],
  );

  // Bind autosave to the same form snapshot. Active only while the
  // dialog is open, with a slightly longer debounce than usual because
  // SelectItem clicks fire one change each (vs typing into a text field
  // which the default 1500ms covers well).
  const profileAutosave = useAutosave({
    snapshot: {
      departmentId: editDepartmentId,
      roleId: editRoleId,
      accessLevel: editAccessLevel,
      status: editStatus,
      dob: editDob,
      officeId: editOfficeId,
      managerId: editManagerId,
    },
    enabled: showEditDialog && !!user,
    delay: 1200,
    save: (s) => saveProfileCore(s, true),
  });

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await saveProfileCore({
        departmentId: editDepartmentId,
        roleId: editRoleId,
        accessLevel: editAccessLevel,
        status: editStatus,
        dob: editDob,
        officeId: editOfficeId,
        managerId: editManagerId,
      }, false);
      setShowEditDialog(false);
      loadAlignment();
    } catch {
      // saveProfileCore already toasted on hard failure path.
    } finally {
      setSaving(false);
    }
  };

  const loadUser = useCallback(() => {
    fetch(`/api/users/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setUser(data?.data ?? data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadUser(); }, [loadUser]);

  if (loading) {
    return (
      <div className="px-6 py-4 space-y-4 max-w-[1100px] mx-auto animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user || user.error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-zinc-500">Person not found</p>
        <Button variant="ghost" className="mt-2" onClick={() => router.push(mode === "peer" || mode === "self" ? "/today" : "/people")}>
          Go back
        </Button>
      </div>
    );
  }

  const my = mode === "self";
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || "?";

  // Restore a removed person (DELETE ?restore=true clears deletedAt).
  const handleRestore = async () => {
    setRestoring(true);
    try {
      const res = await fetch(`/api/users/${id}?restore=true`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Failed to restore");
      }
      toastSuccess(`${fullName} restored`);
      setRestoreOpen(false);
      loadUser();
      router.refresh();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to restore");
    } finally {
      setRestoring(false);
    }
  };
  const role: AlignRole | null = alignment?.user.role ?? (user.role ? { ...user.role, description: null, level: null, department: null } : null);

  /* ── peer: minimal directory card, nothing performance-shaped ──── */
  if (mode === "peer") {
    return (
      <div className="px-6 py-4 max-w-[720px] mx-auto">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-start gap-4">
            <TeamAvatar name={fullName} avatar={user.avatar} size={64} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2">
                <h1 className="text-lg font-semibold text-zinc-900 truncate flex-1">{fullName}</h1>
                {!user.deletedAt && <MessagePersonButton userId={user.id} />}
              </div>
              <p className="text-[14px] text-zinc-600 mt-0.5">{user.role?.title || "No job title"}</p>
              <div className="flex items-center gap-3 flex-wrap mt-2.5 text-[13px] text-zinc-500">
                {user.email ? <a href={`mailto:${user.email}`} className="inline-flex items-center gap-1 hover:text-zinc-800"><Mail size={12} /> {user.email}</a> : null}
                {user.department ? <span className="inline-flex items-center gap-1"><Building2 size={12} /> {user.department.name}</span> : null}
                {user.manager ? <span className="inline-flex items-center gap-1"><Users size={12} /> Reports to {user.manager.firstName} {user.manager.lastName}</span> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const perf = user.performanceSummary;
  const directReports = user.directReports ?? [];

  return (
    <div className="px-6 py-4 space-y-5 max-w-[1100px] mx-auto">
      {/* ── identity header ──────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-3">
          {my ? (
            <span>My Profile</span>
          ) : (
            <>
              <BackButton fallbackHref="/people" className="inline-flex items-center rounded-md p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800" />
              <Link href="/team" className="hover:text-zinc-900">Teams</Link>
              <span className="text-zinc-300">/</span>
              <Link href="/people" className="hover:text-zinc-900">Directory</Link>
              <span className="text-zinc-300">/</span>
              <span className="truncate">{fullName}</span>
            </>
          )}
        </div>
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <TeamAvatar name={fullName} avatar={user.avatar} size={72} />
            {/* Write affordance mirrors POST /api/users/[id]/avatar: own
                photo, or manage-mode viewers (org-wide / manager tree).
                Removed people can't get new photos. */}
            {(my || mode === "manage") && !user.deletedAt ? (
              <label className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-white border border-zinc-200 shadow-sm inline-flex items-center justify-center cursor-pointer text-zinc-500 hover:text-zinc-800" title={uploadingAvatar ? "Uploading…" : "Upload photo"}>
                {uploadingAvatar ? <span className="text-[10px]">…</span> : <Edit3 size={12} />}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} disabled={uploadingAvatar} className="hidden" />
              </label>
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <h1 className="text-xl font-semibold text-zinc-900 truncate">{fullName}</h1>
              <div className="flex-1" />
              {mode === "manage" ? (
                <>
                  {!user.deletedAt && !my && <MessagePersonButton userId={user.id} />}
                  <button type="button" onClick={openEditDialog} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[14px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50 shrink-0">
                    <Edit3 size={13} /> Edit profile
                  </button>
                  <button
                    ref={personMenuBtnRef}
                    type="button"
                    onClick={() => setPersonMenuOpen((v) => !v)}
                    aria-label="Person actions"
                    aria-haspopup="menu"
                    aria-expanded={personMenuOpen}
                    title="More actions"
                    className={`inline-flex items-center justify-center h-8 w-8 rounded-md border border-zinc-200 shrink-0 ${
                      personMenuOpen ? "bg-zinc-100 text-zinc-800" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                    }`}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  <MorePortal anchorRef={personMenuBtnRef} panelRef={personMenuPanelRef} width={232} open={personMenuOpen} placement="below">
                    <MenuList>
                      {user.deletedAt ? (
                        <MenuItem
                          icon={RotateCcw}
                          label="Restore to company"
                          onClick={() => { setPersonMenuOpen(false); setRestoreOpen(true); }}
                        />
                      ) : (
                        <MenuItem
                          icon={UserMinus}
                          destructive
                          label="Remove from company"
                          onClick={() => { setPersonMenuOpen(false); setRemoveOpen(true); }}
                        />
                      )}
                    </MenuList>
                  </MorePortal>
                </>
              ) : (
                <Link href="/account/profile" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[14px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50 shrink-0">
                  <Edit3 size={13} /> Edit personal info
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <StatusChip color={statusColor(user.status)} label={String(user.status).replace(/_/g, " ")} />
              {user.deletedAt ? (
                <StatusChip
                  color="#E2445C"
                  label={`Removed ${new Date(user.deletedAt).toLocaleDateString()}`}
                  title="No longer with the company. Restore from the actions menu."
                />
              ) : null}
              <span className="text-[12px] font-medium text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 uppercase tracking-wide">{String(user.accessLevel).replace(/_/g, " ")}</span>
            </div>
            {role ? (
              <Link href={`/people/roles/${role.id}`} className="inline-flex items-center gap-1 text-[14px] text-zinc-600 mt-1.5 hover:text-[#0073EA]">
                <Briefcase size={12} /> {role.title}
              </Link>
            ) : (
              <p className="text-[14px] text-zinc-400 mt-1.5">No job title yet</p>
            )}
            <div className="flex items-center gap-3 flex-wrap mt-2.5 text-[13px] text-zinc-500">
              <a href={`mailto:${user.email}`} className="inline-flex items-center gap-1 hover:text-zinc-800"><Mail size={12} /> {user.email}</a>
              {user.phone ? <a href={`tel:${user.phone}`} className="inline-flex items-center gap-1 hover:text-zinc-800"><Phone size={12} /> {user.phone}</a> : null}
              {user.department ? <span className="inline-flex items-center gap-1"><Building2 size={12} /> {user.department.name}</span> : null}
              {user.manager ? (
                <span className="inline-flex items-center gap-1">
                  <Users size={12} /> Reports to {user.manager.firstName} {user.manager.lastName}
                </span>
              ) : null}
            </div>
            <div className="mt-2.5">
              <TagPicker entityType="USER" entityId={user.id} canEdit={mode === "manage"} />
            </div>
          </div>
        </div>
      </div>

      {/* ── edit dialog (manage mode; wiring kept from the old page) ── */}
      {mode === "manage" ? (
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit {fullName}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={editDepartmentId} onValueChange={setEditDepartmentId}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editRoleId} onValueChange={setEditRoleId}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Access Level {!isAdmin && <span className="text-[11px] text-zinc-400">(admin only)</span>}</Label>
                <Select value={editAccessLevel} onValueChange={setEditAccessLevel} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AGENT">Agent</SelectItem>
                    <SelectItem value="EMPLOYEE">Employee</SelectItem>
                    <SelectItem value="TEAM_LEAD">Team Lead</SelectItem>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="DIRECTOR">Director</SelectItem>
                    <SelectItem value="VP">VP</SelectItem>
                    <SelectItem value="C_LEVEL">C-Level</SelectItem>
                    <SelectItem value="HR">HR</SelectItem>
                    {/* Granting admin is admin-only; keep the option
                        visible when the person already holds it so the
                        select doesn't render blank. */}
                    {isAdmin || editAccessLevel === "COMPANY_ADMIN" ? (
                      <SelectItem value="COMPANY_ADMIN">Company Admin</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reports To</Label>
                <Select value={editManagerId || "none"} onValueChange={(v) => setEditManagerId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select reporting manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No reporting manager</SelectItem>
                    {allUsers
                      .filter((u) => u.id !== id && u.accessLevel != null && ["MANAGER", "TEAM_LEAD", "HR", "DIRECTOR", "VP", "C_LEVEL", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(u.accessLevel))
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                      ))
                    }
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    {/* ON_LEAVE / PROBATION / PIP / NOTICE_PERIOD were HRIS
                        lifecycle states — no workflow consumes them anymore,
                        so they are no longer offered. Existing values still
                        display via statusColor; the enum stays in the schema. */}
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    {editStatus && editStatus !== "ACTIVE" ? (
                      <SelectItem value={editStatus}>{editStatus.replace(/_/g, " ")} (legacy)</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date of Birth</Label>
                <Input type="date" value={editDob} onChange={(e) => setEditDob(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Office / Location</Label>
                <Select value={editOfficeId || "__none__"} onValueChange={(v) => setEditOfficeId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select office" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No office</SelectItem>
                    {offices.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500">
                        No offices yet. Add one in <span className="text-[#0073EA]">Organization, Offices</span>.
                      </div>
                    ) : (
                      offices.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}{o.city ? ` · ${o.city}` : ""}{o.isHeadquarters ? " (HQ)" : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <AutosaveIndicator
                status={profileAutosave.status}
                lastSavedAt={profileAutosave.lastSavedAt}
                className="mr-auto"
              />
              <Button variant="outline" onClick={() => setShowEditDialog(false)}>Close</Button>
              <Button onClick={handleSaveEdit} disabled={saving} className="gap-1.5">
                <Save size={14} /> {saving ? "Saving..." : "Done"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* ── offboarding dialogs (manage mode) ────────────────────── */}
      {mode === "manage" ? (
        <>
          <RemovePersonDialog
            open={removeOpen}
            onClose={() => setRemoveOpen(false)}
            userId={id}
            userName={fullName}
            firstName={user.firstName || fullName}
            candidates={allUsers.filter((u) => u.id !== id)}
            onRemoved={() => {
              setRemoveOpen(false);
              loadUser();
              loadAlignment();
              router.refresh();
            }}
          />
          <ConfirmDialog
            open={restoreOpen}
            onClose={() => setRestoreOpen(false)}
            onConfirm={handleRestore}
            title={`Restore ${fullName} to the company`}
            description="They regain access on their next sign-in. Their history (tasks, docs, reviews and records) picks up exactly where it left off."
            confirmLabel="Restore"
            destructive={false}
            loading={restoring}
          />
        </>
      ) : null}

      {/* ── the role: job title + JD ─────────────────────────────── */}
      <div className="space-y-2">
        <SectionLabel>{my ? "My role" : "Role"}</SectionLabel>
        {role ? (
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <Briefcase size={14} className="text-[#0073EA] shrink-0" />
              <p className="text-[14px] font-semibold text-zinc-900 truncate">{role.title}</p>
              {role.level ? (
                <span className="text-[12px] font-medium text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 uppercase tracking-wide">{role.level}</span>
              ) : null}
              {role.department ? (
                <span className="text-[12px] text-zinc-400">{role.department.name}</span>
              ) : null}
              <div className="flex-1" />
              <Link href={`/people/roles/${role.id}`} className="text-[13px] text-[#0073EA] hover:underline shrink-0">
                View role definition
              </Link>
            </div>
            {role.description ? (
              <p className="text-[13.5px] text-zinc-600 leading-relaxed mt-2">{role.description}</p>
            ) : (
              <p className="text-[13px] text-zinc-400 mt-2">
                No role description yet. The job description lives on the role definition page.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-5 text-center">
            <Briefcase size={20} className="mx-auto text-zinc-300 mb-1.5" />
            <p className="text-[14px] text-zinc-600">
              {my ? "You have no job title yet." : "No job title assigned yet."}
            </p>
            <p className="text-[13px] text-zinc-400 mt-1">
              {my
                ? "KRAs and KPIs come with a job title: ask your manager to assign yours."
                : "Assign one with Edit profile, the role's KRAs and KPIs seed automatically."}
            </p>
          </div>
        )}
      </div>

      {/* ── what I own and how it reads: KRAs + KPI gauges ───────── */}
      <AlignmentSection id={id} mode={mode} alignment={alignment} loading={alignLoading} onChanged={loadAlignment} />

      {/* ── goals ────────────────────────────────────────────────── */}
      <GoalsSection mode={mode} alignment={alignment} loading={alignLoading} />

      {/* ── composite performance (manager view) ─────────────────── */}
      {mode === "manage" && perf?.compositeScore != null && (
        <Card className="border-zinc-200 bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-6">
              <div className="text-center">
                <Zap size={20} className="mx-auto text-[#0073EA] mb-1" />
                <p className={`text-4xl font-bold font-mono ${getScoreColor(perf.compositeScore)}`}>
                  {perf.compositeScore}
                </p>
                <p className="text-xs text-zinc-500 mt-1">Composite Score</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-500 font-medium mb-2">Score Breakdown</p>
                <ScoreBreakdown breakdown={perf.scoreBreakdown} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "manage" && user.scoreHistory && user.scoreHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Performance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreTrendChart history={user.scoreHistory} />
          </CardContent>
        </Card>
      )}

      {mode === "manage" && perf && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <TeamStatTile icon={Target} label="Avg KPI Score" value={perf.avgKPI ?? "N/A"} accent={perf.avgKPI ? pctColor(perf.avgKPI) : "#71717A"} />
          <TeamStatTile icon={Target} label="Active KRAs" value={perf.activeKRAs ?? 0} accent={TAUPE.soft} />
          <TeamStatTile icon={Smile} label="Avg Mood" value={perf.avgMood ?? "N/A"} accent="#16a34a" />
          <TeamStatTile icon={Star} label="Review Score" value={perf.latestReviewScore ?? "N/A"} accent={perf.latestReviewScore ? pctColor(perf.latestReviewScore) : "#71717A"} />
        </div>
      )}

      {/* ── the record: reviews, growth, assets, reports ─────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <ViewTabStrip className="overflow-x-auto">
          {([
            { k: "reviews", label: my ? "My reviews" : "Reviews", Icon: ClipboardCheck, tile: "#0073EA" },
            { k: "history", label: "KPI history", Icon: Clock, tile: "#16a34a" },
            { k: "skills", label: "Skills", Icon: Zap, tile: "#f59e0b" },
            { k: "kudos", label: "Kudos", Icon: Heart, tile: "#E2445C" },
            { k: "checkins", label: "Check-ins", Icon: Smile, tile: "#16a34a" },
            { k: "assets", label: "Assets", Icon: Package, tile: "#71717A" },
            ...(directReports.length > 0
              ? [{ k: "reports", label: "Direct Reports", Icon: Users, tile: "#0073EA" } as const]
              : []),
          ]).map((t) => (
            <ViewTab
              key={t.k}
              icon={t.Icon}
              iconTileColor={t.tile}
              label={t.label}
              active={tab === t.k}
              onClick={() => setTab(t.k)}
              trailing={t.k === "kudos" && user._count?.kudosReceived > 0 ? <span className="text-[11px] text-zinc-400">{user._count.kudosReceived}</span> : undefined}
            />
          ))}
        </ViewTabStrip>

        <TabsContent value="reviews" className="mt-4 space-y-2">
          {my ? (
            <Link href="/me/weekly-review" className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-[14px] text-zinc-700 hover:bg-zinc-50">
              <ClipboardCheck size={14} className="text-[#0073EA]" />
              <span className="flex-1">My weekly review</span>
              <ChevronRight size={14} className="text-zinc-300" />
            </Link>
          ) : null}
          {(user.reviewsAsSubject ?? []).length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No reviews yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.reviewsAsSubject.map((r: any) => (
              <div key={r.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.cycle.name}</p>
                    <p className="text-xs text-zinc-500">
                      Reviewed by {r.reviewer.firstName} {r.reviewer.lastName}
                    </p>
                  </div>
                  <div className="text-right">
                    {r.overallScore != null && (
                      <p className={`text-lg font-bold font-mono ${getScoreColor(r.overallScore)}`}>{r.overallScore}</p>
                    )}
                    {r.outcome && (
                      <StatusChip
                        color={r.outcome === "PROMOTION_ELIGIBLE" ? "#16a34a" : "#71717A"}
                        label={String(r.outcome).replace(/_/g, " ")}
                      />
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <StatusChip color={r.status === "COMPLETED" ? "#16a34a" : "#0073EA"} label={r.status} />
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-2">
          {(user.kpiRecords ?? []).length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No KPI records yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.kpiRecords.map((r: any) => (
              <div key={r.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.kpi.name}</p>
                    <p className="text-xs text-zinc-500">Period: {r.period}{r.kpi.unit ? ` · ${r.kpi.unit}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold font-mono ${r.score != null ? getScoreColor(r.score) : "text-zinc-400"}`}>
                      {r.score ?? "Pending"}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {r.actualValue ?? "?"}/{r.targetValue}
                    </p>
                  </div>
                </div>
                {r.score != null && (
                  <Progress value={Math.min(r.score, 100)} className="h-1.5 mt-2" indicatorClassName={getScoreBg(r.score)} />
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          {(user.skills ?? []).length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No skills added yet</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {user.skills.map((s: any) => (
                <div key={s.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{s.name}</p>
                    <span className="text-xs text-zinc-500">{s.selfRating}/10</span>
                  </div>
                  <Progress value={s.selfRating * 10} className="h-1.5" indicatorClassName="bg-[#0073EA]" />
                  {s.managerRating && (
                    <p className="text-[11px] text-zinc-500 mt-1">Manager rating: {s.managerRating}/10</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="kudos" className="mt-4 space-y-2">
          {(!user.kudosReceived || user.kudosReceived.length === 0) ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No kudos received yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.kudosReceived.map((k: any) => (
              <div key={k.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <Heart size={14} className="text-[#E2445C] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-500">
                      From <span className="text-zinc-900 font-medium">{k.giver.firstName} {k.giver.lastName}</span>
                    </p>
                    <p className="text-sm mt-1 italic text-zinc-600">&ldquo;{k.message}&rdquo;</p>
                    <div className="flex items-center gap-2 mt-2">
                      {k.companyValue && (
                        <Badge variant="outline" className="text-[11px] uppercase tracking-wider border-[#0073EA]/30 text-[#0073EA]">{k.companyValue}</Badge>
                      )}
                      <span className="text-[11px] text-zinc-500">{new Date(k.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-zinc-100">
                      <KudosReactions
                        kudosId={k.id}
                        initialCounts={k.reactionCounts || []}
                        initialMine={k.myReactions || []}
                        compact
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="checkins" className="mt-4 space-y-2">
          {(user.checkIns ?? []).length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No check-ins yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.checkIns.map((c: any) => (
              <div key={c.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{moodEmojis[c.mood] || "😐"}</span>
                  <span className="text-xs text-zinc-500">{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
                {c.wentWell && <p className="text-xs text-emerald-600 mb-1">✓ {c.wentWell}</p>}
                {c.challenges && <p className="text-xs text-amber-600 mb-1">⚠ {c.challenges}</p>}
                {c.tomorrow && <p className="text-xs text-[#0073EA]">→ {c.tomorrow}</p>}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="assets" className="mt-4">
          <AssetsTab userId={id} />
        </TabsContent>

        {directReports.length > 0 ? (
          <TabsContent value="reports" className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {directReports.map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 cursor-pointer hover:border-zinc-300 transition-colors"
                  onClick={() => router.push(`/people/${r.id}`)}
                >
                  <TeamAvatar name={`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()} avatar={r.avatar} size={40} />
                  <div>
                    <p className="text-sm font-medium">{r.firstName} {r.lastName}</p>
                    <p className="text-xs text-zinc-500">{r.role?.title || "No role"}</p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
