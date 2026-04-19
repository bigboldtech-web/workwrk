"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Building2, Users, CreditCard, TrendingUp, RefreshCw, Target,
  CheckSquare, BookOpen, Star, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
    </div>
  );
}
