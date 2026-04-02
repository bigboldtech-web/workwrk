"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Target,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Save,
  Calendar,
  MessageSquare,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  getCurrentPeriod,
  getLastPeriod,
  formatPeriodLabel,
  calculateScore,
} from "@/lib/kpi-utils";

interface KpiEntry {
  kpiId: string;
  name: string;
  unit: string | null;
  type: string;
  targetValue: number | null;
  existingRecord: {
    id: string;
    actualValue: number | null;
    score: number | null;
    managerNotes: string | null;
    status: string;
  } | null;
}

interface KraGroup {
  kraId: string;
  kraName: string;
  kpis: KpiEntry[];
}

interface RecordFormData {
  [kpiId: string]: {
    actualValue: string;
    managerNotes: string;
  };
}

interface Props {
  userId: string;
}

export function MonthlyKpiRecorder({ userId }: Props) {
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [kras, setKras] = useState<KraGroup[]>([]);
  const [totalKpis, setTotalKpis] = useState(0);
  const [recordedKpis, setRecordedKpis] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<RecordFormData>({});
  const [expandedKras, setExpandedKras] = useState<Set<string>>(new Set());
  const [showNotes, setShowNotes] = useState<Set<string>>(new Set());
  const { success: toastSuccess, error: toastError } = useToast();

  const currentPeriod = getCurrentPeriod();
  const lastPeriod = getLastPeriod();

  const fetchKpis = useCallback(async (period: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}/kpis?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const result = data.data || data;
      setKras(result.kras || []);
      setTotalKpis(result.totalKpis || 0);
      setRecordedKpis(result.recordedKpis || 0);

      // Initialize form data from existing records
      const fd: RecordFormData = {};
      for (const kra of result.kras || []) {
        for (const kpi of kra.kpis) {
          fd[kpi.kpiId] = {
            actualValue: kpi.existingRecord?.actualValue?.toString() || "",
            managerNotes: kpi.existingRecord?.managerNotes || "",
          };
        }
      }
      setFormData(fd);

      // Auto-expand all KRAs
      setExpandedKras(new Set((result.kras || []).map((k: KraGroup) => k.kraId)));
    } catch {
      toastError("Failed to load KPIs");
    } finally {
      setLoading(false);
    }
  }, [userId, toastError]);

  useEffect(() => {
    if (selectedPeriod) {
      fetchKpis(selectedPeriod);
    }
  }, [selectedPeriod, fetchKpis]);

  const updateField = (kpiId: string, field: "actualValue" | "managerNotes", value: string) => {
    setFormData((prev) => ({
      ...prev,
      [kpiId]: { ...prev[kpiId], [field]: value },
    }));
  };

  const handleSaveAll = async () => {
    if (!selectedPeriod) return;
    setSaving(true);
    try {
      const records = Object.entries(formData).map(([kpiId, data]) => ({
        kpiId,
        actualValue: data.actualValue ? Number(data.actualValue) : null,
        managerNotes: data.managerNotes || null,
      }));

      const res = await fetch("/api/kpi-records/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, period: selectedPeriod, records }),
      });

      if (!res.ok) {
        const err = await res.json();
        toastError(err.error || "Failed to save");
        return;
      }

      const result = await res.json();
      toastSuccess(`Saved ${(result.data || result).saved} KPI records for ${formatPeriodLabel(selectedPeriod)}`);
      fetchKpis(selectedPeriod);
    } catch {
      toastError("Failed to save KPI records");
    } finally {
      setSaving(false);
    }
  };

  const toggleKra = (kraId: string) => {
    setExpandedKras((prev) => {
      const next = new Set(prev);
      if (next.has(kraId)) next.delete(kraId);
      else next.add(kraId);
      return next;
    });
  };

  const toggleNotes = (kpiId: string) => {
    setShowNotes((prev) => {
      const next = new Set(prev);
      if (next.has(kpiId)) next.delete(kpiId);
      else next.add(kpiId);
      return next;
    });
  };

  // No period selected — show selection buttons
  if (!selectedPeriod) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Target size={40} className="mx-auto text-purple-400 mb-4" />
          <h3 className="text-lg font-semibold mb-2">Record Monthly KPIs</h3>
          <p className="text-sm text-[#8888A0] mb-6">
            Select a period to record or update KPI scores
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => setSelectedPeriod(lastPeriod)} variant="outline" className="gap-2">
              <Calendar size={14} /> {formatPeriodLabel(lastPeriod)}
              <Badge variant="secondary" className="text-[10px]">Last Month</Badge>
            </Button>
            <Button onClick={() => setSelectedPeriod(currentPeriod)} className="gap-2">
              <Calendar size={14} /> {formatPeriodLabel(currentPeriod)}
              <Badge variant="secondary" className="text-[10px]">This Month</Badge>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading
  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent mx-auto" />
          <p className="text-sm text-[#8888A0] mt-3">Loading KPIs...</p>
        </CardContent>
      </Card>
    );
  }

  // No KPIs assigned
  if (kras.length === 0 || totalKpis === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Target size={40} className="mx-auto text-[#8888A0] mb-4" />
          <h3 className="text-lg font-semibold mb-2">No KPIs Assigned</h3>
          <p className="text-sm text-[#8888A0]">
            Assign KRAs with KPIs to this person first, then come back to record scores.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setSelectedPeriod(null)}>
            Go Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Calculate overall progress
  const filledCount = Object.values(formData).filter((d) => d.actualValue !== "").length;
  const overallProgress = totalKpis > 0 ? Math.round((filledCount / totalKpis) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setSelectedPeriod(null)} className="text-xs">
                Change Period
              </Button>
              <div>
                <h3 className="text-sm font-semibold">{formatPeriodLabel(selectedPeriod)}</h3>
                <p className="text-xs text-[#8888A0]">
                  {filledCount} of {totalKpis} KPIs recorded
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 min-w-[120px]">
                <Progress value={overallProgress} className="h-2 flex-1" />
                <span className="text-xs font-mono text-purple-400">{overallProgress}%</span>
              </div>
              <Button onClick={handleSaveAll} disabled={saving} className="gap-1.5">
                <Save size={14} /> {saving ? "Saving..." : "Save All"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KRA Groups */}
      {kras.map((kra) => {
        const isExpanded = expandedKras.has(kra.kraId);
        const kraFilled = kra.kpis.filter((k) => formData[k.kpiId]?.actualValue !== "").length;

        return (
          <Card key={kra.kraId} className="overflow-hidden">
            <button
              onClick={() => toggleKra(kra.kraId)}
              className="w-full flex items-center justify-between p-4 hover:bg-[#1A1A26] transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown size={16} className="text-[#8888A0]" /> : <ChevronRight size={16} className="text-[#8888A0]" />}
                <div className="text-left">
                  <p className="text-sm font-medium">{kra.kraName}</p>
                  <p className="text-xs text-[#6B6B80]">{kraFilled}/{kra.kpis.length} KPIs filled</p>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">{kra.kpis.length} KPIs</Badge>
            </button>

            {isExpanded && (
              <div className="border-t border-[#2A2A3A]">
                {kra.kpis.map((kpi) => {
                  const fd = formData[kpi.kpiId] || { actualValue: "", managerNotes: "" };
                  const actual = fd.actualValue ? Number(fd.actualValue) : null;
                  const score = calculateScore(actual, kpi.targetValue);
                  const isNoteOpen = showNotes.has(kpi.kpiId);
                  const hasExisting = kpi.existingRecord?.actualValue != null;

                  return (
                    <div key={kpi.kpiId} className="border-b border-[#1A1A26] last:border-b-0 px-4 py-3">
                      <div className="flex items-center gap-4">
                        {/* KPI Name */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm">{kpi.name}</p>
                            {hasExisting && (
                              <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                            )}
                          </div>
                          {kpi.unit && (
                            <span className="text-[10px] text-[#6B6B80]">Unit: {kpi.unit}</span>
                          )}
                        </div>

                        {/* Target */}
                        <div className="text-center min-w-[80px]">
                          <p className="text-[10px] text-[#6B6B80] uppercase">Target</p>
                          <p className="text-sm font-mono font-bold">
                            {kpi.targetValue != null ? kpi.targetValue : "—"}
                          </p>
                        </div>

                        {/* Actual Value Input */}
                        <div className="min-w-[100px]">
                          <p className="text-[10px] text-[#6B6B80] uppercase">Actual</p>
                          <Input
                            type="number"
                            value={fd.actualValue}
                            onChange={(e) => updateField(kpi.kpiId, "actualValue", e.target.value)}
                            placeholder="0"
                            className="h-8 text-sm bg-transparent border-[#2A2A3A] w-full"
                          />
                        </div>

                        {/* Score */}
                        <div className="text-center min-w-[60px]">
                          <p className="text-[10px] text-[#6B6B80] uppercase">Score</p>
                          <p className={`text-sm font-mono font-bold ${
                            score == null ? "text-[#6B6B80]"
                            : score >= 90 ? "text-green-400"
                            : score >= 70 ? "text-purple-400"
                            : score >= 50 ? "text-orange-400"
                            : "text-red-400"
                          }`}>
                            {score != null ? `${score}%` : "—"}
                          </p>
                        </div>

                        {/* Notes toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-[#8888A0] hover:text-[#E8E8F0] shrink-0"
                          onClick={() => toggleNotes(kpi.kpiId)}
                          title="Manager feedback"
                        >
                          <MessageSquare size={14} />
                        </Button>
                      </div>

                      {/* Manager Notes (expandable) */}
                      {isNoteOpen && (
                        <div className="mt-2 pl-0">
                          <Textarea
                            value={fd.managerNotes}
                            onChange={(e) => updateField(kpi.kpiId, "managerNotes", e.target.value)}
                            placeholder="Manager feedback / notes..."
                            rows={2}
                            className="bg-transparent border-[#2A2A3A] text-xs"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
