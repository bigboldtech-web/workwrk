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
import { PageHeader } from "@/components/dashboard/page-header";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface KeyMetrics {
  totalPeople: number;
  avgKPI: number;
  activeKRAs: number;
  sopComplianceRate: number;
  avgMood: number;
  publishedSOPs: number;
  totalCheckIns: number;
}

interface MonthlyTrend {
  month: string;
  kpiRecords: number;
  avgKPI: number;
}

interface DeptComparison {
  name: string;
  members: number;
  avgKPI: number;
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
  dateRange?: { range: string; months: number; from: string; to: string };
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
  if (score >= 70) return "text-[color:var(--b-score-good)]";
  if (score >= 50) return "text-[color:var(--b-score-warn)]";
  return "text-[color:var(--b-score-bad)]";
}

function getScoreBg(score: number) {
  if (score >= 70) return "bg-[color:var(--b-score-good-bg)]";
  if (score >= 50) return "bg-[color:var(--b-score-warn-bg)]";
  return "bg-[color:var(--b-score-bad-bg)]";
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Analytics" }]}
        kicker="Analytics · BI-ready warehouse"
        title="Analytics"
        subtitle="Real-time dashboards and performance insights."
      />

      {/* Health score skeleton */}
      <Card className="border-[rgba(212,255,46,0.2)] bg-gradient-to-r from-[rgba(212,255,46,0.04)] to-transparent">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-5 w-48 bg-border rounded" />
                <div className="h-3 w-64 bg-border rounded" />
              </div>
              <div className="h-10 w-16 bg-border rounded" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-full bg-border rounded" />
                  <div className="h-1.5 w-full bg-border rounded" />
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
              <div className="h-4 w-8 bg-border rounded mb-3" />
              <div className="h-6 w-16 bg-border rounded mb-1" />
              <div className="h-3 w-24 bg-border rounded" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <div className="h-5 w-48 bg-border rounded animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 h-48 animate-pulse">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex-1 bg-border rounded-t-md" style={{ height: `${30 + i * 10}%` }} />
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
  const [dateRange, setDateRange] = useState("6m"); // 1m, 3m, 6m, 12m

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        setError(null);
        setLoading(true);
        const res = await fetch(`/api/analytics?range=${dateRange}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load analytics data");
        setData(json);
      } catch (err) {
        console.error("Failed to fetch analytics:", err);
        setError(err instanceof Error ? err.message : "Failed to load analytics data");
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, [dateRange]);

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  if (!data || (data.keyMetrics.totalPeople === 0 && data.monthlyTrend.length === 0 && data.deptComparison.length === 0)) {
    return (
      <div className="space-y-3 animate-fade-in">
        <PageHeader
          kicker="Analytics · BI-ready warehouse"
          title="Analytics"
          subtitle="Real-time dashboards and performance insights."
        />
        <EmptyState
          icon={BarChart3}
          title="No analytics data yet"
          description="Analytics will populate as your team starts using WorkwrK. Add people, create tasks, and track KPIs to see insights here."
        />
      </div>
    );
  }

  const { healthScore, keyMetrics, monthlyTrend, deptComparison, scoreTrend, topPerformers, mostRecognized, totalKudosThisMonth } = data;

  const metricCards = [
    { name: "Avg KPI Score", value: keyMetrics.avgKPI.toFixed(1), icon: Target },
    { name: "Active KRAs", value: String(keyMetrics.activeKRAs), icon: Target },
    { name: "SOP Compliance", value: `${keyMetrics.sopComplianceRate}%`, icon: BookOpen },
    { name: "Active Employees", value: String(keyMetrics.totalPeople), icon: Users },
    { name: "Published SOPs", value: String(keyMetrics.publishedSOPs), icon: BookOpen },
    { name: "Total Check-ins", value: String(keyMetrics.totalCheckIns), icon: BarChart3 },
  ];

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Analytics" }]}
        kicker="Analytics · BI-ready warehouse"
        title="Analytics"
        subtitle="Performance insights and trends — pulled live from the spine."
      />
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-0.5">
            {[
              { value: "1m", label: "1M" },
              { value: "3m", label: "3M" },
              { value: "6m", label: "6M" },
              { value: "12m", label: "1Y" },
            ].map((opt) => (
              <button key={opt.value} onClick={() => setDateRange(opt.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  dateRange === opt.value ? "bg-violet-600 text-[#0a0a0a]" : "text-muted hover:text-foreground"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open("/api/export/people", "_blank")}>
            <Download size={14} /> Export
          </Button>
        </div>
      </div>

      {/* Date range info */}
      {data.dateRange && (
        <p className="text-xs text-muted">
          Showing data from {new Date(data.dateRange.from).toLocaleDateString("en-US", { month: "short", year: "numeric" })} to {new Date(data.dateRange.to).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      )}

      {/* Company Health Score */}
      <Card className="border-[rgba(212,255,46,0.2)] bg-gradient-to-r from-[rgba(212,255,46,0.04)] to-transparent">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Company Health Score</h2>
              <p className="text-xs text-muted">Composite score across all metrics</p>
            </div>
            <div className={`text-4xl font-bold font-mono ${getScoreColor(healthScore)}`}>
              {healthScore}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Avg KPI", score: Math.round(keyMetrics.avgKPI) },
              { label: "Active KRAs", score: Math.min(keyMetrics.activeKRAs * 10, 100) },
              { label: "SOP Compliance", score: keyMetrics.sopComplianceRate },
              { label: "Avg Mood", score: Math.round((keyMetrics.avgMood / 5) * 100) },
            ].map((item) => (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">{item.label}</span>
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
                <metric.icon size={16} className="text-muted" />
              </div>
              <p className="text-xl font-bold font-mono">{metric.value}</p>
              <p className="text-[10px] text-muted mt-0.5">{metric.name}</p>
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
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyTrend.map((m) => ({ ...m, score: Math.round(m.avgKPI) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
              <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {monthlyTrend.map((m, i) => {
                  const s = Math.round(m.avgKPI);
                  const band =
                    s >= 70 ? "var(--b-score-good-bg)" :
                    s >= 50 ? "var(--b-score-warn-bg)" :
                    "var(--b-score-bad-bg)";
                  return <Cell key={i} fill={band} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={scoreTrend.map((s) => ({ ...s, label: new Date(s.period + "-01").toLocaleString("default", { month: "short" }) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                  <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="avgScore" stroke="var(--b-score-good)" strokeWidth={2} dot={{ fill: "var(--b-score-good)", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
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
                <div key={person.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: "var(--b-accent-tint)", color: "var(--b-accent-text)" }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    <p className="text-[10px] text-muted">{person.role} · {person.department}</p>
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
              <tr className="border-b border-border">
                <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Department</th>
                <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">KPI Avg</th>
                <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Members</th>
              </tr>
            </thead>
            <tbody>
              {deptComparison.map((dept) => (
                <tr key={dept.name} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-muted" />
                      <span className="text-sm font-medium">{dept.name}</span>
                    </div>
                  </td>
                  <td className={`p-4 text-center font-mono text-sm ${getScoreColor(Math.round(dept.avgKPI))}`}>{Math.round(dept.avgKPI)}</td>
                  <td className="p-4 text-center text-sm text-muted">{dept.members}</td>
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
                <div key={person.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-4">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: "var(--b-accent-tint)", color: "var(--b-accent-text)" }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    <p className="text-[10px] text-muted">{person.role}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono text-pink-400">{person.kudosCount}</p>
                    <p className="text-[9px] text-muted">kudos</p>
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
