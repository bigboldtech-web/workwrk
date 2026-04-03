"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Users, CreditCard, TrendingUp, AlertTriangle, Activity,
  RefreshCw,
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
  slug: string;
  plan: string;
  status: string;
  createdAt: string;
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

function getStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE": return <Badge variant="success">Active</Badge>;
    case "TRIAL": return <Badge variant="warning">Trial</Badge>;
    case "SUSPENDED": return <Badge variant="destructive">Suspended</Badge>;
    case "CANCELLED": return <Badge variant="secondary">Cancelled</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

function getPlanBadge(plan: string) {
  const colors: Record<string, string> = {
    STARTER: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    GROWTH: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    SCALE: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    ENTERPRISE: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${colors[plan] || ""}`}>
      {plan}
    </span>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, companiesRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/companies?limit=10"),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
      if (companiesRes.ok) {
        const data = await companiesRes.json();
        setCompanies(data.companies || []);
      }
    } catch (err) {
      console.error("Failed to fetch admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Companies",
      value: stats?.totalOrgs ?? 0,
      change: `+${stats?.newOrgsThisMonth ?? 0} this month`,
      icon: Building2,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      title: "Total Users",
      value: stats?.totalUsers ?? 0,
      change: `+${stats?.newUsersThisMonth ?? 0} this month`,
      icon: Users,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      title: "Monthly Revenue",
      value: formatCurrency(stats?.mrr ?? 0),
      change: `${stats?.activeOrgs ?? 0} paying orgs`,
      icon: CreditCard,
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
    {
      title: "Active Rate",
      value: `${stats?.activeRate ?? 0}%`,
      change: `${stats?.trialOrgs ?? 0} on trial`,
      icon: TrendingUp,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted text-sm mt-1">Platform overview and subscriber management</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw size={14} className="mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted mt-0.5">{stat.change}</p>
              <p className="text-xs text-muted mt-1 font-medium">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Plan Breakdown */}
      {stats?.planBreakdown && stats.planBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Plan Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              {stats.planBreakdown.map((p) => (
                <div key={p.plan} className="flex items-center gap-3">
                  {getPlanBadge(p.plan)}
                  <span className="text-sm font-bold">{p.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Companies Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Subscriber Companies</CardTitle>
          <a href="/admin/companies" className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
            View all →
          </a>
        </CardHeader>
        <CardContent className="p-0">
          {companies.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              No companies registered yet. Share your registration page to get started.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Company</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Plan</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Users</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Usage</th>
                  <th className="text-right p-4 text-xs font-medium text-muted uppercase tracking-wider">Joined</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-purple-400" />
                        <div>
                          <span className="text-sm font-medium">{company.name}</span>
                          <p className="text-[10px] text-muted">{company.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-center">{getPlanBadge(company.plan)}</td>
                    <td className="p-4 text-center text-sm text-muted">{company._count.users}</td>
                    <td className="p-4 text-center">{getStatusBadge(company.status)}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-3 text-[10px] text-muted">
                        <span>{company._count.tasks} tasks</span>
                        <span>{company._count.kras} KRAs</span>
                        <span>{company._count.sops} SOPs</span>
                      </div>
                    </td>
                    <td className="p-4 text-right text-xs text-muted">
                      {new Date(company.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Quick Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity size={16} className="text-purple-400" /> System Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted">
          <div className="flex justify-between">
            <span>Platform</span>
            <span className="text-foreground font-medium">WorkwrK v1.0</span>
          </div>
          <div className="flex justify-between">
            <span>Environment</span>
            <span className="text-foreground font-medium">{process.env.NODE_ENV === "production" ? "Production" : "Development"}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Organizations</span>
            <span className="text-foreground font-medium">{stats?.totalOrgs ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Users</span>
            <span className="text-foreground font-medium">{stats?.totalUsers ?? 0}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
