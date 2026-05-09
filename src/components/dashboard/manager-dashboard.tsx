"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import {
  Users, BarChart3, Target, ClipboardCheck, ArrowRight, AlertCircle,
} from "lucide-react";

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-[color:var(--accent-strong)]";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getScoreBg(score: number) {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-[#d4ff2e]";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

export function ManagerTeamDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/team-dashboard")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setData(d.data || d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="h-32 bg-surface-2 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.teamMembers?.length === 0) return null;

  const { teamMembers, pendingApprovals, stats } = data;

  return (
    <div className="space-y-4">
      {/* Team Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Users size={20} className="mx-auto text-[color:var(--accent-strong)] mb-1" />
            <p className="text-2xl font-bold">{stats.teamSize}</p>
            <p className="text-xs text-muted">Team Size</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Target size={20} className="mx-auto text-blue-400 mb-1" />
            <p className={`text-2xl font-bold font-mono ${stats.avgTeamScore > 0 ? getScoreColor(stats.avgTeamScore) : "text-muted"}`}>
              {stats.avgTeamScore > 0 ? stats.avgTeamScore : "N/A"}
            </p>
            <p className="text-xs text-muted">Avg Team Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <BarChart3 size={20} className="mx-auto text-green-400 mb-1" />
            <p className="text-2xl font-bold">{stats.teamCompletionRate}%</p>
            <p className="text-xs text-muted">KPI Completion</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <ClipboardCheck size={20} className="mx-auto text-amber-400 mb-1" />
            <p className="text-2xl font-bold">{stats.pendingApprovalCount}</p>
            <p className="text-xs text-muted">Pending Approvals</p>
          </CardContent>
        </Card>
      </div>

      {/* Direct Reports */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users size={14} className="text-[color:var(--accent-strong)]" /> My Team
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {teamMembers.map((member: any) => {
            const completionPct = member.kpiTotal > 0 ? Math.round((member.kpiCompleted / member.kpiTotal) * 100) : 0;
            return (
              <Link key={member.id} href={`/people/${member.id}`}>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-xs">{member.firstName[0]}{member.lastName[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{member.firstName} {member.lastName}</p>
                      {member.role && <span className="text-[10px] text-muted">{member.role}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={completionPct} className="h-1 flex-1 max-w-[120px]" />
                      <span className="text-[10px] text-muted">{member.kpiCompleted}/{member.kpiTotal} KPIs</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {member.compositeScore != null ? (
                      <p className={`text-lg font-bold font-mono ${getScoreColor(member.compositeScore)}`}>{member.compositeScore}</p>
                    ) : member.avgKpiScore > 0 ? (
                      <p className={`text-lg font-bold font-mono ${getScoreColor(member.avgKpiScore)}`}>{member.avgKpiScore}%</p>
                    ) : (
                      <p className="text-sm text-muted">—</p>
                    )}
                  </div>
                  <ArrowRight size={14} className="text-muted shrink-0" />
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      {/* Pending Approvals */}
      {pendingApprovals && pendingApprovals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle size={14} className="text-amber-400" /> KPIs Awaiting Approval
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingApprovals.slice(0, 10).map((record: any) => (
              <div key={record.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                <div>
                  <p className="text-sm">{record.kpi?.name}</p>
                  <p className="text-[10px] text-muted">
                    {record.user?.firstName} {record.user?.lastName} &middot; Value: {record.actualValue} {record.kpi?.unit}
                  </p>
                </div>
                <Badge variant="warning" className="text-[10px]">Submitted</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
