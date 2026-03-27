"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Users, CreditCard, TrendingUp, AlertTriangle, CheckCircle,
} from "lucide-react";

const platformStats = [
  { title: "Total Companies", value: "12", change: "+2 this month", icon: Building2, color: "text-purple-400", bg: "bg-purple-500/10" },
  { title: "Total Users", value: "487", change: "+45 this month", icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
  { title: "Monthly Revenue", value: "₹1,42,988", change: "+18% MoM", icon: CreditCard, color: "text-green-400", bg: "bg-green-500/10" },
  { title: "Active Rate", value: "89%", change: "DAU/MAU", icon: TrendingUp, color: "text-orange-400", bg: "bg-orange-500/10" },
];

const recentCompanies = [
  { name: "Acme Corp", plan: "GROWTH", users: 48, status: "ACTIVE", mrr: "₹14,999", health: "good" },
  { name: "TechFlow Solutions", plan: "SCALE", users: 126, status: "ACTIVE", mrr: "₹29,999", health: "good" },
  { name: "QuickServe India", plan: "STARTER", users: 18, status: "TRIAL", mrr: "₹0", health: "at_risk" },
  { name: "GreenLeaf Retail", plan: "GROWTH", users: 67, status: "ACTIVE", mrr: "₹14,999", health: "good" },
  { name: "MetroLogistics", plan: "STARTER", users: 22, status: "ACTIVE", mrr: "₹4,999", health: "churning" },
  { name: "CloudNine Digital", plan: "ENTERPRISE", users: 203, status: "ACTIVE", mrr: "₹75,000", health: "good" },
];

function getHealthBadge(health: string) {
  switch (health) {
    case "good": return <Badge variant="success">Healthy</Badge>;
    case "at_risk": return <Badge variant="warning">At Risk</Badge>;
    case "churning": return <Badge variant="destructive">Churn Risk</Badge>;
    default: return <Badge variant="secondary">{health}</Badge>;
  }
}

export default function AdminDashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-[#8888A0] text-sm mt-1">Platform overview and subscriber management</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {platformStats.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-[#8888A0] mt-0.5">{stat.change}</p>
              <p className="text-xs text-[#8888A0] mt-1 font-medium">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Companies Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subscriber Companies</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A3A]">
                <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Company</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Plan</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Users</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Status</th>
                <th className="text-right p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">MRR</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Health</th>
              </tr>
            </thead>
            <tbody>
              {recentCompanies.map((company) => (
                <tr key={company.name} className="border-b border-[#2A2A3A]/50 hover:bg-[#1A1A26]/50 transition-colors cursor-pointer">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-purple-400" />
                      <span className="text-sm font-medium">{company.name}</span>
                    </div>
                  </td>
                  <td className="p-4 text-center"><Badge variant="outline" className="text-xs">{company.plan}</Badge></td>
                  <td className="p-4 text-center text-sm text-[#8888A0]">{company.users}</td>
                  <td className="p-4 text-center">
                    {company.status === "ACTIVE" ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="warning">Trial</Badge>
                    )}
                  </td>
                  <td className="p-4 text-right text-sm font-mono">{company.mrr}</td>
                  <td className="p-4 text-center">{getHealthBadge(company.health)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* System Alerts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">System Alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="rounded-lg border-l-2 border-l-orange-500 bg-orange-500/5 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-orange-400" />
              <p className="text-sm">QuickServe India trial expires in 3 days — no upgrade signal</p>
            </div>
            <p className="text-[10px] text-[#8888A0] mt-1 ml-5">2 hours ago</p>
          </div>
          <div className="rounded-lg border-l-2 border-l-red-500 bg-red-500/5 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400" />
              <p className="text-sm">MetroLogistics usage dropped 60% this week — churn risk</p>
            </div>
            <p className="text-[10px] text-[#8888A0] mt-1 ml-5">1 day ago</p>
          </div>
          <div className="rounded-lg border-l-2 border-l-green-500 bg-green-500/5 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle size={14} className="text-green-400" />
              <p className="text-sm">CloudNine Digital upgraded to Enterprise plan</p>
            </div>
            <p className="text-[10px] text-[#8888A0] mt-1 ml-5">2 days ago</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
