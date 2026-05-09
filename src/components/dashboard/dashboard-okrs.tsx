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
  if (p >= 80) return "bg-[#d4ff2e]";
  if (p >= 50) return "bg-[#4a9eff]";
  if (p >= 25) return "bg-[#ff9933]";
  return "bg-[#ff3d8a]";
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
  if (level === "COMPANY") return "bg-[rgba(212,255,46,0.1)] text-[color:var(--accent-strong)] border-[rgba(212,255,46,0.3)]";
  if (level === "TEAM") return "bg-[rgba(74,158,255,0.1)] text-[#4a9eff] border-[rgba(74,158,255,0.3)]";
  return "bg-[rgba(255,153,51,0.1)] text-[#ff9933] border-[rgba(255,153,51,0.3)]";
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
    <Card className="border-[rgba(212,255,46,0.2)] bg-gradient-to-br from-[rgba(212,255,46,0.04)] to-[rgba(74,158,255,0.04)]">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Crosshair size={16} className="text-[color:var(--accent-strong)]" />
            <h3 className="text-sm font-bold text-foreground">Your OKRs — {quarter}</h3>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{okrs.length}</Badge>
          </div>
          <Link href="/okrs" className="text-xs text-[color:var(--accent-strong)] hover:text-[#e2ff6b] flex items-center gap-1">
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
                    <p className="text-lg font-bold font-mono" style={{ color: okr.progress >= 80 ? "#d4ff2e" : okr.progress >= 50 ? "#4a9eff" : okr.progress >= 25 ? "#ff9933" : "#ff3d8a" }}>
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
          <Link href="/okrs" className="block mt-2 text-center text-xs text-muted hover:text-[color:var(--accent-strong)] transition-colors">
            +{sorted.length - 5} more
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
