"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Mail, Phone, Building2, Briefcase, Users,
  Target, CheckSquare, TrendingUp, Clock, Star, Smile, Zap, Heart,
  Edit3, Save, Package, Laptop, Monitor, Smartphone,
  ChevronDown, ChevronUp, CalendarClock, ArrowDownRight, ArrowUpRight, Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { useAutosave } from "@/hooks/use-autosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthlyKpiRecorder } from "@/components/kpi/monthly-kpi-recorder";
import { KudosReactions } from "@/components/kudos/kudos-reactions";
import { TagPicker } from "@/components/tags/tag-picker";

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-[color:var(--accent-strong)]";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-green-500/20 text-green-400",
    INACTIVE: "bg-slate-500/20 text-slate-400",
    ON_LEAVE: "bg-blue-500/20 text-blue-400",
    PROBATION: "bg-orange-500/20 text-orange-400",
    PIP: "bg-red-500/20 text-red-400",
    NOTICE_PERIOD: "bg-yellow-500/20 text-yellow-400",
  };
  return styles[status] || "bg-slate-500/20 text-slate-400";
}

function getPriorityStyle(p: string) {
  switch (p) {
    case "P0": return "bg-red-500/20 text-red-400";
    case "P1": return "bg-orange-500/20 text-orange-400";
    case "P2": return "bg-[rgba(212,255,46,0.12)] text-[color:var(--accent-strong)]";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

function getTaskStatusStyle(s: string) {
  switch (s) {
    case "COMPLETED": return "bg-green-500/20 text-green-400";
    case "IN_PROGRESS": return "bg-blue-500/20 text-blue-400";
    case "IN_REVIEW": return "bg-[rgba(212,255,46,0.12)] text-[color:var(--accent-strong)]";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

const moodEmojis = ["", "😢", "😟", "😐", "😊", "🤩"];

function getProgressColor(pct: number) {
  if (pct >= 90) return "bg-green-500";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

function getScoreBg(score: number) {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-violet-600";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function ScoreTrendChart({ history }: { history: Array<{ period: string; score: number }> }) {
  if (!history || history.length === 0) {
    return <p className="text-xs text-muted text-center py-4">No score history yet</p>;
  }

  const maxScore = Math.max(...history.map((h) => h.score), 100);

  return (
    <div className="flex items-end gap-3 h-32">
      {history.map((h) => {
        const height = maxScore > 0 ? (h.score / maxScore) * 100 : 0;
        const label = h.period.length === 7
          ? new Date(h.period + "-01").toLocaleString("default", { month: "short", year: "2-digit" })
          : h.period;
        return (
          <div key={h.period} className="flex-1 flex flex-col items-center gap-1">
            <span className={`text-[10px] font-mono font-bold ${getScoreColor(h.score)}`}>
              {h.score}
            </span>
            <div className="w-full bg-border rounded-t-md relative" style={{ height: "100%" }}>
              <div
                className={`absolute bottom-0 w-full rounded-t-md transition-all ${getScoreBg(h.score)}`}
                style={{ height: `${height}%` }}
              />
            </div>
            <span className="text-[9px] text-muted">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ScoreBreakdown({ breakdown }: { breakdown: Record<string, unknown> | null }) {
  if (!breakdown) return null;

  const components = [
    { label: "KPI Achievement", key: "kpiScore", icon: Target },
    { label: "Manager Rating", key: "managerRating", icon: Star },
    { label: "Peer Rating", key: "peerRating", icon: Users },
    { label: "Self Assessment", key: "selfRating", icon: Smile },
    { label: "SOP Compliance", key: "sopCompliance", icon: CheckSquare },
    { label: "Task Completion", key: "taskCompletion", icon: TrendingUp },
  ];

  const weights = (breakdown.weights as Record<string, number>) || {};

  return (
    <div className="space-y-2">
      {components.map(({ label, key, icon: Icon }) => {
        const value = breakdown[key] as number | null;
        const weight = weights[key] ?? 0;
        if (value == null) return null;
        return (
          <div key={key} className="flex items-center gap-3">
            <Icon size={12} className="text-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted">{label} ({weight}%)</span>
                <span className={`font-mono font-bold ${getScoreColor(value)}`}>{value}</span>
              </div>
              <Progress value={value} className="h-1" indicatorClassName={getScoreBg(value)} />
            </div>
          </div>
        );
      })}
      {(breakdown.kudosBonus as number) > 0 && (
        <div className="flex items-center gap-3">
          <Heart size={12} className="text-pink-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Kudos Bonus</span>
              <span className="font-mono font-bold text-pink-400">+{breakdown.kudosBonus as number}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FREQ_LABELS: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
};

const FREQ_COLORS: Record<string, string> = {
  DAILY: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  WEEKLY: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  MONTHLY: "bg-[rgba(212,255,46,0.1)] text-[color:var(--accent-strong)] border-[rgba(212,255,46,0.2)]",
  QUARTERLY: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  ANNUALLY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

// ─── Local data shapes ──────────────────────────────────────────────
// Lookup arrays only. The full UserDetail shape from /api/users/[id]
// is too polymorphic to hand-type without mirroring the entire Prisma
// include tree (kpiRecords / scoreHistory / performanceSummary / _count
// / etc.). We leave `user` as `any` for now and tighten the rest.

interface DeptOpt { id: string; name: string }
interface RoleOpt { id: string; title?: string; name?: string; description?: string | null; departmentId?: string | null; level?: string }
interface OfficeOpt { id: string; name: string; city?: string | null; country?: string | null; isHeadquarters?: boolean }
interface UserOpt { id: string; firstName?: string; lastName?: string; role?: { title?: string } | null; accessLevel?: string }
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

function KraAssignmentsTab({ userId }: { userId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKras, setExpandedKras] = useState<Set<string>>(new Set());
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const periodOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("default", { month: "short", year: "numeric" });
    return { value: val, label: label + (i === 0 ? " (Current)" : "") };
  });

  useEffect(() => {
    fetch(`/api/kra-assignments?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        const items = Array.isArray(data) ? data : data.assignments ?? data.data ?? [];
        setAssignments(items);
        // Auto-expand all KRAs so user sees everything
        setExpandedKras(new Set(items.map((a: { id: string }) => a.id)));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  const toggleKra = (id: string) => {
    setExpandedKras((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalWeightage = assignments.reduce((sum: number, a: any) => sum + (a.weightage || 0), 0);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map((i) => (
          <div key={i} className="h-24 bg-surface rounded-lg border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (assignments.length === 0) {
    return <p className="text-muted text-sm py-8 text-center">No KRA assignments yet</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted">
          Total weightage: <span className={totalWeightage === 100 ? "text-green-400 font-medium" : "text-orange-400 font-medium"}>{totalWeightage}%</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Showing KPI data for:</span>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="text-xs bg-surface border border-border rounded px-2 py-1"
          >
            {periodOptions.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>
      <Progress
        value={Math.min(totalWeightage, 100)}
        className="h-1.5"
        indicatorClassName={totalWeightage === 100 ? "bg-green-500" : "bg-orange-500"}
      />

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {assignments.map((a: any) => {
        const isExpanded = expandedKras.has(a.id);
        const kpis = a.kra?.kpis ?? [];

        // Calculate overall KRA score from KPIs
        let totalPct = 0;
        let recordedCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kpiDetails = kpis.map((kpi: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const record = kpi.records?.find((r: any) => r.period === selectedPeriod) || kpi.records?.[0];
          const target = record?.targetValue || kpi.targetValue || 0;
          const actual = record?.actualValue ?? null;
          const pct = actual != null && target > 0 ? Math.min(Math.round((actual / target) * 100), 120) : 0;
          if (actual != null) { totalPct += pct; recordedCount++; }
          return { ...kpi, record, target, actual, pct, period: record?.period };
        });
        const avgScore = recordedCount > 0 ? Math.round(totalPct / recordedCount) : null;

        return (
          <div key={a.id} className="rounded-lg border border-border bg-surface overflow-hidden">
            {/* KRA Header - always visible */}
            <button
              onClick={() => toggleKra(a.id)}
              className="w-full text-left p-4 hover:bg-surface-2/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Target size={15} className="text-[color:var(--accent-strong)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{a.kra?.name}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {a.kra?.category && <Badge variant="outline" className="text-[9px]">{a.kra.category}</Badge>}
                      <Badge className={`text-[9px] ${a.status === "ACTIVE" ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"}`}>{a.status}</Badge>
                      <span className="text-[9px] text-muted">&middot; {kpis.length} KPI{kpis.length !== 1 ? "s" : ""}</span>
                      {a.period && a.period !== "ongoing" && (
                        <span className="text-[9px] text-muted">&middot; Period: {a.period}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  {avgScore != null && (
                    <div className="text-right">
                      <p className={`text-base font-bold font-mono ${getScoreColor(avgScore)}`}>{avgScore}%</p>
                      <p className="text-[9px] text-muted">avg score</p>
                    </div>
                  )}
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono text-[color:var(--accent-strong)]">{a.weightage}%</p>
                    <p className="text-[9px] text-muted">weight</p>
                  </div>
                  {isExpanded ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                </div>
              </div>
            </button>

            {/* Expanded Details */}
            {isExpanded && (
              <div className="border-t border-border">
                {/* KRA Description */}
                {a.kra?.description && (
                  <div className="px-4 py-2.5 bg-surface-2/30 border-b border-border">
                    <p className="text-[11px] text-muted leading-relaxed">{a.kra.description}</p>
                  </div>
                )}

                {/* KPI Details */}
                <div className="divide-y divide-border">
                  {kpiDetails.length === 0 ? (
                    <p className="text-xs text-muted p-4 text-center">No KPIs defined for this KRA</p>
                  ) : (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    kpiDetails.map((kpi: any, i: number) => (
                      <div key={i} className="px-4 py-3">
                        {/* KPI Header Row */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">{kpi.name}</p>
                            {kpi.description && (
                              <p className="text-[10px] text-muted mt-0.5 leading-snug">{kpi.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {kpi.actual != null ? (
                              <span className={`text-xs font-semibold font-mono ${getScoreColor(kpi.pct)}`}>{kpi.pct}%</span>
                            ) : (
                              <span className="text-[10px] text-muted">Not recorded</span>
                            )}
                          </div>
                        </div>

                        {/* KPI Meta Tags */}
                        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                          {kpi.frequency && (
                            <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${FREQ_COLORS[kpi.frequency] || "bg-slate-500/15 text-slate-400 border-slate-500/20"}`}>
                              <CalendarClock size={8} />
                              {FREQ_LABELS[kpi.frequency] || kpi.frequency}
                            </span>
                          )}
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/10 text-muted border border-border">
                            {kpi.type === "QUALITATIVE" ? "Qualitative" : "Quantitative"}
                          </span>
                          {kpi.lowerIsBetter && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              <ArrowDownRight size={8} /> Lower is better
                            </span>
                          )}
                          {kpi.unit && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/10 text-muted border border-border">
                              Unit: {kpi.unit}
                            </span>
                          )}
                        </div>

                        {/* Target & Actual Values */}
                        <div className="flex items-center gap-4 mb-1.5">
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="text-muted">Target:</span>
                            <span className="font-medium font-mono">{kpi.target}{kpi.unit ? ` ${kpi.unit}` : ""}</span>
                            {kpi.targetLabel && <span className="text-muted">({kpi.targetLabel})</span>}
                          </div>
                          {kpi.actual != null && (
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="text-muted">Actual:</span>
                              <span className={`font-medium font-mono ${getScoreColor(kpi.pct)}`}>{kpi.actual}{kpi.unit ? ` ${kpi.unit}` : ""}</span>
                            </div>
                          )}
                        </div>

                        {/* Progress Bar */}
                        <Progress
                          value={Math.min(kpi.pct, 100)}
                          className="h-1.5"
                          indicatorClassName={kpi.actual != null ? getProgressColor(kpi.pct) : "bg-border"}
                        />

                        {/* Record details */}
                        {kpi.record && (
                          <div className="flex items-center gap-3 mt-1.5">
                            {kpi.record.status && (
                              <span className={`text-[9px] ${kpi.record.status === "APPROVED" ? "text-green-400" : kpi.record.status === "REJECTED" ? "text-red-400" : "text-muted"}`}>
                                {kpi.record.status}
                              </span>
                            )}
                            {kpi.record.notes && (
                              <span className="text-[9px] text-muted truncate max-w-[200px]" title={kpi.record.notes}>
                                Note: {kpi.record.notes}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function UserProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin, isManager } = useRole();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { success: toastSuccess, error: toastError } = useToast();

  // Edit state
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

  useEffect(() => {
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
  }, []);

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
    } catch {
      // saveProfileCore already toasted on hard failure path.
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetch(`/api/users/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setUser(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-muted">User not found</p>
        <Button variant="ghost" className="mt-2" onClick={() => router.push("/people")}>Back to People</Button>
      </div>
    );
  }

  const perf = user.performanceSummary;
  const initials = `${user.firstName[0]}${user.lastName[0]}`;

  // Hero gradient derived from id hash (matches /people directory)
  const heroGradients = [
    "linear-gradient(135deg, var(--os-c-blue), var(--os-c-purple))",
    "linear-gradient(135deg, var(--os-c-green), var(--os-c-teal))",
    "linear-gradient(135deg, var(--os-c-pink), var(--os-c-purple))",
    "linear-gradient(135deg, var(--os-c-indigo), var(--os-c-blue))",
    "linear-gradient(135deg, var(--os-c-orange), var(--os-c-pink))",
    "linear-gradient(135deg, var(--os-c-purple), var(--os-c-indigo))",
    "linear-gradient(135deg, var(--os-c-teal), var(--os-c-green))",
    "linear-gradient(135deg, var(--os-c-yellow), var(--os-c-orange))",
  ];
  let _h = 0;
  const idStr = String(user.id ?? "");
  for (let i = 0; i < idStr.length; i++) _h = (_h * 31 + idStr.charCodeAt(i)) >>> 0;
  const heroGradient = heroGradients[_h % heroGradients.length];

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Bespoke profile hero */}
      <section className="prfh" style={{ ["--prfh-cover" as unknown as string]: heroGradient }}>
        <div className="prfh__cover" aria-hidden="true">
          <span className="prfh__cover-glow" />
        </div>
        <div className="prfh__body">
          <div className="prfh__av-wrap">
            <div className="prfh__av" style={{ background: heroGradient }}>
              {user.avatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={user.avatar} alt="" />
              ) : (
                <span className="prfh__av-init">{initials}</span>
              )}
            </div>
            <label className="prfh__av-upload" title={uploadingAvatar ? "Uploading…" : "Upload photo"}>
              <span>{uploadingAvatar ? "…" : "Upload"}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
            </label>
          </div>

          <div className="prfh__main">
            <div className="prfh__head-row">
              <button type="button" className="prfh__back-btn" onClick={() => router.push("/people")}>
                <ArrowLeft size={12} /> People
              </button>
              <button type="button" className="prfh__edit-btn" onClick={openEditDialog}>
                <Edit3 size={12} /> Edit profile
              </button>
            </div>
            <h1 className="prfh__name">{user.firstName} {user.lastName}</h1>
            <div className="prfh__pills">
              <span className={`prfh__status prfh__status--${(user.status as string).toLowerCase()}`}>
                {user.status.replace(/_/g, " ")}
              </span>
              <span className="prfh__access">{user.accessLevel.replace(/_/g, " ")}</span>
            </div>
            <p className="prfh__role">{user.role?.title || "No role assigned"}</p>

            <div className="prfh__contacts">
              <a className="prfh__contact" href={`mailto:${user.email}`}>
                <Mail size={12} /> <span>{user.email}</span>
              </a>
              {user.phone && (
                <a className="prfh__contact" href={`tel:${user.phone}`}>
                  <Phone size={12} /> <span>{user.phone}</span>
                </a>
              )}
              {user.department && (
                <span className="prfh__contact">
                  <Building2 size={12} /> <span>{user.department.name}</span>
                </span>
              )}
              {user.manager && (
                <span className="prfh__contact">
                  <Users size={12} /> <span>Reports to {user.manager.firstName} {user.manager.lastName}</span>
                </span>
              )}
            </div>

            {/* Dimensional tags — cost center, business unit, region,
                project. Manager+ can edit. */}
            <div className="prfh__tags">
              <TagPicker
                entityType="USER"
                entityId={user.id}
                canEdit={isManager}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Edit dialog hosted off-hero so the existing Dialog wiring still works */}
      <Card style={{ display: "none" }}>
        <CardContent>
          <div>
            {/* Edit Dialog */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
              <DialogContent>
                <DialogHeader><DialogTitle>Edit {user.firstName} {user.lastName}</DialogTitle></DialogHeader>
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
                    <Label>Access Level {!isAdmin && <span className="text-[10px] text-muted-2">(admin only)</span>}</Label>
                    <Select value={editAccessLevel} onValueChange={setEditAccessLevel} disabled={!isAdmin}>
                      <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EMPLOYEE">Employee</SelectItem>
                        <SelectItem value="TEAM_LEAD">Team Lead</SelectItem>
                        <SelectItem value="MANAGER">Manager</SelectItem>
                        <SelectItem value="DIRECTOR">Director</SelectItem>
                        <SelectItem value="VP">VP</SelectItem>
                        <SelectItem value="C_LEVEL">C-Level</SelectItem>
                        <SelectItem value="HR">HR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Reports To</Label>
                    <Select value={editManagerId || "none"} onValueChange={(v) => setEditManagerId(v === "none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Select reporting manager" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— No reporting manager —</SelectItem>
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
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="PROBATION">Probation</SelectItem>
                        <SelectItem value="PIP">PIP</SelectItem>
                        <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                        <SelectItem value="NOTICE_PERIOD">Notice Period</SelectItem>
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
                        <SelectItem value="__none__">— No office —</SelectItem>
                        {offices.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-muted">
                            No offices yet. Add one in <span className="text-[color:var(--accent-strong)]">Organization → Offices</span>.
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
          </div>
        </CardContent>
      </Card>

      {/* Composite Performance Score */}
      {perf.compositeScore != null && (
        <Card className="border-[rgba(212,255,46,0.2)] bg-gradient-to-r from-[rgba(212,255,46,0.04)] to-transparent">
          <CardContent className="p-6">
            <div className="flex items-start gap-6">
              <div className="text-center">
                <Zap size={20} className="mx-auto text-[color:var(--accent-strong)] mb-1" />
                <p className={`text-4xl font-bold font-mono ${getScoreColor(perf.compositeScore)}`}>
                  {perf.compositeScore}
                </p>
                <p className="text-xs text-muted mt-1">Composite Score</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted font-medium mb-2">Score Breakdown</p>
                <ScoreBreakdown breakdown={perf.scoreBreakdown} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Score Trend */}
      {user.scoreHistory && user.scoreHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Performance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreTrendChart history={user.scoreHistory} />
          </CardContent>
        </Card>
      )}

      {/* Performance Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Target size={20} className="mx-auto text-[color:var(--accent-strong)] mb-1" />
            <p className={`text-2xl font-bold font-mono ${perf.avgKPI ? getScoreColor(perf.avgKPI) : "text-muted"}`}>
              {perf.avgKPI ?? "N/A"}
            </p>
            <p className="text-xs text-muted">Avg KPI Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Target size={20} className="mx-auto text-blue-400 mb-1" />
            <p className="text-2xl font-bold font-mono">{perf.activeKRAs ?? 0}</p>
            <p className="text-xs text-muted">Active KRAs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Smile size={20} className="mx-auto text-green-400 mb-1" />
            <p className="text-2xl font-bold font-mono">{perf.avgMood ?? "N/A"}</p>
            <p className="text-xs text-muted">Avg Mood</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Star size={20} className="mx-auto text-orange-400 mb-1" />
            <p className={`text-2xl font-bold font-mono ${perf.latestReviewScore ? getScoreColor(perf.latestReviewScore) : "text-muted"}`}>
              {perf.latestReviewScore ?? "N/A"}
            </p>
            <p className="text-xs text-muted">Review Score</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="kras">
        <TabsList>
          <TabsTrigger value="kras">KRAs</TabsTrigger>
          <TabsTrigger value="monthly-kpis">Monthly KPIs</TabsTrigger>
          <TabsTrigger value="calendar">Work Calendar</TabsTrigger>
          <TabsTrigger value="kpis">KPI History</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="kudos">Kudos {user._count?.kudosReceived > 0 ? `(${user._count.kudosReceived})` : ""}</TabsTrigger>
          <TabsTrigger value="checkins">Check-ins</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="reports">Direct Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly-kpis" className="mt-4">
          <MonthlyKpiRecorder userId={id as string} />
        </TabsContent>

        <TabsContent value="calendar" className="mt-4 space-y-2">
          {!user.tasks || user.tasks.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No calendar entries yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.tasks.map((t: any) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  t.status === "COMPLETED" ? "bg-green-500" : t.status === "IN_PROGRESS" ? "bg-amber-500" : "bg-blue-500"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${t.status === "COMPLETED" ? "line-through text-muted" : ""}`}>{t.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className="text-[10px]">{t.status.replace(/_/g, " ")}</Badge>
                    {t.date && (
                      <span className="text-[10px] text-muted flex items-center gap-0.5">
                        <Clock size={8} /> {new Date(t.date).toLocaleDateString()}
                      </span>
                    )}
                    {t.kra?.name && (
                      <span className="text-[10px] text-[color:var(--accent-strong)]">{t.kra.name}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="kras" className="mt-4">
          <KraAssignmentsTab userId={id as string} />
        </TabsContent>

        <TabsContent value="kpis" className="mt-4 space-y-2">
          {user.kpiRecords.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No KPI records yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.kpiRecords.map((r: any) => (
              <div key={r.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.kpi.name}</p>
                    <p className="text-xs text-muted">Period: {r.period} · {r.kpi.unit || ""}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold font-mono ${r.score != null ? getScoreColor(r.score) : "text-muted"}`}>
                      {r.score ?? "Pending"}
                    </p>
                    <p className="text-xs text-muted">
                      {r.actualValue ?? "?"}/{r.targetValue}
                    </p>
                  </div>
                </div>
                {r.score != null && (
                  <Progress value={r.score} className="h-1.5 mt-2" indicatorClassName={r.score >= 70 ? "bg-green-500" : r.score >= 50 ? "bg-orange-500" : "bg-red-500"} />
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          {user.skills.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No skills added yet</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {user.skills.map((s: any) => (
                <div key={s.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{s.name}</p>
                    <span className="text-xs text-muted">{s.selfRating}/10</span>
                  </div>
                  <Progress value={s.selfRating * 10} className="h-1.5" indicatorClassName="bg-violet-600" />
                  {s.managerRating && (
                    <p className="text-[10px] text-muted mt-1">Manager rating: {s.managerRating}/10</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reviews" className="mt-4 space-y-2">
          {user.reviewsAsSubject.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No reviews yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.reviewsAsSubject.map((r: any) => (
              <div key={r.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.cycle.name}</p>
                    <p className="text-xs text-muted">
                      Reviewed by {r.reviewer.firstName} {r.reviewer.lastName}
                    </p>
                  </div>
                  <div className="text-right">
                    {r.overallScore != null && (
                      <p className={`text-lg font-bold font-mono ${getScoreColor(r.overallScore)}`}>{r.overallScore}</p>
                    )}
                    {r.outcome && (
                      <Badge className="text-[10px] mt-1" variant={r.outcome === "PROMOTION_ELIGIBLE" ? "success" : "secondary"}>
                        {r.outcome.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge className="mt-2 text-[10px]" variant="secondary">{r.status}</Badge>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="kudos" className="mt-4 space-y-2">
          {(!user.kudosReceived || user.kudosReceived.length === 0) ? (
            <p className="text-muted text-sm py-8 text-center">No kudos received yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.kudosReceived.map((k: any) => (
              <div key={k.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <Heart size={14} className="text-pink-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted">
                      From <span className="text-foreground font-medium">{k.giver.firstName} {k.giver.lastName}</span>
                    </p>
                    <p className="text-sm mt-1 italic text-[#C0C0D0]">&ldquo;{k.message}&rdquo;</p>
                    <div className="flex items-center gap-2 mt-2">
                      {k.companyValue && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-violet-500/40 text-[color:var(--accent-strong)]">{k.companyValue}</Badge>
                      )}
                      <span className="text-[10px] text-muted">{new Date(k.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border/60">
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
          {user.checkIns.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No check-ins yet</p>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user.checkIns.map((c: any) => (
              <div key={c.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{moodEmojis[c.mood] || "😐"}</span>
                  <span className="text-xs text-muted">{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
                {c.wentWell && <p className="text-xs text-green-400 mb-1">✓ {c.wentWell}</p>}
                {c.challenges && <p className="text-xs text-orange-400 mb-1">⚠ {c.challenges}</p>}
                {c.tomorrow && <p className="text-xs text-blue-400">→ {c.tomorrow}</p>}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          {user.directReports.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No direct reports</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {user.directReports.map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 cursor-pointer hover:border-muted-2 transition-colors"
                  onClick={() => router.push(`/people/${r.id}`)}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-[rgba(212,255,46,0.12)] text-[color:var(--accent-strong)] text-sm">
                      {r.firstName[0]}{r.lastName[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{r.firstName} {r.lastName}</p>
                    <p className="text-xs text-muted">{r.role?.title || "No role"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Assets Tab */}
        <TabsContent value="assets" className="mt-4">
          <AssetsTab userId={id as string} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

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

  if (loading) return <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-16 bg-surface-2 rounded-lg animate-pulse" />)}</div>;

  if (assets.length === 0) {
    return (
      <div className="text-center py-12">
        <Package size={32} className="mx-auto text-muted mb-3" />
        <p className="text-sm text-muted">No assets assigned</p>
        <p className="text-xs text-muted mt-1">Assets can be assigned from the Assets page</p>
      </div>
    );
  }

  const typeIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = { LAPTOP: Laptop, DESKTOP: Monitor, MONITOR: Monitor, PHONE: Smartphone };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted mb-3">{assets.length} asset{assets.length !== 1 ? "s" : ""} assigned</p>
      {assets.map((asset) => {
        const Icon = (asset.type && typeIcons[asset.type]) || Package;
        return (
          <Card key={asset.id}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{asset.name}</p>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{asset.condition}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                    {asset.brand && <span>{asset.brand}</span>}
                    {asset.model && <span>· {asset.model}</span>}
                    {asset.serialNumber && <span>· S/N: {asset.serialNumber}</span>}
                    {asset.imeiNumber && <span>· IMEI: {asset.imeiNumber}</span>}
                  </div>
                </div>
                {asset.assignedAt && (
                  <p className="text-[10px] text-muted shrink-0">Since {new Date(asset.assignedAt).toLocaleDateString()}</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
