"use client";

// Employee benefits self-service. Shows current enrollments,
// dependents, and any open enrollment window the user can act on.
// Inline elect button creates a DRAFT enrollment that the carrier
// adapter then submits when the user confirms.

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Heart, CalendarDays, UserPlus, AlertCircle, CheckCircle2 } from "lucide-react";

type Tier = { id: string; tier: string; employeeCost: number; employerCost: number };
type Plan = {
  id: string;
  name: string;
  type: string;
  carrier: string | null;
  description: string | null;
  employeeCost: number;
  employerCost: number;
  tiers: Tier[];
};

type Enrollment = {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "ACTIVE" | "ENDED" | "CANCELLED";
  employeeCost: number;
  employerCost: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  benefitPlan: { id: string; name: string; type: string; carrier: string | null };
  benefitTier: { id: string; tier: string } | null;
};

type Dependent = {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  coveredOnPlan: boolean;
};

type LifeEvent = {
  id: string;
  type: string;
  status: "REPORTED" | "APPROVED" | "REJECTED" | "ENROLLED";
  eventDate: string;
};

type Window = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  effectiveDate: string;
  status: "OPEN";
  plans: Plan[];
};

type Data = {
  enrollments: Enrollment[];
  dependents: Dependent[];
  lifeEvents: LifeEvent[];
  openWindows: Window[];
};

const STATUS_STYLE: Record<Enrollment["status"], string> = {
  DRAFT: "text-muted border-white/20",
  SUBMITTED: "text-amber-400 border-amber-400/30",
  ACTIVE: "text-green-400 border-green-400/30",
  ENDED: "text-muted border-white/20",
  CANCELLED: "text-red-400 border-red-400/30",
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

export default function MyBenefitsPage() {
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/my-benefits");
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load", description: json?.error });
        return;
      }
      setData(json);
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function elect(planId: string, tierId: string | null, openWindowId: string) {
    const res = await fetch("/api/my-benefits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        benefitPlanId: planId,
        benefitTierId: tierId,
        openEnrollmentId: openWindowId,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't elect", description: json?.error });
      return;
    }
    toast({ type: "success", title: "Election saved as draft" });
    load();
  }

  if (loading) return <div className="text-sm text-muted py-8 text-center">Loading…</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Heart size={20} /> My benefits
        </h1>
        <p className="text-muted text-sm mt-1">
          Your current elections, dependents, and any open enrollment window.
        </p>
      </div>

      {data.openWindows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays size={16} className="text-amber-500" /> Open enrollment is live
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.openWindows.map((w) => (
              <div key={w.id} className="space-y-2">
                <div className="text-sm font-medium">{w.name}</div>
                <div className="text-xs text-muted">
                  Election period {new Date(w.startDate).toLocaleDateString()} → {new Date(w.endDate).toLocaleDateString()} · effective {new Date(w.effectiveDate).toLocaleDateString()}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {w.plans.map((p) => (
                    <div key={p.id} className="border border-line rounded p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-medium text-sm">{p.name}</div>
                        <Badge variant="outline" className="text-[10px]">{p.type}</Badge>
                      </div>
                      {p.carrier && <div className="text-xs text-muted">{p.carrier}</div>}
                      {p.description && <div className="text-xs text-muted mt-1">{p.description}</div>}
                      <div className="text-xs mt-2">
                        EE <span className="font-mono">{fmtMoney(Number(p.employeeCost))}</span> · ER <span className="font-mono">{fmtMoney(Number(p.employerCost))}</span> per pay
                      </div>
                      {p.tiers.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.tiers.map((t) => (
                            <Button
                              key={t.id}
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => elect(p.id, t.id, w.id)}
                            >
                              Elect {t.tier} ({fmtMoney(Number(t.employeeCost))})
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => elect(p.id, null, w.id)}>
                            Elect this plan
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Active elections</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.enrollments.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">No elections yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Plan</th>
                  <th className="px-4 py-2.5 font-normal">Tier</th>
                  <th className="px-4 py-2.5 font-normal text-right">EE / pay</th>
                  <th className="px-4 py-2.5 font-normal text-right">ER / pay</th>
                  <th className="px-4 py-2.5 font-normal">Effective</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.enrollments.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{e.benefitPlan.name}</div>
                      <div className="text-[10px] text-muted">{e.benefitPlan.type} · {e.benefitPlan.carrier ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{e.benefitTier?.tier ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{fmtMoney(Number(e.employeeCost))}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{fmtMoney(Number(e.employerCost))}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {new Date(e.effectiveStart).toLocaleDateString()}
                      {e.effectiveEnd && ` → ${new Date(e.effectiveEnd).toLocaleDateString()}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[e.status]}`}>{e.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><UserPlus size={14} /> Dependents</CardTitle>
            <span className="text-xs text-muted">Add or edit dependents in HR settings</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {data.dependents.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">No dependents on file.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {data.dependents.map((d) => (
                <li key={d.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{d.firstName} {d.lastName}</div>
                    <div className="text-xs text-muted">{d.relationship}</div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${d.coveredOnPlan ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                    {d.coveredOnPlan ? <><CheckCircle2 size={10} className="inline mr-1" /> covered</> : "no coverage"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><AlertCircle size={14} /> Life events</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.lifeEvents.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              Marriage, birth, address change, etc. open a window for off-cycle benefit changes. Contact HR to log one.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {data.lifeEvents.map((e) => (
                <li key={e.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{e.type.replace(/_/g, " ")}</div>
                    <div className="text-xs text-muted">{new Date(e.eventDate).toLocaleDateString()}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
