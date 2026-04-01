"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Building2, Plus, Users, ChevronRight, Briefcase, Edit3, Trash2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function OrganizationPage() {
  const [departments, setDepartments] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDeptDialog, setShowAddDeptDialog] = useState(false);
  const [showAddRoleDialog, setShowAddRoleDialog] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: "", description: "", color: "#6C5CE7" });
  const [roleForm, setRoleForm] = useState({ title: "", description: "", departmentId: "", level: "EMPLOYEE" });

  const { success: toastSuccess, error: toastError } = useToast();

  // Edit/delete state
  const [editingDept, setEditingDept] = useState<any>(null);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [showEditDeptDialog, setShowEditDeptDialog] = useState(false);
  const [showEditRoleDialog, setShowEditRoleDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<{ type: "dept" | "role"; id: string; name: string; count: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [deptRes, roleRes, userRes] = await Promise.all([
        fetch("/api/departments"),
        fetch("/api/roles"),
        fetch("/api/users"),
      ]);
      const [deptData, roleData, userData] = await Promise.all([
        deptRes.json(), roleRes.json(), userRes.json(),
      ]);
      setDepartments(Array.isArray(deptData) ? deptData : []);
      setRoles(Array.isArray(roleData) ? roleData : []);
      setUsers(Array.isArray(userData) ? userData : []);
    } catch (err) {
      console.error("Failed to fetch org data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function createDepartment() {
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deptForm),
      });
      if (res.ok) {
        setShowAddDeptDialog(false);
        setDeptForm({ name: "", description: "", color: "#6C5CE7" });
        fetchData();
        toastSuccess("Department created");
      }
    } catch (err) {
      toastError("Failed to create department");
    }
  }

  async function createRole() {
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roleForm),
      });
      if (res.ok) {
        setShowAddRoleDialog(false);
        setRoleForm({ title: "", description: "", departmentId: "", level: "EMPLOYEE" });
        fetchData();
        toastSuccess("Role created");
      }
    } catch (err) {
      toastError("Failed to create role");
    }
  }

  function openEditDept(dept: any) {
    setEditingDept(dept);
    setDeptForm({ name: dept.name, description: dept.description || "", color: dept.color || "#6C5CE7" });
    setShowEditDeptDialog(true);
  }

  async function updateDepartment() {
    if (!editingDept) return;
    try {
      const res = await fetch(`/api/departments/${editingDept.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deptForm),
      });
      if (res.ok) {
        setShowEditDeptDialog(false);
        setEditingDept(null);
        setDeptForm({ name: "", description: "", color: "#6C5CE7" });
        fetchData();
        toastSuccess("Department updated");
      }
    } catch (err) {
      toastError("Failed to update department");
    }
  }

  function openEditRole(role: any) {
    setEditingRole(role);
    setRoleForm({ title: role.title, description: role.description || "", departmentId: role.departmentId || "", level: role.level || "EMPLOYEE" });
    setShowEditRoleDialog(true);
  }

  async function updateRole() {
    if (!editingRole) return;
    try {
      const res = await fetch(`/api/roles/${editingRole.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roleForm),
      });
      if (res.ok) {
        setShowEditRoleDialog(false);
        setEditingRole(null);
        setRoleForm({ title: "", description: "", departmentId: "", level: "EMPLOYEE" });
        fetchData();
        toastSuccess("Role updated");
      }
    } catch (err) {
      toastError("Failed to update role");
    }
  }

  function confirmDelete(type: "dept" | "role", item: any) {
    const count = type === "dept" ? (item._count?.members ?? 0) : (item._count?.users ?? 0);
    setShowDeleteDialog({ type, id: item.id, name: type === "dept" ? item.name : item.title, count });
  }

  async function handleDelete() {
    if (!showDeleteDialog) return;
    if (showDeleteDialog.count > 0) {
      toastError("Reassign people before deleting");
      return;
    }
    setDeleting(true);
    const endpoint = showDeleteDialog.type === "dept"
      ? `/api/departments/${showDeleteDialog.id}`
      : `/api/roles/${showDeleteDialog.id}`;
    const label = showDeleteDialog.type === "dept" ? "Department" : "Role";
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        toastError(data.error || `Failed to delete ${label.toLowerCase()}`);
        return;
      }
      setShowDeleteDialog(null);
      fetchData();
      toastSuccess(`${label} deleted`);
    } catch (err) {
      toastError(`Failed to delete ${label.toLowerCase()}`);
    } finally {
      setDeleting(false);
    }
  }

  const levels = ["EMPLOYEE", "TEAM_LEAD", "MANAGER", "DIRECTOR", "VP", "C_LEVEL", "HR", "AGENT"];

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 bg-[#1A1A26] rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-[#12121A] rounded-lg border border-[#2A2A3A] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organization</h1>
        <p className="text-[#8888A0] text-sm mt-1">Manage your company structure, departments, and roles</p>
      </div>

      <Tabs defaultValue="departments">
        <TabsList>
          <TabsTrigger value="departments" className="gap-2"><Building2 size={14} /> Departments</TabsTrigger>
          <TabsTrigger value="roles" className="gap-2"><Briefcase size={14} /> Roles</TabsTrigger>
          <TabsTrigger value="orgchart" className="gap-2"><Users size={14} /> Org Chart</TabsTrigger>
        </TabsList>

        <TabsContent value="departments" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={showAddDeptDialog} onOpenChange={setShowAddDeptDialog}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus size={16} /> Add Department</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Department</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Department Name <span className="text-red-400">*</span></Label>
                    <Input value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="e.g., Product" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input value={deptForm.description} onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })} placeholder="What does this department do?" />
                  </div>
                  <div className="space-y-2">
                    <Label>Color</Label>
                    <Input type="color" value={deptForm.color} onChange={(e) => setDeptForm({ ...deptForm, color: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddDeptDialog(false)}>Cancel</Button>
                  <Button onClick={createDepartment}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {departments.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No departments yet"
              description="Create departments to organize your team structure."
              actionLabel="Add Department"
              onAction={() => setShowAddDeptDialog(true)}
            />
          ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {departments.map((dept) => {
              const memberCount = dept._count?.members ?? dept.members?.length ?? 0;
              const headName = dept.head ? `${dept.head.firstName} ${dept.head.lastName}` : null;
              return (
                <Card key={dept.id} className="hover:border-[#3A3A4A] transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: (dept.color || "#6C5CE7") + "20" }}>
                          <Building2 size={20} style={{ color: dept.color || "#6C5CE7" }} />
                        </div>
                        <div>
                          <h3 className="font-semibold">{dept.name}</h3>
                          <p className="text-xs text-[#8888A0]">{dept.description || "No description"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditDept(dept); }}>
                          <Edit3 size={13} className="text-[#8888A0]" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); confirmDelete("dept", dept); }}>
                          <Trash2 size={13} className="text-red-400" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-[#0A0A0F] p-2.5 text-center">
                        <p className="text-lg font-bold">{memberCount}</p>
                        <p className="text-[10px] text-[#8888A0]">Members</p>
                      </div>
                      <div className="rounded-lg bg-[#0A0A0F] p-2.5 text-center">
                        <p className="text-lg font-bold">{dept.roles?.length || 0}</p>
                        <p className="text-[10px] text-[#8888A0]">Roles</p>
                      </div>
                    </div>

                    {headName && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-[#8888A0] border-t border-[#2A2A3A] pt-3">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[8px]">{headName.split(" ").map((n: string) => n[0]).join("")}</AvatarFallback>
                        </Avatar>
                        <span>Led by {headName}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          )}
        </TabsContent>

        <TabsContent value="roles" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={showAddRoleDialog} onOpenChange={setShowAddRoleDialog}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus size={16} /> Add Role</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Role</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Role Title <span className="text-red-400">*</span></Label>
                    <Input value={roleForm.title} onChange={(e) => setRoleForm({ ...roleForm, title: e.target.value })} placeholder="e.g., Account Executive" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} placeholder="What does this role do?" />
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <select className="h-10 w-full appearance-none rounded-lg border border-[#2A2A3A] bg-[#12121A] pl-3 pr-8 text-sm text-[#E8E8F0] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500" value={roleForm.departmentId} onChange={(e) => setRoleForm({ ...roleForm, departmentId: e.target.value })}>
                      <option value="">Select department...</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Level</Label>
                    <select className="h-10 w-full appearance-none rounded-lg border border-[#2A2A3A] bg-[#12121A] pl-3 pr-8 text-sm text-[#E8E8F0] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500" value={roleForm.level} onChange={(e) => setRoleForm({ ...roleForm, level: e.target.value })}>
                      {levels.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddRoleDialog(false)}>Cancel</Button>
                  <Button onClick={createRole}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {roles.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No roles defined"
              description="Define roles to clarify responsibilities across your organization."
              actionLabel="Add Role"
              onAction={() => setShowAddRoleDialog(true)}
            />
          ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2A2A3A]">
                    <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Role</th>
                    <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Department</th>
                    <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Level</th>
                    <th className="text-right p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">People</th>
                    <th className="text-right p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-b border-[#2A2A3A]/50 hover:bg-[#1A1A26]/50 transition-colors cursor-pointer">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Briefcase size={14} className="text-purple-400" />
                          <span className="text-sm font-medium">{role.title}</span>
                        </div>
                      </td>
                      <td className="p-4"><Badge variant="outline" className="text-xs">{role.department?.name || "—"}</Badge></td>
                      <td className="p-4"><Badge variant="secondary" className="text-xs">{(role.level || "EMPLOYEE").replace(/_/g, " ")}</Badge></td>
                      <td className="p-4 text-right text-sm text-[#8888A0]">{role._count?.users ?? role.users?.length ?? 0}</td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditRole(role)}>
                            <Edit3 size={13} className="text-[#8888A0]" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => confirmDelete("role", role)}>
                            <Trash2 size={13} className="text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="orgchart" className="mt-4">
          <Card>
            <CardContent className="p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4 min-w-[200px]">
                  <Avatar className="h-12 w-12 mx-auto mb-2">
                    <AvatarFallback>CEO</AvatarFallback>
                  </Avatar>
                  <p className="font-semibold">Admin</p>
                  <p className="text-xs text-[#8888A0]">Company Admin</p>
                </div>

                <div className="h-8 w-px bg-[#2A2A3A]" />

                <div className="flex flex-wrap gap-4 justify-center">
                  {departments.map((dept) => {
                    const headName = dept.head ? `${dept.head.firstName} ${dept.head.lastName}` : "Vacant";
                    const memberCount = dept._count?.members ?? 0;
                    return (
                      <div key={dept.id} className="rounded-xl border border-[#2A2A3A] bg-[#12121A] p-4 min-w-[160px]">
                        <div className="h-3 w-3 rounded-full mx-auto mb-2" style={{ backgroundColor: dept.color || "#6C5CE7" }} />
                        <p className="font-medium text-sm">{headName}</p>
                        <p className="text-xs text-[#8888A0]">{dept.name} Head</p>
                        <p className="text-[10px] text-[#8888A0] mt-1">{memberCount} members</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Department Dialog */}
      <Dialog open={showEditDeptDialog} onOpenChange={(open) => { setShowEditDeptDialog(open); if (!open) setEditingDept(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Department</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Department Name <span className="text-red-400">*</span></Label>
              <Input value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={deptForm.description} onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <Input type="color" value={deptForm.color} onChange={(e) => setDeptForm({ ...deptForm, color: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDeptDialog(false)}>Cancel</Button>
            <Button onClick={updateDepartment}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={showEditRoleDialog} onOpenChange={(open) => { setShowEditRoleDialog(open); if (!open) setEditingRole(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Role</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Role Title <span className="text-red-400">*</span></Label>
              <Input value={roleForm.title} onChange={(e) => setRoleForm({ ...roleForm, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <select className="h-10 w-full appearance-none rounded-lg border border-[#2A2A3A] bg-[#12121A] pl-3 pr-8 text-sm text-[#E8E8F0] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500" value={roleForm.departmentId} onChange={(e) => setRoleForm({ ...roleForm, departmentId: e.target.value })}>
                <option value="">Select department...</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Level</Label>
              <select className="h-10 w-full appearance-none rounded-lg border border-[#2A2A3A] bg-[#12121A] pl-3 pr-8 text-sm text-[#E8E8F0] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500" value={roleForm.level} onChange={(e) => setRoleForm({ ...roleForm, level: e.target.value })}>
                {levels.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditRoleDialog(false)}>Cancel</Button>
            <Button onClick={updateRole}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!showDeleteDialog}
        onClose={() => setShowDeleteDialog(null)}
        title={`Delete ${showDeleteDialog?.type === "dept" ? "Department" : "Role"}`}
        description={
          showDeleteDialog && showDeleteDialog.count > 0
            ? `Cannot delete "${showDeleteDialog.name}": ${showDeleteDialog.count} people are assigned. Reassign them first.`
            : `"${showDeleteDialog?.name}" has 0 people assigned. Are you sure you want to delete it? This action cannot be undone.`
        }
        confirmLabel="Delete"
        onConfirm={handleDelete}
        loading={deleting}
        destructive
      />
    </div>
  );
}
