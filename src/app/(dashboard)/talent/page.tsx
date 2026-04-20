"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Users, Grid3x3 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/dashboard/page-header";

const BOX_LABELS: Record<string, { label: string; color: string; action: string }> = {
  "3-3": { label: "Star", color: "bg-green-500/20 border-green-500/40", action: "Promote & Retain" },
  "3-2": { label: "High Performer", color: "bg-blue-500/20 border-blue-500/40", action: "Develop for Leadership" },
  "3-1": { label: "Specialist", color: "bg-cyan-500/20 border-cyan-500/40", action: "Leverage Expertise" },
  "2-3": { label: "High Potential", color: "bg-[rgba(212,255,46,0.12)] border-[rgba(212,255,46,0.35)]", action: "Invest in Growth" },
  "2-2": { label: "Core Player", color: "bg-amber-500/20 border-amber-500/40", action: "Coach & Develop" },
  "2-1": { label: "Average", color: "bg-slate-500/20 border-slate-500/40", action: "Set Clear Goals" },
  "1-3": { label: "Potential Gem", color: "bg-pink-500/20 border-pink-500/40", action: "Address Performance" },
  "1-2": { label: "Underperformer", color: "bg-orange-500/20 border-orange-500/40", action: "Performance Plan" },
  "1-1": { label: "Risk", color: "bg-red-500/20 border-red-500/40", action: "Transition Out" },
};

export default function TalentPage() {
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
  });
  const [users, setUsers] = useState<any[]>([]);
  const { success: toastSuccess } = useToast();

  useEffect(() => {
    Promise.all([
      fetch(`/api/talent-assessment?period=${period}&auto=true`).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/users?limit=100").then((r) => r.ok ? r.json() : { data: [] }),
    ]).then(([assessData, userData]) => {
      setAssessments(assessData?.data || []);
      setUsers(Array.isArray(userData) ? userData : userData?.data || []);
    }).finally(() => setLoading(false));
  }, [period]);

  async function placeUser(userId: string, performance: number, potential: number) {
    const res = await fetch("/api/talent-assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, period, performance, potential }),
    });
    if (res.ok) {
      const data = await res.json();
      setAssessments((prev) => {
        const idx = prev.findIndex((a) => a.userId === userId);
        if (idx >= 0) { const n = [...prev]; n[idx] = { ...data.data || data, user: prev[idx].user }; return n; }
        return [...prev, data.data || data];
      });
      toastSuccess("Assessment saved");
    }
  }

  // Build 9-box grid data
  const grid: Record<string, any[]> = {};
  Object.keys(BOX_LABELS).forEach((k) => { grid[k] = []; });
  assessments.forEach((a) => {
    const key = `${a.performance}-${a.potential}`;
    if (grid[key]) grid[key].push(a);
  });

  const placedUserIds = new Set(assessments.map((a) => a.userId));
  const unplaced = users.filter((u: any) => !placedUserIds.has(u.id));

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader
          kicker="Talent · 9-box grid"
          title="9-Box talent grid"
          subtitle="Performance vs potential assessment by quarter."
        />
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 4 }, (_, i) => {
              const now = new Date();
              const q = Math.ceil((now.getMonth() + 1) / 3) - i;
              const y = q <= 0 ? now.getFullYear() - 1 : now.getFullYear();
              const qn = q <= 0 ? q + 4 : q;
              return <SelectItem key={i} value={`Q${qn} ${y}`}>Q{qn} {y}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{assessments.length}</p>
          <p className="text-xs text-muted">Assessed</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{grid["3-3"]?.length || 0}</p>
          <p className="text-xs text-muted">Stars</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{grid["1-1"]?.length || 0}</p>
          <p className="text-xs text-muted">At Risk</p>
        </CardContent></Card>
      </div>

      {/* 9-Box Grid */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Grid3x3 size={16} className="text-[#d4ff2e]" />
            <CardTitle className="text-base">Talent Matrix</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {/* Column headers — Potential */}
          <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-2 mb-1">
            <div />
            <p className="text-[10px] text-muted text-center">Low Potential</p>
            <p className="text-[10px] text-muted text-center">Medium Potential</p>
            <p className="text-[10px] text-muted text-center">High Potential</p>
          </div>

          {/* Grid rows: High performance (3) at top, Low (1) at bottom */}
          {[3, 2, 1].map((perf) => {
            const perfLabel = perf === 3 ? "High" : perf === 2 ? "Mid" : "Low";
            return (
              <div key={perf} className="grid grid-cols-[60px_1fr_1fr_1fr] gap-2 mb-2">
                {/* Row label */}
                <div className="flex items-center justify-center">
                  <span className="text-[10px] text-muted font-medium text-center leading-tight">{perfLabel}<br/>Perf</span>
                </div>
                {[1, 2, 3].map((pot) => {
                  const key = `${perf}-${pot}`;
                  const box = BOX_LABELS[key];
                  const people = grid[key] || [];
                  return (
                    <div key={key} className={`min-h-[110px] rounded-lg border-2 p-3 ${box.color}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold">{box.label}</span>
                        <span className="text-[10px] text-muted">{people.length}</span>
                      </div>
                      <p className="text-[10px] text-muted mb-2">{box.action}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {people.map((p: any) => (
                          <div key={p.userId} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/60 border border-white/10" title={`${p.user?.firstName} ${p.user?.lastName} — ${p.user?.role?.title || ""} ${p.user?.department?.name || ""}`}>
                            <Avatar className="h-6 w-6">
                              {p.user?.avatar ? <AvatarImage src={p.user.avatar} alt="" /> : null}
                              <AvatarFallback className="text-[10px] font-bold">{p.user?.firstName?.[0]}{p.user?.lastName?.[0]}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium truncate max-w-[80px]">{p.user?.firstName} {p.user?.lastName?.[0]}.</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Unplaced Users */}
      {unplaced.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Not Yet Assessed ({unplaced.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {unplaced.slice(0, 20).map((u: any) => (
                <div key={u.id} className="flex items-center gap-2 p-2 rounded border border-border">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px]">{u.firstName?.[0]}{u.lastName?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate">{u.firstName} {u.lastName}</p>
                  </div>
                  <Select onValueChange={(v) => { const [p, pt] = v.split("-"); placeUser(u.id, Number(p), Number(pt)); }}>
                    <SelectTrigger className="w-20 h-6 text-[10px]"><SelectValue placeholder="Place" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(BOX_LABELS).map(([key, val]) => (
                        <SelectItem key={key} value={key} className="text-xs">{val.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
