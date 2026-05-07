"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Building2, Users, CreditCard, TrendingUp, RefreshCw, Target,
  CheckSquare, BookOpen, Star, BarChart3, ArrowDownRight, Activity, UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

interface Stats {
  totalOrgs: number;
  totalUsers: number;
  activeOrgs: number;
  trialOrgs: number;
  mrr: number;
  activeRate: number;
  newOrgsThisMonth: number;
  newUsersThisMonth: number;
  planBreakdown: { plan: string; count: number }[];
  funnel?: {
    signedUp: number;
    completedSetup: number;
    engaged: number;
    paying: number;
    windowDays: number;
  };
  cohorts?: { month: string; size: number; active: number; paying: number; churned: number }[];
  mrrOverTime?: { month: string; mrr: number }[];
  recentChurn?: { orgId: string; orgName: string; plan: string; canceledAt: string | null }[];
}

interface Company {
  id: string;
  name: string;
  plan: string;
  status: string;
  _count: {
    users: number;
    tasks: number;
    sops: number;
    reviewCycles: number;
    kras: number;
  };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

const planPrices: Record<string, number> = {
  STARTER: 4999,
  GROWTH: 14999,
  SCALE: 29999,
  ENTERPRISE: 75000,
};

const planColors: Record<string, string> = {
  STARTER: "bg-gray-500",
  GROWTH: "bg-[#d4ff2e]",
  SCALE: "bg-blue-500",
  ENTERPRISE: "bg-amber-500",
};

export default function AdminAnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, companiesRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/companies?limit=100"),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (companiesRes.ok) {
        const data = await companiesRes.json();
        setCompanies(data.companies || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  // Revenue by plan
  const revenueByPlan = (stats?.planBreakdown || []).map((p) => ({
    plan: p.plan,
    count: p.count,
    revenue: (planPrices[p.plan] || 0) * p.count,
  }));

  const totalRevenue = revenueByPlan.reduce((sum, p) => sum + p.revenue, 0);

  // Top companies by usage
  const topByUsers = [...companies].sort((a, b) => b._count.users - a._count.users).slice(0, 5);
  const topByActivity = [...companies]
    .map((c) => ({ ...c, totalActivity: c._count.tasks + c._count.kras + c._count.sops + c._count.reviewCycles }))
    .sort((a, b) => b.totalActivity - a.totalActivity)
    .slice(0, 5);

  const maxUsers = topByUsers[0]?._count.users || 1;
  const maxActivity = topByActivity[0]?.totalActivity || 1;

  // Average users per org
  const avgUsers = stats && stats.totalOrgs > 0 ? Math.round(stats.totalUsers / stats.totalOrgs) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Analytics</h1>
          <p className="text-muted text-sm mt-1">Revenue, usage, and growth metrics</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw size={14} className="mr-2" /> Refresh
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted mb-1">Monthly Recurring Revenue</p>
            <p className="text-2xl font-bold text-green-400">{formatCurrency(stats?.mrr ?? 0)}</p>
            <p className="text-[10px] text-muted mt-1">From {stats?.activeOrgs ?? 0} paying organizations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted mb-1">Avg. Revenue Per Org</p>
            <p className="text-2xl font-bold text-[#d4ff2e]">
              {stats && stats.activeOrgs > 0 ? formatCurrency(Math.round((stats.mrr) / stats.activeOrgs)) : "—"}
            </p>
            <p className="text-[10px] text-muted mt-1">ARPU across all plans</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted mb-1">Avg. Users Per Org</p>
            <p className="text-2xl font-bold text-blue-400">{avgUsers}</p>
            <p className="text-[10px] text-muted mt-1">{stats?.totalUsers ?? 0} users across {stats?.totalOrgs ?? 0} orgs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted mb-1">Trial Conversion Pipeline</p>
            <p className="text-2xl font-bold text-orange-400">{stats?.trialOrgs ?? 0}</p>
            <p className="text-[10px] text-muted mt-1">Organizations currently on trial</p>
          </CardContent>
        </Card>
      </div>

      {/* MRR over time */}
      {stats?.mrrOverTime && stats.mrrOverTime.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={16} className="text-green-400" /> MRR — last 12 months
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer>
                <LineChart data={stats.mrrOverTime} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#888" }} stroke="#444" />
                  <YAxis tick={{ fontSize: 10, fill: "#888" }} stroke="#444" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    formatter={(v) => formatCurrency(typeof v === "number" ? v : Number(v) || 0)}
                    contentStyle={{ background: "#0f0f0f", border: "1px solid #2a2a2a", fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="mrr" stroke="#d4ff2e" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signup funnel */}
      {stats?.funnel && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowDownRight size={16} className="text-blue-400" /> Signup funnel — last {stats.funnel.windowDays} days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const f = stats.funnel!;
              const steps = [
                { label: "Signed up", count: f.signedUp, hint: "Org created" },
                { label: "Completed setup", count: f.completedSetup, hint: "Finished setup wizard" },
                { label: "Engaged", count: f.engaged, hint: "Created ≥1 SOP / KRA / Task" },
                { label: "Paying", count: f.paying, hint: "Active subscription" },
              ];
              const top = steps[0].count || 1;
              return (
                <div className="space-y-3">
                  {steps.map((step, i) => {
                    const prev = i === 0 ? null : steps[i - 1].count;
                    const conv = prev && prev > 0 ? Math.round((step.count / prev) * 100) : null;
                    return (
                      <div key={step.label} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{step.label}</span>
                            <span className="text-muted text-xs">{step.hint}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {conv !== null && (
                              <span className="text-xs text-muted font-mono">{conv}%</span>
                            )}
                            <span className="font-mono text-sm">{step.count}</span>
                          </div>
                        </div>
                        <Progress value={(step.count / top) * 100} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Revenue Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard size={16} className="text-green-400" /> Revenue by Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {revenueByPlan.length === 0 ? (
            <p className="text-sm text-muted">No revenue data yet.</p>
          ) : (
            revenueByPlan.map((p) => (
              <div key={p.plan} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${planColors[p.plan] || "bg-gray-500"}`} />
                    <span className="font-medium">{p.plan}</span>
                    <span className="text-muted text-xs">({p.count} orgs)</span>
                  </div>
                  <span className="font-mono text-sm">{formatCurrency(p.revenue)}</span>
                </div>
                <Progress value={totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0} className="h-2" />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top by Users */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users size={16} className="text-blue-400" /> Largest Organizations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topByUsers.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-muted">{c._count.users} users</span>
                  </div>
                  <Progress value={(c._count.users / maxUsers) * 100} className="h-1.5" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top by Activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 size={16} className="text-[#d4ff2e]" /> Most Active Organizations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topByActivity.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-muted">{c.totalActivity} items</span>
                  </div>
                  <Progress value={(c.totalActivity / maxActivity) * 100} className="h-1.5" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Plan Distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp size={16} className="text-orange-400" /> Growth Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg bg-surface-2 p-4 text-center">
              <p className="text-2xl font-bold text-[#d4ff2e]">+{stats?.newOrgsThisMonth ?? 0}</p>
              <p className="text-[10px] text-muted mt-1">New orgs this month</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">+{stats?.newUsersThisMonth ?? 0}</p>
              <p className="text-[10px] text-muted mt-1">New users this month</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{stats?.activeRate ?? 0}%</p>
              <p className="text-[10px] text-muted mt-1">Active rate</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{formatCurrency((stats?.mrr ?? 0) * 12)}</p>
              <p className="text-[10px] text-muted mt-1">Projected ARR</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cohort retention */}
      {stats?.cohorts && stats.cohorts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users size={16} className="text-blue-400" /> Cohort retention — last 6 months
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-normal">Cohort</th>
                    <th className="pb-2 font-normal">Size</th>
                    <th className="pb-2 font-normal">Active</th>
                    <th className="pb-2 font-normal">Paying</th>
                    <th className="pb-2 font-normal">Churned</th>
                    <th className="pb-2 font-normal">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.cohorts.map((c) => {
                    const retention = c.size > 0 ? Math.round((c.active / c.size) * 100) : 0;
                    return (
                      <tr key={c.month} className="border-t border-white/5">
                        <td className="py-2 font-mono text-xs">{c.month}</td>
                        <td className="py-2">{c.size}</td>
                        <td className="py-2 text-green-400">{c.active}</td>
                        <td className="py-2 text-[#d4ff2e]">{c.paying}</td>
                        <td className="py-2 text-red-400">{c.churned}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <Progress value={retention} className="h-1.5 w-16" />
                            <span className="text-xs text-muted font-mono w-9">{retention}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent churn */}
      {stats?.recentChurn && stats.recentChurn.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserMinus size={16} className="text-red-400" /> Recent cancellations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {stats.recentChurn.map((c) => (
                <li
                  key={c.orgId + (c.canceledAt ?? "")}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{c.orgName}</span>
                    <span className="text-xs text-muted">{c.plan}</span>
                  </div>
                  <span className="text-xs text-muted">
                    {c.canceledAt ? new Date(c.canceledAt).toLocaleDateString() : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
