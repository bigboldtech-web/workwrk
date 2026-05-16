"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building, Users, FileText, AlertTriangle,
  CheckCircle, Clock, BarChart3, TrendingDown,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function rateColor(rate: number) {
  if (rate >= 90) return "text-green-400";
  if (rate >= 70) return "text-[color:var(--accent-strong)]";
  if (rate >= 50) return "text-orange-400";
  return "text-red-400";
}

function rateBarColor(rate: number) {
  if (rate >= 90) return "bg-green-500";
  if (rate >= 70) return "bg-violet-600";
  if (rate >= 50) return "bg-orange-500";
  return "bg-red-500";
}

export default function SOPCompliancePage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/sop-assignments/compliance");
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      console.error("Error fetching compliance data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-3 animate-fade-in">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-20 text-muted">Failed to load compliance data.</div>;
  }

  const { overview, departmentCompliance, personScores, sopCompliance, overdueList } = data;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/sops")} className="shrink-0">
          <ArrowLeft size={18} />
        </Button>
        <PageHeader
          kicker="SOPs · compliance"
          title="SOP compliance dashboard"
          subtitle="Organization-wide SOP compliance tracking."
        />
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{overview.total}</p>
          <p className="text-xs text-muted">Total Assignments</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{overview.completed}</p>
          <p className="text-xs text-muted">Completed</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{overview.inProgress}</p>
          <p className="text-xs text-muted">In Progress</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className={`text-2xl font-bold ${overview.overdue > 0 ? "text-red-400" : "text-muted"}`}>{overview.overdue}</p>
          <p className="text-xs text-muted">Overdue</p>
        </CardContent></Card>
        <Card className="border-[rgba(212,255,46,0.2)] bg-[rgba(212,255,46,0.06)]"><CardContent className="p-4 text-center">
          <p className={`text-2xl font-bold ${rateColor(overview.overallRate)}`}>{overview.overallRate}%</p>
          <p className="text-xs text-muted">Overall Rate</p>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview" className="gap-1.5"><Building size={14} /> By Department</TabsTrigger>
          <TabsTrigger value="people" className="gap-1.5"><Users size={14} /> By Person</TabsTrigger>
          <TabsTrigger value="sops" className="gap-1.5"><FileText size={14} /> By SOP</TabsTrigger>
          <TabsTrigger value="overdue" className="gap-1.5">
            <AlertTriangle size={14} /> Overdue ({overdueList.length})
          </TabsTrigger>
        </TabsList>

        {/* Department Compliance */}
        <TabsContent value="overview" className="mt-4 space-y-3">
          {departmentCompliance.length === 0 ? (
            <div className="text-center py-12 text-muted">No department data available.</div>
          ) : (
            departmentCompliance.map((dept: any) => (
              <Card key={dept.departmentId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-[rgba(212,255,46,0.08)] p-2">
                        <Building size={16} className="text-[color:var(--accent-strong)]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{dept.name}</h3>
                        <p className="text-xs text-muted">{dept.completed}/{dept.total} completed</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-bold font-mono ${rateColor(dept.rate)}`}>{dept.rate}%</p>
                      {dept.overdue > 0 && (
                        <p className="text-[10px] text-red-400">{dept.overdue} overdue</p>
                      )}
                    </div>
                  </div>
                  <Progress value={dept.rate} className="h-2" indicatorClassName={rateBarColor(dept.rate)} />
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Per-Person Scores */}
        <TabsContent value="people" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="text-left py-3 px-4 font-medium">Person</th>
                      <th className="text-left py-3 px-4 font-medium">Department</th>
                      <th className="text-center py-3 px-4 font-medium">Assigned</th>
                      <th className="text-center py-3 px-4 font-medium">Completed</th>
                      <th className="text-center py-3 px-4 font-medium">Rate</th>
                      <th className="text-center py-3 px-4 font-medium">Avg Score</th>
                      <th className="text-center py-3 px-4 font-medium">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personScores.map((p: any) => (
                      <tr key={p.userId} className="border-b border-border/50 hover:bg-surface-2/50">
                        <td className="py-3 px-4 font-medium">{p.name}</td>
                        <td className="py-3 px-4 text-muted">{p.department}</td>
                        <td className="py-3 px-4 text-center font-mono">{p.total}</td>
                        <td className="py-3 px-4 text-center font-mono">{p.completed}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`font-mono font-bold ${rateColor(p.rate)}`}>{p.rate}%</span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono">{p.avgScore != null ? `${p.avgScore}%` : "—"}</td>
                        <td className="py-3 px-4 text-center">
                          {p.overdue > 0 ? (
                            <Badge variant="destructive" className="text-[10px]">{p.overdue}</Badge>
                          ) : (
                            <span className="text-muted">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {personScores.length === 0 && (
                <div className="text-center py-12 text-muted">No person data available.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Per-SOP Compliance */}
        <TabsContent value="sops" className="mt-4 space-y-3">
          {sopCompliance.length === 0 ? (
            <div className="text-center py-12 text-muted">No SOP compliance data available.</div>
          ) : (
            sopCompliance.map((s: any) => (
              <Card key={s.sopId} className="hover:border-muted-2 transition-all cursor-pointer" onClick={() => router.push(`/sops/${s.sopId}`)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="rounded-lg bg-[rgba(212,255,46,0.08)] p-2 shrink-0">
                    <FileText size={16} className="text-[color:var(--accent-strong)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{s.title}</h3>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      {s.category && <span>{s.category}</span>}
                      <span>{s.completed}/{s.total} completed</span>
                    </div>
                    <Progress value={s.rate} className="h-1.5 mt-2" indicatorClassName={rateBarColor(s.rate)} />
                  </div>
                  <p className={`text-xl font-bold font-mono shrink-0 ${rateColor(s.rate)}`}>{s.rate}%</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Overdue List */}
        <TabsContent value="overdue" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {overdueList.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle size={32} className="mx-auto text-green-400 mb-2" />
                  <p className="text-sm text-muted">No overdue assignments. Great job!</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted">
                        <th className="text-left py-3 px-4 font-medium">SOP</th>
                        <th className="text-left py-3 px-4 font-medium">Assigned To</th>
                        <th className="text-left py-3 px-4 font-medium">Department</th>
                        <th className="text-left py-3 px-4 font-medium">Due Date</th>
                        <th className="text-left py-3 px-4 font-medium">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdueList.map((item: any) => {
                        const daysPast = Math.ceil((Date.now() - new Date(item.dueDate).getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <tr key={item.id} className="border-b border-border/50">
                            <td className="py-3 px-4 font-medium">{item.sopTitle}</td>
                            <td className="py-3 px-4">{item.userName}</td>
                            <td className="py-3 px-4 text-muted">{item.department}</td>
                            <td className="py-3 px-4">
                              <span className="text-red-400">{formatDate(item.dueDate)}</span>
                              <span className="text-[10px] text-red-400 ml-1">({daysPast}d overdue)</span>
                            </td>
                            <td className="py-3 px-4 font-mono">
                              {item.stepsCompleted}/{item.stepsTotal}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
