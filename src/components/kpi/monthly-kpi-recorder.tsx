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
import { useAutosave } from "@/hooks/use-autosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import {
  getCurrentPeriod,
  getLastPeriod,
  formatPeriodLabel,
  calculateScore,
  adjustedTarget,
  type KpiFrequency,
} from "@/lib/kpi-utils";

interface KpiEntry {
  kpiId: string;
  name: string;
  unit: string | null;
  type: string;
  /** Target as defined on the KPI (per its `frequency`). */
  targetValue: number | null;
  /** Cadence the KPI was set up for. We use it to convert the
   *  stored target into a monthly target for the recorder. */
  frequency?: KpiFrequency;
  lowerIsBetter?: boolean;
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

  // Shared save core — called both by the explicit "Save All" button
  // and by the debounced autosave. `silent=true` skips the success toast
  // (autosave fires often; the indicator next to the button is feedback
  // enough) and skips the post-save refetch since the user is likely
  // mid-edit on another field.
  const saveCore = useCallback(
    async (snapshot: RecordFormData, silent: boolean): Promise<void> => {
      if (!selectedPeriod) return;
      const records = Object.entries(snapshot).map(([kpiId, data]) => ({
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
        const err = await res.json().catch(() => ({}));
        // Throw so useAutosave's catch flips status to "error" — toast
        // only when the user explicitly hit the button.
        if (!silent) toastError(err.error || "Failed to save");
        throw new Error(err.error || "Failed to save");
      }
      if (!silent) {
        const result = await res.json();
        toastSuccess(`Saved ${(result.data || result).saved} KPI records for ${formatPeriodLabel(selectedPeriod)}`);
        fetchKpis(selectedPeriod);
      }
    },
    [selectedPeriod, userId, toastError, toastSuccess, fetchKpis],
  );

  const handleSaveAll = async () => {
    if (!selectedPeriod) return;
    setSaving(true);
    try {
      await saveCore(formData, false);
    } catch {
      // saveCore already toasted on hard failure path.
    } finally {
      setSaving(false);
    }
  };

  // Debounced autosave: fires 2s after the user stops typing in any KPI
  // input. Disabled until a period is selected + initial data loaded so
  // hydration doesn't trigger a no-op POST.
  const autosaveEnabled = !!selectedPeriod && !loading && Object.keys(formData).length > 0;
  const autosave = useAutosave<RecordFormData>({
    snapshot: formData,
    enabled: autosaveEnabled,
    delay: 2000,
    save: (snapshot) => saveCore(snapshot, true),
  });

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
          <Target size={40} className="mx-auto text-[color:var(--accent-strong)] mb-4" />
          <h3 className="text-lg font-semibold mb-2">Record Monthly KPIs</h3>
          <p className="text-sm text-muted mb-6">
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
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent mx-auto" />
          <p className="text-sm text-muted mt-3">Loading KPIs...</p>
        </CardContent>
      </Card>
    );
  }

  // No KPIs assigned
  if (kras.length === 0 || totalKpis === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Target size={40} className="mx-auto text-muted mb-4" />
          <h3 className="text-lg font-semibold mb-2">No KPIs Assigned</h3>
          <p className="text-sm text-muted">
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
                <p className="text-xs text-muted">
                  {filledCount} of {totalKpis} KPIs recorded
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-[120px]">
                <Progress value={overallProgress} className="h-2 flex-1" />
                <span className="text-xs font-mono text-[color:var(--accent-strong)]">{overallProgress}%</span>
              </div>
              {autosaveEnabled && (
                <AutosaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} />
              )}
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
              className="w-full flex items-center justify-between p-4 hover:bg-surface-2 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                <div className="text-left">
                  <p className="text-sm font-medium">{kra.kraName}</p>
                  <p className="text-xs text-muted-2">{kraFilled}/{kra.kpis.length} KPIs filled</p>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">{kra.kpis.length} KPIs</Badge>
            </button>

            {isExpanded && (
              <div className="border-t border-border">
                {kra.kpis.map((kpi) => {
                  const fd = formData[kpi.kpiId] || { actualValue: "", managerNotes: "" };
                  const actual = fd.actualValue ? Number(fd.actualValue) : null;
                  // The recorder always works in MONTHLY periods, so
                  // adjust the displayed + scoring target if the KPI
                  // was set up at a different cadence (weekly target
                  // 40 → monthly target ≈ 174).
                  const { value: adjTarget, hint: targetHint } = adjustedTarget(
                    kpi.targetValue,
                    (kpi.frequency ?? "MONTHLY") as KpiFrequency,
                    "MONTHLY",
                  );
                  const score = calculateScore(actual, adjTarget, kpi.lowerIsBetter);
                  const isNoteOpen = showNotes.has(kpi.kpiId);
                  const hasExisting = kpi.existingRecord?.actualValue != null;

                  // Cadence chip + helper copy. The recorder always
                  // works in monthly periods, so a quarterly KPI is
                  // tracked here as "1/3 of a quarter" — the score
                  // uses the prorated monthly target, and the row
                  // says so plainly to avoid the "is this monthly
                  // or quarterly?" confusion.
                  const definedFreq = (kpi.frequency ?? "MONTHLY") as KpiFrequency;
                  const isMonthly = definedFreq === "MONTHLY";
                  const cadenceLabel = definedFreq.charAt(0) + definedFreq.slice(1).toLowerCase();
                  const cadenceChipColor =
                    definedFreq === "MONTHLY" ? "bg-surface-2 text-muted" :
                    definedFreq === "WEEKLY" ? "bg-cyan-500/10 text-cyan-400" :
                    definedFreq === "DAILY" ? "bg-blue-500/10 text-blue-400" :
                    definedFreq === "QUARTERLY" ? "bg-purple-500/10 text-purple-400" :
                    "bg-amber-500/10 text-amber-400"; // ANNUALLY
                  return (
                    <div key={kpi.kpiId} className="border-b border-surface-2 last:border-b-0 px-4 py-3">
                      <div className="flex items-center gap-4">
                        {/* KPI Name */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm">{kpi.name}</p>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide ${cadenceChipColor}`}
                              title={isMonthly ? "Monthly KPI" : `Defined ${cadenceLabel.toLowerCase()} — recording the monthly slice`}
                            >
                              {cadenceLabel}
                            </span>
                            {hasExisting && (
                              <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {kpi.unit && (
                              <span className="text-[10px] text-muted-2">Unit: {kpi.unit}</span>
                            )}
                            {kpi.lowerIsBetter && (
                              <span className="text-[10px] text-amber-400">Lower is better</span>
                            )}
                            {!isMonthly && (
                              <span className="text-[10px] text-muted-2">
                                {definedFreq === "QUARTERLY" || definedFreq === "ANNUALLY"
                                  ? `Tracked ${cadenceLabel.toLowerCase()} — enter this month's contribution`
                                  : `Tracked ${cadenceLabel.toLowerCase()} — enter the month's rolled-up actual`}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Target — auto-converted to a monthly figure if
                            the KPI is defined at a different cadence so the
                            number you enter under Actual compares apples
                            to apples. */}
                        <div className="text-center min-w-[100px]" title={targetHint ?? undefined}>
                          <p className="text-[10px] text-muted-2 uppercase">Target / month</p>
                          <p className="text-sm font-mono font-bold">
                            {adjTarget != null ? adjTarget : "—"}
                          </p>
                          {targetHint && (
                            <p className="text-[9px] text-muted-2 leading-tight">
                              from {kpi.targetValue} {kpi.frequency?.toLowerCase()}
                            </p>
                          )}
                        </div>

                        {/* Actual Value Input */}
                        <div className="min-w-[100px]">
                          <p className="text-[10px] text-muted-2 uppercase">Actual</p>
                          <Input
                            type="number"
                            value={fd.actualValue}
                            onChange={(e) => updateField(kpi.kpiId, "actualValue", e.target.value)}
                            placeholder="0"
                            className="h-8 text-sm bg-transparent border-border w-full"
                          />
                        </div>

                        {/* Score */}
                        <div className="text-center min-w-[60px]">
                          <p className="text-[10px] text-muted-2 uppercase">Score</p>
                          <p className={`text-sm font-mono font-bold ${
                            score == null ? "text-muted-2"
                            : score >= 90 ? "text-green-400"
                            : score >= 70 ? "text-[color:var(--accent-strong)]"
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
                          className="h-7 w-7 text-muted hover:text-foreground shrink-0"
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
                            className="bg-transparent border-border text-xs"
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
