"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  Building2, Search, RefreshCw, ChevronLeft, ChevronRight, Eye,
  Users, CheckSquare, BookOpen, Target, Star,
} from "lucide-react";

interface Company {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    users: number;
    tasks: number;
    sops: number;
    reviewCycles: number;
    kras: number;
  };
}

const plans = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"];
const statuses = ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"];

function getStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE": return <Badge variant="success">Active</Badge>;
    case "TRIAL": return <Badge variant="warning">Trial</Badge>;
    case "SUSPENDED": return <Badge variant="destructive">Suspended</Badge>;
    case "CANCELLED": return <Badge variant="secondary">Cancelled</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

function getPlanColor(plan: string) {
  switch (plan) {
    case "STARTER": return "text-gray-400";
    case "GROWTH": return "text-[#d4ff2e]";
    case "SCALE": return "text-blue-400";
    case "ENTERPRISE": return "text-amber-400";
    default: return "text-gray-400";
  }
}

export default function AdminCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Company | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const { success: toastSuccess, error: toastError } = useToast();

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (search) params.set("search", search);
      if (filterPlan) params.set("plan", filterPlan);
      if (filterStatus) params.set("status", filterStatus);

      const res = await fetch(`/api/admin/companies?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterPlan, filterStatus]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const openDetail = (company: Company) => {
    setSelected(company);
    setEditPlan(company.plan);
    setEditStatus(company.status);
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, plan: editPlan, status: editStatus }),
      });
      if (res.ok) {
        toastSuccess("Company updated successfully");
        setSelected(null);
        fetchCompanies();
      } else {
        toastError("Failed to update company");
      }
    } catch {
      toastError("Failed to update company");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
        <p className="text-muted text-sm mt-1">Manage all subscriber organizations — {total} total</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search companies..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={filterPlan} onValueChange={(v) => { setFilterPlan(v === "ALL" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Plans" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Plans</SelectItem>
            {plans.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v === "ALL" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <RefreshCw className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : companies.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              No companies found.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Company</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Plan</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Users</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Activity</th>
                  <th className="text-right p-4 text-xs font-medium text-muted uppercase tracking-wider">Joined</th>
                  <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-[#d4ff2e]" />
                        <div>
                          <span className="text-sm font-medium">{c.name}</span>
                          <p className="text-[10px] text-muted">{c.slug}{c.domain ? ` · ${c.domain}` : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-xs font-semibold ${getPlanColor(c.plan)}`}>{c.plan}</span>
                    </td>
                    <td className="p-4 text-center text-sm">{c._count.users}</td>
                    <td className="p-4 text-center">{getStatusBadge(c.status)}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-3 text-[10px] text-muted">
                        <span title="Tasks"><CheckSquare size={10} className="inline mr-0.5" />{c._count.tasks}</span>
                        <span title="KRAs"><Target size={10} className="inline mr-0.5" />{c._count.kras}</span>
                        <span title="SOPs"><BookOpen size={10} className="inline mr-0.5" />{c._count.sops}</span>
                        <span title="Reviews"><Star size={10} className="inline mr-0.5" />{c._count.reviewCycles}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right text-xs text-muted">
                      {new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="p-4 text-center">
                      <Button variant="ghost" size="sm" onClick={() => openDetail(c)}>
                        <Eye size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            Page {page} of {totalPages} ({total} companies)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Detail / Edit Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 size={18} className="text-[#d4ff2e]" />
              {selected?.name}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-5 gap-3 text-center">
                <div className="rounded-lg bg-surface-2 p-3">
                  <Users size={14} className="mx-auto mb-1 text-blue-400" />
                  <p className="text-lg font-bold">{selected._count.users}</p>
                  <p className="text-[10px] text-muted">Users</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3">
                  <CheckSquare size={14} className="mx-auto mb-1 text-green-400" />
                  <p className="text-lg font-bold">{selected._count.tasks}</p>
                  <p className="text-[10px] text-muted">Tasks</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3">
                  <Target size={14} className="mx-auto mb-1 text-orange-400" />
                  <p className="text-lg font-bold">{selected._count.kras}</p>
                  <p className="text-[10px] text-muted">KRAs</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3">
                  <BookOpen size={14} className="mx-auto mb-1 text-[#d4ff2e]" />
                  <p className="text-lg font-bold">{selected._count.sops}</p>
                  <p className="text-[10px] text-muted">SOPs</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3">
                  <Star size={14} className="mx-auto mb-1 text-yellow-400" />
                  <p className="text-lg font-bold">{selected._count.reviewCycles}</p>
                  <p className="text-[10px] text-muted">Reviews</p>
                </div>
              </div>

              {/* Info */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Slug</span>
                  <span className="font-mono text-xs">{selected.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Domain</span>
                  <span>{selected.domain || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Joined</span>
                  <span>{new Date(selected.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</span>
                </div>
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">Plan</label>
                  <Select value={editPlan} onValueChange={setEditPlan}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">Status</label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
