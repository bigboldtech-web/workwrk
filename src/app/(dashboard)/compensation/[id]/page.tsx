"use client";

// Compensation cycle detail. Three modes blended into one table:
//   - Manager mode: edits proposed amounts for direct reports inline
//   - HR/admin mode: same edits PLUS approve/reject + open/close cycle
//   - Subject row (if visible to manager): read-only
//
// Server detail endpoint already filters by viewer role, so we render
// whatever it returns. Inline-editable cells call PATCH on each blur.

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  ChevronLeft,
  DollarSign,
  CheckCircle2,
  XCircle,
  Send,
  Sparkles,
  Lock,
} from "lucide-react";

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
};

type Decision = {
  id: string;
  status: "DRAFT" | "PROPOSED" | "APPROVED" | "REJECTED";
  currency: string;
  currentSalary: number | null;
  proposedSalary: number | null;
  changePct: number | null;
  bonusAmount: number | null;
  reasoning: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  subject: { id: string; firstName: string; lastName: string; email: string };
  proposedBy: { id: string; firstName: string; lastName: string } | null;
};

type ViewerRole = "ADMIN" | "MANAGER";

const DECISION_STYLE: Record<string, string> = {
  DRAFT: "text-muted border-white/20",
  PROPOSED: "text-blue-400 border-blue-400/30",
  APPROVED: "text-green-400 border-green-400/30",
  REJECTED: "text-red-400 border-red-400/30",
};

function fmtMoney(n: number | null, currency: string): string {
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

export default function CompCycleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [viewerRole, setViewerRole] = useState<ViewerRole>("MANAGER");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/comp-cycles/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load cycle", description: data?.error });
        return;
      }
      setCycle(data.cycle);
      setDecisions(data.decisions);
      setViewerRole(data.viewerRole);
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  async function patchDecision(decisionId: string, patch: Record<string, unknown>) {
    setBusy(decisionId);
    try {
      const res = await fetch(`/api/comp-decisions/${decisionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      // Replace in place — full row.
      setDecisions((prev) => prev.map((d) => (d.id === decisionId ? { ...d, ...data } : d)));
    } finally {
      setBusy(null);
    }
  }

  async function decide(decisionId: string, decision: "APPROVE" | "REJECT") {
    setBusy(decisionId);
    try {
      const note =
        decision === "REJECT"
          ? prompt("Reason for rejection?") ?? ""
          : null;
      const res = await fetch(`/api/comp-decisions/${decisionId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't decide", description: data?.error });
        return;
      }
      setDecisions((prev) => prev.map((d) => (d.id === decisionId ? { ...d, ...data } : d)));
      toast({ type: "success", title: `Decision ${decision.toLowerCase()}d` });
    } finally {
      setBusy(null);
    }
  }

  async function transitionCycle(status: "OPEN" | "CLOSED") {
    if (!cycle) return;
    if (status === "CLOSED") {
      const ok = confirm(
        "Close this cycle? Open decisions stay where they are; new edits will be blocked.",
      );
      if (!ok) return;
    }
    const res = await fetch(`/api/comp-cycles/${cycle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't transition", description: data?.error });
      return;
    }
    setCycle({ ...cycle, ...data });
    toast({ type: "success", title: status === "OPEN" ? "Cycle opened" : "Cycle closed" });
  }

  async function seedCycle() {
    if (!cycle) return;
    const res = await fetch(`/api/comp-cycles/${cycle.id}/seed`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't seed", description: data?.error });
      return;
    }
    toast({ type: "success", title: data.message ?? `Seeded ${data.created} rows` });
    load();
  }

  if (loading) {
    return <div className="text-sm text-muted py-8 text-center">Loading…</div>;
  }
  if (!cycle) {
    return <div className="text-sm text-muted py-8 text-center">Not found.</div>;
  }

  const isAdmin = viewerRole === "ADMIN";
  const cycleEditable = cycle.status !== "CLOSED";

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/compensation"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg mb-3"
        >
          <ChevronLeft size={12} /> Back to cycles
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DollarSign size={20} />
              <h1 className="text-2xl font-bold tracking-tight">{cycle.name}</h1>
              <Badge variant="outline" className="text-[10px]">{cycle.status}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted mt-2">
              <span>{new Date(cycle.startDate).toLocaleDateString()} → {new Date(cycle.endDate).toLocaleDateString()}</span>
              <span>{cycle.reportingCurrency}</span>
              {cycle.budgetPct !== null && <span>budget {cycle.budgetPct}%</span>}
              {cycle.description && <span className="opacity-80">· {cycle.description}</span>}
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              {cycle.status === "DRAFT" && decisions.length === 0 && (
                <Button variant="outline" onClick={seedCycle}>
                  <Sparkles size={14} className="mr-1.5" /> Seed from employees
                </Button>
              )}
              {cycle.status === "DRAFT" && (
                <Button onClick={() => transitionCycle("OPEN")}>Open for managers</Button>
              )}
              {cycle.status === "OPEN" && (
                <Button variant="outline" onClick={() => transitionCycle("CLOSED")}>
                  <Lock size={14} className="mr-1.5" /> Close cycle
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Decisions ({decisions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {decisions.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              {isAdmin
                ? "No rows yet. Use 'Seed from employees' above to populate."
                : "No proposals to act on yet."}
            </div>
          ) : (
            <DecisionsTable
              decisions={decisions}
              cycle={cycle}
              isAdmin={isAdmin}
              cycleEditable={cycleEditable}
              busy={busy}
              onPatch={patchDecision}
              onDecide={decide}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DecisionsTable({
  decisions,
  cycle,
  isAdmin,
  cycleEditable,
  busy,
  onPatch,
  onDecide,
}: {
  decisions: Decision[];
  cycle: Cycle;
  isAdmin: boolean;
  cycleEditable: boolean;
  busy: string | null;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDecide: (id: string, decision: "APPROVE" | "REJECT") => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-white/5">
            <th className="px-4 py-2.5 font-normal">Employee</th>
            <th className="px-4 py-2.5 font-normal text-right">Current</th>
            <th className="px-4 py-2.5 font-normal text-right">Proposed</th>
            <th className="px-4 py-2.5 font-normal text-right">Δ%</th>
            <th className="px-4 py-2.5 font-normal text-right">Bonus</th>
            <th className="px-4 py-2.5 font-normal">Status</th>
            <th className="px-4 py-2.5 font-normal text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d) => (
            <DecisionRow
              key={d.id}
              decision={d}
              cycle={cycle}
              isAdmin={isAdmin}
              cycleEditable={cycleEditable}
              busy={busy === d.id}
              onPatch={onPatch}
              onDecide={onDecide}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecisionRow({
  decision,
  cycle,
  isAdmin,
  cycleEditable,
  busy,
  onPatch,
  onDecide,
}: {
  decision: Decision;
  cycle: Cycle;
  isAdmin: boolean;
  cycleEditable: boolean;
  busy: boolean;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDecide: (id: string, decision: "APPROVE" | "REJECT") => void;
}) {
  const editableStatus = decision.status === "DRAFT" || decision.status === "PROPOSED";
  const canEditFields = cycleEditable && editableStatus;

  // Local state on the editable cells so a partial edit doesn't push
  // a save on every keystroke.
  const [current, setCurrent] = useState<string>(
    decision.currentSalary === null ? "" : String(decision.currentSalary),
  );
  const [proposed, setProposed] = useState<string>(
    decision.proposedSalary === null ? "" : String(decision.proposedSalary),
  );
  const [bonus, setBonus] = useState<string>(
    decision.bonusAmount === null ? "" : String(decision.bonusAmount),
  );

  // Re-sync if the row was patched server-side (e.g. proposedBy
  // auto-claimed).
  useEffect(() => {
    setCurrent(decision.currentSalary === null ? "" : String(decision.currentSalary));
    setProposed(decision.proposedSalary === null ? "" : String(decision.proposedSalary));
    setBonus(decision.bonusAmount === null ? "" : String(decision.bonusAmount));
  }, [decision.currentSalary, decision.proposedSalary, decision.bonusAmount]);

  const computedPct =
    decision.currentSalary && decision.proposedSalary && decision.currentSalary > 0
      ? ((decision.proposedSalary - decision.currentSalary) / decision.currentSalary) * 100
      : decision.changePct;

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02]">
      <td className="px-4 py-2 align-top">
        <div className="font-medium text-sm">
          {decision.subject.firstName} {decision.subject.lastName}
        </div>
        <div className="text-[10px] text-muted">{decision.subject.email}</div>
        {decision.proposedBy && (
          <div className="text-[10px] text-muted mt-0.5">
            proposed by {decision.proposedBy.firstName} {decision.proposedBy.lastName}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {canEditFields ? (
          <Input
            inputMode="decimal"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            onBlur={() => {
              const newVal = current === "" ? null : Number(current);
              if (newVal === decision.currentSalary) return;
              onPatch(decision.id, { currentSalary: newVal });
            }}
            className="h-7 text-xs text-right font-mono w-24 ml-auto"
            placeholder="—"
          />
        ) : (
          <span className="font-mono text-xs">{fmtMoney(decision.currentSalary, decision.currency)}</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {canEditFields ? (
          <Input
            inputMode="decimal"
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
            onBlur={() => {
              const newVal = proposed === "" ? null : Number(proposed);
              if (newVal === decision.proposedSalary) return;
              onPatch(decision.id, { proposedSalary: newVal });
            }}
            className="h-7 text-xs text-right font-mono w-24 ml-auto"
            placeholder="—"
          />
        ) : (
          <span className="font-mono text-xs">{fmtMoney(decision.proposedSalary, decision.currency)}</span>
        )}
      </td>
      <td className="px-4 py-2 text-right text-xs font-mono">
        {computedPct === null
          ? "—"
          : `${computedPct >= 0 ? "+" : ""}${computedPct.toFixed(1)}%`}
      </td>
      <td className="px-4 py-2 text-right">
        {canEditFields ? (
          <Input
            inputMode="decimal"
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
            onBlur={() => {
              const newVal = bonus === "" ? null : Number(bonus);
              if (newVal === decision.bonusAmount) return;
              onPatch(decision.id, { bonusAmount: newVal });
            }}
            className="h-7 text-xs text-right font-mono w-24 ml-auto"
            placeholder="—"
          />
        ) : (
          <span className="font-mono text-xs">{fmtMoney(decision.bonusAmount, decision.currency)}</span>
        )}
      </td>
      <td className="px-4 py-2">
        <Badge variant="outline" className={`text-[10px] ${DECISION_STYLE[decision.status]}`}>
          {decision.status}
        </Badge>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-1 flex-wrap">
          {decision.status === "DRAFT" && cycleEditable && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => onPatch(decision.id, { submit: true })}
            >
              <Send size={11} className="mr-1" /> Submit
            </Button>
          )}
          {decision.status === "PROPOSED" && cycleEditable && !isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => onPatch(decision.id, { retract: true })}
            >
              Retract
            </Button>
          )}
          {decision.status === "PROPOSED" && cycleEditable && isAdmin && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-red-400"
                disabled={busy}
                onClick={() => onDecide(decision.id, "REJECT")}
              >
                <XCircle size={11} className="mr-1" /> Reject
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => onDecide(decision.id, "APPROVE")}
              >
                <CheckCircle2 size={11} className="mr-1" /> Approve
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
