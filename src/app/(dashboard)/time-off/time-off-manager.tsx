"use client";

// Time-off interactive shell. Tabs:
//   Mine     — own requests
//   Approve  — pending requests waiting on me as approver (manager+)
//   Team     — direct reports (manager+)
//   All      — org-wide audit (manager+)
//
// Balances at the top come from the server first paint and refresh
// after my own actions only (other users' approvals re-flow on
// router.refresh from the page).

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { BulkApproveBar } from "@/components/ui/bulk-approve-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import {
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

export type Policy = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  description: string | null;
  annualHours: number;
  carryoverHours: number;
  requiresApproval: boolean;
  archived: boolean;
};

type Balance = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  annualHours: number;
  pendingHours: number;
  usedHours: number;
  remainingHours: number;
};

type Request = {
  id: string;
  startDate: string;
  endDate: string;
  hours: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decisionAt: string | null;
  decisionNote: string | null;
  user: { id: string; firstName: string; lastName: string } | null;
  approver: { id: string; firstName: string; lastName: string } | null;
  policy: { id: string; name: string; type: string; color: string | null };
};

const STATUS_STYLE: Record<string, { className: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  PENDING: { className: "text-amber-400 border-amber-400/30", Icon: Clock },
  APPROVED: { className: "text-green-400 border-green-400/30", Icon: CheckCircle2 },
  REJECTED: { className: "text-red-400 border-red-400/30", Icon: XCircle },
  CANCELLED: { className: "text-muted border-white/20", Icon: XCircle },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(start: string, end: string): number {
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS) + 1;
}

export function TimeOffManager({
  policies,
  initialBalances,
  isManager,
  isAdmin,
}: {
  policies: Policy[];
  initialBalances: Balance[];
  isManager: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<"mine" | "approve" | "team" | "all">("mine");
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [tab, requests]);
  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const load = useCallback(
    async (scope: typeof tab) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/time-off?scope=${scope}&limit=100`);
        const data = await res.json();
        if (!res.ok) {
          toast({ type: "error", title: "Couldn't load requests", description: data?.error });
          return;
        }
        setRequests(Array.isArray(data) ? data : []);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => { load(tab); }, [tab, load]);

  async function decide(id: string, decision: "APPROVE" | "REJECT", note?: string) {
    const res = await fetch(`/api/time-off/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: note ?? null }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    toast({ type: "success", title: `Request ${decision.toLowerCase()}d` });
    load(tab);
  }

  async function cancel(id: string) {
    const res = await fetch(`/api/time-off/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't cancel", description: data?.error });
      return;
    }
    toast({ type: "success", title: "Cancelled" });
    load(tab);
    router.refresh(); // refresh server balances
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Time off" }]}
        kicker="Time off · balance & requests"
        title="Time off"
        subtitle="Request leave, see your balance, approve your team's requests."
        stats={[
          {
            label: "Remaining",
            value: `${initialBalances
              .reduce((sum, b) => sum + b.remainingHours, 0)
              .toFixed(0)}h`,
          },
          { label: "Policies", value: policies.length },
        ]}
      />
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {isAdmin && (
          <Button variant="outline" size="sm" asChild>
            <a href="/time-off/policies">Manage policies</a>
          </Button>
        )}
        {isManager && (
          <a
            href={`/api/export/time-off?scope=${tab === "mine" ? "mine" : "all"}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-border text-foreground hover:bg-surface-2 transition-colors"
          >
            Export CSV
          </a>
        )}
        <Button onClick={() => setShowCreate(true)} disabled={policies.length === 0} size="sm">
          <Plus size={14} className="mr-1.5" /> Request
        </Button>
      </div>

      {policies.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted">
            No leave policies configured yet.
            {isAdmin && (
              <>
                {" "}
                <a href="/time-off/policies" className="text-[color:var(--accent-strong)] hover:underline font-medium">
                  Create one
                </a>
                {" "}so employees can request time off.
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {initialBalances.map((b) => {
            const used = b.usedHours + b.pendingHours;
            const pct = b.annualHours > 0 ? (used / b.annualHours) * 100 : 0;
            const tone =
              b.color ?? (b.type === "VACATION" ? "#7c3aed" : b.type === "SICK" ? "#ff3d8a" : "#4a9eff");
            return (
              <Card key={b.id} style={{ borderLeft: `3px solid ${tone}` }}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-medium truncate">{b.name}</p>
                    <span className="text-[9px] uppercase tracking-wide text-muted-2 ml-1">{b.type}</span>
                  </div>
                  <p className="text-lg font-bold font-mono leading-none tabular-nums">
                    {b.remainingHours.toFixed(0)}
                    <span className="text-[11px] text-muted ml-1 font-normal">/ {b.annualHours.toFixed(0)}h</span>
                  </p>
                  <Progress value={pct} className="h-1 mt-2" />
                  <p className="text-[10px] text-muted mt-1">
                    {b.usedHours.toFixed(0)}h used
                    {b.pendingHours > 0 && ` · ${b.pendingHours.toFixed(0)}h pending`}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="mine">My requests</TabsTrigger>
          {isManager && <TabsTrigger value="approve">Approval queue</TabsTrigger>}
          {isManager && <TabsTrigger value="team">Team</TabsTrigger>}
          {isManager && <TabsTrigger value="all">All</TabsTrigger>}
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-sm text-muted">Loading…</div>
              ) : requests.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted">
                  {tab === "mine" && "No requests yet."}
                  {tab === "approve" && "Nothing waiting on you."}
                  {tab === "team" && "No requests from your team."}
                  {tab === "all" && "No requests."}
                </div>
              ) : (
                <RequestsTable
                  rows={requests}
                  showApprovalActions={tab === "approve"}
                  showOwnerActions={tab === "mine"}
                  onDecide={decide}
                  onCancel={cancel}
                  selectedIds={selectedIds}
                  onToggleSelected={(id) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  onToggleAll={(allSelected) => {
                    if (allSelected) setSelectedIds(new Set());
                    else setSelectedIds(new Set(requests.filter((r) => r.status === "PENDING").map((r) => r.id)));
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {showCreate && (
        <CreateRequestDialog
          policies={policies}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load(tab);
            router.refresh();
          }}
        />
      )}

      {tab === "approve" && (
        <BulkApproveBar
          entityType="time-off"
          selectedIds={selectedArray}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => { load(tab); router.refresh(); }}
        />
      )}
    </div>
  );
}

function RequestsTable({
  rows,
  showApprovalActions,
  showOwnerActions,
  onDecide,
  onCancel,
  selectedIds,
  onToggleSelected,
  onToggleAll,
}: {
  rows: Request[];
  showApprovalActions: boolean;
  showOwnerActions: boolean;
  onDecide: (id: string, decision: "APPROVE" | "REJECT", note?: string) => void;
  onCancel: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleAll: (allSelected: boolean) => void;
}) {
  const confirm = useConfirm();
  const promptDialog = usePrompt();
  const pendingRows = rows.filter((r) => r.status === "PENDING");
  const allChecked = showApprovalActions && pendingRows.length > 0
    && pendingRows.every((r) => selectedIds.has(r.id));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-white/5">
            {showApprovalActions && (
              <th className="px-3 py-2.5 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => onToggleAll(allChecked)}
                  aria-label="Select all pending"
                />
              </th>
            )}
            <th className="px-4 py-2.5 font-normal">Employee</th>
            <th className="px-4 py-2.5 font-normal">Policy</th>
            <th className="px-4 py-2.5 font-normal">Dates</th>
            <th className="px-4 py-2.5 font-normal text-right">Hours</th>
            <th className="px-4 py-2.5 font-normal">Status</th>
            <th className="px-4 py-2.5 font-normal text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const style = STATUS_STYLE[r.status];
            const StatusIcon = style.Icon;
            const days = daysBetween(r.startDate, r.endDate);
            const checkable = r.status === "PENDING";
            return (
              <tr key={r.id} className="border-b border-white/5 hover:bg-surface-2">
                {showApprovalActions && (
                  <td className="px-3 py-2.5">
                    {checkable && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => onToggleSelected(r.id)}
                        aria-label="Select request"
                      />
                    )}
                  </td>
                )}
                <td className="px-4 py-2.5 text-xs">
                  {r.user ? `${r.user.firstName} ${r.user.lastName}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: r.policy.color ?? "#666" }}
                    />
                    {r.policy.name}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
                  {new Date(r.startDate).toLocaleDateString()}
                  {days > 1 && ` → ${new Date(r.endDate).toLocaleDateString()}`}
                  {" · "}
                  {days} day{days === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{r.hours.toFixed(0)}h</td>
                <td className="px-4 py-2.5">
                  <Badge variant="outline" className={`text-[10px] gap-1 ${style.className}`}>
                    <StatusIcon size={10} />
                    {r.status}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {showApprovalActions && r.status === "PENDING" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onDecide(r.id, "APPROVE")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-red-400"
                          onClick={async () => {
                            const note = (await promptDialog({ title: "Reason for rejection?" })) ?? undefined;
                            if (note !== undefined) onDecide(r.id, "REJECT", note);
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {showOwnerActions &&
                      (r.status === "PENDING" || r.status === "APPROVED") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={async () => {
                            if (await confirm({ title: "Cancel request", description: "Cancel this request?", destructive: true, confirmLabel: "Cancel request" })) onCancel(r.id);
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateRequestDialog({
  policies,
  onClose,
  onCreated,
}: {
  policies: Policy[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Default hours = days × 8 unless user overrode it.
  useEffect(() => {
    if (!startDate || !endDate) return;
    const days = daysBetween(startDate, endDate);
    if (days > 0 && !hours) setHours(String(days * 8));
  }, [startDate, endDate, hours]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId,
          startDate,
          endDate,
          hours: hours ? Number(hours) : undefined,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't submit", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Request submitted" });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  const valid = policyId && startDate && endDate && new Date(endDate) >= new Date(startDate);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request time off</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Policy</Label>
            <Select value={policyId} onValueChange={setPolicyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {policies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {!p.requiresApproval && " (auto-approved)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setHours(""); }} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setHours(""); }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Hours <span className="text-xs text-muted">(default: days × 8)</span></Label>
            <Input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={save}>
            {saving ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
