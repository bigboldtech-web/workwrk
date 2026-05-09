"use client";

// Compensation cycles — list. HR/admin can create new cycles; managers
// see an open cycle to act on. Closed cycles linger for audit.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useRole } from "@/hooks/use-role";
import { useToast } from "@/components/ui/toast";
import { Plus, Calendar, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { FormGrid, FormRow } from "@/components/ui/form-row";

type Cycle = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED";
  startDate: string;
  endDate: string;
  budgetPct: number | null;
  reportingCurrency: string;
  closedAt: string | null;
  _count: { decisions: number };
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-muted border-border",
  OPEN: "text-[color:var(--accent-strong)] border-[color:var(--accent-border)]",
  CLOSED: "text-blue-600 border-blue-300",
};

export default function CompensationPage() {
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/comp-cycles");
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load cycles", description: data?.error });
        return;
      }
      setCycles(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCount = cycles.filter((c) => c.status === "OPEN").length;
  const draftCount = cycles.filter((c) => c.status === "DRAFT").length;

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Compensation" }]}
        kicker="Compensation · cycles"
        title="Compensation"
        subtitle="Annual / cycle-based pay reviews. Managers propose; HR finalizes."
        stats={cycles.length > 0 ? [
          { label: "Open", value: openCount },
          { label: "Draft", value: draftCount },
          { label: "Total cycles", value: cycles.length },
        ] : undefined}
      />
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus size={14} className="mr-1.5" /> New cycle
          </Button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : cycles.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No compensation cycles yet.
            {isAdmin && <span> Click <strong>New cycle</strong> to start one.</span>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {cycles.map((c) => (
            <Link
              key={c.id}
              href={`/compensation/${c.id}`}
              className="block group"
            >
              <Card className="hover:border-white/20 transition-colors">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{c.name}</p>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[c.status]}`}>
                        {c.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {new Date(c.startDate).toLocaleDateString()} → {new Date(c.endDate).toLocaleDateString()}
                      </span>
                      <span>·</span>
                      <span>{c._count.decisions} {c._count.decisions === 1 ? "decision" : "decisions"}</span>
                      {c.budgetPct !== null && (
                        <>
                          <span>·</span>
                          <span>budget {c.budgetPct}%</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{c.reportingCurrency}</span>
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-muted group-hover:text-fg transition-colors flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCycleDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateCycleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const oneMonth = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(oneMonth);
  const [budgetPct, setBudgetPct] = useState("");
  const [reportingCurrency, setReportingCurrency] = useState("USD");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/comp-cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          startDate,
          endDate,
          budgetPct: budgetPct ? Number(budgetPct) : null,
          reportingCurrency,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't create", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Cycle created" });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  const valid = name.trim() && startDate && endDate && new Date(endDate) > new Date(startDate);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New compensation cycle</DialogTitle></DialogHeader>
        <FormGrid cols={1} className="pt-1">
          <FormRow label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 Annual Comp Review" autoFocus />
          </FormRow>
          <FormGrid cols={2}>
            <FormRow label="Start date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </FormRow>
            <FormRow label="End date">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </FormRow>
          </FormGrid>
          <FormGrid cols={2}>
            <FormRow label="Budget %" hint="Optional">
              <Input value={budgetPct} onChange={(e) => setBudgetPct(e.target.value)} placeholder="5.0" inputMode="decimal" />
            </FormRow>
            <FormRow label="Reporting currency">
              <Input value={reportingCurrency} onChange={(e) => setReportingCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
            </FormRow>
          </FormGrid>
          <FormRow label="Description" hint="Optional">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </FormRow>
        </FormGrid>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={save}>
            {saving ? "Creating…" : "Create cycle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
