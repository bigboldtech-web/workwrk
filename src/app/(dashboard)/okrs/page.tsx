"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Target, Plus, ChevronDown, ChevronRight, ArrowRight, Trash2, CheckCircle2,
  Building2, User, Globe,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";

const STATUS_COLORS: Record<string, string> = {
  ON_TRACK: "bg-green-500/20 text-green-400",
  AT_RISK: "bg-amber-500/20 text-amber-400",
  BEHIND: "bg-red-500/20 text-red-400",
  COMPLETED: "bg-purple-500/20 text-purple-400",
};

const LEVEL_ICONS: Record<string, typeof Globe> = {
  COMPANY: Globe,
  TEAM: Building2,
  INDIVIDUAL: User,
};

interface OKR {
  id: string;
  title: string;
  description?: string;
  level: string;
  status: string;
  progress: number;
  quarter?: string;
  ownerId?: string;
  parentId?: string;
  keyResults: { id: string; title: string; unit?: string; startValue: number; targetValue: number; currentValue: number; progress: number }[];
  children?: { id: string; title: string; progress: number; level: string }[];
}

export default function OKRsPage() {
  const { isManager } = useRole();
  const [okrs, setOkrs] = useState<OKR[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quarter, setQuarter] = useState(() => {
    const now = new Date();
    return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
  });
  const [form, setForm] = useState({
    title: "", description: "", level: "INDIVIDUAL", quarter: "",
    keyResults: [{ title: "", targetValue: "100", unit: "%" }],
  });
  const [checkInOkr, setCheckInOkr] = useState<OKR | null>(null);
  const [checkInValues, setCheckInValues] = useState<Record<string, string>>({});
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/okrs?quarter=${quarter}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setOkrs(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [quarter]);

  function toggle(id: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleCreate() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/okrs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          quarter: form.quarter || quarter,
          keyResults: form.keyResults.filter((kr) => kr.title.trim()).map((kr) => ({
            title: kr.title, targetValue: Number(kr.targetValue) || 100, unit: kr.unit || "%",
          })),
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ title: "", description: "", level: "INDIVIDUAL", quarter: "", keyResults: [{ title: "", targetValue: "100", unit: "%" }] });
        // Refresh
        const d = await fetch(`/api/okrs?quarter=${quarter}`).then((r) => r.json());
        if (d?.data) setOkrs(d.data);
        toastSuccess("OKR created");
      }
    } catch { toastError("Failed"); } finally { setSaving(false); }
  }

  async function handleCheckIn(okrId: string) {
    const okr = okrs.find((o) => o.id === okrId);
    if (!okr) return;
    try {
      for (const kr of okr.keyResults) {
        const val = checkInValues[kr.id];
        if (val) {
          await fetch(`/api/okrs/${okrId}/check-in`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keyResultId: kr.id, value: Number(val) }),
          });
        }
      }
      setCheckInOkr(null);
      setCheckInValues({});
      const d = await fetch(`/api/okrs?quarter=${quarter}`).then((r) => r.json());
      if (d?.data) setOkrs(d.data);
      toastSuccess("Progress updated");
    } catch { toastError("Failed"); }
  }

  const companyOkrs = okrs.filter((o) => o.level === "COMPANY");
  const teamOkrs = okrs.filter((o) => o.level === "TEAM");
  const individualOkrs = okrs.filter((o) => o.level === "INDIVIDUAL");

  const avgProgress = okrs.length > 0 ? Math.round(okrs.reduce((s, o) => s + o.progress, 0) / okrs.length) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OKRs</h1>
          <p className="text-muted text-sm mt-1">{okrs.length} objectives &middot; {avgProgress}% avg progress</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={quarter} onValueChange={setQuarter}>
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
          {isManager && (
            <Button onClick={() => setShowCreate(true)} className="gap-1.5"><Plus size={14} /> New OKR</Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-20 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}</div>
      ) : okrs.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Target size={40} className="mx-auto text-muted mb-3" />
          <p className="font-medium mb-1">No OKRs for {quarter}</p>
          <p className="text-sm text-muted">Set objectives and key results to align your team.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-6">
          {[{ label: "Company Objectives", items: companyOkrs, level: "COMPANY" },
            { label: "Team Objectives", items: teamOkrs, level: "TEAM" },
            { label: "Individual Objectives", items: individualOkrs, level: "INDIVIDUAL" },
          ].filter((g) => g.items.length > 0).map((group) => (
            <div key={group.level}>
              <h2 className="text-sm font-medium text-muted mb-3 flex items-center gap-2">
                {(() => { const Icon = LEVEL_ICONS[group.level] || Target; return <Icon size={14} />; })()}
                {group.label} ({group.items.length})
              </h2>
              <div className="space-y-3">
                {group.items.map((okr) => {
                  const isExp = expanded.has(okr.id);
                  const statusStyle = STATUS_COLORS[okr.status] || STATUS_COLORS.ON_TRACK;
                  return (
                    <Card key={okr.id} className="overflow-hidden">
                      <div className="p-4 cursor-pointer" onClick={() => toggle(okr.id)}>
                        <div className="flex items-center gap-3">
                          <button className="shrink-0 text-muted">{isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-semibold">{okr.title}</h3>
                              <Badge className={`text-[10px] ${statusStyle}`}>{okr.status.replace(/_/g, " ")}</Badge>
                              {okr.quarter && <Badge variant="outline" className="text-[10px]">{okr.quarter}</Badge>}
                            </div>
                            {okr.description && <p className="text-xs text-muted truncate">{okr.description}</p>}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-lg font-bold font-mono text-purple-400">{okr.progress}%</p>
                              <p className="text-[10px] text-muted">{okr.keyResults.length} KRs</p>
                            </div>
                          </div>
                        </div>
                        <Progress value={okr.progress} className="h-1.5 mt-3" indicatorClassName={okr.progress >= 70 ? "bg-green-500" : okr.progress >= 40 ? "bg-amber-500" : "bg-red-500"} />
                      </div>

                      {isExp && (
                        <div className="border-t border-border px-4 py-3 space-y-2 bg-surface-3">
                          {okr.keyResults.map((kr) => (
                            <div key={kr.id} className="flex items-center gap-3 text-sm">
                              {kr.progress >= 100 ? <CheckCircle2 size={14} className="text-green-400 shrink-0" /> : <ArrowRight size={14} className="text-muted shrink-0" />}
                              <span className="flex-1">{kr.title}</span>
                              <span className="text-xs text-muted font-mono">{kr.currentValue}/{kr.targetValue} {kr.unit}</span>
                              <div className="w-20">
                                <Progress value={kr.progress} className="h-1" />
                              </div>
                              <span className="text-xs font-mono w-10 text-right">{kr.progress}%</span>
                            </div>
                          ))}
                          {okr.children && okr.children.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-border">
                              <p className="text-[10px] text-muted uppercase mb-1">Aligned Objectives</p>
                              {okr.children.map((c) => (
                                <div key={c.id} className="flex items-center gap-2 text-xs text-muted">
                                  <ArrowRight size={10} />
                                  <span>{c.title}</span>
                                  <span className="font-mono">{c.progress}%</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex justify-end pt-2">
                            <Button size="sm" variant="outline" className="text-xs" onClick={(e) => { e.stopPropagation(); setCheckInOkr(okr); setCheckInValues({}); }}>
                              Update Progress
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create OKR Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create OKR</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Objective <span className="text-red-400">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What do you want to achieve?" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Level</Label>
                <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COMPANY">Company</SelectItem>
                    <SelectItem value="TEAM">Team</SelectItem>
                    <SelectItem value="INDIVIDUAL">Individual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quarter</Label>
                <Input value={form.quarter || quarter} onChange={(e) => setForm({ ...form, quarter: e.target.value })} placeholder="Q2 2026" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Why is this important?" rows={2} />
            </div>

            {/* Key Results */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Key Results</Label>
                <Button variant="ghost" size="sm" className="text-xs text-purple-400 h-6" onClick={() => setForm({ ...form, keyResults: [...form.keyResults, { title: "", targetValue: "100", unit: "%" }] })}>
                  <Plus size={12} className="mr-1" /> Add KR
                </Button>
              </div>
              {form.keyResults.map((kr, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded border border-border bg-surface-3">
                  <Input value={kr.title} onChange={(e) => { const krs = [...form.keyResults]; krs[i] = { ...krs[i], title: e.target.value }; setForm({ ...form, keyResults: krs }); }} placeholder="Key result" className="flex-1 h-8 text-sm" />
                  <Input type="number" value={kr.targetValue} onChange={(e) => { const krs = [...form.keyResults]; krs[i] = { ...krs[i], targetValue: e.target.value }; setForm({ ...form, keyResults: krs }); }} className="w-20 h-8 text-sm" />
                  <Select value={kr.unit} onValueChange={(v) => { const krs = [...form.keyResults]; krs[i] = { ...krs[i], unit: v }; setForm({ ...form, keyResults: krs }); }}>
                    <SelectTrigger className="w-16 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="%">%</SelectItem>
                      <SelectItem value="count">#</SelectItem>
                      <SelectItem value="$">$</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.keyResults.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => setForm({ ...form, keyResults: form.keyResults.filter((_, j) => j !== i) })}>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title.trim()}>
              {saving ? "Creating..." : "Create OKR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-in Dialog */}
      <Dialog open={!!checkInOkr} onOpenChange={(open) => { if (!open) setCheckInOkr(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Progress: {checkInOkr?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-4">
            {checkInOkr?.keyResults.map((kr) => (
              <div key={kr.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">{kr.title}</Label>
                  <span className="text-xs text-muted">Current: {kr.currentValue} / Target: {kr.targetValue} {kr.unit}</span>
                </div>
                <Input
                  type="number"
                  value={checkInValues[kr.id] || ""}
                  onChange={(e) => setCheckInValues({ ...checkInValues, [kr.id]: e.target.value })}
                  placeholder={`New value (current: ${kr.currentValue})`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInOkr(null)}>Cancel</Button>
            <Button onClick={() => checkInOkr && handleCheckIn(checkInOkr.id)}>Save Progress</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
