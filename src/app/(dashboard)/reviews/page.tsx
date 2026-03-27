"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Users, CheckCircle, Rocket, Pencil, Trash2, ChevronRight, Download, Star,
} from "lucide-react";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ReviewCycle {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  reviews: any[];
  _count?: { reviews: number };
}

function getCycleStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE": return <Badge variant="success">Active</Badge>;
    case "DRAFT": return <Badge variant="secondary">Draft</Badge>;
    case "COMPLETED": return <Badge variant="outline">Completed</Badge>;
    case "IN_CALIBRATION": return <Badge variant="warning">In Calibration</Badge>;
    case "CANCELLED": return <Badge variant="destructive">Cancelled</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString();
}

export default function ReviewsPage() {
  const router = useRouter();
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Create dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");

  // Edit dialog
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingCycle, setEditingCycle] = useState<ReviewCycle | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Launch
  const [launching, setLaunching] = useState<string | null>(null);

  const { success: toastSuccess, error: toastError } = useToast();

  const fetchCycles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const res = await fetch(`/api/reviews?${params}`);
      if (res.ok) {
        const json = await res.json();
        setCycles(json.data || []);
        setTotal(json.pagination?.total || 0);
        setTotalPages(json.pagination?.totalPages || 0);
      }
    } catch {} finally { setLoading(false); }
  }, [page, limit]);

  useEffect(() => { fetchCycles(); }, [fetchCycles]);

  const handleCreate = async () => {
    if (!newName.trim() || !newType) return;
    setCreating(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, type: newType, startDate: newStartDate, endDate: newEndDate }),
      });
      if (res.ok) {
        setShowAddDialog(false);
        setNewName(""); setNewType(""); setNewStartDate(""); setNewEndDate("");
        await fetchCycles();
        toastSuccess("Review cycle created");
      }
    } catch {} finally { setCreating(false); }
  };

  const handleEdit = async () => {
    if (!editingCycle) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingCycle.id, name: newName, type: newType, startDate: newStartDate, endDate: newEndDate }),
      });
      if (res.ok) {
        setShowEditDialog(false);
        setEditingCycle(null);
        await fetchCycles();
        toastSuccess("Review cycle updated");
      }
    } catch {} finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/reviews?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setShowDeleteConfirm(null);
        await fetchCycles();
        toastSuccess("Review cycle deleted");
      }
    } catch {} finally { setDeleting(false); }
  };

  const handleLaunch = async (id: string) => {
    setLaunching(id);
    try {
      const res = await fetch(`/api/reviews/${id}/launch`, { method: "POST" });
      if (res.ok) {
        await fetchCycles();
        toastSuccess("Review cycle launched!");
      } else {
        const data = await res.json();
        toastError(data.error || "Failed to launch review cycle");
      }
    } catch {} finally { setLaunching(null); }
  };

  const openEdit = (cycle: ReviewCycle) => {
    setEditingCycle(cycle);
    setNewName(cycle.name);
    setNewType(cycle.type);
    setNewStartDate(cycle.startDate.split("T")[0]);
    setNewEndDate(cycle.endDate.split("T")[0]);
    setShowEditDialog(true);
  };

  const activeCycle = cycles.find((c) => c.status === "ACTIVE" || c.status === "IN_CALIBRATION");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Performance Reviews</h1>
          <p className="text-[#8888A0] text-sm mt-1">Manage review cycles, assessments, and outcomes</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus size={16} /> New Cycle</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Review Cycle</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>Cycle Name <span className="text-red-400">*</span></Label><Input placeholder="e.g., Q1 2026 Quarterly Review" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
              <div className="space-y-2"><Label>Type <span className="text-red-400">*</span></Label>
                <Select value={newType} onValueChange={setNewType}><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY_PULSE">Monthly Pulse</SelectItem>
                    <SelectItem value="QUARTERLY">Quarterly Review</SelectItem>
                    <SelectItem value="ANNUAL">Annual Review</SelectItem>
                    <SelectItem value="PROBATION">Probation Review</SelectItem>
                    <SelectItem value="PIP_REVIEW">PIP Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} /></div>
                <div className="space-y-2"><Label>End Date</Label><Input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim() || !newType}>
                {creating ? "Creating..." : "Create Cycle"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Active Cycle Banner */}
      {!loading && activeCycle && (
        <Card
          className="border-purple-500/30 bg-purple-500/5 cursor-pointer hover:border-purple-500/50 transition-colors"
          onClick={() => router.push(`/reviews/${activeCycle.id}`)}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">{activeCycle.name}</h3>
                <p className="text-xs text-[#8888A0]">{formatDate(activeCycle.startDate)} to {formatDate(activeCycle.endDate)}</p>
              </div>
              <div className="flex items-center gap-2">
                {getCycleStatusBadge(activeCycle.status)}
                <ChevronRight size={16} className="text-[#8888A0]" />
              </div>
            </div>
            {(() => {
              const total = activeCycle.reviews?.length ?? activeCycle._count?.reviews ?? 0;
              const completed = activeCycle.reviews?.filter((r: any) => r.status === "COMPLETED").length ?? 0;
              const selfDone = activeCycle.reviews?.filter((r: any) => r.status !== "PENDING").length ?? 0;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              return (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Progress value={pct} className="h-2 flex-1" indicatorClassName="bg-purple-500" />
                    <span className="text-sm font-mono text-purple-400">{pct}%</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[#8888A0]">
                    <span className="flex items-center gap-1"><Users size={12} /> {total} total</span>
                    <span className="flex items-center gap-1"><CheckCircle size={12} className="text-blue-400" /> {selfDone} self done</span>
                    <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-400" /> {completed} completed</span>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* All Cycles Table */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">All Review Cycles</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A3A]">
                <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Cycle</th>
                <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Type</th>
                <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Period</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Reviews</th>
                <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Status</th>
                <th className="text-right p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-[#2A2A3A]/50">
                    <td className="p-4"><div className="h-4 w-40 bg-[#1A1A26] rounded animate-pulse" /></td>
                    <td className="p-4"><div className="h-5 w-24 bg-[#1A1A26] rounded animate-pulse" /></td>
                    <td className="p-4"><div className="h-4 w-36 bg-[#1A1A26] rounded animate-pulse" /></td>
                    <td className="p-4"><div className="h-4 w-12 bg-[#1A1A26] rounded animate-pulse mx-auto" /></td>
                    <td className="p-4"><div className="h-5 w-16 bg-[#1A1A26] rounded animate-pulse mx-auto" /></td>
                    <td className="p-4"><div className="h-5 w-24 bg-[#1A1A26] rounded animate-pulse ml-auto" /></td>
                  </tr>
                ))
              ) : cycles.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Plus}
                      title="No review cycles"
                      description="Start your first performance review cycle to evaluate your team."
                      actionLabel="Create Review Cycle"
                      onAction={() => setShowAddDialog(true)}
                    />
                  </td>
                </tr>
              ) : (
                cycles.map((cycle) => {
                  const total = cycle.reviews?.length ?? cycle._count?.reviews ?? 0;
                  const completed = cycle.reviews?.filter((r: any) => r.status === "COMPLETED").length ?? 0;
                  return (
                    <tr
                      key={cycle.id}
                      className="border-b border-[#2A2A3A]/50 hover:bg-[#1A1A26]/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/reviews/${cycle.id}`)}
                    >
                      <td className="p-4 text-sm font-medium">{cycle.name}</td>
                      <td className="p-4"><Badge variant="outline" className="text-xs">{cycle.type.replace(/_/g, " ")}</Badge></td>
                      <td className="p-4 text-sm text-[#8888A0]">{formatDate(cycle.startDate)} — {formatDate(cycle.endDate)}</td>
                      <td className="p-4 text-center text-sm font-mono">{completed}/{total}</td>
                      <td className="p-4 text-center">{getCycleStatusBadge(cycle.status)}</td>
                      <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {cycle.status === "DRAFT" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => handleLaunch(cycle.id)}
                              disabled={launching === cycle.id}
                            >
                              <Rocket size={12} className="text-green-400" />
                              {launching === cycle.id ? "..." : "Launch"}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => window.open(`/api/export/reviews/${cycle.id}`, "_blank")}
                            title="Export CSV"
                          >
                            <Download size={14} className="text-[#8888A0]" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(cycle)} title="Edit">
                            <Pencil size={14} className="text-[#8888A0]" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDeleteConfirm(cycle.id)} title="Delete">
                            <Trash2 size={14} className="text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={(open) => { setShowEditDialog(open); if (!open) setEditingCycle(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Review Cycle</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Cycle Name <span className="text-red-400">*</span></Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
            <div className="space-y-2"><Label>Type <span className="text-red-400">*</span></Label>
              <Select value={newType} onValueChange={setNewType}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY_PULSE">Monthly Pulse</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly Review</SelectItem>
                  <SelectItem value="ANNUAL">Annual Review</SelectItem>
                  <SelectItem value="PROBATION">Probation Review</SelectItem>
                  <SelectItem value="PIP_REVIEW">PIP Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} /></div>
              <div className="space-y-2"><Label>End Date</Label><Input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving || !newName.trim()}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {!loading && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={(l) => { setLimit(l); setPage(1); }}
        />
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        title="Delete Review Cycle"
        description="This will permanently delete this review cycle and ALL reviews within it. This cannot be undone."
        confirmLabel="Delete Cycle"
        loading={deleting}
      />
    </div>
  );
}
