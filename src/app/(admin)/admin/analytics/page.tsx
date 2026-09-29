"use client";

import { formatDate } from "@/lib/format/date";

import { useConsole } from "../../console-context";

import { Dots } from "@/components/ui/dots";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Users, CreditCard, TrendingUp, RefreshCw,
  BarChart3, ArrowDownRight, UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { planLabel } from "@/lib/staff-audit-helpers";

interface Stats {
  totalOrgs: number;
  totalUsers: number;
  activeOrgs: number;
  trialOrgs: number;
  /** Whether billing is connected. No revenue number is sent until the Stripe reader ships. */
  revenue?: { source: "stripe" | "unavailable" };
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

const planColors: Record<string, string> = {
  // Plan shares are one series: neutral steps, the one blue on the largest tier.
  STARTER: "bg-line-strong",
  GROWTH: "bg-ink-3",
  SCALE: "bg-ink-2",
  ENTERPRISE: "bg-brand",
};

export default function AdminAnalyticsPage() {
  const { datePrefs } = useConsole();
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
        <Dots variant="pending" label="Loading" />
      </div>
    );
  }

  // Companies per plan: the true half of the old "Revenue by Plan" card,
  // which multiplied a hard-coded price by this count (spec 2.5 item 7).
  const plans = stats?.planBreakdown || [];
  const maxPlan = Math.max(1, ...plans.map((p) => p.count));

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
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw size={14} className="mr-2" /> Refresh
        </Button>
      </div>

      {/* Revenue: what Stripe charged, never a price list (spec 2.5 item 1).
          No number is shown until that reader ships; a zero is never shown
          in place of a missing number. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard size={16} className="text-ink-2" /> Revenue
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats?.revenue?.source === "stripe" ? (
            <p className="text-base text-ink-2">
              Billing is connected. What Stripe charged is in the{" "}
              <a
                href="https://dashboard.stripe.com/payments"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-deep hover:underline"
              >
                Stripe dashboard
              </a>
              , one line per currency.
            </p>
          ) : (
            <OsEmptyView compact title="Billing is not connected yet" />
          )}
        </CardContent>
      </Card>

      {/* Growth */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-ink-2 mb-1">Average people per company</p>
            <p className="text-2xl font-semibold tabular-nums text-ink">{avgUsers}</p>
            <p className="text-xs text-ink-2 mt-1">{stats?.totalUsers ?? 0} people across {stats?.totalOrgs ?? 0} companies</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-ink-2 mb-1">On trial</p>
            <p className="text-2xl font-semibold tabular-nums text-ink">{stats?.trialOrgs ?? 0}</p>
            <p className="text-xs text-ink-2 mt-1">Companies on trial now</p>
          </CardContent>
        </Card>
      </div>

      {/* Signup funnel */}
      {stats?.funnel && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowDownRight size={16} className="text-ink-2" /> Signup funnel, last {stats.funnel.windowDays} days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const f = stats.funnel!;
              const steps = [
                { label: "Signed up", count: f.signedUp, hint: "A company was created" },
                { label: "Finished setup", count: f.completedSetup, hint: "They completed the setup wizard" },
                { label: "Created something", count: f.engaged, hint: "At least one SOP, KRA or task" },
                { label: "Paying", count: f.paying, hint: "An active subscription" },
              ];
              const top = steps[0].count || 1;
              return (
                <div className="space-y-3">
                  {steps.map((step, i) => {
                    const prev = i === 0 ? null : steps[i - 1].count;
                    const conv = prev && prev > 0 ? Math.round((step.count / prev) * 100) : null;
                    return (
                      <div key={step.label} className="space-y-1">
                        <div className="flex items-center justify-between text-base">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{step.label}</span>
                            <span className="text-ink-2 text-sm">{step.hint}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {conv !== null && (
                              <span className="text-sm text-ink-2 font-mono">{conv}%</span>
                            )}
                            <span className="font-mono text-base">{step.count}</span>
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

      {/* Plans: companies per plan, no revenue per plan (spec 2.5 item 7). */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 size={16} className="text-ink-2" /> Plans
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {plans.length === 0 ? (
            <p className="text-base text-ink-2">Nothing to measure yet.</p>
          ) : (
            plans.map((p) => (
              <div key={p.plan} className="space-y-1">
                <div className="flex items-center justify-between text-base">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${planColors[p.plan] || "bg-line-strong"}`} />
                    <span className="font-medium">{planLabel(p.plan)}</span>
                  </div>
                  <span className="tabular-nums text-base">
                    {p.count} {p.count === 1 ? "company" : "companies"}
                  </span>
                </div>
                <Progress value={(p.count / maxPlan) * 100} className="h-2" />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top by Users */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users size={16} className="text-ink-2" /> Biggest workspaces
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topByUsers.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-sm font-semibold text-ink-2 w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-base font-medium">{c.name}</span>
                    <span className="text-sm text-ink-2">{c._count.users} {c._count.users === 1 ? "person" : "people"}</span>
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
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 size={16} className="text-ink-2" /> Busiest workspaces
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topByActivity.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-sm font-semibold text-ink-2 w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-base font-medium">{c.name}</span>
                    <span className="text-sm text-ink-2">{c.totalActivity} items</span>
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
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp size={16} className="text-ink-2" /> Growth
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-hover p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums text-ink">{stats?.newOrgsThisMonth ?? 0}</p>
              <p className="text-xs text-ink-2 mt-1">New companies in the last 30 days</p>
            </div>
            <div className="rounded-lg bg-hover p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums text-ink">{stats?.newUsersThisMonth ?? 0}</p>
              <p className="text-xs text-ink-2 mt-1">New people in the last 30 days</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cohort retention */}
      {stats?.cohorts && stats.cohorts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users size={16} className="text-ink-2" /> Cohort retention, last 6 months
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="text-left text-sm text-ink-2">
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
                      <tr key={c.month} className="border-t border-line">
                        <td className="py-2 font-mono text-sm">{c.month}</td>
                        <td className="py-2">{c.size}</td>
                        <td className="py-2 text-ink">{c.active}</td>
                        <td className="py-2 text-ink-2">{c.paying}</td>
                        <td className="py-2 text-ink">{c.churned}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <Progress value={retention} className="h-1.5 w-16" />
                            <span className="text-sm text-ink-2 font-mono w-9">{retention}%</span>
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
            <CardTitle className="text-lg flex items-center gap-2">
              <UserMinus size={16} className="text-ink-2" /> Recent cancellations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {stats.recentChurn.map((c) => (
                <li
                  key={c.orgId + (c.canceledAt ?? "")}
                  className="flex items-center justify-between text-base"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{c.orgName}</span>
                    <span className="text-sm text-ink-2">{planLabel(c.plan)}</span>
                  </div>
                  <span className="text-sm text-ink-2">
                    {c.canceledAt ? formatDate(c.canceledAt, datePrefs, "date") : "Unknown"}
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
