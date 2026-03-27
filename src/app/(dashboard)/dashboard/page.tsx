"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import {
  Users,
  Target,
  CheckSquare,
  BookOpen,
  Heart,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Activity,
  Calendar,
  GraduationCap,
} from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";

interface DashboardStats {
  totalPeople: number;
  newPeopleThisMonth: number;
  completedTasksThisWeek: number;
  totalTasksThisWeek: number;
  sopCompliance: number;
  sopCount: number;
  overdueTasks: number;
}

interface TopPerformer {
  id: string;
  name: string;
  role: string;
  score: number;
  department: string;
}

interface RecentTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  assignee: string;
  deadline: string;
  completedAt: string | null;
}

interface DepartmentPerformance {
  name: string;
  score: number;
  members: number;
  color: string;
}

interface Alert {
  type: string;
  message: string;
  time: string;
}

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  actor: { id: string; firstName: string; lastName: string; avatar: string | null };
  createdAt: string;
}

interface KudosItem {
  id: string;
  message: string;
  companyValue: string | null;
  giver: { id: string; firstName: string; lastName: string; avatar: string | null };
  receiver: { id: string; firstName: string; lastName: string; avatar: string | null };
  createdAt: string;
}

interface DashboardData {
  stats: DashboardStats;
  topPerformers: TopPerformer[];
  recentTasks: RecentTask[];
  departmentPerformance: DepartmentPerformance[];
  alerts: Alert[];
  recentActivity: ActivityItem[];
  recentKudos: KudosItem[];
}

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-purple-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getScoreBgColor(score: number) {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-purple-500";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function getPriorityStyle(priority: string) {
  switch (priority) {
    case "P0": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "P1": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "P2": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    default: return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
}

function getStatusStyle(status: string) {
  switch (status) {
    case "COMPLETED": return "bg-green-500/20 text-green-400";
    case "IN_PROGRESS": return "bg-blue-500/20 text-blue-400";
    case "IN_REVIEW": return "bg-purple-500/20 text-purple-400";
    case "NOT_STARTED": return "bg-slate-500/20 text-slate-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

function getAlertStyle(type: string) {
  switch (type) {
    case "warning": return "border-l-orange-500 bg-orange-500/5";
    case "danger": return "border-l-red-500 bg-red-500/5";
    case "success": return "border-l-green-500 bg-green-500/5";
    default: return "border-l-blue-500 bg-blue-500/5";
  }
}

function formatDeadline(deadline: string, completedAt: string | null): string {
  if (completedAt) return "Completed";
  const date = new Date(deadline);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const deadlineDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (deadlineDate.getTime() === today.getTime()) return "Today";
  if (deadlineDate.getTime() === tomorrow.getTime()) return "Tomorrow";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-[#1A1A26] ${className ?? ""}`} />;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch dashboard data");
        return res.json();
      })
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-[#8888A0] text-sm mt-1">
            Overview of your business operating system
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <SkeletonBlock className="h-10 w-10 rounded-lg" />
                <SkeletonBlock className="mt-3 h-8 w-20" />
                <SkeletonBlock className="mt-1 h-3 w-28" />
                <SkeletonBlock className="mt-2 h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-5 space-y-3">
                <SkeletonBlock className="h-5 w-32" />
                {[1, 2, 3, 4, 5].map((j) => (
                  <SkeletonBlock key={j} className="h-14 w-full" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-5 space-y-4">
            <SkeletonBlock className="h-5 w-48" />
            {[1, 2, 3, 4, 5].map((i) => (
              <SkeletonBlock key={i} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-[#8888A0] text-sm mt-1">
            Overview of your business operating system
          </p>
        </div>
        <ErrorState message={error ?? undefined} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const { stats: apiStats, topPerformers, recentTasks, departmentPerformance, alerts, recentActivity, recentKudos } = data;

  const avgKpiScore =
    topPerformers.length > 0
      ? (topPerformers.reduce((sum, p) => sum + p.score, 0) / topPerformers.length).toFixed(1)
      : "N/A";

  const stats = [
    {
      title: "Total People",
      value: String(apiStats.totalPeople),
      change: `+${apiStats.newPeopleThisMonth} this month`,
      trend: apiStats.newPeopleThisMonth > 0 ? "up" : "neutral",
      icon: Users,
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Avg Performance",
      value: avgKpiScore,
      change: topPerformers.length > 0 ? `from ${topPerformers.length} performers` : "No data",
      trend: "up",
      icon: Target,
      color: "text-green-400",
      bgColor: "bg-green-500/10",
    },
    {
      title: "Tasks Completed",
      value: String(apiStats.completedTasksThisWeek),
      change: `of ${apiStats.totalTasksThisWeek} this week`,
      trend: "neutral",
      icon: CheckSquare,
      color: "text-blue-400",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "SOP Compliance",
      value: `${apiStats.sopCompliance}%`,
      change: `${apiStats.sopCount} published`,
      trend: apiStats.sopCompliance >= 80 ? "up" : "down",
      icon: BookOpen,
      color: "text-orange-400",
      bgColor: "bg-orange-500/10",
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-[#8888A0] text-sm mt-1">
          Overview of your business operating system
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="hover:border-[#3A3A4A] transition-colors">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className={`rounded-lg p-2.5 ${stat.bgColor}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                {stat.trend === "up" && (
                  <div className="flex items-center gap-1 text-xs text-green-400">
                    <ArrowUpRight size={14} />
                  </div>
                )}
                {stat.trend === "down" && (
                  <div className="flex items-center gap-1 text-xs text-red-400">
                    <ArrowDownRight size={14} />
                  </div>
                )}
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-[#8888A0] mt-0.5">{stat.change}</p>
              </div>
              <p className="text-xs text-[#8888A0] mt-2 font-medium">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
        {/* Top Performers */}
        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Top Performers</CardTitle>
              <Badge variant="secondary" className="text-xs">This Month</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPerformers.map((person, i) => (
              <div
                key={person.id}
                className="flex items-center gap-3 rounded-lg border border-[#2A2A3A] bg-[#0A0A0F]/50 p-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600/20 text-xs font-bold text-purple-400">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{person.name}</p>
                  <p className="text-xs text-[#8888A0]">{person.role}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold font-mono ${getScoreColor(person.score)}`}>
                    {person.score}
                  </p>
                </div>
              </div>
            ))}
            {topPerformers.length === 0 && (
              <p className="text-xs text-[#8888A0] text-center py-6">No KPI data yet. Set up KRAs and track KPI scores to see top performers here.</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Tasks */}
        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Tasks</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {recentTasks.filter(t => t.status !== "COMPLETED").length} Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-start gap-3 rounded-lg border border-[#2A2A3A] bg-[#0A0A0F]/50 p-3"
              >
                <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${
                  task.status === "COMPLETED" ? "bg-green-500" :
                  task.status === "IN_PROGRESS" ? "bg-blue-500" :
                  task.status === "IN_REVIEW" ? "bg-purple-500" : "bg-slate-500"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${task.status === "COMPLETED" ? "line-through text-[#8888A0]" : ""}`}>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${getPriorityStyle(task.priority)}`}>
                      {task.priority}
                    </span>
                    <span className="text-[10px] text-[#8888A0]">{task.assignee}</span>
                    <span className="text-[10px] text-[#8888A0] flex items-center gap-0.5">
                      <Clock size={8} />
                      {formatDeadline(task.deadline, task.completedAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {recentTasks.length === 0 && (
              <p className="text-xs text-[#8888A0] text-center py-6">No tasks yet. Create your first task to see activity here.</p>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Alerts</CardTitle>
              <Badge variant="destructive" className="text-xs">
                {alerts.filter(a => a.type === "danger" || a.type === "warning").length} Action Required
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((alert, i) => (
              <div
                key={i}
                className={`rounded-lg border-l-2 p-3 ${getAlertStyle(alert.type)}`}
              >
                <p className="text-sm">{alert.message}</p>
                <p className="text-[10px] text-[#8888A0] mt-1">{alert.time}</p>
              </div>
            ))}
            {alerts.length === 0 && (
              <p className="text-xs text-[#8888A0] text-center py-6">No alerts right now. Everything looks good!</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <Link href="/activity" className="text-xs text-purple-400 hover:text-purple-300">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(!recentActivity || recentActivity.length === 0) ? (
              <p className="text-xs text-[#8888A0] text-center py-4">No recent activity</p>
            ) : (
              recentActivity.slice(0, 6).map((item) => {
                const IconMap: Record<string, any> = {
                  task_created: CheckSquare,
                  task_completed: CheckSquare,
                  task_updated: CheckSquare,
                  user_added: Users,
                  sop_created: BookOpen,
                  meeting_created: Calendar,
                  reviews_finalized: Target,
                  onboarding_started: GraduationCap,
                  onboarding_completed: GraduationCap,
                };
                const Icon = IconMap[item.type] || Activity;
                const seconds = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 1000);
                const timeAgo = seconds < 60 ? "just now" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;

                return (
                  <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-[#2A2A3A] bg-[#0A0A0F]/50 p-2.5">
                    <Icon size={12} className="text-purple-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-snug line-clamp-2">{item.description}</p>
                      <p className="text-[10px] text-[#8888A0] mt-0.5">
                        {item.actor?.firstName} {item.actor?.lastName} · {timeAgo}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Kudos Feed */}
      {recentKudos && recentKudos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Heart size={16} className="text-pink-400" /> Recent Kudos
              </CardTitle>
              <Badge variant="secondary" className="text-xs">{recentKudos.length} recent</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {recentKudos.map((k) => {
                const timeAgo = (() => {
                  const seconds = Math.floor((Date.now() - new Date(k.createdAt).getTime()) / 1000);
                  if (seconds < 60) return "just now";
                  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
                  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
                  return `${Math.floor(seconds / 86400)}d ago`;
                })();
                return (
                  <div key={k.id} className="rounded-lg border border-[#2A2A3A] bg-[#0A0A0F]/50 p-4">
                    <div className="flex items-start gap-3">
                      <Heart size={14} className="text-pink-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs">
                          <span className="font-medium">{k.giver.firstName} {k.giver.lastName}</span>
                          <span className="text-[#8888A0]"> recognized </span>
                          <span className="font-medium">{k.receiver.firstName} {k.receiver.lastName}</span>
                        </p>
                        <p className="text-sm mt-1.5 text-[#C0C0D0] leading-relaxed">&ldquo;{k.message}&rdquo;</p>
                        <div className="flex items-center gap-2 mt-2">
                          {k.companyValue && (
                            <Badge variant="secondary" className="text-[10px]">{k.companyValue}</Badge>
                          )}
                          <span className="text-[10px] text-[#8888A0]">{timeAgo}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Department Performance */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Department Performance</CardTitle>
            <Badge variant="secondary" className="text-xs">This Quarter</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {departmentPerformance.map((dept) => (
              <div key={dept.name} className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium">{dept.name}</div>
                <div className="flex-1">
                  <Progress
                    value={dept.score}
                    className="h-2.5"
                    indicatorClassName={dept.color}
                  />
                </div>
                <div className={`w-12 text-right text-sm font-bold font-mono ${getScoreColor(dept.score)}`}>
                  {dept.score}
                </div>
                <div className="w-20 text-right text-xs text-[#8888A0]">
                  {dept.members} people
                </div>
              </div>
            ))}
            {departmentPerformance.length === 0 && (
              <p className="text-xs text-[#8888A0] text-center py-6">No departments set up yet. Create departments in Organization settings.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
