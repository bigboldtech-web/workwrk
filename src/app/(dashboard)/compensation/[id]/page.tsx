"use client";

// Compensation cycle detail. Three modes blended into one table:
//   - Manager mode: edits proposed amounts for direct reports inline
//   - HR/admin mode: same edits PLUS approve/reject + open/close cycle
//   - Subject row (if visible to manager): read-only
//
// Server detail endpoint already filters by viewer role, so we render
// whatever it returns. Inline-editable cells call PATCH on each blur.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation"; // useRouter removed — back nav lives in breadcrumbs now
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { BulkApproveBar } from "@/components/ui/bulk-approve-bar";
import { PageHeader } from "@/components/dashboard/page-header";
import {
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
  DRAFT: "text-zinc-500 border-white/20",
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
  const { toast } = useToast();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [viewerRole, setViewerRole] = useState<ViewerRole>("MANAGER");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
  useEffect(() => { setSelectedIds(new Set()); }, [decisions.length]);

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
    return <div className="text-sm text-zinc-500 py-8 text-center">Loading…</div>;
  }
  if (!cycle) {
    return <div className="text-sm text-zinc-500 py-8 text-center">Not found.</div>;
  }

  const isAdmin = viewerRole === "ADMIN";
  const cycleEditable = cycle.status !== "CLOSED";

  // Headline stats for the page-header chips. Drives quick visual
  // triage: how much budget have we proposed, how many decisions are
  // still in-flight, etc.
  const proposedSum = decisions.reduce(
    (sum, d) => sum + (d.proposedSalary ?? 0),
    0,
  );
  const proposedCount = decisions.filter((d) => d.status === "PROPOSED").length;
  const approvedCount = decisions.filter((d) => d.status === "APPROVED").length;

  const statusColor = cycle.status === "OPEN" ? "var(--os-c-orange)" : cycle.status === "CLOSED" ? "var(--os-c-green)" : "var(--os-c-indigo)";
  return (
    <div className="space-y-3 animate-fade-in">
      <section className="compd__hero" style={{ ["--hero-c" as unknown as string]: statusColor }}>
        <span className="compd__hero-accent" aria-hidden="true" />
        <div className="compd__hero-meta">
          <span className="compd__hero-status">{cycle.status}</span>
          <span className="compd__hero-dates">
            {new Date(cycle.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {" → "}
            {new Date(cycle.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          {cycle.budgetPct !== null && <span className="compd__hero-budget">Budget {cycle.budgetPct}%</span>}
          <span className="compd__hero-currency">{cycle.reportingCurrency}</span>
        </div>
        <h1 className="compd__hero-name">{cycle.name}</h1>
        {cycle.description && <p className="compd__hero-desc">{cycle.description}</p>}
        <div className="compd__hero-stats">
          <div className="compd__stat">
            <span>Decisions</span>
            <strong>{decisions.length}</strong>
          </div>
          <div className="compd__stat">
            <span>Proposed</span>
            <strong>{proposedCount}</strong>
          </div>
          <div className="compd__stat">
            <span>Approved</span>
            <strong>{approvedCount}</strong>
          </div>
          <div className="compd__stat compd__stat--hero">
            <span>Proposed sum</span>
            <strong>{fmtMoney(proposedSum, cycle.reportingCurrency)}</strong>
          </div>
        </div>
      </section>
      {isAdmin && (
        <div className="flex flex-wrap gap-2 justify-end">
          {cycle.status === "DRAFT" && decisions.length === 0 && (
            <Button variant="outline" size="sm" onClick={seedCycle}>
              <Sparkles size={14} className="mr-1.5" /> Seed from employees
            </Button>
          )}
          {cycle.status === "DRAFT" && (
            <Button size="sm" onClick={() => transitionCycle("OPEN")}>Open for managers</Button>
          )}
          {cycle.status === "OPEN" && (
            <Button variant="outline" size="sm" onClick={() => transitionCycle("CLOSED")}>
              <Lock size={14} className="mr-1.5" /> Close cycle
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Decisions ({decisions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {decisions.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              {isAdmin
                ? "No rows yet. Use 'Seed from employees' above to populate."
                : "No proposals to act on yet."}
            </div>
          ) : (
            <DecisionsTable
              decisions={decisions}
              isAdmin={isAdmin}
              cycleEditable={cycleEditable}
              busy={busy}
              onPatch={patchDecision}
              onDecide={decide}
              selectedIds={selectedIds}
              onToggle={(rowId) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(rowId)) next.delete(rowId);
                  else next.add(rowId);
                  return next;
                });
              }}
              onToggleAll={() => {
                const proposed = decisions.filter((d) => d.status === "PROPOSED").map((d) => d.id);
                const allSelected = proposed.length > 0 && proposed.every((id) => selectedIds.has(id));
                setSelectedIds(allSelected ? new Set() : new Set(proposed));
              }}
            />
          )}
        </CardContent>
      </Card>

      {isAdmin && cycleEditable && (
        <BulkApproveBar
          entityType="comp-decision"
          selectedIds={selectedArray}
          onClear={() => setSelectedIds(new Set())}
          onDone={load}
        />
      )}
    </div>
  );
}

function DecisionsTable({
  decisions,
  isAdmin,
  cycleEditable,
  busy,
  onPatch,
  onDecide,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  decisions: Decision[];
  isAdmin: boolean;
  cycleEditable: boolean;
  busy: string | null;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDecide: (id: string, decision: "APPROVE" | "REJECT") => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const proposed = decisions.filter((d) => d.status === "PROPOSED");
  const allSelected = proposed.length > 0 && proposed.every((d) => selectedIds.has(d.id));
  const showCheckbox = isAdmin && cycleEditable;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 border-b border-white/5">
            {showCheckbox && (
              <th className="px-3 py-2.5 font-normal w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  aria-label="Select all proposed"
                  disabled={proposed.length === 0}
                />
              </th>
            )}
            <th className="px-3 py-2 font-normal">Employee</th>
            <th className="px-3 py-2 font-normal text-right">Current</th>
            <th className="px-3 py-2 font-normal text-right">Proposed</th>
            <th className="px-3 py-2 font-normal text-right">Δ%</th>
            <th className="px-3 py-2 font-normal text-right">Bonus</th>
            <th className="px-3 py-2 font-normal">Reasoning</th>
            <th className="px-3 py-2 font-normal">Status</th>
            <th className="px-3 py-2 font-normal text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d) => (
            <DecisionRow
              key={d.id}
              decision={d}
              isAdmin={isAdmin}
              cycleEditable={cycleEditable}
              busy={busy === d.id}
              onPatch={onPatch}
              onDecide={onDecide}
              showCheckbox={showCheckbox}
              selected={selectedIds.has(d.id)}
              onToggle={() => onToggle(d.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecisionRow({
  decision,
  isAdmin,
  cycleEditable,
  busy,
  onPatch,
  onDecide,
  showCheckbox,
  selected,
  onToggle,
}: {
  decision: Decision;
  isAdmin: boolean;
  cycleEditable: boolean;
  busy: boolean;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDecide: (id: string, decision: "APPROVE" | "REJECT") => void;
  showCheckbox: boolean;
  selected: boolean;
  onToggle: () => void;
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
  const [reasoning, setReasoning] = useState<string>(decision.reasoning ?? "");

  // Re-sync if the row was patched server-side (e.g. proposedBy
  // auto-claimed).
  useEffect(() => {
    setCurrent(decision.currentSalary === null ? "" : String(decision.currentSalary));
    setProposed(decision.proposedSalary === null ? "" : String(decision.proposedSalary));
    setBonus(decision.bonusAmount === null ? "" : String(decision.bonusAmount));
    setReasoning(decision.reasoning ?? "");
  }, [decision.currentSalary, decision.proposedSalary, decision.bonusAmount, decision.reasoning]);

  const computedPct =
    decision.currentSalary && decision.proposedSalary && decision.currentSalary > 0
      ? ((decision.proposedSalary - decision.currentSalary) / decision.currentSalary) * 100
      : decision.changePct;

  const canBulkSelect = decision.status === "PROPOSED";
  return (
    <tr className="border-b border-white/5 hover:bg-zinc-50">
      {showCheckbox && (
        <td className="px-3 py-1.5 align-top">
          {canBulkSelect ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              aria-label="Select row"
            />
          ) : null}
        </td>
      )}
      <td className="px-3 py-1.5 align-top">
        <div className="font-medium text-sm">
          {decision.subject.firstName} {decision.subject.lastName}
        </div>
        <div className="text-[10px] text-zinc-500">{decision.subject.email}</div>
        {decision.proposedBy && (
          <div className="text-[10px] text-zinc-500 mt-0.5">
            proposed by {decision.proposedBy.firstName} {decision.proposedBy.lastName}
          </div>
        )}
      </td>
      <td className="px-3 py-1.5 text-right">
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
      <td className="px-3 py-1.5 text-right">
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
      <td className="px-3 py-1.5 text-right text-xs font-mono">
        {computedPct === null
          ? "—"
          : `${computedPct >= 0 ? "+" : ""}${computedPct.toFixed(1)}%`}
      </td>
      <td className="px-3 py-1.5 text-right">
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
      <td className="px-3 py-1.5 align-top">
        {canEditFields ? (
          <Input
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            onBlur={() => {
              const newVal = reasoning.trim() || null;
              if ((newVal ?? "") === (decision.reasoning ?? "")) return;
              onPatch(decision.id, { reasoning: newVal });
            }}
            className="h-7 text-xs w-40"
            placeholder="Why this proposal?"
            maxLength={240}
          />
        ) : decision.reasoning ? (
          <span
            className="text-[11.5px] text-zinc-500 line-clamp-2 max-w-[180px] inline-block"
            title={decision.reasoning}
          >
            {decision.reasoning}
          </span>
        ) : (
          <span className="text-[11.5px] text-zinc-500-2">—</span>
        )}
      </td>
      <td className="px-3 py-1.5 align-top">
        <div className="flex flex-col gap-0.5">
          <Badge variant="outline" className={`text-[10px] w-fit ${DECISION_STYLE[decision.status]}`}>
            {decision.status}
          </Badge>
          {decision.decisionNote && (decision.status === "APPROVED" || decision.status === "REJECTED") && (
            <span
              className="text-[10px] text-zinc-500-2 line-clamp-1 max-w-[140px]"
              title={`Note: ${decision.decisionNote}`}
            >
              note: {decision.decisionNote}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-1.5 text-right">
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
