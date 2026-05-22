"use client";

// Benefits tab components — extracted for board-route conversion.
// Two boards: plans, oe (open enrollments).

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Plus, CalendarDays } from "lucide-react";

type BenefitType =
  | "MEDICAL" | "DENTAL" | "VISION" | "LIFE" | "DISABILITY_SHORT" | "DISABILITY_LONG"
  | "RETIREMENT_401K" | "RETIREMENT_ROTH" | "HSA" | "FSA" | "COMMUTER" | "OTHER";

type BenefitPlan = {
  id: string;
  type: BenefitType;
  name: string;
  carrier: string | null;
  description: string | null;
  employeeCost: number;
  employerCost: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  _count: { enrollments: number; tiers: number };
};

type OpenEnrollment = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  effectiveDate: string;
  status: "DRAFT" | "OPEN" | "CLOSED" | "ARCHIVED";
  _count: { plans: number; enrollments: number };
};

const TYPE_LABEL: Record<BenefitType, string> = {
  MEDICAL: "Medical", DENTAL: "Dental", VISION: "Vision", LIFE: "Life",
  DISABILITY_SHORT: "Short-term disability", DISABILITY_LONG: "Long-term disability",
  RETIREMENT_401K: "401(k)", RETIREMENT_ROTH: "Roth 401(k)",
  HSA: "HSA", FSA: "FSA", COMMUTER: "Commuter", OTHER: "Other",
};

const OE_STATUS_STYLE: Record<OpenEnrollment["status"], string> = {
  DRAFT: "text-muted border-white/20",
  OPEN: "text-green-400 border-green-400/30",
  CLOSED: "text-blue-400 border-blue-400/30",
  ARCHIVED: "text-muted border-white/20",
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

export function PlansTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BenefitPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/benefit-plans");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1.5" /> New plan</Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted">No benefit plans yet. Add medical, dental, vision, 401(k), or any other plan you offer.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Plan</th>
                  <th className="px-4 py-2.5 font-normal">Type</th>
                  <th className="px-4 py-2.5 font-normal">Carrier</th>
                  <th className="px-4 py-2.5 font-normal text-right">EE / pay</th>
                  <th className="px-4 py-2.5 font-normal text-right">ER / pay</th>
                  <th className="px-4 py-2.5 font-normal text-right">Tiers</th>
                  <th className="px-4 py-2.5 font-normal text-right">Enrolled</th>
                  <th className="px-4 py-2.5 font-normal">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5 text-xs">{TYPE_LABEL[p.type]}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{p.carrier ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtMoney(p.employeeCost)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtMoney(p.employerCost)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{p._count.tiers}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{p._count.enrollments}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${p.active ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                        {p.active ? "Active" : "Archived"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {showCreate && (
        <CreateBenefitPlanDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Plan created" }); load(); }}
        />
      )}
    </>
  );
}

function CreateBenefitPlanDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<BenefitType>("MEDICAL");
  const [carrier, setCarrier] = useState("");
  const [description, setDescription] = useState("");
  const [employeeCost, setEmployeeCost] = useState("0");
  const [employerCost, setEmployerCost] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/benefit-plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), type, carrier: carrier.trim() || undefined,
          description: description.trim() || undefined,
          employeeCost: Number(employeeCost) || 0, employerCost: Number(employerCost) || 0,
          effectiveFrom, effectiveTo: effectiveTo || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: "Couldn't create", description: data?.error }); return; }
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New benefit plan</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label>Plan name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aetna PPO Gold" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as BenefitType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Carrier</Label><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Aetna" /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Employee cost / pay</Label><Input value={employeeCost} onChange={(e) => setEmployeeCost(e.target.value)} inputMode="decimal" /></div>
            <div className="space-y-1.5"><Label>Employer cost / pay</Label><Input value={employerCost} onChange={(e) => setEmployerCost(e.target.value)} inputMode="decimal" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Effective from</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Effective to (optional)</Label><Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!name.trim() || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OpenEnrollmentsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<OpenEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/open-enrollments");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1.5" /> New OE window</Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted">No open enrollment windows yet. Schedule one to let employees pick benefits.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Window</th>
                  <th className="px-4 py-2.5 font-normal flex items-center gap-1"><CalendarDays size={11} /> Election period</th>
                  <th className="px-4 py-2.5 font-normal">Effective</th>
                  <th className="px-4 py-2.5 font-normal text-right">Plans</th>
                  <th className="px-4 py-2.5 font-normal text-right">Enrolled</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium">{r.name}</td>
                    <td className="px-4 py-2.5 text-xs">{new Date(r.startDate).toLocaleDateString()} → {new Date(r.endDate).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{new Date(r.effectiveDate).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{r._count.plans}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{r._count.enrollments}</td>
                    <td className="px-4 py-2.5"><Badge variant="outline" className={`text-[10px] ${OE_STATUS_STYLE[r.status]}`}>{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {showCreate && (
        <CreateOpenEnrollmentDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Window created" }); load(); }}
        />
      )}
    </>
  );
}

function CreateOpenEnrollmentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/open-enrollments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), startDate, endDate, effectiveDate }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: "Couldn't create", description: data?.error }); return; }
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New open enrollment</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="2027 Open Enrollment" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Election starts</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Election ends</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Coverage effective</Label><Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!name.trim() || !endDate || !effectiveDate || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
