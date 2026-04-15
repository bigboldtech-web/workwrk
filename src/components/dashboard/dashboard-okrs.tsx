"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crosshair, Building2, Users, User, ChevronRight } from "lucide-react";

interface OKR {
  id: string;
  title: string;
  level: "COMPANY" | "TEAM" | "INDIVIDUAL";
  progress: number;
  quarter: string;
  owner?: { firstName: string; lastName: string };
  department?: { name: string; color?: string };
  keyResults: Array<{ id: string; title: string }>;
}

function progressColor(p: number) {
  if (p >= 80) return "bg-green-500";
  if (p >= 50) return "bg-blue-500";
  if (p >= 25) return "bg-amber-500";
  return "bg-red-500";
}

function levelIcon(level: string) {
  if (level === "COMPANY") return <Building2 size={12} />;
  if (level === "TEAM") return <Users size={12} />;
  return <User size={12} />;
}

function levelLabel(level: string) {
  if (level === "COMPANY") return "Company";
  if (level === "TEAM") return "Team";
  return "Individual";
}

function levelStyle(level: string) {
  if (level === "COMPANY") return "bg-purple-500/15 text-purple-300 border-purple-500/30";
  if (level === "TEAM") return "bg-blue-500/15 text-blue-300 border-blue-500/30";
  return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
}

export function DashboardOkrs() {
  const [okrs, setOkrs] = useState<OKR[]>([]);
  const [loading, setLoading] = useState(true);
  const [quarter, setQuarter] = useState("");

  useEffect(() => {
    fetch("/api/okrs/my-okrs")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.okrs) {
          setOkrs(d.okrs);
          setQuarter(d.quarter || "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card><CardContent className="p-4"><div className="h-20 bg-surface-2 rounded animate-pulse" /></CardContent></Card>;
  if (okrs.length === 0) return null;

  // Sort: company first, then team, then individual
  const order = { COMPANY: 0, TEAM: 1, INDIVIDUAL: 2 };
  const sorted = [...okrs].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-blue-500/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Crosshair size={16} className="text-purple-400" />
            <h3 className="text-sm font-bold">Your OKRs — {quarter}</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{okrs.length}</Badge>
          </div>
          <Link href="/okrs" className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
            View all <ChevronRight size={12} />
          </Link>
        </div>

        <div className="space-y-2">
          {sorted.slice(0, 5).map((okr) => (
            <Link key={okr.id} href="/okrs" className="block">
              <div className="rounded-lg border border-border bg-background/40 hover:bg-surface-2 transition-colors p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 gap-1 ${levelStyle(okr.level)}`}>
                        {levelIcon(okr.level)} {levelLabel(okr.level)}
                      </Badge>
                      {okr.department && (
                        <span className="text-[10px] text-muted">{okr.department.name}</span>
                      )}
                      {okr.owner && okr.level === "INDIVIDUAL" && (
                        <span className="text-[10px] text-muted">· {okr.owner.firstName} {okr.owner.lastName}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{okr.title}</p>
                    <p className="text-[10px] text-muted mt-0.5">{okr.keyResults.length} Key Result{okr.keyResults.length !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold font-mono" style={{ color: okr.progress >= 80 ? "#10b981" : okr.progress >= 50 ? "#3b82f6" : okr.progress >= 25 ? "#f59e0b" : "#ef4444" }}>
                      {okr.progress}%
                    </p>
                  </div>
                </div>
                <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden">
                  <div className={`h-full ${progressColor(okr.progress)} transition-all`} style={{ width: `${okr.progress}%` }} />
                </div>
              </div>
            </Link>
          ))}
        </div>
        {sorted.length > 5 && (
          <Link href="/okrs" className="block mt-2 text-center text-xs text-muted hover:text-purple-400">
            +{sorted.length - 5} more
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
