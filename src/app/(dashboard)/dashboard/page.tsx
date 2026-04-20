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
  BookOpen,
  Heart,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Calendar,
  GraduationCap,
} from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { ManagerTeamDashboard } from "@/components/dashboard/manager-dashboard";
import { BirthdayCard } from "@/components/dashboard/birthday-card";
import { AnnouncementsBanner } from "@/components/dashboard/announcements-banner";
import { AdminSetupChecklist } from "@/components/admin-setup-checklist";
import { DashboardOkrs } from "@/components/dashboard/dashboard-okrs";
import { useRole } from "@/hooks/use-role";
import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/dashboard/page-header";
import { AISignals } from "@/components/dashboard/ai-signals";
import { KudosReactions } from "@/components/kudos/kudos-reactions";

interface DashboardStats {
  totalPeople: number;
  newPeopleThisMonth: number;
  sopCompliance: number;
  sopCount: number;
}

interface TopPerformer {
  id: string;
  name: string;
  role: string;
  score: number;
  department: string;
}

interface KpiRecord {
  id: string;
  kpiName: string;
  unit: string | null;
  score: number | null;
  actualValue: number | null;
  targetValue: number;
  userName: string;
  createdAt: string;
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
  reactionCounts: { emoji: string; count: number }[];
  totalReactions: number;
  myReactions: string[];
}

interface PendingSurveyItem {
  id: string;
  title: string;
  questions: unknown;
  audienceType: string;
  createdAt: string;
}

interface DashboardData {
  stats: DashboardStats;
  topPerformers: TopPerformer[];
  recentKpiRecords: KpiRecord[];
  departmentPerformance: DepartmentPerformance[];
  alerts: Alert[];
  recentActivity: ActivityItem[];
  recentKudos: KudosItem[];
  pendingSurveys: PendingSurveyItem[];
}

function getScoreColor(score: number) {
  if (score >= 70) return "text-[color:var(--b-score-good)]";
  if (score >= 50) return "text-[color:var(--b-score-warn)]";
  return "text-[color:var(--b-score-bad)]";
}

function getAlertStyle(type: string) {
  switch (type) {
    case "warning": return "border-l-[#ff9933] bg-[rgba(255,153,51,0.06)]";
    case "danger": return "border-l-[#ff3d8a] bg-[rgba(255,61,138,0.06)]";
    case "success": return "border-l-[#d4ff2e] bg-[rgba(212,255,46,0.06)]";
    default: return "border-l-[#4a9eff] bg-[rgba(74,158,255,0.06)]";
  }
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className ?? ""}`} />;
}

function EmployeeOfMonthCard() {
  const [eom, setEom] = useState<any>(null);

  useEffect(() => {
    fetch("/api/employee-of-month")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data?.current) setEom(d.data.current); })
      .catch(() => {});
  }, []);

  if (!eom) return null; // Don't show card if no data yet

  return (
    <Card className="border-yellow-500/20 bg-gradient-to-r from-yellow-500/5 to-amber-500/5 dark:from-yellow-500/10 dark:to-amber-500/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/20">
            <Trophy size={24} className="text-yellow-400" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted uppercase tracking-wider font-medium">Employee of the Month</p>
            <p className="text-lg font-bold">{eom.user?.firstName} {eom.user?.lastName}</p>
            <div className="flex items-center gap-2 text-xs text-muted">
              {eom.user?.role?.title && <span>{eom.user.role.title}</span>}
              {eom.user?.department?.name && <span>&middot; {eom.user.department.name}</span>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold font-mono text-yellow-400">{Math.round(eom.score)}</p>
            <p className="text-[10px] text-muted">Score</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { isEmployee, isManager, isExecutive } = useRole();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("dashboard");

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
      <div className="space-y-4 animate-fade-in">
        <PageHeader kicker="Your workspace · live" title={t("title")} subtitle={t("subtitle")} />
        <AnnouncementsBanner />
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
      <div className="space-y-4 animate-fade-in">
        <PageHeader kicker="Your workspace · live" title={t("title")} subtitle={t("subtitle")} />
        <ErrorState message={error ?? undefined} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const { stats: apiStats, topPerformers, recentKpiRecords, departmentPerformance, alerts, recentActivity, recentKudos, pendingSurveys } = data;

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
      color: "text-[#d4ff2e]",
      bgColor: "bg-[rgba(212,255,46,0.08)]",
    },
    {
      title: "Avg Performance",
      value: avgKpiScore,
      change: topPerformers.length > 0 ? `from ${topPerformers.length} performers` : "No data",
      trend: "up",
      icon: Target,
      color: "text-[#ff3d8a]",
      bgColor: "bg-[rgba(255,61,138,0.08)]",
    },
    {
      title: "Active SOPs",
      value: String(apiStats.sopCount),
      change: "published",
      trend: "neutral",
      icon: BookOpen,
      color: "text-[#4a9eff]",
      bgColor: "bg-[rgba(74,158,255,0.08)]",
    },
    {
      title: "SOP Compliance",
      value: `${apiStats.sopCompliance}%`,
      change: `${apiStats.sopCount} published`,
      trend: apiStats.sopCompliance >= 80 ? "up" : "down",
      icon: BookOpen,
      color: "text-[#ff9933]",
      bgColor: "bg-[rgba(255,153,51,0.08)]",
    },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="Your workspace · live"
        title="Dashboard"
        subtitle="Everything that happened in your org today — KPIs, SOPs, kudos, and the people driving them."
        actions={[
          { label: "Ask the AI Engine", href: "/ai", variant: "ghost", icon: <span aria-hidden>✦</span> },
        ]}
      />

      {/* Announcements — pinned at the very top so everyone sees them */}
      <AnnouncementsBanner />

      {/* Admin setup checklist (only for admins, auto-hides when complete) */}
      <AdminSetupChecklist />

      {/* AI Signals — cross-module attention-worthy events */}
      <AISignals />

      {/* OKRs */}
      <DashboardOkrs />

      {/* Birthday Card */}
      <BirthdayCard />

      {/* Onboarding Checklist */}
      <OnboardingChecklist />

      {/* Employee of the Month */}
      <EmployeeOfMonthCard />

      {/* Employee Dashboard — employees see their own KPIs, SOPs, reviews */}
      {isEmployee && <EmployeeDashboard />}

      {/* Manager Team Dashboard — managers see their direct reports first */}
      {isManager && <ManagerTeamDashboard />}

      {/* Stats Grid — org-wide stats for managers/executives */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="hover:border-muted-2 transition-colors">
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
                <p className="text-xs text-muted mt-0.5">{stat.change}</p>
              </div>
              <p className="text-xs text-muted mt-2 font-medium">{stat.title}</p>
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
                className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(212,255,46,0.12)] text-xs font-bold text-[#d4ff2e]">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{person.name}</p>
                  <p className="text-xs text-muted">{person.role}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold font-mono ${getScoreColor(person.score)}`}>
                    {person.score}
                  </p>
                </div>
              </div>
            ))}
            {topPerformers.length === 0 && (
              <p className="text-xs text-muted text-center py-6">No KPI data yet. Set up KRAs and track KPI scores to see top performers here.</p>
            )}
          </CardContent>
        </Card>

        {/* Recent KPI Updates */}
        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">KPI Updates</CardTitle>
              <Link href="/kra-kpi" className="text-xs text-[#d4ff2e] hover:text-[#e2ff6b]">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(recentKpiRecords || []).map((record) => {
              const achievement = record.targetValue > 0 && record.actualValue != null
                ? Math.round((record.actualValue / record.targetValue) * 100)
                : null;
              return (
                <div
                  key={record.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3"
                >
                  <Target size={14} className="text-[#d4ff2e] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{record.kpiName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted">{record.userName}</span>
                      {achievement != null && (
                        <span className={`text-[10px] font-mono font-semibold ${achievement >= 100 ? "text-green-400" : achievement >= 70 ? "text-[#d4ff2e]" : "text-orange-400"}`}>
                          {achievement}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {(!recentKpiRecords || recentKpiRecords.length === 0) && (
              <p className="text-xs text-muted text-center py-6">No KPI records yet. Start tracking KPIs to see updates here.</p>
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
                <p className="text-[10px] text-muted mt-1">{alert.time}</p>
              </div>
            ))}
            {alerts.length === 0 && (
              <p className="text-xs text-muted text-center py-6">No alerts right now. Everything looks good!</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <Link href="/activity" className="text-xs text-[#d4ff2e] hover:text-[#e2ff6b]">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(!recentActivity || recentActivity.length === 0) ? (
              <p className="text-xs text-muted text-center py-4">No recent activity</p>
            ) : (
              recentActivity.slice(0, 6).map((item) => {
                const IconMap: Record<string, any> = {
                  user_added: Users,
                  kra_assigned: Target,
                  kpi_recorded: Target,
                  sop_created: BookOpen,
                  sop_completed: BookOpen,
                  meeting_created: Calendar,
                  reviews_finalized: Target,
                  kudos_given: Heart,
                  onboarding_started: GraduationCap,
                  onboarding_completed: GraduationCap,
                };
                const Icon = IconMap[item.type] || Activity;
                const seconds = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 1000);
                const timeAgo = seconds < 60 ? "just now" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;

                return (
                  <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-background/50 p-2.5">
                    <Icon size={12} className="text-[#d4ff2e] mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-snug line-clamp-2">{item.description}</p>
                      <p className="text-[10px] text-muted mt-0.5">
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

      {/* Pending Surveys */}
      {pendingSurveys && pendingSurveys.length > 0 && (
        <Card className="border-[color:var(--accent-strong)]/30 bg-[color:var(--accent-soft)]/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <span aria-hidden className="text-[color:var(--accent-strong)]">📋</span>
                Surveys waiting for you
              </CardTitle>
              <Badge variant="outline" className="text-xs">{pendingSurveys.length} pending</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingSurveys.map((s) => {
                const qCount = Array.isArray(s.questions) ? s.questions.length : 0;
                return (
                  <Link
                    key={s.id}
                    href="/surveys"
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-background/60 hover:bg-surface-2 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.title}</p>
                      <p className="text-[11px] text-muted">{qCount} question{qCount === 1 ? "" : "s"} · takes ~{Math.max(1, qCount)} min</p>
                    </div>
                    <span className="text-xs text-[color:var(--accent-strong)] font-medium flex-shrink-0">Respond →</span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kudos Feed */}
      {recentKudos && recentKudos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Heart size={16} className="text-pink-400" /> Recent Kudos
              </CardTitle>
              <Link href="/kudos" className="text-xs text-[#d4ff2e] hover:underline">View all →</Link>
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
                  <div key={k.id} className="rounded-lg border border-border bg-background/50 p-4 flex flex-col">
                    <div className="flex items-start gap-3">
                      <Heart size={14} className="text-pink-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs">
                          <span className="font-medium">{k.giver.firstName} {k.giver.lastName}</span>
                          <span className="text-muted"> → </span>
                          <span className="font-medium">{k.receiver.firstName} {k.receiver.lastName}</span>
                        </p>
                        <p className="text-sm mt-1.5 italic text-foreground leading-relaxed">&ldquo;{k.message}&rdquo;</p>
                        <div className="flex items-center gap-2 mt-2">
                          {k.companyValue && (
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-[#d4ff2e]/40 text-[#d4ff2e]">{k.companyValue}</Badge>
                          )}
                          <span className="text-[10px] text-muted">{timeAgo}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border/60">
                      <KudosReactions
                        kudosId={k.id}
                        initialCounts={k.reactionCounts}
                        initialMine={k.myReactions}
                        compact
                      />
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
                <div className="w-20 text-right text-xs text-muted">
                  {dept.members} people
                </div>
              </div>
            ))}
            {departmentPerformance.length === 0 && (
              <p className="text-xs text-muted text-center py-6">No departments set up yet. Create departments in Organization settings.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
