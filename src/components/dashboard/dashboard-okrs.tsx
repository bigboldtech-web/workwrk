"use client";

// DashboardOkrs — "Your OKRs" widget on the dashboard. Reskinned to the
// house design system (brand blue #0073EA + zinc, flat Monday-clean — no
// lime/violet/pink). Every row deep-links to its own /okrs/[id] detail
// page; unmeasured goals (progressSource NONE) render an honest "—" over
// a neutral empty track, never a fake 0%.

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Building2, Users, User, ChevronRight } from "lucide-react";

const BRAND = "#0073EA";

interface OKR {
  id: string;
  title: string;
  level: "COMPANY" | "DEPARTMENT" | "INDIVIDUAL";
  progress: number;
  /** NONE = nothing measurable yet — render "—", not a fake 0%. */
  progressSource?: "ROLLUP" | "MANUAL" | "NONE";
  quarter: string;
  owner?: { firstName: string; lastName: string };
  department?: { name: string; color?: string };
  keyResults: Array<{ id: string; title: string }>;
}

function levelIcon(level: string) {
  if (level === "COMPANY") return <Building2 size={12} />;
  if (level === "DEPARTMENT") return <Users size={12} />;
  return <User size={12} />;
}

function levelLabel(level: string) {
  if (level === "COMPANY") return "Company";
  if (level === "DEPARTMENT") return "Department";
  return "Individual";
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

  // Sort: company first, then department, then individual
  const order = { COMPANY: 0, DEPARTMENT: 1, INDIVIDUAL: 2 };
  const sorted = [...okrs].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-[#0073EA]" />
            <h3 className="text-sm font-bold text-foreground">Your Goals — {quarter}</h3>
            <Badge variant="outline" className="text-[11px] px-1.5 py-0">{okrs.length}</Badge>
          </div>
          <Link href="/okrs?mine=1" className="text-xs text-[#0073EA] hover:underline flex items-center gap-1">
            View all <ChevronRight size={12} />
          </Link>
        </div>

        <div className="space-y-2">
          {sorted.slice(0, 5).map((okr) => {
            const unmeasured = okr.progressSource === "NONE";
            const pct = Math.max(0, Math.min(100, okr.progress));
            return (
              <Link key={okr.id} href={`/okrs/${okr.id}`} className="block">
                <div className="rounded-lg border border-border bg-background/40 hover:bg-surface-2 transition-colors p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[11px] px-1.5 py-0 gap-1 border-border text-muted">
                          {levelIcon(okr.level)} {levelLabel(okr.level)}
                        </Badge>
                        {okr.department && (
                          <span className="text-[11px] text-muted">{okr.department.name}</span>
                        )}
                        {okr.owner && okr.level === "INDIVIDUAL" && (
                          <span className="text-[11px] text-muted">· {okr.owner.firstName} {okr.owner.lastName}</span>
                        )}
                      </div>
                      <p className="text-sm font-medium truncate">{okr.title}</p>
                      <p className="text-[11px] text-muted mt-0.5">{okr.keyResults.length} Target{okr.keyResults.length !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {unmeasured ? (
                        <p className="text-lg font-bold font-mono text-muted" title="No targets yet">—</p>
                      ) : (
                        <p className="text-lg font-bold font-mono" style={{ color: BRAND }}>
                          {pct}%
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden">
                    {/* Neutral empty track when nothing is measured — no
                        colored fill under a "—". */}
                    {!unmeasured && (
                      <div className="h-full transition-all rounded-full" style={{ width: `${pct}%`, background: BRAND }} />
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        {sorted.length > 5 && (
          <Link href="/okrs?mine=1" className="block mt-2 text-center text-xs text-muted hover:text-[#0073EA] transition-colors">
            +{sorted.length - 5} more
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
