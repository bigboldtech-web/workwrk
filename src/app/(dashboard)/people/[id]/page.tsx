"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Mail, Phone, Building2, Briefcase, Users,
  Target, CheckSquare, TrendingUp, Clock, Star, Smile, Zap, Heart,
} from "lucide-react";

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-purple-400";
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
    case "P2": return "bg-purple-500/20 text-purple-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

function getTaskStatusStyle(s: string) {
  switch (s) {
    case "COMPLETED": return "bg-green-500/20 text-green-400";
    case "IN_PROGRESS": return "bg-blue-500/20 text-blue-400";
    case "IN_REVIEW": return "bg-purple-500/20 text-purple-400";
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
  if (score >= 70) return "bg-purple-500";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function ScoreTrendChart({ history }: { history: Array<{ period: string; score: number }> }) {
  if (!history || history.length === 0) {
    return <p className="text-xs text-[#8888A0] text-center py-4">No score history yet</p>;
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
            <div className="w-full bg-[#2A2A3A] rounded-t-md relative" style={{ height: "100%" }}>
              <div
                className={`absolute bottom-0 w-full rounded-t-md transition-all ${getScoreBg(h.score)}`}
                style={{ height: `${height}%` }}
              />
            </div>
            <span className="text-[9px] text-[#8888A0]">{label}</span>
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
            <Icon size={12} className="text-[#8888A0] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#8888A0]">{label} ({weight}%)</span>
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
              <span className="text-[#8888A0]">Kudos Bonus</span>
              <span className="font-mono font-bold text-pink-400">+{breakdown.kudosBonus as number}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KraAssignmentsTab({ userId }: { userId: string }) {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/kra-assignments?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        setAssignments(Array.isArray(data) ? data : data.assignments ?? data.data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  const totalWeightage = assignments.reduce((sum: number, a: any) => sum + (a.weightage || 0), 0);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map((i) => (
          <div key={i} className="h-16 bg-[#12121A] rounded-lg border border-[#2A2A3A] animate-pulse" />
        ))}
      </div>
    );
  }

  if (assignments.length === 0) {
    return <p className="text-[#8888A0] text-sm py-8 text-center">No KRA assignments yet</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#8888A0]">
          Total weightage: <span className={totalWeightage === 100 ? "text-green-400 font-medium" : "text-orange-400 font-medium"}>{totalWeightage}%</span>
        </p>
        <Progress
          value={Math.min(totalWeightage, 100)}
          className="w-32 h-1.5"
          indicatorClassName={totalWeightage === 100 ? "bg-green-500" : "bg-orange-500"}
        />
      </div>
      {assignments.map((a: any) => {
        const kpiProgress = a.kra?.kpis?.map((kpi: any) => {
          const latestRecord = kpi.records?.[0];
          if (!latestRecord) return null;
          const pct = latestRecord.targetValue > 0 ? Math.min(Math.round((latestRecord.actualValue / latestRecord.targetValue) * 100), 120) : 0;
          return { name: kpi.name, unit: kpi.unit, pct, actual: latestRecord.actualValue, target: latestRecord.targetValue };
        }).filter(Boolean) ?? [];

        return (
          <div key={a.id} className="rounded-lg border border-[#2A2A3A] bg-[#12121A] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target size={14} className="text-purple-400" />
                <div>
                  <p className="text-sm font-medium">{a.kra?.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[10px]">{a.kra?.category}</Badge>
                    <span className="text-[10px] text-[#8888A0]">{a.period}</span>
                    <Badge className={`text-[10px] ${a.status === "ACTIVE" ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"}`}>{a.status}</Badge>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold font-mono text-purple-400">{a.weightage}%</p>
              </div>
            </div>
            {kpiProgress.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-[#2A2A3A] pt-3">
                {kpiProgress.map((kpi: any, i: number) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[#8888A0]">{kpi.name}</span>
                      <span className={getScoreColor(kpi.pct)}>{kpi.actual}/{kpi.target} {kpi.unit} ({kpi.pct}%)</span>
                    </div>
                    <Progress value={Math.min(kpi.pct, 100)} className="h-1" indicatorClassName={getProgressColor(kpi.pct)} />
                  </div>
                ))}
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
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 bg-[#1A1A26] rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-[#12121A] rounded-lg border border-[#2A2A3A] animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[#12121A] rounded-lg border border-[#2A2A3A] animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-[#8888A0]">User not found</p>
        <Button variant="ghost" className="mt-2" onClick={() => router.push("/people")}>Back to People</Button>
      </div>
    );
  }

  const perf = user.performanceSummary;
  const initials = `${user.firstName[0]}${user.lastName[0]}`;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/people")}>
          <ArrowLeft size={16} className="mr-1" /> Back
        </Button>
      </div>

      {/* Profile Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-6">
            <Avatar className="h-20 w-20 text-2xl">
              <AvatarFallback className="bg-purple-600/20 text-purple-400 text-xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{user.firstName} {user.lastName}</h1>
                <Badge className={getStatusBadge(user.status)}>{user.status.replace(/_/g, " ")}</Badge>
                <Badge variant="secondary">{user.accessLevel.replace(/_/g, " ")}</Badge>
              </div>
              <p className="text-[#8888A0] mt-1">{user.role?.title || "No role assigned"}</p>
              <div className="flex items-center gap-6 mt-3 text-sm text-[#8888A0]">
                <span className="flex items-center gap-1"><Mail size={14} /> {user.email}</span>
                {user.phone && <span className="flex items-center gap-1"><Phone size={14} /> {user.phone}</span>}
                {user.department && (
                  <span className="flex items-center gap-1"><Building2 size={14} /> {user.department.name}</span>
                )}
                {user.manager && (
                  <span className="flex items-center gap-1">
                    <Users size={14} /> Reports to {user.manager.firstName} {user.manager.lastName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Composite Performance Score */}
      {perf.compositeScore != null && (
        <Card className="border-purple-500/20 bg-gradient-to-r from-purple-500/5 to-transparent">
          <CardContent className="p-6">
            <div className="flex items-start gap-6">
              <div className="text-center">
                <Zap size={20} className="mx-auto text-purple-400 mb-1" />
                <p className={`text-4xl font-bold font-mono ${getScoreColor(perf.compositeScore)}`}>
                  {perf.compositeScore}
                </p>
                <p className="text-xs text-[#8888A0] mt-1">Composite Score</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#8888A0] font-medium mb-2">Score Breakdown</p>
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
            <Target size={20} className="mx-auto text-purple-400 mb-1" />
            <p className={`text-2xl font-bold font-mono ${perf.avgKPI ? getScoreColor(perf.avgKPI) : "text-[#8888A0]"}`}>
              {perf.avgKPI ?? "N/A"}
            </p>
            <p className="text-xs text-[#8888A0]">Avg KPI Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckSquare size={20} className="mx-auto text-blue-400 mb-1" />
            <p className="text-2xl font-bold font-mono">{perf.taskCompletionRate}%</p>
            <p className="text-xs text-[#8888A0]">{perf.completedTasks}/{perf.totalTasks} Tasks Done</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Smile size={20} className="mx-auto text-green-400 mb-1" />
            <p className="text-2xl font-bold font-mono">{perf.avgMood ?? "N/A"}</p>
            <p className="text-xs text-[#8888A0]">Avg Mood</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Star size={20} className="mx-auto text-orange-400 mb-1" />
            <p className={`text-2xl font-bold font-mono ${perf.latestReviewScore ? getScoreColor(perf.latestReviewScore) : "text-[#8888A0]"}`}>
              {perf.latestReviewScore ?? "N/A"}
            </p>
            <p className="text-xs text-[#8888A0]">Review Score</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="kras">KRAs</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="kudos">Kudos {user._count?.kudosReceived > 0 ? `(${user._count.kudosReceived})` : ""}</TabsTrigger>
          <TabsTrigger value="checkins">Check-ins</TabsTrigger>
          <TabsTrigger value="reports">Direct Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4 space-y-2">
          {user.assignedTasks.length === 0 ? (
            <p className="text-[#8888A0] text-sm py-8 text-center">No tasks assigned</p>
          ) : (
            user.assignedTasks.map((t: any) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-[#2A2A3A] bg-[#12121A] p-3">
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  t.status === "COMPLETED" ? "bg-green-500" : t.status === "IN_PROGRESS" ? "bg-blue-500" : "bg-slate-500"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${t.status === "COMPLETED" ? "line-through text-[#8888A0]" : ""}`}>{t.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${getPriorityStyle(t.priority)}`}>{t.priority}</span>
                    <Badge className={`text-[10px] ${getTaskStatusStyle(t.status)}`}>{t.status.replace(/_/g, " ")}</Badge>
                    {t.deadline && (
                      <span className="text-[10px] text-[#8888A0] flex items-center gap-0.5">
                        <Clock size={8} /> {new Date(t.deadline).toLocaleDateString()}
                      </span>
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
            <p className="text-[#8888A0] text-sm py-8 text-center">No KPI records yet</p>
          ) : (
            user.kpiRecords.map((r: any) => (
              <div key={r.id} className="rounded-lg border border-[#2A2A3A] bg-[#12121A] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.kpi.name}</p>
                    <p className="text-xs text-[#8888A0]">Period: {r.period} · {r.kpi.unit || ""}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold font-mono ${r.score != null ? getScoreColor(r.score) : "text-[#8888A0]"}`}>
                      {r.score ?? "Pending"}
                    </p>
                    <p className="text-xs text-[#8888A0]">
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
            <p className="text-[#8888A0] text-sm py-8 text-center">No skills added yet</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {user.skills.map((s: any) => (
                <div key={s.id} className="rounded-lg border border-[#2A2A3A] bg-[#12121A] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{s.name}</p>
                    <span className="text-xs text-[#8888A0]">{s.selfRating}/10</span>
                  </div>
                  <Progress value={s.selfRating * 10} className="h-1.5" indicatorClassName="bg-purple-500" />
                  {s.managerRating && (
                    <p className="text-[10px] text-[#8888A0] mt-1">Manager rating: {s.managerRating}/10</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reviews" className="mt-4 space-y-2">
          {user.reviewsAsSubject.length === 0 ? (
            <p className="text-[#8888A0] text-sm py-8 text-center">No reviews yet</p>
          ) : (
            user.reviewsAsSubject.map((r: any) => (
              <div key={r.id} className="rounded-lg border border-[#2A2A3A] bg-[#12121A] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.cycle.name}</p>
                    <p className="text-xs text-[#8888A0]">
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
            <p className="text-[#8888A0] text-sm py-8 text-center">No kudos received yet</p>
          ) : (
            user.kudosReceived.map((k: any) => (
              <div key={k.id} className="rounded-lg border border-[#2A2A3A] bg-[#12121A] p-4">
                <div className="flex items-start gap-3">
                  <Heart size={14} className="text-pink-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#8888A0]">
                      From <span className="text-white font-medium">{k.giver.firstName} {k.giver.lastName}</span>
                    </p>
                    <p className="text-sm mt-1 text-[#C0C0D0]">&ldquo;{k.message}&rdquo;</p>
                    <div className="flex items-center gap-2 mt-2">
                      {k.companyValue && (
                        <Badge variant="secondary" className="text-[10px]">{k.companyValue}</Badge>
                      )}
                      <span className="text-[10px] text-[#8888A0]">{new Date(k.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="checkins" className="mt-4 space-y-2">
          {user.checkIns.length === 0 ? (
            <p className="text-[#8888A0] text-sm py-8 text-center">No check-ins yet</p>
          ) : (
            user.checkIns.map((c: any) => (
              <div key={c.id} className="rounded-lg border border-[#2A2A3A] bg-[#12121A] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{moodEmojis[c.mood] || "😐"}</span>
                  <span className="text-xs text-[#8888A0]">{new Date(c.createdAt).toLocaleDateString()}</span>
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
            <p className="text-[#8888A0] text-sm py-8 text-center">No direct reports</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {user.directReports.map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-[#2A2A3A] bg-[#12121A] p-3 cursor-pointer hover:border-[#3A3A4A] transition-colors"
                  onClick={() => router.push(`/people/${r.id}`)}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-purple-600/20 text-purple-400 text-sm">
                      {r.firstName[0]}{r.lastName[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{r.firstName} {r.lastName}</p>
                    <p className="text-xs text-[#8888A0]">{r.role?.title || "No role"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
