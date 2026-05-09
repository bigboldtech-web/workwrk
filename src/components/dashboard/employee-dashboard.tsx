"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Target, BarChart3, BookOpen, Star, Zap, CheckCircle2, Clock, ArrowRight,
} from "lucide-react";

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-[color:var(--accent-strong)]";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

export function EmployeeDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/my-dashboard")
      .then((r) => r.json())
      .then((d) => setData(d.data || d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}><CardContent className="p-4"><div className="h-16 bg-surface-2 rounded animate-pulse" /></CardContent></Card>
          ))}
        </div>
        <div className="h-48 bg-surface rounded-lg border border-border animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const { stats, kraAssignments, kpiRecords, sopAssignments, reviews, currentPeriod } = data;

  // Group KPI records by period
  const currentRecords = kpiRecords?.filter((r: any) => r.period === currentPeriod) || [];

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Zap size={20} className="mx-auto text-[color:var(--accent-strong)] mb-1" />
            <p className={`text-2xl font-bold font-mono ${stats.compositeScore != null ? getScoreColor(stats.compositeScore) : "text-muted"}`}>
              {stats.compositeScore ?? "N/A"}
            </p>
            <p className="text-xs text-muted">Performance Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <BarChart3 size={20} className="mx-auto text-blue-400 mb-1" />
            <p className="text-2xl font-bold font-mono">{stats.completedKpis}/{stats.totalKpis}</p>
            <p className="text-xs text-muted">KPIs Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <BookOpen size={20} className="mx-auto text-amber-400 mb-1" />
            <p className="text-2xl font-bold">{stats.pendingSops}</p>
            <p className="text-xs text-muted">Pending SOPs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Star size={20} className="mx-auto text-green-400 mb-1" />
            <p className="text-2xl font-bold">{stats.pendingReviews}</p>
            <p className="text-xs text-muted">Pending Reviews</p>
          </CardContent>
        </Card>
      </div>

      {/* Action Items Row */}
      {(stats.pendingSurveys > 0 || stats.pendingPolicies > 0 || (stats.todayTasksTotal || 0) > 0) && (
        <div className="flex items-center gap-3 flex-wrap">
          {stats.pendingSurveys > 0 && (
            <Link href="/surveys">
              <Badge variant="warning" className="text-xs cursor-pointer hover:opacity-80 gap-1.5 py-1">
                {stats.pendingSurveys} survey{stats.pendingSurveys > 1 ? "s" : ""} pending
              </Badge>
            </Link>
          )}
          {stats.pendingPolicies > 0 && (
            <Link href="/policies">
              <Badge variant="destructive" className="text-xs cursor-pointer hover:opacity-80 gap-1.5 py-1">
                {stats.pendingPolicies} polic{stats.pendingPolicies > 1 ? "ies" : "y"} to acknowledge
              </Badge>
            </Link>
          )}
          {(stats.todayTasksTotal || 0) > 0 && (
            <Link href="/tasks">
              <Badge variant="secondary" className="text-xs cursor-pointer hover:opacity-80 gap-1.5 py-1">
                {stats.todayTasksDone}/{stats.todayTasksTotal} tasks today
              </Badge>
            </Link>
          )}
        </div>
      )}

      {/* My KRAs & KPI Progress */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target size={14} className="text-[color:var(--accent-strong)]" /> My KRAs & KPIs
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">{stats.completionRate}% complete this month</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(!kraAssignments || kraAssignments.length === 0) ? (
            <p className="text-sm text-muted text-center py-4">No KRAs assigned yet.</p>
          ) : (
            kraAssignments.map((a: any) => (
              <div key={a.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Target size={12} className="text-[color:var(--accent-strong)]" />
                    <span className="text-sm font-medium">{a.kra.name}</span>
                    <Badge variant="outline" className="text-[9px]">{a.weightage}%</Badge>
                  </div>
                </div>
                {a.kra.kpis.length === 0 ? (
                  <p className="text-xs text-muted">No KPIs defined for this KRA</p>
                ) : (
                  <div className="space-y-1.5">
                    {a.kra.kpis.map((kpi: any) => {
                      const record = currentRecords.find((r: any) => r.kpi?.id === kpi.id);
                      const actual = record?.actualValue;
                      const target = kpi.targetValue;
                      const score = record?.score;
                      const status = record?.status;
                      return (
                        <div key={kpi.id} className="flex items-center gap-3 text-xs">
                          {status === "APPROVED" ? (
                            <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                          ) : status === "SUBMITTED" ? (
                            <Clock size={12} className="text-amber-400 shrink-0" />
                          ) : (
                            <div className="h-3 w-3 rounded-full border border-border shrink-0" />
                          )}
                          <span className="flex-1 text-muted">{kpi.name}</span>
                          <span className="text-muted-2 font-mono">
                            {actual != null ? actual : "—"} / {target ?? "—"} {kpi.unit}
                          </span>
                          {score != null && (
                            <span className={`font-mono font-bold ${getScoreColor(score)}`}>{score}%</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* My OKRs */}
      {data.myOkrs && data.myOkrs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target size={14} className="text-[color:var(--accent-strong)]" /> My Goals (OKRs)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.myOkrs.map((okr: any) => (
              <div key={okr.id} className="flex items-center gap-3 p-2 rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{okr.title}</p>
                  <p className="text-[10px] text-muted">{okr.quarter}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Progress value={okr.progress} className="w-16 h-1.5" />
                  <span className={`text-xs font-mono font-bold ${
                    okr.progress >= 70 ? "text-green-400" : okr.progress >= 40 ? "text-orange-400" : "text-red-400"
                  }`}>{okr.progress}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pending SOPs */}
      {sopAssignments && sopAssignments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen size={14} className="text-amber-400" /> Pending SOPs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sopAssignments.map((a: any) => (
              <Link key={a.id} href={`/sops/${a.sop.id}`}>
                <div className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-2 transition-colors">
                  <div>
                    <p className="text-sm">{a.sop.title}</p>
                    <p className="text-[10px] text-muted">{a.sop.category}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="warning" className="text-[10px]">{a.status}</Badge>
                    <ArrowRight size={12} className="text-muted" />
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Upcoming Reviews */}
      {reviews && reviews.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star size={14} className="text-green-400" /> Upcoming Reviews
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reviews.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                <div>
                  <p className="text-sm">{r.cycle?.name}</p>
                  <p className="text-[10px] text-muted">{r.cycle?.type?.replace(/_/g, " ")}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">{r.status.replace(/_/g, " ")}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
