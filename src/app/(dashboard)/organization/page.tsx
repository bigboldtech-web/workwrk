"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Building2, Plus, Users, ChevronRight, Briefcase, Edit3, Trash2,
  Heart, Target, Eye, Globe, Calendar, Sparkles, Save, X,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/dashboard/page-header";

// ============================================
// Dynamic Org Chart Component
// ============================================

const ACCESS_LEVEL_ORDER: Record<string, number> = {
  SUPER_ADMIN: 0, COMPANY_ADMIN: 1, C_LEVEL: 2, VP: 3,
  DIRECTOR: 4, MANAGER: 5, HR: 5, TEAM_LEAD: 6, EMPLOYEE: 7, AGENT: 8,
};

function getAccessLabel(level: string) {
  return level.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function OrgChartNode({ user, allUsers, depth = 0 }: { user: any; allUsers: any[]; depth?: number }) {
  const directReports = allUsers
    .filter((u) => u.manager?.id === user.id)
    .sort((a: any, b: any) => (ACCESS_LEVEL_ORDER[a.accessLevel] ?? 7) - (ACCESS_LEVEL_ORDER[b.accessLevel] ?? 7));
  const borderColor = depth === 0 ? "border-[rgba(212,255,46,0.3)]" : "border-border";
  const bgColor = depth === 0 ? "bg-[rgba(212,255,46,0.08)]" : "bg-surface";

  return (
    <div className="flex flex-col items-center">
      {/* Node */}
      <div className={`rounded-xl border ${borderColor} ${bgColor} p-4 min-w-[180px] max-w-[220px] text-center`}>
        <Avatar className="h-10 w-10 mx-auto mb-2">
          <AvatarFallback className={`text-sm font-bold ${depth === 0 ? "bg-[rgba(212,255,46,0.12)] text-[#d4ff2e]" : "bg-border text-muted"}`}>
            {user.firstName?.[0]}{user.lastName?.[0]}
          </AvatarFallback>
        </Avatar>
        <p className="font-semibold text-sm">{user.firstName} {user.lastName}</p>
        <p className="text-xs text-muted">{user.role?.title || getAccessLabel(user.accessLevel)}</p>
        {user.department && (
          <Badge variant="outline" className="text-[9px] mt-1.5">{user.department.name}</Badge>
        )}
        {directReports.length > 0 && (
          <p className="text-[10px] text-muted mt-1">{directReports.length} report{directReports.length !== 1 ? "s" : ""}</p>
        )}
      </div>

      {/* Children with connectors */}
      {directReports.length > 0 && (
        <div className="flex flex-col items-center">
          {/* Vertical line from parent down */}
          <div style={{ width: "2px", height: "24px", background: "var(--b-t4)" }} />

          {directReports.length === 1 ? (
            <OrgChartNode user={directReports[0]} allUsers={allUsers} depth={depth + 1} />
          ) : (
            <div style={{ display: "flex" }}>
              {directReports.map((report: any, idx: number) => {
                const isFirst = idx === 0;
                const isLast = idx === directReports.length - 1;
                const count = directReports.length;
                return (
                  <div key={report.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px" }}>
                    {/* T-connector: horizontal segments (extend into padding) + vertical drop */}
                    <div style={{ position: "relative", width: "100%", height: "24px", overflow: "visible" }}>
                      {/* Left half — extends 16px into the gap between columns */}
                      {!isFirst && (
                        <div style={{ position: "absolute", top: 0, left: "-16px", right: "50%", height: "2px", background: "var(--b-t4)" }} />
                      )}
                      {/* Right half — extends 16px into the gap between columns */}
                      {!isLast && (
                        <div style={{ position: "absolute", top: 0, left: "50%", right: "-16px", height: "2px", background: "var(--b-t4)" }} />
                      )}
                      {/* Vertical drop */}
                      <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: "2px", height: "100%", background: "var(--b-t4)" }} />
                    </div>
                    <OrgChartNode user={report} allUsers={allUsers} depth={depth + 1} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrgChartCanvas({ users, departments }: { users: any[]; departments: any[] }) {
  const [zoom, setZoom] = useState(0.55);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const fitToScreen = useCallback(() => {
    if (containerRef.current && chartRef.current) {
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      // Use scrollWidth/scrollHeight to get true content size (not clipped by overflow)
      const chartW = Math.max(chartRef.current.scrollWidth, chartRef.current.offsetWidth);
      const chartH = Math.max(chartRef.current.scrollHeight, chartRef.current.offsetHeight);
      if (chartW > 0 && chartH > 0) {
        const padding = 80;
        const zoomW = (containerW - padding) / chartW;
        const zoomH = (containerH - padding) / chartH;
        const newZoom = Math.max(0.2, Math.min(0.9, Math.min(zoomW, zoomH)));
        setZoom(newZoom);
        // Center the chart vertically within the container
        const scaledH = chartH * newZoom;
        const panY = scaledH < containerH ? (containerH - scaledH) / 2 - 24 * newZoom : 0;
        setPan({ x: 0, y: Math.max(0, panY) });
        return;
      }
    }
    setPan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom((z) => Math.min(2, Math.max(0.2, z + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // Auto-fit zoom on first render and when users change
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 5;
    const tryFit = () => {
      attempts++;
      if (chartRef.current && chartRef.current.scrollWidth > 0 && chartRef.current.scrollHeight > 0) {
        fitToScreen();
      } else if (attempts < maxAttempts) {
        setTimeout(tryFit, 200);
      }
    };
    const timer = setTimeout(tryFit, 100);
    return () => clearTimeout(timer);
  }, [users.length]);

  // Re-fit on window resize so chart adapts to different screen sizes
  useEffect(() => {
    const handleResize = () => fitToScreen();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitToScreen]);

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-border relative"
      style={{
        height: "calc(100vh - 230px)",
        overflow: "hidden",
        cursor: dragging ? "grabbing" : "grab",
        background: "radial-gradient(circle at 1px 1px, #27272a 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar — inside canvas but pinned top-right with high z-index */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-surface border border-border rounded-lg p-1 shadow-lg">
        <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="h-7 w-7 rounded flex items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground text-sm font-bold">+</button>
        <span className="text-[10px] text-muted w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))} className="h-7 w-7 rounded flex items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground text-sm font-bold">−</button>
        <div className="w-px h-4 bg-border mx-1" />
        <button onClick={fitToScreen} className="h-7 px-2 rounded flex items-center justify-center text-[10px] text-muted hover:bg-surface-2 hover:text-foreground">Fit</button>
      </div>

      {/* Hint — pinned bottom-left */}
      <div className="absolute bottom-3 left-3 z-20">
        <span className="text-[10px] text-muted bg-surface/90 px-2 py-1 rounded border border-border">Scroll to zoom · Drag to pan</span>
      </div>

      {/* Zoomable chart — uses width/height 100% so transform-origin centers properly */}
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "top center",
          transition: dragging ? "none" : "transform 0.15s ease-out",
          paddingTop: "24px",
          pointerEvents: "none",
        }}
      >
        <div ref={chartRef} style={{ display: "inline-flex", pointerEvents: "auto" }}>
          <OrgChart users={users} departments={departments} />
        </div>
      </div>
    </div>
  );
}

function OrgChart({ users, departments }: { users: any[]; departments: any[] }) {
  if (users.length === 0) {
    return (
      <div className="text-center py-12">
        <Users size={40} className="mx-auto text-muted mb-3" />
        <p className="text-sm text-muted">Add team members to see the org chart</p>
      </div>
    );
  }

  // Find top-level users (no manager assigned)
  const topLevel = users
    .filter((u) => !u.manager && !u.deletedAt)
    .sort((a, b) => (ACCESS_LEVEL_ORDER[a.accessLevel] ?? 7) - (ACCESS_LEVEL_ORDER[b.accessLevel] ?? 7));

  // Users with managers who aren't in the top level
  const managedUsers = users.filter((u) => u.manager && !u.deletedAt);

  // Find unlinked users (have no manager and no reports — orphans not in the tree)
  const usersInTree = new Set<string>();
  function collectTree(userId: string) {
    usersInTree.add(userId);
    users.filter((u) => u.manager?.id === userId).forEach((u) => collectTree(u.id));
  }
  topLevel.forEach((u) => collectTree(u.id));

  const unlinked = users.filter((u) => !usersInTree.has(u.id) && !u.deletedAt);

  return (
    <div className="space-y-8">
      {/* Main tree */}
      <div className="flex justify-center min-w-fit">
        <div className="flex flex-col items-center">
          {topLevel.length === 1 ? (
            <OrgChartNode user={topLevel[0]} allUsers={users} depth={0} />
          ) : topLevel.length > 1 ? (
            <div className="flex gap-8">
              {topLevel.map((user) => (
                <OrgChartNode key={user.id} user={user} allUsers={users} depth={0} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Unlinked users — no manager assigned */}
      {unlinked.length > 0 && (
        <div className="border-t border-border pt-6">
          <p className="text-xs text-muted mb-3 text-center">
            Not in hierarchy — assign a manager to link them
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {unlinked.map((u) => (
              <div key={u.id} className="rounded-lg border border-dashed border-border bg-surface-3 p-3 min-w-[140px] text-center">
                <Avatar className="h-8 w-8 mx-auto mb-1">
                  <AvatarFallback className="text-xs bg-border text-muted">
                    {u.firstName?.[0]}{u.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <p className="text-xs font-medium">{u.firstName} {u.lastName}</p>
                <p className="text-[10px] text-muted-2">{u.role?.title || u.accessLevel?.replace(/_/g, " ")}</p>
                {u.department && (
                  <p className="text-[10px] text-muted-2">{u.department.name}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrganizationPage() {
  const [departments, setDepartments] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDeptDialog, setShowAddDeptDialog] = useState(false);
  const [showAddRoleDialog, setShowAddRoleDialog] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: "", description: "", color: "var(--b-accent-text)" });
  const [roleForm, setRoleForm] = useState({ title: "", description: "", departmentId: "", level: "EMPLOYEE" });

  const { success: toastSuccess, error: toastError } = useToast();

  // Company profile
  interface CompanyProfile {
    mission: string;
    vision: string;
    about: string;
    values: string[];
    website: string;
    industry: string;
    founded: string;
  }
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    mission: "", vision: "", about: "", values: [], website: "", industry: "", founded: "",
  });
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [orgName, setOrgName] = useState("");

  // Edit/delete state
  const [editingDept, setEditingDept] = useState<any>(null);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [showEditDeptDialog, setShowEditDeptDialog] = useState(false);
  const [showEditRoleDialog, setShowEditRoleDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<{ type: "dept" | "role"; id: string; name: string; count: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Offices
  const [officesList, setOfficesList] = useState<any[]>([]);
  const [showAddOffice, setShowAddOffice] = useState(false);
  const [officeForm, setOfficeForm] = useState({ name: "", city: "", country: "", isHeadquarters: false });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [deptRes, roleRes, userRes, settingsRes, officesRes] = await Promise.all([
        fetch("/api/departments"),
        fetch("/api/roles"),
        fetch("/api/users?limit=100"),
        fetch("/api/settings"),
        fetch("/api/offices"),
      ]);
      const [deptData, roleData, userData, settingsData, officesData] = await Promise.all([
        deptRes.json(), roleRes.json(), userRes.json(), settingsRes.json(), officesRes.json(),
      ]);
      setOfficesList(Array.isArray(officesData) ? officesData : officesData?.data || []);
      setDepartments(Array.isArray(deptData) ? deptData : []);
      setRoles(Array.isArray(roleData) ? roleData : []);
      setUsers(Array.isArray(userData) ? userData : userData?.data || []);
      if (settingsData?.settings?.companyProfile) {
        setCompanyProfile({ mission: "", vision: "", about: "", values: [], website: "", industry: "", founded: "", ...settingsData.settings.companyProfile });
      }
      if (settingsData?.organization?.name) {
        setOrgName(settingsData.organization.name);
      }
    } catch (err) {
      console.error("Failed to fetch org data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function saveCompanyProfile() {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyProfile }),
      });
      if (res.ok) {
        setEditingProfile(false);
        toastSuccess("Company profile saved");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to save profile");
      }
    } catch { toastError("Failed to save profile"); } finally { setSavingProfile(false); }
  }

  async function aiGenerateProfile() {
    setAiGenerating(true);
    try {
      const res = await fetch("/api/organization/ai-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: orgName,
          website: companyProfile.website,
          industry: companyProfile.industry,
          currentAbout: companyProfile.about,
          currentMission: companyProfile.mission,
          currentVision: companyProfile.vision,
          currentValues: companyProfile.values,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const result = data.data || data || {};
        setCompanyProfile({
          ...companyProfile,
          about: result.about || companyProfile.about,
          mission: result.mission || companyProfile.mission,
          vision: result.vision || companyProfile.vision,
          values: result.values?.length > 0 ? result.values : companyProfile.values,
          industry: result.industry || companyProfile.industry,
        });
        setEditingProfile(true);
        toastSuccess("AI generated profile — review and save");
      } else {
        toastError(data?.error || "AI generation failed");
      }
    } catch (e: any) { toastError(e?.message || "AI generation failed"); } finally { setAiGenerating(false); }
  }

  function addValue() {
    if (!newValue.trim()) return;
    setCompanyProfile({ ...companyProfile, values: [...companyProfile.values, newValue.trim()] });
    setNewValue("");
  }

  function removeValue(index: number) {
    setCompanyProfile({ ...companyProfile, values: companyProfile.values.filter((_, i) => i !== index) });
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
        setDeptForm({ name: "", description: "", color: "var(--b-accent-text)" });
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
    setDeptForm({ name: dept.name, description: dept.description || "", color: dept.color || "#d4ff2e" });
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
        setDeptForm({ name: "", description: "", color: "var(--b-accent-text)" });
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
      <div className="space-y-4 animate-fade-in">
        <div className="h-8 w-48 bg-surface-2 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-surface rounded-lg border border-border animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        kicker="Organization · structure"
        title="Organization"
        subtitle="Manage your company structure, departments, roles, and offices."
      />

      <Tabs defaultValue="about">
        <TabsList>
          <TabsTrigger value="about" className="gap-2"><Heart size={14} /> About</TabsTrigger>
          <TabsTrigger value="departments" className="gap-2"><Building2 size={14} /> Departments</TabsTrigger>
          <TabsTrigger value="roles" className="gap-2"><Briefcase size={14} /> Roles</TabsTrigger>
          <TabsTrigger value="offices" className="gap-2"><Globe size={14} /> Offices</TabsTrigger>
          <TabsTrigger value="orgchart" className="gap-2"><Users size={14} /> Org Chart</TabsTrigger>
        </TabsList>

        {/* About Tab */}
        <TabsContent value="about" className="mt-4 space-y-4">
          {/* Header with edit button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">{orgName || "Your Company"}</h2>
            </div>
            {editingProfile ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setEditingProfile(false); fetchData(); }}>
                  <X size={14} className="mr-1" /> Cancel
                </Button>
                <Button size="sm" onClick={saveCompanyProfile} disabled={savingProfile}>
                  <Save size={14} className="mr-1" /> {savingProfile ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1 border-[rgba(212,255,46,0.3)] text-[#d4ff2e] hover:bg-[rgba(212,255,46,0.08)]" onClick={aiGenerateProfile} disabled={aiGenerating}>
                  <Sparkles size={14} /> {aiGenerating ? "Generating..." : "AI Assist"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
                  <Edit3 size={14} className="mr-1" /> Edit
                </Button>
              </div>
            )}
          </div>

          {/* Mission & Vision */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target size={14} className="text-[#d4ff2e]" /> Mission
                </CardTitle>
              </CardHeader>
              <CardContent>
                {editingProfile ? (
                  <Textarea
                    value={companyProfile.mission}
                    onChange={(e) => setCompanyProfile({ ...companyProfile, mission: e.target.value })}
                    placeholder="What is your company's mission?"
                    rows={3}
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted">{companyProfile.mission || "No mission statement set yet."}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Eye size={14} className="text-[#d4ff2e]" /> Vision
                </CardTitle>
              </CardHeader>
              <CardContent>
                {editingProfile ? (
                  <Textarea
                    value={companyProfile.vision}
                    onChange={(e) => setCompanyProfile({ ...companyProfile, vision: e.target.value })}
                    placeholder="What is your company's vision?"
                    rows={3}
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted">{companyProfile.vision || "No vision statement set yet."}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* About */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 size={14} className="text-[#d4ff2e]" /> About the Company
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editingProfile ? (
                <Textarea
                  value={companyProfile.about}
                  onChange={(e) => setCompanyProfile({ ...companyProfile, about: e.target.value })}
                  placeholder="Tell your team about the company — history, purpose, what you do..."
                  rows={4}
                  className="text-sm"
                />
              ) : companyProfile.about ? (
                <p className="text-sm text-muted whitespace-pre-wrap">{companyProfile.about}</p>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted mb-2">No company description added yet.</p>
                  <p className="text-xs text-muted mb-3">A strong company description helps AI generate better KRAs, KPIs, and align everything to your business.</p>
                  <Button variant="outline" size="sm" className="gap-1 border-[rgba(212,255,46,0.3)] text-[#d4ff2e]" onClick={aiGenerateProfile} disabled={aiGenerating}>
                    <Sparkles size={14} /> {aiGenerating ? "Generating..." : "Generate with AI"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company Values */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Heart size={14} className="text-[#d4ff2e]" /> Our Values
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {companyProfile.values.length === 0 && !editingProfile ? (
                <p className="text-sm text-muted">No company values defined yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {companyProfile.values.map((value, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[rgba(212,255,46,0.08)] border border-[rgba(212,255,46,0.2)]">
                      <Sparkles size={12} className="text-[#d4ff2e]" />
                      <span className="text-sm">{value}</span>
                      {editingProfile && (
                        <button onClick={() => removeValue(i)} className="ml-1 text-red-400 hover:text-red-300">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {editingProfile && (
                <div className="flex items-center gap-2 mt-3">
                  <Input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="Add a value (e.g., Integrity, Innovation)"
                    className="text-sm"
                    onKeyDown={(e) => e.key === "Enter" && addValue()}
                  />
                  <Button size="sm" variant="outline" onClick={addValue}>Add</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe size={14} className="text-muted" /> Website
                </CardTitle>
              </CardHeader>
              <CardContent>
                {editingProfile ? (
                  <Input
                    value={companyProfile.website}
                    onChange={(e) => setCompanyProfile({ ...companyProfile, website: e.target.value })}
                    placeholder="https://yourcompany.com"
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted">{companyProfile.website || "—"}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Briefcase size={14} className="text-muted" /> Industry
                </CardTitle>
              </CardHeader>
              <CardContent>
                {editingProfile ? (
                  <Input
                    value={companyProfile.industry}
                    onChange={(e) => setCompanyProfile({ ...companyProfile, industry: e.target.value })}
                    placeholder="e.g., Technology, Finance"
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted">{companyProfile.industry || "—"}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar size={14} className="text-muted" /> Founded
                </CardTitle>
              </CardHeader>
              <CardContent>
                {editingProfile ? (
                  <Input
                    value={companyProfile.founded}
                    onChange={(e) => setCompanyProfile({ ...companyProfile, founded: e.target.value })}
                    placeholder="e.g., 2020"
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted">{companyProfile.founded || "—"}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{departments.length}</p>
                <p className="text-xs text-muted">Departments</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{roles.length}</p>
                <p className="text-xs text-muted">Roles</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-xs text-muted">Team Members</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-[#d4ff2e]">{companyProfile.values.length}</p>
                <p className="text-xs text-muted">Core Values</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

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
                <Card key={dept.id} className="hover:border-muted-2 transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: (dept.color || "#d4ff2e") + "20" }}>
                          <Building2 size={20} style={{ color: dept.color || "#d4ff2e" }} />
                        </div>
                        <div>
                          <h3 className="font-semibold">{dept.name}</h3>
                          <p className="text-xs text-muted">{dept.description || "No description"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditDept(dept); }}>
                          <Edit3 size={13} className="text-muted" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); confirmDelete("dept", dept); }}>
                          <Trash2 size={13} className="text-red-400" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-background p-2.5 text-center">
                        <p className="text-lg font-bold">{memberCount}</p>
                        <p className="text-[10px] text-muted">Members</p>
                      </div>
                      <div className="rounded-lg bg-background p-2.5 text-center">
                        <p className="text-lg font-bold">{dept.roles?.length || 0}</p>
                        <p className="text-[10px] text-muted">Roles</p>
                      </div>
                    </div>

                    {headName && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-muted border-t border-border pt-3">
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
                    <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]" value={roleForm.departmentId} onChange={(e) => setRoleForm({ ...roleForm, departmentId: e.target.value })}>
                      <option value="">Select department...</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Level</Label>
                    <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]" value={roleForm.level} onChange={(e) => setRoleForm({ ...roleForm, level: e.target.value })}>
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
                  <tr className="border-b border-border">
                    <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Role</th>
                    <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Department</th>
                    <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Level</th>
                    <th className="text-right p-4 text-xs font-medium text-muted uppercase tracking-wider">People</th>
                    <th className="text-right p-4 text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors cursor-pointer">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Briefcase size={14} className="text-[#d4ff2e]" />
                          <span className="text-sm font-medium">{role.title}</span>
                        </div>
                      </td>
                      <td className="p-4"><Badge variant="outline" className="text-xs">{role.department?.name || "—"}</Badge></td>
                      <td className="p-4"><Badge variant="secondary" className="text-xs">{(role.level || "EMPLOYEE").replace(/_/g, " ")}</Badge></td>
                      <td className="p-4 text-right text-sm text-muted">{role._count?.users ?? role.users?.length ?? 0}</td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditRole(role)}>
                            <Edit3 size={13} className="text-muted" />
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

        {/* Offices Tab */}
        <TabsContent value="offices" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={showAddOffice} onOpenChange={setShowAddOffice}>
              <Button className="gap-2" onClick={() => setShowAddOffice(true)}><Plus size={16} /> Add Office</Button>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Office Location</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Office Name <span className="text-red-400">*</span></Label>
                    <Input placeholder="e.g., Mumbai HQ" value={officeForm.name} onChange={(e) => setOfficeForm({ ...officeForm, name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>City</Label>
                      <Input placeholder="e.g., Mumbai" value={officeForm.city} onChange={(e) => setOfficeForm({ ...officeForm, city: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Country</Label>
                      <Input placeholder="e.g., India" value={officeForm.country} onChange={(e) => setOfficeForm({ ...officeForm, country: e.target.value })} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={officeForm.isHeadquarters} onChange={(e) => setOfficeForm({ ...officeForm, isHeadquarters: e.target.checked })} className="rounded" />
                    <span className="text-sm">This is the headquarters</span>
                  </label>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddOffice(false)}>Cancel</Button>
                  <Button onClick={async () => {
                    if (!officeForm.name.trim()) return;
                    const res = await fetch("/api/offices", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(officeForm),
                    });
                    if (res.ok) {
                      setShowAddOffice(false);
                      setOfficeForm({ name: "", city: "", country: "", isHeadquarters: false });
                      fetchData();
                      toastSuccess("Office added");
                    }
                  }} disabled={!officeForm.name.trim()}>Add Office</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {officesList.length === 0 ? (
            <Card><CardContent className="p-8 text-center">
              <Globe size={32} className="mx-auto text-muted mb-2" />
              <p className="text-sm text-muted">No offices added yet. Add your company locations.</p>
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {officesList.map((office: any) => (
                <Card key={office.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Globe size={16} className="text-[#d4ff2e]" />
                        <h3 className="font-semibold text-sm">{office.name}</h3>
                        {office.isHeadquarters && <Badge variant="secondary" className="text-[10px]">HQ</Badge>}
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-muted">
                      {office.city && <p>{office.city}{office.country ? `, ${office.country}` : ""}</p>}
                      {office.timezone && <p>Timezone: {office.timezone}</p>}
                    </div>
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs text-muted">{office._count?.members ?? 0} members</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="orgchart" className="mt-2">
          <OrgChartCanvas users={users} departments={departments} />
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
              <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]" value={roleForm.departmentId} onChange={(e) => setRoleForm({ ...roleForm, departmentId: e.target.value })}>
                <option value="">Select department...</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Level</Label>
              <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]" value={roleForm.level} onChange={(e) => setRoleForm({ ...roleForm, level: e.target.value })}>
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
