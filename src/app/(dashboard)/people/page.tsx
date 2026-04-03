"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, Plus, Users, TrendingUp, TrendingDown, Minus,
  MoreHorizontal, Mail, Building2, UserCheck, Download, Trash2,
  UserMinus, Target, BookOpen,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: { id: string; title: string } | null;
  department: { id: string; name: string } | null;
  status: string;
  accessLevel: string;
  score: number;
  trend: string;
  avatar?: string | null;
  joinDate?: string;
  _count?: { directReports: number };
}

interface Department {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name?: string;
  title?: string;
}

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-purple-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE": return <Badge variant="success">Active</Badge>;
    case "PIP": return <Badge variant="destructive">PIP</Badge>;
    case "PROBATION": return <Badge variant="warning">Probation</Badge>;
    case "ON_LEAVE": return <Badge variant="secondary">On Leave</Badge>;
    case "INACTIVE": return <Badge variant="secondary">Inactive</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function PeoplePage() {
  const router = useRouter();
  const { canManagePeople, canInvite, isManager } = useRole();
  const [people, setPeople] = useState<Person[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [kras, setKras] = useState<any[]>([]);
  const [sops, setSops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkPayload, setBulkPayload] = useState<any>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  // Add form state
  const [formEmail, setFormEmail] = useState("");
  const [formDepartmentId, setFormDepartmentId] = useState("");
  const [formRoleId, setFormRoleId] = useState("");
  const [formAccessLevel, setFormAccessLevel] = useState("");

  // Inline creation state
  const [showNewRole, setShowNewRole] = useState(false);
  const [newRoleTitle, setNewRoleTitle] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [showNewDept, setShowNewDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);

  const handleCreateRole = async () => {
    if (!newRoleTitle.trim()) return;
    setCreatingRole(true);
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newRoleTitle,
          departmentId: formDepartmentId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create role");
      const role = await res.json();
      const created = role.data || role;
      setRoles((prev) => [...prev, { id: created.id, title: created.title }]);
      setFormRoleId(created.id);
      setNewRoleTitle("");
      setShowNewRole(false);
      toastSuccess(`Role "${created.title}" created`);
    } catch {
      toastError("Failed to create role");
    } finally {
      setCreatingRole(false);
    }
  };

  const handleCreateDept = async () => {
    if (!newDeptName.trim()) return;
    setCreatingDept(true);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDeptName }),
      });
      if (!res.ok) throw new Error("Failed to create department");
      const dept = await res.json();
      const created = dept.data || dept;
      setDepartments((prev) => [...prev, { id: created.id, name: created.name }]);
      setFormDepartmentId(created.id);
      setNewDeptName("");
      setShowNewDept(false);
      toastSuccess(`Department "${created.name}" created`);
    } catch {
      toastError("Failed to create department");
    } finally {
      setCreatingDept(false);
    }
  };

  // Pending invitations
  const [pendingInvitations, setPendingInvitations] = useState<any[]>([]);

  const fetchPendingInvitations = useCallback(async () => {
    try {
      const res = await fetch("/api/invitations");
      if (res.ok) {
        const data = await res.json();
        const pending = (Array.isArray(data) ? data : data.data || []).filter(
          (inv: any) => !inv.accepted && new Date(inv.expiresAt) > new Date()
        );
        setPendingInvitations(pending);
      }
    } catch {}
  }, []);

  const handleCancelInvite = async (id: string) => {
    try {
      const res = await fetch("/api/invitations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toastSuccess("Invitation cancelled");
        fetchPendingInvitations();
      }
    } catch {
      toastError("Failed to cancel invitation");
    }
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (searchQuery) params.set("search", searchQuery);
      if (deptFilter !== "all") params.set("departmentId", deptFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/users?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch users");
      const json = await res.json();
      setPeople(json.data || []);
      setTotal(json.pagination?.total || 0);
      setTotalPages(json.pagination?.totalPages || 0);
    } catch (err) {
      console.error("Error fetching users:", err);
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, searchQuery, deptFilter, statusFilter]);

  useEffect(() => {
    Promise.all([
      fetch("/api/departments").then((r) => r.ok ? r.json() : []),
      fetch("/api/roles").then((r) => r.ok ? r.json() : []),
      fetch("/api/kras?limit=100").then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
      fetch("/api/sops?status=PUBLISHED&limit=100").then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
    ]).then(([depts, rls, krasData, sopsData]) => {
      setDepartments(depts);
      setRoles(rls);
      setKras(Array.isArray(krasData) ? krasData : krasData?.data || []);
      setSops(Array.isArray(sopsData) ? sopsData : sopsData?.data || []);
    });
  }, []);

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1); // Reset to page 1 on filter change
  }, [debouncedSearch, deptFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
    fetchPendingInvitations();
  }, [fetchUsers, fetchPendingInvitations]);

  const filtered = people; // Server-side filtering now

  const resetForm = () => {
    setFormEmail("");
    setFormDepartmentId(""); setFormRoleId(""); setFormAccessLevel("");
  };

  const handleAddPerson = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formEmail,
          accessLevel: formAccessLevel || "EMPLOYEE",
          departmentId: formDepartmentId || undefined,
          roleId: formRoleId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toastError(err.error || "Failed to send invitation");
        return;
      }
      setShowAddDialog(false);
      resetForm();
      fetchPendingInvitations();
      toastSuccess("Invitation sent! They'll appear here once they accept.");
    } catch (err) {
      toastError("Failed to send invitation");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/people/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(selectedIds), action: bulkAction, payload: bulkPayload }),
      });
      const data = await res.json();
      if (res.ok) {
        setBulkMessage(data.message);
        setSelectedIds(new Set());
        setBulkAction(null);
        setBulkPayload({});
        setTimeout(() => setBulkMessage(null), 3000);
        toastSuccess(data.message || "Bulk action applied");
        setLoading(true);
        await fetchUsers();
      }
    } catch (err) {
      console.error("Bulk action failed:", err);
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteTarget(null);
        setLoading(true);
        await fetchUsers();
        toastSuccess("Team member removed");
      }
    } catch (err) {
      toastError("Failed to remove team member");
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = () => {
    window.open("/api/export/people", "_blank");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="text-muted text-sm mt-1">{total} team members across your organization</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download size={14} /> Export
          </Button>
          {canInvite && <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} /> Invite Person</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
              <p className="text-xs text-muted">They&apos;ll receive an email invite to join your organization.</p>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Email <span className="text-red-400">*</span></Label>
                  <Input type="email" placeholder="email@company.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
                  {formEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail) && (
                    <p className="text-xs text-red-400">Please enter a valid email address</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  {showNewDept ? (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Department name..."
                        value={newDeptName}
                        onChange={(e) => setNewDeptName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreateDept()}
                        autoFocus
                      />
                      <Button size="sm" onClick={handleCreateDept} disabled={creatingDept || !newDeptName.trim()}>
                        {creatingDept ? "..." : "Add"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowNewDept(false); setNewDeptName(""); }}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select value={formDepartmentId} onValueChange={setFormDepartmentId}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Select department" /></SelectTrigger>
                        <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => setShowNewDept(true)} className="shrink-0 text-xs">
                        + New
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  {showNewRole ? (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Role title..."
                        value={newRoleTitle}
                        onChange={(e) => setNewRoleTitle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreateRole()}
                        autoFocus
                      />
                      <Button size="sm" onClick={handleCreateRole} disabled={creatingRole || !newRoleTitle.trim()}>
                        {creatingRole ? "..." : "Add"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowNewRole(false); setNewRoleTitle(""); }}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select value={formRoleId} onValueChange={setFormRoleId}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Select role" /></SelectTrigger>
                        <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.title || r.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => setShowNewRole(true)} className="shrink-0 text-xs">
                        + New
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Access Level</Label>
                  <Select value={formAccessLevel} onValueChange={setFormAccessLevel}>
                    <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EMPLOYEE">Employee</SelectItem>
                      <SelectItem value="TEAM_LEAD">Team Lead</SelectItem>
                      <SelectItem value="MANAGER">Manager</SelectItem>
                      <SelectItem value="DIRECTOR">Director</SelectItem>
                      <SelectItem value="VP">VP</SelectItem>
                      <SelectItem value="HR">HR</SelectItem>
                      <SelectItem value="AGENT">Agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }}>Cancel</Button>
                <Button onClick={handleAddPerson} disabled={submitting || !formEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail)}>
                  {submitting ? "Sending..." : "Send Invite"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search people..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[200px]">
            <Building2 size={14} className="mr-2 text-muted shrink-0" />
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <UserCheck size={14} className="mr-2 text-muted" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="PIP">PIP</SelectItem>
            <SelectItem value="PROBATION">Probation</SelectItem>
            <SelectItem value="ON_LEAVE">On Leave</SelectItem>
          </SelectContent>
        </Select>
        {filtered.length > 0 && canManagePeople && (
          <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="text-xs text-muted">
            {selectedIds.size === filtered.length ? "Deselect All" : "Select All"}
          </Button>
        )}
      </div>

      {/* Bulk success toast */}
      {bulkMessage && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">{bulkMessage}</div>
      )}

      {/* People Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}><CardContent className="p-5"><div className="flex items-start gap-4"><div className="h-12 w-12 rounded-full animate-pulse bg-surface-2" /><div className="flex-1 space-y-2"><div className="h-4 w-32 animate-pulse rounded bg-surface-2" /><div className="h-3 w-24 animate-pulse rounded bg-surface-2" /></div></div></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((person) => {
            const isSelected = selectedIds.has(person.id);
            return (
              <Card key={person.id} className={`hover:border-muted-2 transition-all group cursor-pointer ${isSelected ? "border-purple-500/50 bg-purple-500/5" : ""}`} onClick={() => router.push(`/people/${person.id}`)}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    {canManagePeople && <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(person.id); }}
                      className={`mt-1 h-5 w-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                        isSelected ? "border-purple-500 bg-purple-500" : "border-border hover:border-muted"
                      }`}
                    >
                      {isSelected && <span className="text-white text-xs font-bold">&#10003;</span>}
                    </button>}
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="text-base">{person.firstName[0]}{person.lastName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold truncate">{person.firstName} {person.lastName}</h3>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-surface-2">
                              <MoreHorizontal size={16} className="text-muted" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/people/${person.id}`)}>View Profile</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => router.push(`/kra-kpi`)}>Assign KRA</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => router.push(`/reviews`)}>Start Review</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => router.push(`/people/${person.id}`)}>Edit Details</DropdownMenuItem>
                            {canManagePeople && <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-400 focus:text-red-400" onClick={(e) => { e.stopPropagation(); setDeleteTarget(person); }}>
                              <UserMinus size={14} className="mr-2" /> Remove from Organization
                            </DropdownMenuItem>
                            </>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {person.role && <p className="text-sm text-muted">{person.role.title}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        {person.department && <Badge variant="outline" className="text-[10px]">{person.department.name}</Badge>}
                        {getStatusBadge(person.status)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1"><Mail size={12} /> {person.email}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-lg font-bold font-mono ${getScoreColor(person.score)}`}>{person.score}</span>
                      {person.trend === "up" && <TrendingUp size={14} className="text-green-400" />}
                      {person.trend === "down" && <TrendingDown size={14} className="text-red-400" />}
                      {person.trend === "stable" && <Minus size={14} className="text-muted" />}
                    </div>
                  </div>
                  {(person._count?.directReports ?? 0) > 0 && (
                    <div className="mt-2 text-xs text-muted flex items-center gap-1"><Users size={12} /> {person._count?.directReports} direct reports</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && !loading && (
            <div className="col-span-full">
              <EmptyState
                icon={Users}
                title="No team members yet"
                description="Start by adding your first team member to build your organization."
                actionLabel="Add Person"
                onAction={() => setShowAddDialog(true)}
              />
            </div>
          )}
        </div>
      )}

      {/* Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted">Pending Invitations ({pendingInvitations.length})</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pendingInvitations.map((inv: any) => (
              <Card key={inv.id} className="border-dashed border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 text-xs font-bold shrink-0">
                      <Mail size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{inv.email}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="warning" className="text-[10px]">Invited</Badge>
                        <span className="text-[10px] text-muted-2">
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-red-400 hover:text-red-300 shrink-0"
                      onClick={() => handleCancelInvite(inv.id)}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

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

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-3 shadow-2xl">
          <span className="text-sm font-medium text-purple-400">{selectedIds.size} selected</span>
          <div className="h-5 w-px bg-border" />
          <Button variant="outline" size="sm" onClick={() => { setBulkAction("change_department"); setBulkPayload({}); }}>
            <Building2 size={14} className="mr-1" /> Department
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setBulkAction("change_manager"); setBulkPayload({}); }}>
            <Users size={14} className="mr-1" /> Manager
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setBulkAction("assign_kra"); setBulkPayload({ weightage: 100, period: "Q1 2026" }); }}>
            <Target size={14} className="mr-1" /> KRA
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setBulkAction("assign_sop"); setBulkPayload({ mandatory: true }); }}>
            <BookOpen size={14} className="mr-1" /> SOP
          </Button>
          <div className="h-5 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="text-muted">Cancel</Button>
        </div>
      )}

      {/* Bulk Action Dialog */}
      <Dialog open={!!bulkAction} onOpenChange={(open) => { if (!open) { setBulkAction(null); setBulkPayload({}); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkAction === "change_department" && "Change Department"}
              {bulkAction === "change_manager" && "Change Manager"}
              {bulkAction === "assign_kra" && "Assign KRA"}
              {bulkAction === "assign_sop" && "Assign SOP"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted">Applying to {selectedIds.size} selected people</p>
            {bulkAction === "change_department" && (
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={bulkPayload.departmentId || ""} onValueChange={(v) => setBulkPayload({ ...bulkPayload, departmentId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {bulkAction === "change_manager" && (
              <div className="space-y-2">
                <Label>Manager</Label>
                <Select value={bulkPayload.managerId || ""} onValueChange={(v) => setBulkPayload({ ...bulkPayload, managerId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>{people.filter((p) => p.accessLevel !== "EMPLOYEE").map((p) => <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {bulkAction === "assign_kra" && (
              <>
                <div className="space-y-2">
                  <Label>KRA</Label>
                  <Select value={bulkPayload.kraId || ""} onValueChange={(v) => setBulkPayload({ ...bulkPayload, kraId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select KRA" /></SelectTrigger>
                    <SelectContent>{kras.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Weightage (%)</Label><Input type="number" value={bulkPayload.weightage || 100} onChange={(e) => setBulkPayload({ ...bulkPayload, weightage: parseInt(e.target.value) || 100 })} /></div>
                  <div className="space-y-2"><Label>Period</Label><Input value={bulkPayload.period || "Q1 2026"} onChange={(e) => setBulkPayload({ ...bulkPayload, period: e.target.value })} /></div>
                </div>
              </>
            )}
            {bulkAction === "assign_sop" && (
              <>
                <div className="space-y-2">
                  <Label>SOP</Label>
                  <Select value={bulkPayload.sopId || ""} onValueChange={(v) => setBulkPayload({ ...bulkPayload, sopId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select SOP" /></SelectTrigger>
                    <SelectContent>{sops.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Due Date</Label><Input type="date" value={bulkPayload.dueDate || ""} onChange={(e) => setBulkPayload({ ...bulkPayload, dueDate: e.target.value })} /></div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkAction(null); setBulkPayload({}); }}>Cancel</Button>
            <Button onClick={handleBulkAction} disabled={bulkSubmitting}>{bulkSubmitting ? "Applying..." : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove from Organization"
        description={deleteTarget ? `Are you sure you want to remove ${deleteTarget.firstName} ${deleteTarget.lastName}? They will be excluded from active assignments and future reviews. Historical data will be preserved. This can be reversed from Settings > Removed People.` : ""}
        confirmLabel="Remove Person"
        loading={deleting}
      />
    </div>
  );
}
