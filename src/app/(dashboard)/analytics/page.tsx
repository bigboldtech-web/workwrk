"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart3, Users, Target, CheckSquare, BookOpen, TrendingUp, TrendingDown,
  Building2, ArrowUpRight, ArrowDownRight, Download, Heart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";

interface KeyMetrics {
  totalPeople: number;
  avgKPI: number;
  taskCompletionRate: number;
  sopComplianceRate: number;
  overdueTasks: number;
  avgMood: number;
  publishedSOPs: number;
  totalCheckIns: number;
}

interface MonthlyTrend {
  month: string;
  tasksCreated: number;
  tasksCompleted: number;
  avgKPI: number;
}

interface DeptComparison {
  name: string;
  members: number;
  avgKPI: number;
  taskCompletion: number;
  totalTasks: number;
}

interface ScoreTrendItem {
  period: string;
  avgScore: number;
  count: number;
}

interface TopPerformer {
  id: string;
  name: string;
  role: string;
  department: string;
  score: number;
}

interface MostRecognized {
  id: string;
  name: string;
  role: string;
  department: string;
  kudosCount: number;
}

interface AnalyticsData {
  healthScore: number;
  keyMetrics: KeyMetrics;
  monthlyTrend: MonthlyTrend[];
  deptComparison: DeptComparison[];
  scoreTrend?: ScoreTrendItem[];
  topPerformers?: TopPerformer[];
  mostRecognized?: MostRecognized[];
  totalKudosThisMonth?: number;
}

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-purple-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getScoreBg(score: number) {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-purple-500";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-[#8888A0] text-sm mt-1">Real-time dashboards and performance insights</p>
      </div>

      {/* Health score skeleton */}
      <Card className="border-purple-500/20 bg-gradient-to-r from-purple-500/5 to-transparent">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-5 w-48 bg-[#2A2A3A] rounded" />
                <div className="h-3 w-64 bg-[#2A2A3A] rounded" />
              </div>
              <div className="h-10 w-16 bg-[#2A2A3A] rounded" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-full bg-[#2A2A3A] rounded" />
                  <div className="h-1.5 w-full bg-[#2A2A3A] rounded" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metrics skeleton */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 animate-pulse">
              <div className="h-4 w-8 bg-[#2A2A3A] rounded mb-3" />
              <div className="h-6 w-16 bg-[#2A2A3A] rounded mb-1" />
              <div className="h-3 w-24 bg-[#2A2A3A] rounded" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <div className="h-5 w-48 bg-[#2A2A3A] rounded animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 h-48 animate-pulse">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex-1 bg-[#2A2A3A] rounded-t-md" style={{ height: `${30 + i * 10}%` }} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        setError(null);
        const res = await fetch("/api/analytics");
        if (!res.ok) throw new Error("Failed to load analytics data");
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Failed to fetch analytics:", err);
        setError(err instanceof Error ? err.message : "Failed to load analytics data");
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  if (!data || (data.keyMetrics.totalPeople === 0 && data.monthlyTrend.length === 0 && data.deptComparison.length === 0)) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-[#8888A0] text-sm mt-1">Real-time dashboards and performance insights</p>
        </div>
        <EmptyState
          icon={BarChart3}
          title="No analytics data yet"
          description="Analytics will populate as your team starts using TheywrK. Add people, create tasks, and track KPIs to see insights here."
        />
      </div>
    );
  }

  const { healthScore, keyMetrics, monthlyTrend, deptComparison, scoreTrend, topPerformers, mostRecognized, totalKudosThisMonth } = data;

  const metricCards = [
    { name: "Avg Performance Score", value: keyMetrics.avgKPI.toFixed(1), icon: Target },
    { name: "Task Completion Rate", value: `${keyMetrics.taskCompletionRate}%`, icon: CheckSquare },
    { name: "SOP Compliance", value: `${keyMetrics.sopComplianceRate}%`, icon: BookOpen },
    { name: "Active Employees", value: String(keyMetrics.totalPeople), icon: Users },
    { name: "Overdue Tasks", value: String(keyMetrics.overdueTasks), icon: CheckSquare },
    { name: "Total Check-ins", value: String(keyMetrics.totalCheckIns), icon: BarChart3 },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-[#8888A0] text-sm mt-1">Real-time dashboards and performance insights</p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => window.open("/api/export/people", "_blank")}
        >
          <Download size={16} /> Export CSV
        </Button>
      </div>

      {/* Company Health Score */}
      <Card className="border-purple-500/20 bg-gradient-to-r from-purple-500/5 to-transparent">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Company Health Score</h2>
              <p className="text-xs text-[#8888A0]">Composite score across all metrics</p>
            </div>
            <div className={`text-4xl font-bold font-mono ${getScoreColor(healthScore)}`}>
              {healthScore}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Avg KPI", score: Math.round(keyMetrics.avgKPI) },
              { label: "Task Completion", score: keyMetrics.taskCompletionRate },
              { label: "SOP Compliance", score: keyMetrics.sopComplianceRate },
              { label: "Avg Mood", score: Math.round((keyMetrics.avgMood / 5) * 100) },
            ].map((item) => (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#8888A0]">{item.label}</span>
                  <span className={`font-mono font-bold ${getScoreColor(item.score)}`}>{item.score}</span>
                </div>
                <Progress value={item.score} className="h-1.5" indicatorClassName={getScoreBg(item.score)} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {metricCards.map((metric) => (
          <Card key={metric.name}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <metric.icon size={16} className="text-[#8888A0]" />
              </div>
              <p className="text-xl font-bold font-mono">{metric.value}</p>
              <p className="text-[10px] text-[#8888A0] mt-0.5">{metric.name}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly Trend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Performance Trend ({monthlyTrend.length} Months)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 h-48">
            {monthlyTrend.map((m) => {
              const score = Math.round(m.avgKPI);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                  <span className={`text-xs font-mono ${getScoreColor(score)}`}>{score}</span>
                  <div className="w-full bg-[#2A2A3A] rounded-t-md relative" style={{ height: "100%" }}>
                    <div
                      className={`absolute bottom-0 w-full rounded-t-md transition-all ${getScoreBg(score)}`}
                      style={{ height: `${score}%` }}
                    />
                  </div>
                  <span className="text-xs text-[#8888A0]">{m.month}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Performance Score Trend + Top Performers */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Score Trend Chart */}
        {scoreTrend && scoreTrend.some((s) => s.avgScore > 0) && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Composite Performance Score Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-4 h-48">
                {scoreTrend.map((s) => {
                  const label = new Date(s.period + "-01").toLocaleString("default", { month: "short" });
                  return (
                    <div key={s.period} className="flex-1 flex flex-col items-center gap-2">
                      <span className={`text-xs font-mono ${getScoreColor(s.avgScore)}`}>{s.avgScore}</span>
                      <div className="w-full bg-[#2A2A3A] rounded-t-md relative" style={{ height: "100%" }}>
                        <div
                          className={`absolute bottom-0 w-full rounded-t-md transition-all ${getScoreBg(s.avgScore)}`}
                          style={{ height: `${s.avgScore}%` }}
                        />
                      </div>
                      <span className="text-xs text-[#8888A0]">{label}</span>
                      <span className="text-[9px] text-[#8888A0]">{s.count} people</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top Performers */}
        {topPerformers && topPerformers.length > 0 && (
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Top Performers</CardTitle>
                <Badge variant="secondary" className="text-xs">Composite Score</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {topPerformers.map((person, i) => (
                <div key={person.id} className="flex items-center gap-3 rounded-lg border border-[#2A2A3A] bg-[#0A0A0F]/50 p-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-600/20 text-xs font-bold text-purple-400">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    <p className="text-[10px] text-[#8888A0]">{person.role} · {person.department}</p>
                  </div>
                  <span className={`text-sm font-bold font-mono ${getScoreColor(person.score)}`}>
                    {person.score}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Department Comparison */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Department Comparison</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A3A]">
                <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Department</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">KPI Avg</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Task Rate</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Total Tasks</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Members</th>
              </tr>
            </thead>
            <tbody>
              {deptComparison.map((dept) => (
                <tr key={dept.name} className="border-b border-[#2A2A3A]/50 hover:bg-[#1A1A26]/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-purple-400" />
                      <span className="text-sm font-medium">{dept.name}</span>
                    </div>
                  </td>
                  <td className={`p-4 text-center font-mono text-sm ${getScoreColor(Math.round(dept.avgKPI))}`}>{Math.round(dept.avgKPI)}</td>
                  <td className={`p-4 text-center font-mono text-sm ${getScoreColor(dept.taskCompletion)}`}>{dept.taskCompletion}%</td>
                  <td className="p-4 text-center text-sm text-[#8888A0]">{dept.totalTasks}</td>
                  <td className="p-4 text-center text-sm text-[#8888A0]">{dept.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Most Recognized This Month */}
      {mostRecognized && mostRecognized.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Heart size={16} className="text-pink-400" /> Most Recognized This Month
              </CardTitle>
              <Badge variant="secondary" className="text-xs">{totalKudosThisMonth} kudos total</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              {mostRecognized.map((person, i) => (
                <div key={person.id} className="flex items-center gap-3 rounded-lg border border-[#2A2A3A] bg-[#0A0A0F]/50 p-4">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                    i === 0 ? "bg-yellow-500/20 text-yellow-400" : i === 1 ? "bg-slate-400/20 text-slate-300" : i === 2 ? "bg-orange-700/20 text-orange-400" : "bg-purple-600/20 text-purple-400"
                  }`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    <p className="text-[10px] text-[#8888A0]">{person.role}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono text-pink-400">{person.kudosCount}</p>
                    <p className="text-[9px] text-[#8888A0]">kudos</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
