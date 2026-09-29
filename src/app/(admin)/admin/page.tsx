"use client";

import { formatDate } from "@/lib/format/date";

import { useConsole } from "../console-context";

import { Dots } from "@/components/ui/dots";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Building2, Users, CreditCard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Stats {
  totalOrgs: number;
  totalUsers: number;
  activeOrgs: number;
  trialOrgs: number;
  payingOrgs: number;
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
    // One neutral chip for every plan: a plan is a fact, not a status.
    STARTER: "bg-hover text-ink-2 border-line",
    GROWTH: "bg-hover text-ink-2 border-line",
    SCALE: "bg-hover text-ink-2 border-line",
    ENTERPRISE: "bg-hover text-ink-2 border-line",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colors[plan] || ""}`}>
      {plan}
    </span>
  );
}

export default function AdminDashboard() {
  const { datePrefs } = useConsole();
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
        <Dots variant="pending" label="Loading" />
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Companies",
      value: stats?.totalOrgs ?? 0,
      change: `+${stats?.newOrgsThisMonth ?? 0} this month`,
      icon: Building2,
      color: "text-ink-2",
      bg: "bg-hover",
    },
    {
      title: "Total Users",
      value: stats?.totalUsers ?? 0,
      change: `+${stats?.newUsersThisMonth ?? 0} this month`,
      icon: Users,
      color: "text-ink-2",
      bg: "bg-hover",
    },
    // No revenue tile and no "Active rate" here: the old revenue figure
    // multiplied a hard-coded price list and the rate measured billing
    // status, not activity, so neither was a fact. Revenue returns with
    // the Overview rebuild, read from what Stripe actually charged.
    {
      title: "Paying",
      value: stats?.payingOrgs ?? 0,
      change: `${stats?.trialOrgs ?? 0} on trial`,
      icon: CreditCard,
      color: "text-success-text",
      bg: "bg-hover",
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw size={14} className="mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="text-sm text-ink-2 mt-0.5">{stat.change}</p>
              <p className="text-sm text-ink-2 mt-1 font-medium">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Plan Breakdown */}
      {stats?.planBreakdown && stats.planBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Plans</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              {stats.planBreakdown.map((p) => (
                <div key={p.plan} className="flex items-center gap-3">
                  {getPlanBadge(p.plan)}
                  <span className="text-base font-semibold">{p.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Companies Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Newest companies</CardTitle>
          <Link href="/admin/companies" className="text-sm text-ink-2 hover:underline transition-colors">
            See all companies
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {companies.length === 0 ? (
            <div className="p-8 text-center text-base text-ink-2">
              No companies registered yet. Share your registration page to get started.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Company</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Plan</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Users</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Status</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Usage</th>
                  <th className="text-right p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Joined</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id} className="border-b border-line/50 hover:bg-hover transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-ink-2" />
                        <div>
                          <span className="text-base font-medium">{company.name}</span>
                          <p className="text-xs text-ink-2">{company.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-center">{getPlanBadge(company.plan)}</td>
                    <td className="p-4 text-center text-base text-ink-2">{company._count.users}</td>
                    <td className="p-4 text-center">{getStatusBadge(company.status)}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-3 text-xs text-ink-2">
                        <span>{company._count.tasks} tasks</span>
                        <span>{company._count.kras} KRAs</span>
                        <span>{company._count.sops} SOPs</span>
                      </div>
                    </td>
                    <td className="p-4 text-right text-sm text-ink-2">
                      {formatDate(company.createdAt, datePrefs, "date")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
